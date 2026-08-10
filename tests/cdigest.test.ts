/**
 * Дайджесты подсистем: рождаются только для посещённых сообществ с уже
 * описанными ролями, инвалидируются по составу, подаются один раз за сессию
 * при первом касании подсистемы.
 */
import { describe, it, expect } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { pendingDigests, runCommunityDigests, parseDigests, digestForFile } from '../src/graph/cdigest'
import { ensureFeedLog } from '../src/hooks/node-brief'
import { touchFeed } from '../src/hooks/touch-feed'
import { READ_TOUCH_WEIGHT } from '../src/graph/heat'

/** Мир: сообщество a/ (4 файла с ролями, посещено) и b/ (4 файла без визитов). */
function world(): Database {
  const db = openDb(':memory:')
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file,to_file))')
  db.run('CREATE TABLE node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)')
  db.run('CREATE TABLE node_visits(file TEXT PRIMARY KEY, visits INTEGER NOT NULL, last_at TEXT NOT NULL)')
  const n = db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,0,0)')
  const e = db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)')
  for (const dir of ['a', 'b']) {
    for (let i = 0; i < 4; i++) n.run(`${dir}/f${i}.ts`, 0.2)
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) e.run(`${dir}/f${i}.ts`, `${dir}/f${j}.ts`)
  }
  const s = db.query('INSERT INTO node_summary(file,z1,content_hash,model,created_at) VALUES(?,?,?,?,?)')
  s.run('a/f0.ts', 'хранилище фактов', 'h', 'fake', '2026-08-01T00:00:00Z')
  s.run('a/f1.ts', 'журнал сессий', 'h', 'fake', '2026-08-01T00:00:00Z')
  db.query('INSERT INTO node_visits(file,visits,last_at) VALUES(?,?,?)').run('a/f0.ts', 3, '2026-08-01T00:00:00Z')
  return db
}

describe('pendingDigests', () => {
  it('в очереди только посещённая подсистема с ролями', () => {
    const db = world()
    const pending = pendingDigests(db)
    expect(pending.length).toBe(1)
    expect(pending[0].name).toBe('a')
    expect(pending[0].roles.length).toBe(2)
    db.close()
  })
})

describe('runCommunityDigests + подача', () => {
  it('дайджест сохраняется, повторный проход пуст, касание подаёт один раз за сессию', () => {
    const db = world()
    const fake = () => ({ model: 'fake', text: JSON.stringify([{ name: 'a', digest: 'ядро состояния: журнал фактов и сессии' }]) })
    const r = runCommunityDigests(db, fake, '2026-08-02T00:00:00Z')
    expect(r.stored).toBe(1)
    expect(pendingDigests(db).length).toBe(0) // состав не менялся — свежо

    const d = digestForFile(db, 'a/f2.ts') // даже файл без роли знает свою подсистему
    expect(d?.digest).toContain('ядро состояния')

    ensureFeedLog(db)
    const lines1 = touchFeed(db, 's1', 'a/f2.ts', 'graph', READ_TOUCH_WEIGHT)
    expect(lines1.join('\n')).toContain('ядро состояния')
    const lines2 = touchFeed(db, 's1', 'a/f3.ts', 'graph', READ_TOUCH_WEIGHT)
    expect(lines2.join('\n')).not.toContain('ядро состояния') // дедуп по подсистеме на сессию
    db.close()
  })

  it('смена состава инвалидирует дайджест', () => {
    const db = world()
    runCommunityDigests(db, () => ({ model: 'fake', text: JSON.stringify([{ name: 'a', digest: 'старое назначение подсистемы' }]) }), '2026-08-02T00:00:00Z')
    db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,0,0)').run('a/f9.ts', 0.2)
    db.query('INSERT INTO graph_edges(from_file,to_file) VALUES(?,?)').run('a/f9.ts', 'a/f0.ts')
    expect(pendingDigests(db).length).toBe(1) // состав изменился — пора заново
    db.close()
  })

  it('мусорный ответ модели — ноль записей, не исключение', () => {
    const db = world()
    const r = runCommunityDigests(db, () => ({ model: 'fake', text: 'эссе о подсистемах' }), '2026-08-02T00:00:00Z')
    expect(r.stored).toBe(0)
    expect(parseDigests('мусор')).toEqual([])
    db.close()
  })
})
