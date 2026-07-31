/**
 * Salsa-lite: инкрементальные вычисления «истина → проекции» поверх SQLite.
 *
 * Модель (rust-analyzer/Salsa, упрощено до нашего масштаба):
 * - inputs: пары (key, hash); смена hash двигает глобальную ревизию.
 * - запросы: чистые функции от inputs и других запросов; зависимости
 *   записываются автоматически во время выполнения.
 * - red-green: перед пересчётом проверяем зависимости; если ни одна не
 *   менялась после нашей verified_at — только штампуем ревизию.
 * - early cutoff: если пересчёт дал побайтово тот же результат,
 *   changed_at не двигается — всё, что выше по графу, не пересобирается.
 */
import { openDb, type Database } from './db'
import { createHash } from 'node:crypto'

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

export interface QueryCtx {
  /** Объявить зависимость от входа и получить его hash (null — входа нет). */
  input(key: string): string | null
  /** Объявить зависимость от другого запроса и получить его значение. */
  get<T = unknown>(query: string): T
}

type QueryFn = (ctx: QueryCtx) => unknown

interface MemoRow {
  query: string
  value: string
  value_hash: string
  verified_at: number
  changed_at: number
}

export class Engine {
  readonly db: Database
  private queries = new Map<string, QueryFn>()
  private execCount = new Map<string, number>()

  constructor(dbPath: string) {
    this.db = openDb(dbPath)
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA synchronous = NORMAL')
    this.db.run(
      'CREATE TABLE IF NOT EXISTS inputs(key TEXT PRIMARY KEY, hash TEXT NOT NULL, changed_at INTEGER NOT NULL)',
    )
    this.db.run(
      'CREATE TABLE IF NOT EXISTS memo(query TEXT PRIMARY KEY, value TEXT NOT NULL, value_hash TEXT NOT NULL, verified_at INTEGER NOT NULL, changed_at INTEGER NOT NULL)',
    )
    this.db.run(
      'CREATE TABLE IF NOT EXISTS deps(query TEXT NOT NULL, dep TEXT NOT NULL, PRIMARY KEY(query, dep))',
    )
    this.db.run('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)')
    this.db.run("INSERT OR IGNORE INTO meta VALUES('rev', 0)")
  }

  /**
   * Инвалидация по версии кода проекций. Salsa обновляет записанные
   * зависимости запроса только при его перезапуске — поэтому смена
   * ЛОГИКИ (новая зависимость/формат) в запросе, который остаётся «чистым»
   * по старым зависимостям, не подхватывается никогда. Лечение как миграция:
   * версия проекций сменилась → один раз чистим memo/deps, всё пересчитается
   * из истины (входы целы). Дёшево, детерминированно, отлаживаемо.
   */
  invalidateIfCodeChanged(codeVersion: string): boolean {
    this.db.run('CREATE TABLE IF NOT EXISTS code_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    const row = this.db.query("SELECT v FROM code_meta WHERE k='projection_version'").get() as { v: string } | null
    if (row && row.v === codeVersion) return false
    this.db.run('DELETE FROM memo')
    this.db.run('DELETE FROM deps')
    this.db
      .query("INSERT INTO code_meta(k,v) VALUES('projection_version',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .run(codeVersion)
    return true
  }

  get rev(): number {
    return (this.db.query("SELECT v FROM meta WHERE k='rev'").get() as { v: number }).v
  }

  private bumpRev(): number {
    this.db.run("UPDATE meta SET v = v + 1 WHERE k='rev'")
    return this.rev
  }

  /** Задать вход; ревизия двигается только при реальной смене hash. */
  setInput(key: string, hash: string): void {
    const row = this.db.query('SELECT hash FROM inputs WHERE key=?').get(key) as { hash: string } | null
    if (row && row.hash === hash) return
    const rev = this.bumpRev()
    this.db
      .query(
        'INSERT INTO inputs(key,hash,changed_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash, changed_at=excluded.changed_at',
      )
      .run(key, hash, rev)
  }

  register(name: string, fn: QueryFn): void {
    this.queries.set(name, fn)
  }

  /** Сколько раз запрос реально выполнялся в этом процессе (для тестов и status). */
  executions(name: string): number {
    return this.execCount.get(name) ?? 0
  }

  /** changed_at зависимости; отсутствующая зависимость = «всегда изменилась». */
  private changedAtOf(dep: string): number {
    if (dep.startsWith('input:')) {
      const row = this.db.query('SELECT changed_at FROM inputs WHERE key=?').get(dep.slice(6)) as
        | { changed_at: number }
        | null
      return row ? row.changed_at : Number.POSITIVE_INFINITY
    }
    this.get(dep)
    const row = this.db.query('SELECT changed_at FROM memo WHERE query=?').get(dep) as
      | { changed_at: number }
      | null
    return row ? row.changed_at : Number.POSITIVE_INFINITY
  }

  get<T = unknown>(name: string): T {
    const rev = this.rev
    const memo = this.db.query('SELECT * FROM memo WHERE query=?').get(name) as MemoRow | null

    if (memo && memo.verified_at === rev) return JSON.parse(memo.value) as T

    if (memo) {
      const deps = (this.db.query('SELECT dep FROM deps WHERE query=?').all(name) as { dep: string }[]).map(
        (d) => d.dep,
      )
      const clean = deps.length > 0 && deps.every((d) => this.changedAtOf(d) <= memo.verified_at)
      if (clean) {
        this.db.query('UPDATE memo SET verified_at=? WHERE query=?').run(rev, name)
        return JSON.parse(memo.value) as T
      }
    }

    const fn = this.queries.get(name)
    if (!fn) throw new Error(`Запрос не зарегистрирован: ${name}`)

    const deps = new Set<string>()
    const ctx: QueryCtx = {
      input: (key) => {
        deps.add('input:' + key)
        const row = this.db.query('SELECT hash FROM inputs WHERE key=?').get(key) as { hash: string } | null
        return row ? row.hash : null
      },
      get: <V>(q: string): V => {
        deps.add(q)
        return this.get<V>(q)
      },
    }

    this.execCount.set(name, (this.execCount.get(name) ?? 0) + 1)
    const value = fn(ctx)
    const valueText = JSON.stringify(value ?? null)
    const valueHash = sha1(valueText)
    // early cutoff: тот же результат — changed_at не двигается
    const changedAt = memo && memo.value_hash === valueHash ? memo.changed_at : rev

    this.db
      .query(
        'INSERT INTO memo(query,value,value_hash,verified_at,changed_at) VALUES(?,?,?,?,?) ON CONFLICT(query) DO UPDATE SET value=excluded.value, value_hash=excluded.value_hash, verified_at=excluded.verified_at, changed_at=excluded.changed_at',
      )
      .run(name, valueText, valueHash, rev, changedAt)
    this.db.query('DELETE FROM deps WHERE query=?').run(name)
    const insDep = this.db.query('INSERT OR IGNORE INTO deps(query,dep) VALUES(?,?)')
    for (const d of deps) insDep.run(name, d)

    return value as T
  }

  close(): void {
    this.db.close()
  }
}
