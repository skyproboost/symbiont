import { describe, it, expect } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { reconstructEntry } from '../src/hooks/entry'
import { bumpHeat } from '../src/graph/heat'

const NOW = Date.parse('2026-07-30T12:00:00Z')

/** Граф app.js → service.js → core.js. */
function graphDb(): Database {
  const db = openDb(':memory:')
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL, in_deg INTEGER, out_deg INTEGER)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file,to_file))')
  const ins = db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)')
  ins.run('app.js', 0.1, 0, 1)
  ins.run('service.js', 0.3, 1, 1)
  ins.run('core.js', 0.6, 1, 0)
  const e = db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)')
  e.run('app.js', 'service.js')
  e.run('service.js', 'core.js')
  return db
}

describe('reconstructEntry — протокол самостарта', () => {
  it('нить работы → блок с работой и её граф-окружением', () => {
    const db = graphDb()
    const block = reconstructEntry(db, ['app.js'], [], NOW)
    expect(block).toContain('Вход в работу')
    expect(block).toContain('над чем шла работа: app.js')
    expect(block).toContain('service.js') // прямой импорт app.js — окружение задачи
    expect(block).toContain('восстанови намерение') // нудж «промпт — сид»
    db.close()
  })

  it('незакоммиченное (dirty) тоже сид работы', () => {
    const db = graphDb()
    const block = reconstructEntry(db, [], ['service.js'], NOW)
    expect(block).toContain('над чем шла работа: service.js')
    db.close()
  })

  it('горячее (недавно тронутое) входит вторым тиром сида', () => {
    const db = graphDb()
    bumpHeat(db, 'app.js', new Date(NOW).toISOString())
    const block = reconstructEntry(db, [], [], NOW) // нет нити/dirty, но есть тепло
    expect(block).toContain('Вход в работу') // горячее подняло окружение
    db.close()
  })

  it('файлы вне графа игнорируются', () => {
    const db = graphDb()
    const block = reconstructEntry(db, ['docs/README.md', 'app.js'], [], NOW)
    expect(block).toContain('app.js')
    expect(block).not.toContain('README.md')
    db.close()
  })

  it('прецедент: прошлая сессия с той же зоной работы всплывает рецептом', () => {
    const db = graphDb()
    db.run("CREATE TABLE session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL, commits TEXT NOT NULL DEFAULT '[]')")
    const ins = db.query('INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?)')
    // Давняя сессия с пересечением ≥2 файлов и итоговым коммитом — прецедент
    ins.run('old', JSON.stringify(['app.js', 'service.js', 'core.js']), JSON.stringify(['feat: rewire the service layer']), '2026-07-20T10:00:00Z')
    const block = reconstructEntry(db, ['app.js', 'service.js'], [], NOW)
    expect(block).toContain('похожая работа уже делалась')
    expect(block).toContain('rewire the service layer')
    db.close()
  })

  it('несколько похожих сессий → рецепт называется устойчивым', () => {
    const db = graphDb()
    db.run("CREATE TABLE session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL, commits TEXT NOT NULL DEFAULT '[]')")
    const ins = db.query('INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?)')
    ins.run('p1', JSON.stringify(['app.js', 'service.js', 'core.js']), JSON.stringify(['feat: one']), '2026-07-20T10:00:00Z')
    // порядок иной, чем у показанной нити, — это другая сессия, не её дубль
    ins.run('p2', JSON.stringify(['service.js', 'app.js']), JSON.stringify(['feat: two']), '2026-07-22T10:00:00Z')
    const block = reconstructEntry(db, ['app.js', 'service.js'], [], NOW)
    expect(block).toContain('рецепт устойчив')
    db.close()
  })

  it('прецедент не дублирует показанную нить и не срабатывает на 1 общем файле', () => {
    const db = graphDb()
    db.run("CREATE TABLE session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL, commits TEXT NOT NULL DEFAULT '[]')")
    const ins = db.query('INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?)')
    // Ровно та нить, что уже показана строкой нити, — не прецедент
    ins.run('last', JSON.stringify(['app.js', 'service.js']), JSON.stringify(['feat: shown already']), '2026-07-29T10:00:00Z')
    // Пересечение в один файл — совпадение, не рецепт
    ins.run('weak', JSON.stringify(['app.js', 'other.js']), JSON.stringify(['chore: unrelated']), '2026-07-28T10:00:00Z')
    const block = reconstructEntry(db, ['app.js', 'service.js'], [], NOW)
    expect(block).not.toContain('похожая работа')
    db.close()
  })

  it('нет сигнала непрерывности → пусто (молчание)', () => {
    const db = graphDb()
    expect(reconstructEntry(db, [], [], NOW)).toBe('')
    db.close()
  })

  it('нет графа → пусто (fail-open)', () => {
    const db = openDb(':memory:')
    expect(reconstructEntry(db, ['app.js'], [], NOW)).toBe('')
    db.close()
  })
})
