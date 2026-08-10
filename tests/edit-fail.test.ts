/**
 * PostToolUseFailure: упавшая правка — момент, когда свежее оглавление ценнее
 * всего (строки уехали). Проверяется подача при свежем индексе, отказ при
 * несвежем (совет по устаревшей структуре — второй обман подряд), дедуп на
 * сессию и молчание на нерелевантных инструментах.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { sha1 } from '../src/core/salsa'
import { handlePostToolFailure } from '../src/hooks/post-tool-failure-core'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const CONTENT = `export function alpha(): number {\n  return 1\n}\n${'// наполнение\n'.repeat(40)}export function beta(): number {\n  return 2\n}\n`

function makeWorld(freshIndex: boolean) {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-ef-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-ef-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'mod.ts'), CONTENT)
  const db = openDb(join(dataDir, 'passport.db'))
  db.run(
    'CREATE TABLE IF NOT EXISTS symbols(file TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, chars INTEGER NOT NULL, PRIMARY KEY(file, ord))',
  )
  db.run('CREATE TABLE IF NOT EXISTS symbols_meta(file TEXT PRIMARY KEY, hash TEXT NOT NULL, n INTEGER NOT NULL)')
  const add = db.query('INSERT INTO symbols(file,ord,name,kind,line,end_line,chars) VALUES(?,?,?,?,?,?,?)')
  add.run('src/mod.ts', 0, 'alpha', 'function', 1, 3, 40)
  add.run('src/mod.ts', 1, 'beta', 'function', 44, 46, 40)
  db.query('INSERT INTO symbols_meta(file,hash,n) VALUES(?,?,?)').run('src/mod.ts', freshIndex ? sha1(CONTENT) : 'устарел', 2)
  db.close()
  return { proj, dataRoot }
}

describe('PostToolUseFailure — оглавление в момент упавшей правки', () => {
  it('свежий индекс → подан дешёвый путь восстановления', () => {
    const { proj, dataRoot } = makeWorld(true)
    const out = handlePostToolFailure(
      { cwd: proj, session_id: 'e1', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src', 'mod.ts') } },
      dataRoot,
    )
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('passport_outline')
    expect(ctx).toContain('src/mod.ts')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('несвежий индекс → молчание (не советуем по устаревшей структуре)', () => {
    const { proj, dataRoot } = makeWorld(false)
    const out = handlePostToolFailure(
      { cwd: proj, session_id: 'e2', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src', 'mod.ts') } },
      dataRoot,
    )
    expect(out.hookSpecificOutput).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('дедуп: вторая упавшая правка того же файла за сессию молчит', () => {
    const { proj, dataRoot } = makeWorld(true)
    const input = { cwd: proj, session_id: 'e3', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src', 'mod.ts') } }
    expect(handlePostToolFailure(input, dataRoot).hookSpecificOutput).toBeDefined()
    expect(handlePostToolFailure(input, dataRoot).hookSpecificOutput).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('нерелевантный инструмент → молчание', () => {
    const { proj, dataRoot } = makeWorld(true)
    const out = handlePostToolFailure(
      { cwd: proj, session_id: 'e4', tool_name: 'Bash', tool_input: { file_path: join(proj, 'src', 'mod.ts') } },
      dataRoot,
    )
    expect(out.hookSpecificOutput).toBeUndefined()
    rmrf(proj)
    rmrf(dataRoot)
  })
})
