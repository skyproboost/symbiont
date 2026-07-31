/**
 * «Паспорт не врёт» — аудит само-образа: карта не подаёт того, чего нет.
 * Ключевой инвариант: проекции лечатся, журнал-истина не трогается никогда.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Database } from '../src/core/db'
import { auditTruth, healProjections, staleSummaryLines, renderTruth } from '../src/gardener/truth'
import { FactStore } from '../src/core/store'
import { buildPassport } from '../src/passport/build'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const seedProjections = (db: Database): void => {
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  db.run('CREATE TABLE node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)')
  db.run('CREATE TABLE node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)')
  db.run('CREATE TABLE lessons(zone TEXT NOT NULL, statement TEXT NOT NULL, source TEXT, created_at TEXT, UNIQUE(zone, statement))')
}

describe('auditTruth', () => {
  it('ловит мёртвые узлы, роли, тепло и уроки удалённых путей', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-truth-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'alive.ts'), 'export const a = 1\n')
    const db = openDb(':memory:')
    seedProjections(db)
    db.run("INSERT INTO graph_nodes VALUES('src/alive.ts', 0.5, 1, 0), ('src/deleted.ts', 0.4, 1, 0)")
    db.run("INSERT INTO node_summary VALUES('src/deleted.ts','роль исчезнувшего модуля','h','haiku','2026-07-30T10:00:00Z')")
    db.run("INSERT INTO node_heat VALUES('src/deleted.ts', 2.0, '2026-07-30T10:00:00Z')")
    db.run("INSERT INTO lessons(zone, statement) VALUES('src/gone','урок про снесённую зону')")

    const kinds = auditTruth(db, root, root).map((i) => i.kind)
    expect(kinds).toContain('узлы графа без файла')
    expect(kinds).toContain('роли удалённых файлов')
    expect(kinds).toContain('тепло удалённых файлов')
    expect(kinds).toContain('уроки по несуществующим зонам')

    db.close()
    rmrf(root)
  })

  it('честный паспорт — пустой список', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-truth-'))
    writeFileSync(join(root, 'alive.ts'), 'export const a = 1\n')
    const db = openDb(':memory:')
    seedProjections(db)
    db.run("INSERT INTO graph_nodes VALUES('alive.ts', 0.5, 0, 0)")
    expect(auditTruth(db, root, root)).toEqual([])
    db.close()
    rmrf(root)
  })

  it('нет таблиц-проекций — не падает (fail-open)', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-truth-'))
    const db = openDb(':memory:')
    expect(auditTruth(db, root, root)).toEqual([])
    db.close()
    rmrf(root)
  })
})

describe('staleSummaryLines — сводка против журнала', () => {
  it('ловит поданное, чего в журнале уже нет', () => {
    const summary = [
      '## Законы стиля',
      '- идентификаторы — camelCase — 2703 из 2713 (100%)',
      '- переменные — только var — 900 из 900 (100%)',
    ].join('\n')
    const stale = staleSummaryLines(summary, ['идентификаторы — camelCase'])
    expect(stale.length).toBe(1)
    expect(stale[0]).toContain('только var')
  })

  it('«факт есть, но не подан» — норма, не враньё', () => {
    const summary = ['## Законы стиля', '- идентификаторы — camelCase — 2703 из 2713 (100%)'].join('\n')
    expect(staleSummaryLines(summary, ['идентификаторы — camelCase', 'кавычки — одинарные'])).toEqual([])
  })

  it('«Смешанный стиль» не судится — особый формат рендера, не statement факта', () => {
    // Живая находка: строка «filter/map/reduce: 53% / 47%» рендерится по своему
    // шаблону, и сверка по префиксу обвиняла честный паспорт во вранье.
    const summary = ['## Смешанный стиль (единого правила нет)', '- filter/map/reduce: 53% / 47%'].join('\n')
    expect(staleSummaryLines(summary, [])).toEqual([])
  })

  it('секции не из журнала не судятся — состав проекта похож на факт, но им не является', () => {
    const summary = [
      '## Стойка качества (стоячая)',
      '- цель: топ-1 по осям — безопасность, корректность',
      '- ограничение: улучшения сверх задачи — предлагать, не делать',
      '## Состав проекта',
      '- код — 138 файлов (86%)',
      '- контент/тексты — 16 файлов (10%)',
      '## Стек и направления',
      '- фреймворки: nuxt',
      '## Состояние',
      '- ветка: master — незакоммичено: 2',
    ].join('\n')
    expect(staleSummaryLines(summary, [])).toEqual([])
  })
})

describe('healProjections', () => {
  it('чистит проекции и повисшие рёбра, журнал-истину не трогает', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-truth-'))
    writeFileSync(join(root, 'alive.ts'), 'export const a = 1\n')
    const db = openDb(':memory:')
    seedProjections(db)
    const store = new FactStore(db)
    store.assertAll(
      [{ area: 'стиль', statement: 'кавычки — одинарные', positive: 10, total: 10, prevalence: 1, tier: 'закон' }],
      'miner:layer0',
    )
    db.run("INSERT INTO graph_nodes VALUES('alive.ts', 0.5, 1, 0), ('deleted.ts', 0.4, 0, 1)")
    db.run("INSERT INTO graph_edges VALUES('deleted.ts','alive.ts'), ('alive.ts','alive.ts')")
    db.run("INSERT INTO node_summary VALUES('deleted.ts','роль','h','haiku','2026-07-30T10:00:00Z')")
    db.run("INSERT INTO node_heat VALUES('deleted.ts', 2.0, '2026-07-30T10:00:00Z')")

    const before = store.active().length
    const rep = healProjections(db, root)

    expect(rep.removed).toBeGreaterThan(0)
    expect((db.query('SELECT COUNT(*) n FROM graph_nodes').get() as { n: number }).n).toBe(1)
    expect((db.query('SELECT COUNT(*) n FROM node_summary').get() as { n: number }).n).toBe(0)
    expect((db.query('SELECT COUNT(*) n FROM graph_edges').get() as { n: number }).n).toBe(1) // повисшее ребро ушло
    expect(store.active().length).toBe(before) // ЖУРНАЛ НЕ ТРОНУТ

    // идемпотентность: повторное лечение уже нечего чистить
    expect(healProjections(db, root).removed).toBe(0)
    db.close()
    rmrf(root)
  })
})

describe('renderTruth', () => {
  it('честный паспорт молчит одной строкой, лживый перечисляет', () => {
    expect(renderTruth([])).toContain('паспорт честен')
    const s = renderTruth([{ kind: 'узлы графа без файла', detail: 'a.ts', count: 1, healable: true }])
    expect(s).toContain('узлы графа без файла: 1')
    expect(renderTruth([{ kind: 'строки сводки', detail: 'x', count: 2, healable: false }])).toContain('пересборка уже назначена фоном')
  })
})

describe('симуляция: удаление файла лечится следующей сборкой', () => {
  it('роль и тепло снесённого файла не переживают пересборку паспорта', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-truth-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-truth-data-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'keep.ts'), "import { gone } from './gone'\nexport const a = () => gone\n")
    writeFileSync(join(proj, 'src', 'gone.ts'), 'export const gone = 1\n')
    writeFileSync(join(proj, 'README.md'), 'Сервис.\n')
    const dataDir = join(data, slugOf(proj))

    buildPassport(proj, dataDir)
    {
      const db = openDb(join(dataDir, 'passport.db'))
      db.run('CREATE TABLE IF NOT EXISTS node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)')
      db.run("INSERT OR REPLACE INTO node_summary VALUES('src/gone.ts','роль файла, который вот-вот удалят','h','haiku','2026-07-30T10:00:00Z')")
      db.run('CREATE TABLE IF NOT EXISTS node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)')
      db.run("INSERT OR REPLACE INTO node_heat VALUES('src/gone.ts', 3.0, '2026-07-30T10:00:00Z')")
      db.close()
    }

    rmSync(join(proj, 'src', 'gone.ts'))
    writeFileSync(join(proj, 'src', 'keep.ts'), 'export const a = () => 1\n')
    buildPassport(proj, dataDir)

    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const summaries = db.query("SELECT COUNT(*) n FROM node_summary WHERE file='src/gone.ts'").get() as { n: number }
    const heat = db.query("SELECT COUNT(*) n FROM node_heat WHERE file='src/gone.ts'").get() as { n: number }
    const nodes = db.query("SELECT COUNT(*) n FROM graph_nodes WHERE file='src/gone.ts'").get() as { n: number }
    db.close()

    expect(summaries.n).toBe(0)
    expect(heat.n).toBe(0)
    expect(nodes.n).toBe(0)

    rmrf(proj)
    rmrf(data)
  })
})
