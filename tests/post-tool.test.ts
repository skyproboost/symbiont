import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePostTool, toRelNode } from '../src/hooks/post-tool-core'
import { handleUserPrompt } from '../src/hooks/user-prompt-core'
import type { Fact } from '../src/miner/facts'

const LAW: Fact = {
  area: 'стиль',
  statement: 'кавычки — одинарные',
  positive: 50,
  total: 50,
  prevalence: 1,
  tier: 'закон',
}

/** Проект + паспорт с одним законом и одним узлом графа. */
function makeWorld() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-pt-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-pt-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'passport.db'))
  new FactStore(db).assertAll([LAW], 'miner:layer0')
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))')
  db.query('INSERT INTO graph_nodes(file, rank, in_deg, out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.4, 2, 0)
  db.query('INSERT INTO graph_edges(from_file, to_file) VALUES(?,?)').run('src/api.ts', 'src/core.ts')
  db.query('INSERT INTO graph_edges(from_file, to_file) VALUES(?,?)').run('src/ui.ts', 'src/core.ts')
  db.close()
  mkdirSync(join(proj, 'src'), { recursive: true })
  return { proj, dataRoot }
}

const touch = (proj: string, dataRoot: string, tool: string, file: string, sid = 's1') =>
  handlePostTool({ cwd: proj, session_id: sid, tool_name: tool, tool_input: { file_path: join(proj, file) } }, dataRoot)

describe('toRelNode', () => {
  it('нормализует в forward-slash относительный путь', () => {
    expect(toRelNode('D:\\proj', 'D:\\proj\\src\\a.ts')).toBe('src/a.ts')
  })
  it('вне проекта и служебные зоны — null', () => {
    expect(toRelNode('D:\\proj', 'D:\\other\\a.ts')).toBe(null)
    expect(toRelNode('D:\\proj', 'D:\\proj\\node_modules\\x\\a.js')).toBe(null)
    expect(toRelNode('D:\\proj', 'D:\\proj\\.git\\config')).toBe(null)
  })
})

describe('handlePostTool · мгновенный гейт', () => {
  it('правка с нарушением закона — факт сразу, повтор — молчание (дедуп)', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'new.ts'), 'const s = "двойные";\nconst t = "и ещё";\nconst u = "и ещё";\nconst v = "и ещё";\nconst w = "пять";\n')
    const out = touch(proj, dataRoot, 'Edit', 'src/new.ts')
    expect(out.hookSpecificOutput?.additionalContext).toContain('кавычки — одинарные')
    expect(touch(proj, dataRoot, 'Edit', 'src/new.ts')).toEqual({}) // тот же файл+закон — уже сообщали
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('гейт помечает поимку в gate_log — Stop не повторит той же пары файл+закон', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'new.ts'), 'const a = "x";\nconst b = "x";\nconst c = "x";\nconst d = "x";\nconst e = "x";\n')
    touch(proj, dataRoot, 'Write', 'src/new.ts')
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'), { readonly: true })
    const row = db.query('SELECT * FROM gate_log WHERE session_id=? AND file=?').get('s1', 'src/new.ts')
    db.close()
    expect(row).not.toBe(null)
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('Read не гейтится (чтение — не нарушение), чистая правка молчит', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'bad.ts'), 'const s = "двойные";\nconst t = "и ещё";\nconst u = "3";\nconst v = "4";\nconst w = "5";\n')
    expect(touch(proj, dataRoot, 'Read', 'src/bad.ts')).toEqual({}) // не в графе, читать можно что угодно
    writeFileSync(join(proj, 'src', 'ok.ts'), "const s = 'одинарные'\nconst t = 'ещё'\nconst u = 'ещё'\nconst v = 'ещё'\nconst w = 'пять'\n")
    expect(touch(proj, dataRoot, 'Write', 'src/ok.ts')).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('handlePostTool · срез узла', () => {
  it('касание узла графа (Read) — связи; повтор — молчание', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'core.ts'), "const x = 'ок'\n")
    const out = touch(proj, dataRoot, 'Read', 'src/core.ts')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('src/core.ts · вход:2')
    expect(ctx).toContain('зависят: src/api.ts, src/ui.ts')
    expect(touch(proj, dataRoot, 'Read', 'src/core.ts')).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('дедуп общий с JIT: файл, поданный JIT-ом, PostToolUse не повторяет', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'core.ts'), "const x = 'ок'\n")
    const jit = handleUserPrompt({ prompt: 'посмотри core.ts', cwd: proj, session_id: 's1' }, dataRoot)
    expect(jit.hookSpecificOutput?.additionalContext).toContain('src/core.ts')
    expect(touch(proj, dataRoot, 'Read', 'src/core.ts')).toEqual({}) // уже подан JIT-ом
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('другая сессия — узел подкладывается снова', () => {
    const { proj, dataRoot } = makeWorld()
    writeFileSync(join(proj, 'src', 'core.ts'), "const x = 'ок'\n")
    touch(proj, dataRoot, 'Read', 'src/core.ts', 's1')
    const out = touch(proj, dataRoot, 'Read', 'src/core.ts', 's2')
    expect(out.hookSpecificOutput?.additionalContext).toContain('src/core.ts')
    rmrf(proj)
    rmrf(dataRoot)
  })
})

describe('handlePostTool · края', () => {
  it('не-файловый инструмент, файл вне проекта, нет паспорта — молчание', () => {
    const { proj, dataRoot } = makeWorld()
    expect(handlePostTool({ cwd: proj, tool_name: 'Bash', tool_input: {} }, dataRoot)).toEqual({})
    expect(
      handlePostTool({ cwd: proj, tool_name: 'Edit', tool_input: { file_path: 'C:\\other\\x.ts' } }, dataRoot),
    ).toEqual({})
    const emptyRoot = mkdtempSync(join(tmpdir(), 'symbiont-pt-empty-'))
    expect(touch(proj, emptyRoot, 'Edit', 'src/new.ts')).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
    rmrf(emptyRoot)
  })

  it('удалённый файл после правки — fail-open молчание', () => {
    const { proj, dataRoot } = makeWorld()
    expect(touch(proj, dataRoot, 'Edit', 'src/ghost.ts')).toEqual({})
    rmrf(proj)
    rmrf(dataRoot)
  })
})
