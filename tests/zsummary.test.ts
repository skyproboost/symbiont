/**
 * Ленивые z-резюме (зум-граф ч.4): очередь визитов, инвалидация по content-hash,
 * строгий парс, пакетная генерация и подача роли в срезе узла.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Database } from '../src/core/db'
import {
  ensureSummaryTables,
  markVisited,
  summaryFor,
  contentHashOf,
  contentHashes,
  pendingSummaries,
  parseSummaries,
  storeSummary,
  runZSummaries,
  summaryStats,
  buildSummaryPrompt,
  MAX_BATCH,
} from '../src/graph/zsummary'
import { nodeBrief } from '../src/hooks/node-brief'
import { rmrf } from './_helpers'

const freshDb = (): Database => {
  const db = openDb(':memory:')
  ensureSummaryTables(db)
  return db
}

const withCache = (db: Database, rows: Array<[string, string]>): void => {
  db.run('CREATE TABLE IF NOT EXISTS file_cache(path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL)')
  for (const r of rows) db.query('INSERT OR REPLACE INTO file_cache(path, mtime_ms, size, hash) VALUES(?,0,0,?)').run(r[0], r[1])
}

describe('очередь визитов', () => {
  it('копит визиты и приоритизирует часто посещаемое', () => {
    const db = freshDb()
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:01:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:02:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:03:00.000Z')
    const pending = pendingSummaries(db, new Map())
    expect(pending.map((p) => p.file)).toEqual(['b.ts', 'a.ts'])
    expect(pending[0].visits).toBe(3)
    db.close()
  })

  it('ленив: непосещённые узлы в очередь не попадают', () => {
    const db = freshDb()
    markVisited(db, 'visited.ts', '2026-07-30T10:00:00.000Z')
    const files = pendingSummaries(db, new Map()).map((p) => p.file)
    expect(files).toEqual(['visited.ts'])
    expect(files).not.toContain('never-opened.ts')
    db.close()
  })

  it('соблюдает лимит пакета', () => {
    const db = freshDb()
    for (let i = 0; i < MAX_BATCH + 7; i++) markVisited(db, `f${i}.ts`, '2026-07-30T10:00:00.000Z')
    expect(pendingSummaries(db, new Map()).length).toBe(MAX_BATCH)
    db.close()
  })
})

describe('инвалидация по content-hash', () => {
  it('свежее резюме не переспрашивается, изменённый файл возвращается в очередь', () => {
    const db = freshDb()
    withCache(db, [['a.ts', 'hash-1']])
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    storeSummary(db, { file: 'a.ts', z1: 'журнал фактов проекта' }, 'hash-1', 'haiku', '2026-07-30T10:00:00.000Z')

    expect(pendingSummaries(db, contentHashes(db)).length).toBe(0)
    expect(summaryFor(db, 'a.ts', contentHashOf(db, 'a.ts'))).toBe('журнал фактов проекта')

    withCache(db, [['a.ts', 'hash-2']]) // файл переписали
    expect(pendingSummaries(db, contentHashes(db)).map((p) => p.file)).toEqual(['a.ts'])
    expect(summaryFor(db, 'a.ts', contentHashOf(db, 'a.ts'))).toBeNull()
    db.close()
  })

  it('без кэша сборки резюме отдаётся как есть — молчание хуже устаревшей строки', () => {
    const db = freshDb()
    storeSummary(db, { file: 'a.ts', z1: 'резолвер корня данных' }, 'hash-1', 'haiku', '2026-07-30T10:00:00.000Z')
    expect(contentHashOf(db, 'a.ts')).toBeNull()
    expect(summaryFor(db, 'a.ts', null)).toBe('резолвер корня данных')
    db.close()
  })

  it('нет резюме — null, не исключение', () => {
    const db = freshDb()
    expect(summaryFor(db, 'нет-такого.ts', null)).toBeNull()
    db.close()
  })
})

describe('parseSummaries', () => {
  it('берёт валидные, нормализует пробелы, режет по длине', () => {
    const long = 'о'.repeat(400)
    const out = parseSummaries(`болтовня [{"file":"a.ts","z1":"роль\\n  первая  строка"},{"file":"b.ts","z1":"${long}"}] хвост`)
    expect(out.length).toBe(2)
    expect(out[0].z1).toBe('роль первая строка')
    expect(out[1].z1.length).toBeLessThanOrEqual(200)
  })

  it('сырой перевод строки в z1 (невалидный JSON) не уносит весь пакет', () => {
    const broken = '[{"file":"a.ts","z1":"роль первая\n строка с сырым переносом"},{"file":"b.ts","z1":"вторая роль модуля"}]'
    const out = parseSummaries(broken)
    expect(out.length).toBe(2)
    expect(out[0].z1).toBe('роль первая строка с сырым переносом')
    expect(out[1].file).toBe('b.ts')
  })

  it('мусор и слишком короткое — отбрасывается, не исключение', () => {
    expect(parseSummaries('не json')).toEqual([])
    expect(parseSummaries('{"file":"a"}')).toEqual([])
    expect(parseSummaries('[{"file":"a.ts","z1":"мало"}]')).toEqual([])
    expect(parseSummaries('[{"z1":"без файла тут длинно"}]')).toEqual([])
  })
})

describe('buildSummaryPrompt', () => {
  it('несёт файлы образца и требует чистый JSON', () => {
    const p = buildSummaryPrompt([{ file: 'src/core/store.ts', content: 'export class FactStore {}' }])
    expect(p).toContain('<source>\nsrc/core/store.ts\n</source>')
    expect(p).toContain('export class FactStore {}')
    expect(p).toContain('Ответ целиком — один JSON-массив')
  })
})

describe('runZSummaries — ленивый проход', () => {
  it('симуляция цикла: визит → генерация → кэш → повтор не тратит вызов', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zsum-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'store.ts'), 'export class FactStore { assert() {} }\n')
    writeFileSync(join(proj, 'src', 'heat.ts'), 'export const decayHeat = () => 0\n')
    const db = freshDb()
    withCache(db, [
      ['src/store.ts', 'h-store'],
      ['src/heat.ts', 'h-heat'],
    ])
    markVisited(db, 'src/store.ts', '2026-07-30T10:00:00.000Z')
    markVisited(db, 'src/heat.ts', '2026-07-30T10:00:01.000Z')

    let calls = 0
    const caller = (prompt: string) => {
      calls++
      expect(prompt).toContain('src/store.ts')
      return {
        text: '[{"file":"src/store.ts","z1":"журнал фактов: append-only, вытеснение через superseded_by"},{"file":"src/heat.ts","z1":"тепло узлов: forward-decay без демонов"}]',
        model: 'haiku',
      }
    }

    const r = runZSummaries(db, proj, caller, '2026-07-30T10:05:00.000Z')
    expect(calls).toBe(1) // один вызов на пакет, не по файлу
    expect(r.stored).toBe(2)
    expect(summaryFor(db, 'src/store.ts', contentHashOf(db, 'src/store.ts'))).toContain('append-only')

    // очередь пуста → второй проход не зовёт модель вообще
    const again = runZSummaries(db, proj, caller, '2026-07-30T10:06:00.000Z')
    expect(calls).toBe(1)
    expect(again.requested).toBe(0)
    expect(again.stored).toBe(0)

    db.close()
    rmrf(proj)
  })

  it('выдуманный моделью путь не пишется', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zsum-'))
    writeFileSync(join(proj, 'real.ts'), 'export const a = 1\n')
    const db = freshDb()
    markVisited(db, 'real.ts', '2026-07-30T10:00:00.000Z')
    const r = runZSummaries(
      db,
      proj,
      () => ({ text: '[{"file":"выдуманный.ts","z1":"этого файла не существует вовсе"}]', model: 'haiku' }),
      '2026-07-30T10:05:00.000Z',
    )
    expect(r.stored).toBe(0)
    expect(summaryFor(db, 'выдуманный.ts', null)).toBeNull()
    db.close()
    rmrf(proj)
  })

  it('модель молчит — тихий ноль, очередь цела', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zsum-'))
    writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
    const db = freshDb()
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    const r = runZSummaries(db, proj, () => null, '2026-07-30T10:05:00.000Z')
    expect(r.stored).toBe(0)
    expect(r.model).toBeNull()
    expect(pendingSummaries(db, new Map()).length).toBe(1)
    db.close()
    rmrf(proj)
  })

  it('пропущенный моделью файл остаётся в очереди и добирается следующим проходом', () => {
    // Живая находка: haiku на пакете из 4 файлов вернул 3 — неполный ответ
    // не должен терять узел навсегда.
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zsum-'))
    writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(proj, 'b.ts'), 'export const b = 2\n')
    const db = freshDb()
    withCache(db, [
      ['a.ts', 'ha'],
      ['b.ts', 'hb'],
    ])
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:00:01.000Z')

    const first = runZSummaries(db, proj, () => ({ text: '[{"file":"a.ts","z1":"первый модуль проекта"}]', model: 'haiku' }), '2026-07-30T10:05:00.000Z')
    expect(first.stored).toBe(1)
    expect(pendingSummaries(db, contentHashes(db)).map((p) => p.file)).toEqual(['b.ts'])

    const second = runZSummaries(db, proj, () => ({ text: '[{"file":"b.ts","z1":"второй модуль проекта"}]', model: 'haiku' }), '2026-07-30T10:06:00.000Z')
    expect(second.stored).toBe(1)
    expect(pendingSummaries(db, contentHashes(db)).length).toBe(0)
    db.close()
    rmrf(proj)
  })

  it('пишет диагностику сырого ответа с перечнем пропущенных', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zsum-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-zsum-data-'))
    writeFileSync(join(proj, 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(proj, 'b.ts'), 'export const b = 2\n')
    const db = freshDb()
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:00:01.000Z')
    runZSummaries(
      db,
      proj,
      () => ({ text: '[{"file":"a.ts","z1":"первый модуль проекта"}]', model: 'haiku' }),
      '2026-07-30T10:05:00.000Z',
      MAX_BATCH,
      data,
    )
    const diag = JSON.parse(readFileSync(join(data, 'zsummary-last.json'), 'utf8')) as { missed: string[]; asked: string[]; raw: string }
    expect(diag.asked.sort()).toEqual(['a.ts', 'b.ts'])
    expect(diag.missed).toEqual(['b.ts'])
    expect(diag.raw).toContain('первый модуль')
    db.close()
    rmrf(proj)
    rmrf(data)
  })

  it('пустая очередь — модель не зовётся', () => {
    const db = freshDb()
    let calls = 0
    const r = runZSummaries(db, tmpdir(), () => {
      calls++
      return { text: '[]', model: 'haiku' }
    })
    expect(calls).toBe(0)
    expect(r.requested).toBe(0)
    db.close()
  })
})

describe('подача роли в срезе узла', () => {
  it('nodeBrief отмечает визит и добавляет роль, когда она выведена', () => {
    const db = freshDb()
    db.run('CREATE TABLE graph_edges(from_file TEXT, to_file TEXT)')
    const node = { file: 'src/store.ts', in_deg: 25, out_deg: 3 }

    const before = nodeBrief(db, node)
    expect(before).toContain('вход:25')
    expect(before).not.toContain('роль:')
    expect(pendingSummaries(db, new Map()).map((p) => p.file)).toEqual(['src/store.ts']) // визит отмечен

    storeSummary(db, { file: 'src/store.ts', z1: 'журнал фактов проекта' }, '', 'haiku', '2026-07-30T10:00:00.000Z')
    const after = nodeBrief(db, node)
    expect(after).toContain('роль: журнал фактов проекта')
    expect(after).toContain('вход:25')
    db.close()
  })
})

describe('summaryStats', () => {
  it('считает выведенные и ждущие', () => {
    const db = freshDb()
    withCache(db, [['a.ts', 'h1']])
    markVisited(db, 'a.ts', '2026-07-30T10:00:00.000Z')
    markVisited(db, 'b.ts', '2026-07-30T10:00:00.000Z')
    storeSummary(db, { file: 'a.ts', z1: 'первый модуль проекта' }, 'h1', 'haiku', '2026-07-30T10:00:00.000Z')
    const s = summaryStats(db)
    expect(s.have).toBe(1)
    expect(s.pending).toBe(1)
    db.close()
  })
})
