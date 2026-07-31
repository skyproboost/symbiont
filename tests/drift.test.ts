import { describe, it, expect } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { computeHealth, captureHealth, ensureSnapshots, computeDrift, renderDrift, computeHotspots, renderDriftReport, type HealthMetrics } from '../src/gardener/drift'
import type { CommitInfo } from '../src/passport/constitution-derive'

const iso = (d: string): string => new Date(d).toISOString()

function snap(db: Database, commit: string, ts: string, m: Partial<HealthMetrics>): void {
  ensureSnapshots(db)
  const full: HealthMetrics = { lawCount: 0, lawPrevalence: 1, activeFacts: 0, graphNodes: 0, graphEdges: 0, density: 0, orphans: 0, broken: 0, gateCatches: 0, ...m }
  db.query('INSERT INTO health_snapshot(commit_hash, ts, metrics) VALUES(?,?,?)').run(commit, ts, JSON.stringify(full))
}

describe('computeHealth — из паспорта', () => {
  it('считает законы/факты/граф/сироты/битые/поимки', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(id INTEGER PRIMARY KEY, tier TEXT, prevalence REAL, superseded_by INTEGER)')
    db.query('INSERT INTO fact_journal(tier,prevalence,superseded_by) VALUES(?,?,?)').run('закон', 1.0, null)
    db.query('INSERT INTO fact_journal(tier,prevalence,superseded_by) VALUES(?,?,?)').run('закон', 0.9, null)
    db.query('INSERT INTO fact_journal(tier,prevalence,superseded_by) VALUES(?,?,?)').run('привычка', 0.5, null)
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY)')
    db.run('CREATE TABLE graph_edges(from_file TEXT, to_file TEXT)')
    db.query('INSERT INTO graph_nodes(file) VALUES(?)').run('a')
    db.query('INSERT INTO graph_nodes(file) VALUES(?)').run('b')
    db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)').run('a', 'b')
    const h = computeHealth(db)
    expect(h.lawCount).toBe(2)
    expect(h.lawPrevalence).toBeCloseTo(0.95, 5)
    expect(h.activeFacts).toBe(3)
    expect(h.graphNodes).toBe(2)
    expect(h.density).toBeCloseTo(0.5, 5)
    db.close()
  })
  it('пустой паспорт — нули, не падает', () => {
    const h = computeHealth(openDb(':memory:'))
    expect(h.lawCount).toBe(0)
    expect(h.density).toBe(0)
  })
})

describe('captureHealth', () => {
  it('latest-wins на коммит; no-git пропускается', () => {
    const db = openDb(':memory:')
    captureHealth(db, 'abc', iso('2026-07-01'))
    captureHealth(db, 'abc', iso('2026-07-02')) // тот же коммит — обновление
    captureHealth(db, 'no-git', iso('2026-07-03')) // пропуск
    captureHealth(db, '', iso('2026-07-03')) // пропуск
    const rows = db.query('SELECT commit_hash, ts FROM health_snapshot').all() as Array<{ commit_hash: string; ts: string }>
    expect(rows.length).toBe(1)
    expect(rows[0].ts).toBe(iso('2026-07-02'))
    db.close()
  })
})

describe('computeDrift / renderDrift', () => {
  it('<2 снимков → null → пустая строка', () => {
    const db = openDb(':memory:')
    snap(db, 'c1', iso('2026-07-01'), {})
    expect(computeDrift(db)).toBe(null)
    expect(renderDrift(null)).toBe('')
    db.close()
  })

  it('деградация: конвенции просели + сироты выросли → строка ухудшений (СИМУЛЯЦИЯ)', () => {
    const db = openDb(':memory:')
    snap(db, 'c1', iso('2026-07-01'), { lawPrevalence: 0.98, orphans: 2, broken: 0 }) // база
    snap(db, 'c2', iso('2026-07-10'), { lawPrevalence: 0.90, orphans: 9, broken: 3 }) // сейчас (хуже)
    const line = renderDrift(computeDrift(db))
    expect(line).toContain('Уползание')
    expect(line).toContain('конвенции −8%')
    expect(line).toContain('сироты +7')
    expect(line).toContain('битые ссылки +3')
    db.close()
  })

  it('стабильно/лучше → молчание (пустая строка)', () => {
    const db = openDb(':memory:')
    snap(db, 'c1', iso('2026-07-01'), { lawPrevalence: 0.90, orphans: 9 }) // было хуже
    snap(db, 'c2', iso('2026-07-10'), { lawPrevalence: 0.98, orphans: 2 }) // стало лучше
    expect(renderDrift(computeDrift(db))).toBe('')
    db.close()
  })

  it('шум ниже порога не репортится (просадка 1% < 3%)', () => {
    const db = openDb(':memory:')
    snap(db, 'c1', iso('2026-07-01'), { lawPrevalence: 0.99, orphans: 2 })
    snap(db, 'c2', iso('2026-07-10'), { lawPrevalence: 0.98, orphans: 3 })
    expect(renderDrift(computeDrift(db))).toBe('')
    db.close()
  })

  it('оплотнение графа (density рост) репортится', () => {
    const db = openDb(':memory:')
    snap(db, 'c1', iso('2026-07-01'), { density: 2.0 })
    snap(db, 'c2', iso('2026-07-10'), { density: 2.8 })
    expect(renderDrift(computeDrift(db))).toContain('плотность графа')
    db.close()
  })
})

describe('computeHotspots — частота фиксов × размер', () => {
  const commits: CommitInfo[] = [
    { subject: 'fix(gate): предохранитель', files: ['src/gate.ts'] },
    { subject: 'fix: снова gate', files: ['src/gate.ts', 'src/util.ts'] },
    { subject: 'revert: откат gate', files: ['src/gate.ts'] },
    { subject: 'feat: новая фича', files: ['src/gate.ts', 'src/big.ts'] }, // feat — не фикс, не считается
    { subject: 'fix: правка util', files: ['src/util.ts'] },
  ]
  const sizeByFile = new Map([['src/gate.ts', 300], ['src/util.ts', 50], ['src/gone.ts', 999]])

  it('ранжирует по score=фиксы×размер; только существующие и ≥2 фиксов', () => {
    const hs = computeHotspots(commits, sizeByFile)
    // gate: 3 фикса (fix,fix,revert) × 300 = 900; util: 2 фикса × 50 = 100
    expect(hs.map((h) => h.file)).toEqual(['src/gate.ts', 'src/util.ts'])
    expect(hs[0].fixes).toBe(3)
    expect(hs[0].score).toBe(900)
  })
  it('feat-only файл (big.ts, 0 фиксов) и удалённый (gone) — не hotspot', () => {
    const hs = computeHotspots(commits, sizeByFile)
    expect(hs.some((h) => h.file === 'src/big.ts')).toBe(false)
  })
  it('единичный фикс (<2) не hotspot', () => {
    const one: CommitInfo[] = [{ subject: 'fix: разово', files: ['x.ts'] }]
    expect(computeHotspots(one, new Map([['x.ts', 100]]))).toEqual([])
  })
})

describe('renderDriftReport — полный отчёт о здоровье', () => {
  it('здоровье + тренд + зоны частых починок в отчёте', () => {
    const health: HealthMetrics = { lawCount: 5, lawPrevalence: 0.97, activeFacts: 40, graphNodes: 100, graphEdges: 250, density: 2.5, orphans: 3, broken: 1, gateCatches: 0 }
    const hotspots = [{ file: 'src/gate.ts', fixes: 3, size: 300, score: 900 }]
    const rep = renderDriftReport(health, null, hotspots)
    expect(rep).toContain('Здоровье сейчас')
    expect(rep).toContain('законов 5')
    expect(rep).toContain('снимков мало') // тренда нет
    expect(rep).toContain('Где чаще всего чинят')
    expect(rep).toContain('src/gate.ts · фиксов 3 · 300 строк')
  })
  it('нет выраженных зон → честная строка', () => {
    const health: HealthMetrics = { lawCount: 0, lawPrevalence: 0, activeFacts: 0, graphNodes: 0, graphEdges: 0, density: 0, orphans: 0, broken: 0, gateCatches: 0 }
    expect(renderDriftReport(health, null, [])).toContain('выраженных зон нет')
  })
})
