/**
 * PostToolUseFailure: упавшая правка — момент, когда свежее оглавление ценнее
 * всего (строки уехали). Проверяется подача при свежем индексе, отказ при
 * несвежем (совет по устаревшей структуре — второй обман подряд), дедуп на
 * сессию и молчание на нерелевантных инструментах.
 */
import { describe, it, expect } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { sha1 } from '../src/core/salsa'
import { handlePostToolFailure, isRejectedWrite } from '../src/hooks/post-tool-failure-core'
import { handlePostTool } from '../src/hooks/post-tool-core'
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

// Живой случай (Claude Code 2.1.322, снято пробой входа хука 22.11.2026): правку,
// отклонённую проверкой инструмента («строка не найдена»), платформа отдаёт
// событием PostToolUse, а не PostToolUseFailure, и кладёт в tool_response строку
// ошибки вместо объекта. Канал упавшей правки не бил ни в одном из 140 проектов,
// а сама неудача записывалась как состоявшаяся правка.
describe('отклонённая правка приходит событием PostToolUse', () => {
  const REJECTED = 'Error: String to replace not found in file.\nString: такой строки нет'
  const DONE = { filePath: 'src/mod.ts', oldString: 'a', newString: 'b', structuredPatch: [], userModified: false, replaceAll: false }
  const editsOf = (dataRoot: string, proj: string, sid: string): number => {
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
    try {
      return (db.query('SELECT COUNT(*) n FROM session_edits WHERE session_id=?').get(sid) as { n: number }).n
    } catch {
      return 0 // таблицы авторства нет — правок не записано
    } finally {
      db.close()
    }
  }

  it('строка ошибки в tool_response — правка не состоялась: авторства нет, подано оглавление, канал отбил пульс', () => {
    const { proj, dataRoot } = makeWorld(true)
    const out = handlePostTool(
      { cwd: proj, session_id: 'e5', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src', 'mod.ts') }, tool_response: REJECTED },
      dataRoot,
    )
    expect(out.hookSpecificOutput?.hookEventName).toBe('PostToolUse') // имя события — то, которым пришёл вызов
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('passport_outline')
    expect(editsOf(dataRoot, proj, 'e5')).toBe(0)
    // Пульс — того события, которым платформа пришла: бил зарегистрированный PostToolUse
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-posttooluse.json'))).toBe(true)
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-posttoolusefailure.json'))).toBe(false)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('отклонённая правка носителя секретов файл не открывает — как и состоявшаяся', () => {
    const { proj, dataRoot } = makeWorld(true)
    // Оглавление для .env «свежее» — если бы файл читался, подача состоялась бы
    const secret = 'API_KEY=не-должно-быть-прочитано\n'
    writeFileSync(join(proj, '.env'), secret)
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
    db.query('INSERT INTO symbols(file,ord,name,kind,line,end_line,chars) VALUES(?,?,?,?,?,?,?)').run('.env', 0, 'API_KEY', 'variable', 1, 1, 10)
    db.query('INSERT INTO symbols_meta(file,hash,n) VALUES(?,?,?)').run('.env', sha1(secret), 1)
    db.close()
    for (const event of ['PostToolUse', 'PostToolUseFailure'] as const) {
      const input = { cwd: proj, session_id: `e9-${event}`, tool_name: 'Edit', tool_input: { file_path: join(proj, '.env') }, tool_response: REJECTED }
      const out = event === 'PostToolUse' ? handlePostTool(input, dataRoot) : handlePostToolFailure(input, dataRoot)
      expect(out.hookSpecificOutput).toBeUndefined()
    }
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('признак отказа — слово Error с двоеточием или обёртка ошибки; имя файла Error.ts в тексте успеха — не отказ', () => {
    expect(isRejectedWrite('Error: String to replace not found in file.')).toBe(true)
    expect(isRejectedWrite('<tool_use_error>File has not been read yet.</tool_use_error>')).toBe(true)
    expect(isRejectedWrite('Error.ts updated')).toBe(false)
    expect(isRejectedWrite('Error-log.md created')).toBe(false)
    expect(isRejectedWrite({ filePath: 'a.ts' })).toBe(false)
    expect(isRejectedWrite(undefined)).toBe(false)
  })

  it('объект в tool_response и вызов без него — состоявшаяся правка, как прежде', () => {
    const { proj, dataRoot } = makeWorld(true)
    const file = join(proj, 'src', 'mod.ts')
    handlePostTool({ cwd: proj, session_id: 'e6', tool_name: 'Edit', tool_input: { file_path: file }, tool_response: DONE }, dataRoot)
    expect(editsOf(dataRoot, proj, 'e6')).toBe(1)
    handlePostTool({ cwd: proj, session_id: 'e7', tool_name: 'Write', tool_input: { file_path: file } }, dataRoot)
    expect(editsOf(dataRoot, proj, 'e7')).toBe(1)
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-posttoolusefailure.json'))).toBe(false)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('строка без признака ошибки — не отказ: чужая платформа отвечает на правку текстом', () => {
    const { proj, dataRoot } = makeWorld(true)
    handlePostTool(
      { cwd: proj, session_id: 'e8', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src', 'mod.ts') }, tool_response: 'Updated the file' },
      dataRoot,
    )
    expect(editsOf(dataRoot, proj, 'e8')).toBe(1)
    rmrf(proj)
    rmrf(dataRoot)
  })
})
