/**
 * Канал подачи ДО чтения. Проверяется не столько то, что он говорит, сколько
 * то, чего он НЕ делает: не блокирует, не повторяет уже сказанное, молчит там,
 * где сказать нечего, и не уговаривает на дорогой путь.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { sha1 } from '../src/core/salsa'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePreTool, MIN_FILE_CHARS, PRE_READ_KIND } from '../src/hooks/pre-tool-core'
import { OUTLINE_KIND } from '../src/hooks/node-brief'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { storeOutline } from '../src/layer1/symbols'
import { utilityOf } from '../src/gardener/utility'

const BIG = `export function alpha(): number {\n  return 1\n}\n`.repeat(200)

function makeWorld(opts: { withOutline?: boolean; content?: string } = {}) {
  const content = opts.content ?? BIG
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-pre-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-pre-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'core.ts'), content)

  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  db.query('INSERT INTO graph_nodes(file, rank, in_deg, out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.4, 2, 0)
  db.query('INSERT INTO graph_edges(from_file, to_file) VALUES(?,?)').run('src/api.ts', 'src/core.ts')
  if (opts.withOutline) {
    storeOutline(db, 'src/core.ts', sha1(content), [
      { name: 'alpha', kind: 'function', line: 1, endLine: 3, chars: 40 },
      { name: 'Beta', kind: 'class', line: 5, endLine: 400, chars: 9000 },
    ])
  }
  db.close()
  return { proj, dataRoot, dataDir }
}

const read = (proj: string, dataRoot: string, file: string, sid = 'p1') =>
  handlePreTool({ cwd: proj, session_id: sid, tool_name: 'Read', tool_input: { file_path: join(proj, file) } }, dataRoot)

describe('подача до чтения', () => {
  it('отдаёт то, что уже известно, и ничего не блокирует', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      const out = read(proj, dataRoot, 'src/core.ts')
      const ctx = out.hookSpecificOutput?.additionalContext ?? ''
      expect(out.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
      expect(ctx).toContain('src/core.ts')
      // решение о доступе не выносится ни в каком виде
      expect(JSON.stringify(out)).not.toContain('permissionDecision')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('называет цену обоих путей, когда структура разобрана', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      const ctx = read(proj, dataRoot, 'src/core.ts').hookSpecificOutput?.additionalContext ?? ''
      expect(ctx).toContain('passport_outline')
      expect(ctx).toMatch(/≈\d+t/)
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('без разобранной структуры предложения нет, но связи всё равно приходят', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: false })
    try {
      const ctx = read(proj, dataRoot, 'src/core.ts').hookSpecificOutput?.additionalContext ?? ''
      expect(ctx).toContain('src/core.ts')
      expect(ctx).not.toContain('passport_outline')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('на изменённом после разбора файле структура не предлагается', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      writeFileSync(join(proj, 'src', 'core.ts'), BIG + '\n// правка после разбора\n')
      const ctx = read(proj, dataRoot, 'src/core.ts').hookSpecificOutput?.additionalContext ?? ''
      expect(ctx).not.toContain('passport_outline')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('на коротком файле связи приходят, а структура не предлагается', () => {
    // Порог касается ТОЛЬКО предложения структуры: «возьми кусок вместо целого»
    // на файле в одну строку — нелепость, а знать, кто от него зависит, полезно
    // при любом размере. Раньше эту роль на чтении играл PostToolUse; теперь он
    // на Read не зовётся, и потерять её значило бы получить регрессию знания
    // в обмен на выигрыш во времени.
    const { proj, dataRoot } = makeWorld({ content: 'export const a = 1\n' })
    try {
      expect('export const a = 1\n'.length).toBeLessThan(MIN_FILE_CHARS)
      const ctx = read(proj, dataRoot, 'src/core.ts').hookSpecificOutput?.additionalContext ?? ''
      expect(ctx).toContain('src/core.ts')
      expect(ctx).not.toContain('passport_outline')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('срабатывает только на Read: правка — не повод рассказывать о файле заранее', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      const out = handlePreTool(
        { cwd: proj, session_id: 'p1', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src/core.ts') } },
        dataRoot,
      )
      expect(out.hookSpecificOutput).toBeUndefined()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('дважды об одном файле в одной сессии не рассказывает', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      expect(read(proj, dataRoot, 'src/core.ts').hookSpecificOutput).toBeDefined()
      expect(read(proj, dataRoot, 'src/core.ts').hookSpecificOutput).toBeUndefined()
      // другая сессия — своя подача
      expect(read(proj, dataRoot, 'src/core.ts', 'p2').hookSpecificOutput).toBeDefined()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('сказанное до чтения не повторяется после него', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      expect(read(proj, dataRoot, 'src/core.ts').hookSpecificOutput).toBeDefined()
      const after = handlePostTool(
        { cwd: proj, session_id: 'p1', tool_name: 'Read', tool_input: { file_path: join(proj, 'src/core.ts') } },
        dataRoot,
      )
      const ctx = after.hookSpecificOutput?.additionalContext ?? ''
      expect(ctx).not.toContain('исход:0')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('связи и предложение структуры считаются раздельно, и обоим зачитывается польза', () => {
    // Слитые в один счётчик, они не отвечают ни на один из двух вопросов: одна
    // подача давала два показа при одном зачёте, и предложение структуры
    // выглядело бы вдвое бесполезнее, чем оно есть.
    const { proj, dataRoot, dataDir } = makeWorld({ withOutline: true })
    try {
      read(proj, dataRoot, 'src/core.ts')
      handlePostTool(
        { cwd: proj, session_id: 'p1', tool_name: 'Edit', tool_input: { file_path: join(proj, 'src/core.ts') } },
        dataRoot,
      )
      const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
      const links = utilityOf(db, PRE_READ_KIND)
      const outline = utilityOf(db, OUTLINE_KIND)
      db.close()
      expect(links.surfaced).toBe(1)
      expect(links.used).toBe(1)
      expect(outline.surfaced).toBe(1)
      expect(outline.used).toBe(1)
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('вне проекта и без паспорта — молчание, а не ошибка', () => {
    const { proj, dataRoot } = makeWorld({ withOutline: true })
    try {
      const outside = handlePreTool(
        { cwd: proj, session_id: 'p1', tool_name: 'Read', tool_input: { file_path: join(tmpdir(), 'чужой.ts') } },
        dataRoot,
      )
      expect(outside.hookSpecificOutput).toBeUndefined()
      const noPassport = handlePreTool(
        { cwd: tmpdir(), session_id: 'p1', tool_name: 'Read', tool_input: { file_path: join(tmpdir(), 'x.ts') } },
        dataRoot,
      )
      expect(noPassport.hookSpecificOutput).toBeUndefined()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })
})

describe('оглавление вместо чтения (gate.json outline=deny)', () => {
  it('первое чтение большого файла целиком отменяется с оглавлением; диапазон и повтор проходят; свой файл не трогается', () => {
    const { proj, dataRoot, dataDir } = makeWorld({ withOutline: true })
    try {
      writeFileSync(join(dataDir, 'gate.json'), '{"outline":"deny"}')
      const first = read(proj, dataRoot, 'src/core.ts', 'd1')
      expect(first.hookSpecificOutput?.permissionDecision).toBe('deny')
      const reason = first.hookSpecificOutput?.permissionDecisionReason ?? ''
      expect(reason).toContain('alpha')
      expect(reason).toContain('5-400 class Beta')
      expect(reason).toContain('offset')
      // повтор того же чтения — не отменяется
      const second = read(proj, dataRoot, 'src/core.ts', 'd1')
      expect(second.hookSpecificOutput?.permissionDecision).toBeUndefined()
      // чтение диапазона — осознанный выбор, не отменяется даже в первый раз
      const ranged = handlePreTool(
        { cwd: proj, session_id: 'd2', tool_name: 'Read', tool_input: { file_path: join(proj, 'src/core.ts'), offset: 5, limit: 40 } },
        dataRoot,
      )
      expect(ranged.hookSpecificOutput?.permissionDecision).toBeUndefined()
      // файл, который сессия писала, — индекс отстал, отменять нельзя
      const db = openDb(join(dataDir, 'passport.db'))
      db.run("CREATE TABLE IF NOT EXISTS session_edits(session_id TEXT NOT NULL, file TEXT NOT NULL, edited_at TEXT NOT NULL, PRIMARY KEY(session_id, file))")
      db.run("INSERT INTO session_edits VALUES('d3','src/core.ts','2026-01-01')")
      db.close()
      expect(read(proj, dataRoot, 'src/core.ts', 'd3').hookSpecificOutput?.permissionDecision).toBeUndefined()
      // без режима — прежняя подсказка
      writeFileSync(join(dataDir, 'gate.json'), '{}')
      expect(read(proj, dataRoot, 'src/core.ts', 'd4').hookSpecificOutput?.permissionDecision).toBeUndefined()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })
})
