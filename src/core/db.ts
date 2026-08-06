/**
 * Драйвер хранилища: единственное место в системе, которое знает, на каком
 * рантайме мы исполняемся.
 *
 * Мотив — аксиома живучести (CONCEPT §7: минимум обязательных предпосылок к
 * окружению). Прямой импорт `bun:sqlite` из шести десятков модулей делал bun
 * обязательным условием жизни плагина: на машине без него не стартовал ни один
 * канал, причём молча. Node есть у всех, кто вообще способен запустить Claude
 * Code, а с Node 22 в нём появилось встроенное хранилище `node:sqlite` — значит
 * предпосылка снимается не переписыванием кода, а одним слоем совместимости.
 *
 * Форма слоя. Наружу торчит ровно то подмножество API bun:sqlite, которое проект
 * использует: query/run/close. Узость контракта намеренная — чем меньше
 * поверхность, тем меньше мест, где драйверы могут разойтись.
 *
 * Почему драйвер грузится, а не импортируется. Статический `import` привязал бы
 * модуль к рантайму намертво: bun не знает `node:sqlite`, node не знает
 * `bun:sqlite` — любой из двух импортов падал бы на чужой машине ещё до первой
 * строки логики. Динамический `await import()` сделал бы асинхронной всю
 * синхронную цепочку вызовов проекта. Поэтому загрузка синхронная и живёт в
 * runtime.ts (loadSqliteDriver) — там же, где отвечают на вопрос «что вообще
 * есть на этой машине»; здесь — только форма API поверх загруженного.
 *
 * Отвергнутая альтернатива: оставить различия драйверов как есть и чинить их по
 * месту вызова. Тогда одна и та же правка работала бы на bun и падала на node
 * (node отказывается связывать boolean и undefined, а промах `.get()` отдаёт
 * undefined вместо null) — расхождение всплыло бы у владельца, а не в тестах.
 * Поэтому node-адаптер приводит семантику к bun, а не наоборот: эталон — тот
 * драйвер, под который написаны все шестьдесят модулей.
 */
import { inspectRuntime, loadSqliteDriver, runtimeBlocker } from './runtime'

/** Значения, которые проект связывает с параметрами запроса. */
export type SqlParam = string | number | bigint | boolean | null | undefined | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface Statement {
  all(...params: SqlParam[]): unknown[]
  get(...params: SqlParam[]): unknown | null
  run(...params: SqlParam[]): RunResult
}

/**
 * Подключение к хранилищу. Имя типа сохранено от bun:sqlite намеренно: сигнатуры
 * шестидесяти модулей продолжают читаться как раньше, меняется только источник.
 */
export interface Database {
  query(sql: string): Statement
  run(sql: string, ...params: SqlParam[]): RunResult
  close(): void
}

export interface OpenOptions {
  readonly?: boolean
}

/** Драйвер, на котором фактически открываются базы в этом процессе. */
export type DriverKind = 'bun' | 'node'

interface BunSqliteModule {
  Database: new (path: string, options?: { readonly?: boolean }) => Database
}

interface NodeStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

interface NodeDatabaseSync {
  prepare(sql: string): NodeStatement
  close(): void
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => NodeDatabaseSync
}

let bunSqlite: BunSqliteModule | null = null
let nodeSqlite: NodeSqliteModule | null = null

/**
 * Экспериментальный статус node:sqlite печатается в stderr при первой загрузке.
 * Гасим только его: хук обязан молчать, когда всё в порядке, но чужие
 * предупреждения глушить не вправе — они уходят прежним обработчикам.
 */
function silenceSqliteExperimentalWarning(): void {
  const previous = process.listeners('warning')
  process.removeAllListeners('warning')
  process.on('warning', (w: Error) => {
    if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return
    for (const listener of previous) listener(w)
  })
}

/** Какой драйвер будет использован; вычисляется по рантайму, а не по догадке. */
export function driverKind(): DriverKind {
  return inspectRuntime().runtime === 'bun' ? 'bun' : 'node'
}

/** node:sqlite не связывает boolean и undefined, а bun связывает — выравниваем. */
function normalize(params: SqlParam[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}

class NodeStatementAdapter implements Statement {
  constructor(private stmt: NodeStatement) {}

  all(...params: SqlParam[]): unknown[] {
    return this.stmt.all(...normalize(params))
  }

  /** Промах у node — undefined, у bun — null; наружу всегда null. */
  get(...params: SqlParam[]): unknown | null {
    const row = this.stmt.get(...normalize(params))
    return row === undefined ? null : row
  }

  run(...params: SqlParam[]): RunResult {
    const r = this.stmt.run(...normalize(params))
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }
}

class NodeDatabaseAdapter implements Database {
  /**
   * Кэш подготовленных запросов. У bun `query()` кэширует сам, и код проекта на
   * это опирается: одни и те же строки SQL зовутся в циклах. Без кэша node
   * готовил бы запрос заново на каждой итерации — та же семантика, но другая цена.
   */
  private prepared = new Map<string, Statement>()

  constructor(private db: NodeDatabaseSync) {}

  query(sql: string): Statement {
    const hit = this.prepared.get(sql)
    if (hit) return hit
    const stmt = new NodeStatementAdapter(this.db.prepare(sql))
    this.prepared.set(sql, stmt)
    return stmt
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    return this.query(sql).run(...params)
  }

  close(): void {
    this.prepared.clear()
    this.db.close()
  }
}

/**
 * Ожидание освобождения базы, миллисекунды. Оба драйвера по умолчанию не ждут
 * ни мгновения: параллельная запись садовника роняет канал подачи с «database is
 * locked», хук честно отрабатывает fail-open — и срез просто не появляется.
 * Замерено: 2 отказа на 2475 открытий, пока фон работает. Дефект был всегда,
 * порт на node лишь сдвинул тайминги и сделал его видимым.
 *
 * Значение с запасом меньше самого короткого таймаута канала (SessionEnd — 5с):
 * лучше подождать миллисекунды, чем промолчать. Отвергнуто: повторные попытки в
 * коде вызова — тот же цикл ожидания, но размазанный по шестидесяти модулям.
 */
const BUSY_TIMEOUT_MS = 2000

/**
 * Открыть базу тем драйвером, который есть в этом рантайме. Ошибка загрузки
 * драйвера не глушится: без хранилища работать всё равно нечем, а причину
 * владельцу объясняет строка предпосылок в стартовой сводке (runtime.ts).
 */
export function openDb(path: string, options: OpenOptions = {}): Database {
  const db = openDriver(path, options)
  try {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  } catch {
    /* read-only подключение к чужой базе может отказать в PRAGMA — не повод не работать */
  }
  return db
}

function openDriver(path: string, options: OpenOptions): Database {
  if (driverKind() === 'bun') {
    if (!bunSqlite) bunSqlite = mustLoad('bun', 'драйвер bun:sqlite') as BunSqliteModule
    return new bunSqlite.Database(path, options.readonly ? { readonly: true } : undefined)
  }
  if (!nodeSqlite) {
    silenceSqliteExperimentalWarning()
    nodeSqlite = mustLoad('node', 'встроенное хранилище node:sqlite (нужен Node 22.13+ или bun)') as NodeSqliteModule
  }
  return new NodeDatabaseAdapter(new nodeSqlite.DatabaseSync(path, options.readonly ? { readOnly: true } : {}))
}

/**
 * Драйвер обязателен: без хранилища паспорт держать негде. Отсутствие драйвера
 * — не тихий null, а исключение с внятным текстом: канал отработает fail-open,
 * но причина уйдёт в стартовую сводку строкой предпосылок (runtime.ts).
 */
function mustLoad(runtime: DriverKind, what: string): unknown {
  const driver = loadSqliteDriver(runtime)
  if (!driver) {
    // Текст исключения — тоже сообщение человеку, а не только запись в лог.
    // Прежнее «недоступен node:sqlite» называло симптом и молчало о том, что
    // делать; на чужой машине оно вышло восемью строками стека ESM-загрузчика.
    throw new Error(runtimeBlocker() ?? `Symbiont: в этом рантайме недоступен ${what}`)
  }
  return driver
}
