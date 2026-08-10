/**
 * Миграция знания при переименовании: оплаченная роль, тепло и визиты следуют
 * за файлом по ТОЧНОМУ хэш-матчу; любая неоднозначность оставляет сироту —
 * ложная миграция (роль чужого файла) хуже честного «роль родится заново».
 */
import { describe, it, expect } from 'bun:test'
import { openDb } from '../src/core/db'
import { migrateRenames } from '../src/gardener/rename'

function seeded() {
  const db = openDb(':memory:')
  db.run(
    'CREATE TABLE node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)',
  )
  db.run('CREATE TABLE node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)')
  db.run('CREATE TABLE node_visits(file TEXT PRIMARY KEY, visits INTEGER NOT NULL, last_at TEXT NOT NULL)')
  db.query('INSERT INTO node_summary(file,z1,content_hash,model,created_at) VALUES(?,?,?,?,?)').run(
    'src/old.ts',
    'роль модуля',
    'hash-1',
    'fake',
    '2026-08-01T00:00:00Z',
  )
  db.query('INSERT INTO node_heat(file,heat,updated_at) VALUES(?,?,?)').run('src/old.ts', 3.5, '2026-08-01T00:00:00Z')
  db.query('INSERT INTO node_visits(file,visits,last_at) VALUES(?,?,?)').run('src/old.ts', 4, '2026-08-01T00:00:00Z')
  return db
}

describe('migrateRenames', () => {
  it('чистое переименование: роль, тепло и визиты переезжают на новый путь', () => {
    const db = seeded()
    const n = migrateRenames(db, new Map([['src/renamed.ts', 'hash-1']]))
    expect(n).toBe(1)
    expect((db.query('SELECT z1 FROM node_summary WHERE file=?').get('src/renamed.ts') as { z1: string }).z1).toBe('роль модуля')
    expect((db.query('SELECT heat FROM node_heat WHERE file=?').get('src/renamed.ts') as { heat: number }).heat).toBe(3.5)
    expect(db.query('SELECT 1 x FROM node_summary WHERE file=?').get('src/old.ts')).toBeNull()
    db.close()
  })

  it('файл жив на диске — никакой миграции', () => {
    const db = seeded()
    const n = migrateRenames(
      db,
      new Map([
        ['src/old.ts', 'hash-1'],
        ['src/copy.ts', 'hash-1'],
      ]),
    )
    expect(n).toBe(0)
    db.close()
  })

  it('два кандидата с тем же содержимым — неоднозначность, сирота честнее', () => {
    const db = seeded()
    const n = migrateRenames(
      db,
      new Map([
        ['src/a.ts', 'hash-1'],
        ['src/b.ts', 'hash-1'],
      ]),
    )
    expect(n).toBe(0)
    expect(db.query('SELECT 1 x FROM node_summary WHERE file=?').get('src/old.ts')).not.toBeNull()
    db.close()
  })

  it('rename+edit (хэш изменился) — не мигрируется', () => {
    const db = seeded()
    expect(migrateRenames(db, new Map([['src/renamed.ts', 'другой-хэш']]))).toBe(0)
    db.close()
  })

  it('у нового пути уже есть своё знание — не перетирается, старое тепло уступает', () => {
    const db = seeded()
    db.query('INSERT INTO node_summary(file,z1,content_hash,model,created_at) VALUES(?,?,?,?,?)').run(
      'src/renamed.ts',
      'своя роль',
      'hash-1',
      'fake',
      '2026-08-02T00:00:00Z',
    )
    db.query('INSERT INTO node_heat(file,heat,updated_at) VALUES(?,?,?)').run('src/renamed.ts', 1.0, '2026-08-02T00:00:00Z')
    const n = migrateRenames(db, new Map([['src/renamed.ts', 'hash-1']]))
    expect(n).toBe(0)
    expect((db.query('SELECT z1 FROM node_summary WHERE file=?').get('src/renamed.ts') as { z1: string }).z1).toBe('своя роль')
    expect((db.query('SELECT heat FROM node_heat WHERE file=?').get('src/renamed.ts') as { heat: number }).heat).toBe(1.0)
    db.close()
  })

  it('таблиц знания нет — ноль без ошибки (fail-open)', () => {
    const db = openDb(':memory:')
    expect(migrateRenames(db, new Map([['a.ts', 'h']]))).toBe(0)
    db.close()
  })
})
