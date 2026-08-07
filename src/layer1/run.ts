/**
 * Прогон слоя 1: инкрементально, с бюджетом времени, crash-only.
 *
 * - Кэш метрик по content-hash: неизменённый файл не парсится никогда;
 *   большой репозиторий дожёвывается за несколько заходов (курсор — сам кэш).
 * - Журнал трогается ТОЛЬКО при изменении агрегата И полном покрытии
 *   (частичный замер под бюджетом — не основание для вердикта).
 * - Владение фактами: source miner:layer1; исчезнувший вердикт отзывается.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { openDb } from '../core/db'
import { sha1 } from '../core/salsa'
import { FactStore, keyOf } from '../core/store'
import { walkFiles, codeFiles } from '../miner/walk'
import { withRoot, collectMetrics, astSource, astSupported, addMetrics, zeroMetrics, type AstMetrics } from './ast'
import { collectOutline, ensureSymbols, indexedHash, storeOutline, pruneSymbols, type SymbolRow } from './symbols'
import { deriveAstFacts } from './facts1'
import type { Fact } from '../miner/facts'

const MAX_FILE = 300_000

export interface Layer1Result {
  parsed: number
  fromCache: number
  pending: number // не успели в бюджет — дожуём следующим заходом
  facts: Fact[]
  asserted: boolean
}

export async function runLayer1(projectRoot: string, dataDir: string, budgetMs = Infinity): Promise<Layer1Result> {
  const db = openDb(join(dataDir, 'passport.db'))
  const t0 = Date.now()
  try {
    db.run('CREATE TABLE IF NOT EXISTS layer1_cache(path TEXT PRIMARY KEY, hash TEXT NOT NULL, metrics TEXT NOT NULL)')
    db.run('CREATE TABLE IF NOT EXISTS layer1_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    ensureSymbols(db)
    const cacheGet = db.query('SELECT hash, metrics FROM layer1_cache WHERE path=?')
    const cachePut = db.query(
      'INSERT INTO layer1_cache(path,hash,metrics) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, metrics=excluded.metrics',
    )

    const files = codeFiles(walkFiles(projectRoot)).filter((f) => astSupported(f.ext) && f.size <= MAX_FILE)
    const present = new Set<string>()
    let parsed = 0
    let fromCache = 0
    let pending = 0

    for (const f of files) {
      const rel = relative(projectRoot, f.path).replaceAll('\\', '/')
      present.add(rel)
      let content: string
      try {
        content = readFileSync(f.path, 'utf8')
      } catch {
        continue // исчез между walk и чтением
      }
      const hash = sha1(content)
      const cached = cacheGet.get(rel) as { hash: string; metrics: string } | null
      const needMetrics = !cached || cached.hash !== hash
      // Оглавление сверяется СВОИМ хэшом, а не метрик: иначе обновление плагина
      // застало бы весь кэш свежим и структура не построилась бы ни для одного
      // файла — до его следующей правки, то есть, возможно, никогда.
      const needOutline = indexedHash(db, rel) !== hash
      if (!needMetrics && !needOutline) {
        fromCache++
        continue
      }
      if (Date.now() - t0 > budgetMs) {
        pending++
        continue // бюджет вышел — файл дождётся следующего захода
      }
      const source = astSource(f.ext, content)
      if (source === null) continue // расширение вне слоя (или .vue без script)
      // Один разбор — два вывода: метрики конвенций и оглавление файла
      const got = await withRoot(f.ext, source, (root) => ({
        metrics: collectMetrics(root),
        outline: f.ext === '.vue' ? [] : collectOutline(root),
      }))
      if (got === null) continue // язык недоступен — файл вне слоя
      cachePut.run(rel, hash, JSON.stringify(got.metrics))
      storeOutline(db, rel, hash, got.outline as SymbolRow[])
      parsed++
    }

    pruneSymbols(db, present)

    // Уборка кэша от удалённых файлов
    const cachedPaths = (db.query('SELECT path FROM layer1_cache').all() as Array<{ path: string }>).map((r) => r.path)
    const del = db.query('DELETE FROM layer1_cache WHERE path=?')
    for (const p of cachedPaths) if (!present.has(p)) del.run(p)

    // Агрегат по всему покрытому кэшу
    let agg: AstMetrics = zeroMetrics()
    for (const row of db.query('SELECT metrics FROM layer1_cache').all() as Array<{ metrics: string }>) {
      try {
        agg = addMetrics(agg, JSON.parse(row.metrics) as AstMetrics)
      } catch {
        continue
      }
    }
    const facts = deriveAstFacts(agg)

    // Вердикты — только при полном покрытии и реальном изменении агрегата
    let asserted = false
    if (pending === 0) {
      const aggHash = sha1(JSON.stringify(agg))
      const prev = (db.query("SELECT value FROM layer1_meta WHERE key='agg'").get() as { value: string } | null)?.value
      if (prev !== aggHash) {
        const store = new FactStore(db)
        store.assertAll(facts, 'miner:layer1')
        store.retractMissingBySource('miner:layer1', new Set(facts.map((f) => keyOf(f))))
        db.query("INSERT INTO layer1_meta(key,value) VALUES('agg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(aggHash)
        asserted = true
      }
    }

    return { parsed, fromCache, pending, facts, asserted }
  } finally {
    db.close()
  }
}
