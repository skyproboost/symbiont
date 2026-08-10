import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import {
  decayHeat,
  bumpHeat,
  effectiveHeat,
  hotFiles,
  readHeatRows,
  HEAT_HALF_LIFE_MS,
  HEAT_CAP,
  READ_TOUCH_WEIGHT,
  EDIT_TOUCH_WEIGHT,
  type HeatRow,
} from '../src/graph/heat'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePostTool } from '../src/hooks/post-tool-core'

const T0 = Date.parse('2026-07-30T12:00:00Z')
const iso = (ms: number): string => new Date(ms).toISOString()

describe('decayHeat — forward decay', () => {
  it('за полураспад тепло падает вдвое', () => {
    expect(decayHeat(1, HEAT_HALF_LIFE_MS)).toBeCloseTo(0.5, 5)
    expect(decayHeat(1, 2 * HEAT_HALF_LIFE_MS)).toBeCloseTo(0.25, 5)
  })
  it('возраст 0/отрицательный/битый → без изменений', () => {
    expect(decayHeat(1, 0)).toBe(1)
    expect(decayHeat(1, -100)).toBe(1)
    expect(decayHeat(1, NaN)).toBe(1)
  })
})

describe('bumpHeat — бамп поверх остывшего', () => {
  it('первое касание = 1.0; второе через полураспад = 0.5+1.0', () => {
    const db = openDb(':memory:')
    bumpHeat(db, 'a.ts', iso(T0))
    expect((db.query('SELECT heat FROM node_heat WHERE file=?').get('a.ts') as { heat: number }).heat).toBeCloseTo(1.0, 5)
    bumpHeat(db, 'a.ts', iso(T0 + HEAT_HALF_LIFE_MS))
    expect((db.query('SELECT heat FROM node_heat WHERE file=?').get('a.ts') as { heat: number }).heat).toBeCloseTo(1.5, 5)
    db.close()
  })
  it('правка греет сильнее чтения (вес касания)', () => {
    const db = openDb(':memory:')
    bumpHeat(db, 'r.ts', iso(T0), READ_TOUCH_WEIGHT)
    bumpHeat(db, 'e.ts', iso(T0), EDIT_TOUCH_WEIGHT)
    const heat = (f: string): number => (db.query('SELECT heat FROM node_heat WHERE file=?').get(f) as { heat: number }).heat
    expect(heat('e.ts')).toBeCloseTo(4 * heat('r.ts'), 5)
    db.close()
  })
  it('кап насыщения: шлифовка одного файла не растит тепло бесконечно', () => {
    // Без капа длинная сессия в одном файле держала бы узел «горячим»
    // неделями, перевешивая всю остальную работу (болезнь, от которой Chrome
    // ввёл дневной потолок начисления Site Engagement)
    const db = openDb(':memory:')
    for (let i = 0; i < 50; i++) bumpHeat(db, 'grind.ts', iso(T0 + i * 60_000), EDIT_TOUCH_WEIGHT)
    const h = (db.query('SELECT heat FROM node_heat WHERE file=?').get('grind.ts') as { heat: number }).heat
    expect(h).toBeLessThanOrEqual(HEAT_CAP)
    expect(h).toBeCloseTo(HEAT_CAP, 5)
    db.close()
  })
  it('разные файлы независимы', () => {
    const db = openDb(':memory:')
    bumpHeat(db, 'a.ts', iso(T0))
    bumpHeat(db, 'b.ts', iso(T0))
    expect(readHeatRows(db).length).toBe(2)
    db.close()
  })
})

describe('effectiveHeat / hotFiles', () => {
  const rows: HeatRow[] = [
    { file: 'hot.ts', heat: 2.0, updated_at: iso(T0) },
    { file: 'warm.ts', heat: 1.0, updated_at: iso(T0 - HEAT_HALF_LIFE_MS) }, // остынет до 0.5
    { file: 'cold.ts', heat: 1.0, updated_at: iso(T0 - 10 * HEAT_HALF_LIFE_MS) }, // ~0
  ]

  it('остужает по возрасту, нулевое отбрасывает', () => {
    const h = effectiveHeat(rows, T0)
    expect(h.get('hot.ts')).toBeCloseTo(2.0, 5)
    expect(h.get('warm.ts')).toBeCloseTo(0.5, 5)
    expect(h.get('cold.ts') ?? 0).toBeLessThan(0.01)
  })
  it('hotFiles: порог + топ N + по убыванию', () => {
    const h = effectiveHeat(rows, T0)
    expect(hotFiles(h, 0.5, 5)).toEqual(['hot.ts', 'warm.ts']) // cold ниже порога
    expect(hotFiles(h, 0.5, 1)).toEqual(['hot.ts'])
    expect(hotFiles(h, 1.5, 5)).toEqual(['hot.ts'])
  })
  it('нет таблицы → readHeatRows пусто (fail-open)', () => {
    const db = openDb(':memory:')
    expect(readHeatRows(db)).toEqual([])
    db.close()
  })
})

describe('интеграция: касание файла греет узел (PostToolUse)', () => {
  function makeWorld() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-heat-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-heat-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const db = openDb(join(dataDir, 'passport.db'))
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
    db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
    db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.4, 2, 0)
    db.close()
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'core.ts'), "const x = 'ок'\n")
    return { proj, dataRoot, dataDir }
  }

  it('Read узла графа → node_heat пополнился', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    handlePostTool({ cwd: proj, session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(proj, 'src', 'core.ts') } }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const rows = readHeatRows(db)
    db.close()
    expect(rows.find((r) => r.file === 'src/core.ts')?.heat).toBeGreaterThan(0)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('касание файла ВНЕ графа тепло не пишет', () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    writeFileSync(join(proj, 'src', 'other.ts'), "const y = 1\n")
    handlePostTool({ cwd: proj, session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(proj, 'src', 'other.ts') } }, dataRoot)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const rows = readHeatRows(db)
    db.close()
    expect(rows.find((r) => r.file === 'src/other.ts')).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })
})
