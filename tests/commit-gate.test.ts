/**
 * Гейт момента коммита. Как и у подачи до чтения, проверяется в первую очередь
 * то, чего он НЕ делает: не тратит работу на чужую команду, не повторяет
 * сказанное, не мешает коммиту вне режима блокировки и не держит его дважды.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { slugOf } from '../src/hooks/session-start-core'
import { handlePreTool } from '../src/hooks/pre-tool-core'
import { recordEdit } from '../src/hooks/post-tool-core'
import { isCommitCommand, commitsElsewhere, missingPartners, PARTNER_SUPPORT } from '../src/hooks/commit-core'

let seq = 0
const use = (name: string, input: Record<string, unknown>, id = `cu-${++seq}`): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const run = (output: string, command = 'bun test 2>&1 | tail -5'): string[] => {
  const id = `crun-${++seq}`
  return [use('Bash', { command }, id), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } })]
}
const RED = ' 12 pass\n 1 fail'
const GREEN = ' 13 pass\n 0 fail'

interface World {
  proj: string
  dataRoot: string
  dataDir: string
  transcript: string
}

/** Проект с графом (тесты в нём есть), журналом правок сессии и таблицами co-change. */
function makeWorld(edited: string[] = ['src/a.ts'], sid = 'c1'): World {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-commit-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-commit-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, 'tests'), { recursive: true })
  writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(proj, 'tests', 'a.test.ts'), "import { a } from '../src/a'\n")
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  for (const f of ['src/a.ts', 'tests/a.test.ts']) db.query('INSERT INTO graph_nodes(file, rank, in_deg, out_deg) VALUES(?,?,?,?)').run(f, 0.1, 1, 1)
  db.run('CREATE TABLE cochange(file_a TEXT NOT NULL, file_b TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(file_a, file_b))')
  db.run('CREATE TABLE cochange_totals(file TEXT PRIMARY KEY, n INTEGER NOT NULL)')
  for (const f of edited) recordEdit(db, sid, f)
  db.close()
  return { proj, dataRoot, dataDir, transcript: join(dataRoot, 't.jsonl') }
}

const commit = (w: World, command = 'git add -A && git commit -m "x"', tool = 'Bash', sid = 'c1') =>
  handlePreTool({ cwd: w.proj, session_id: sid, transcript_path: w.transcript, tool_name: tool, tool_input: { command } }, w.dataRoot)

const drop = (w: World): void => {
  rmrf(w.proj)
  rmrf(w.dataRoot)
}

describe('что такое коммит', () => {
  it('по форме команды, в составной команде и с глобальными флагами git', () => {
    for (const c of ['git commit -m "x"', 'git add -A && git commit -m "x"', 'git -C /repo commit -am x', 'git -c user.name=t -c user.email=t@t commit -m x', 'cd repo; git commit --amend --no-edit']) {
      expect(isCommitCommand(c)).toBe(true)
    }
    for (const c of ['git commit --dry-run', 'git log --grep=commit', 'echo "git committed"', 'git commit-graph write', 'git status', 'bun test']) expect(isCommitCommand(c)).toBe(false)
  })
})

describe('манифест хуков', () => {
  it('на каждую оболочку два условия: шаблон сверяется с НАЧАЛОМ подкоманды, и флаги git его ломают', () => {
    // Замер живой пробой на платформе: `…(git commit *)` ловит `git commit …` и
    // составные команды, но НЕ `git -C путь commit …`; `…(git * commit *)` — наоборот.
    // Каждая форма, которую ловит манифест, обязана признаваться и самим гейтом.
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ if?: string }> }> }
    }
    for (const shell of ['Bash', 'PowerShell']) {
      const group = manifest.hooks.PreToolUse.find((g) => g.matcher === shell)
      expect(group?.hooks.map((h) => h.if)).toEqual([`${shell}(git commit *)`, `${shell}(git * commit *)`])
    }
    for (const c of ['git commit -m x', 'git -C . commit --allow-empty -m x', 'git -c user.name=t commit -m x']) expect(isCommitCommand(c)).toBe(true)
    // второй шаблон шире гейта (`git log --grep commit x` под него подходит) — гейт такое отсекает сам
    expect(isCommitCommand('git log --grep commit x')).toBe(false)
  })
})

describe('на коммите', () => {
  it('чужая команда оболочки выходит сразу, без единой строки', () => {
    const w = makeWorld()
    writeFileSync(w.transcript, use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }))
    expect(commit(w, 'bun test')).toEqual({})
    expect(commit(w, 'git status')).toEqual({})
    drop(w)
  })

  it('правка после последней проверки — строка один раз на состояние; коммит не блокируется', () => {
    const w = makeWorld()
    writeFileSync(w.transcript, [...run(GREEN), use('Edit', { file_path: join(w.proj, 'src', 'a.ts') })].join('\n'))
    const out = commit(w)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('перед коммитом')
    expect(ctx).toContain('после последней правки проверка не запускалась (src/a.ts)')
    expect(JSON.stringify(out)).not.toContain('permissionDecision')
    expect(commit(w)).toEqual({}) // то же состояние — молчит
    drop(w)
  })

  it('последняя проверка красная — называется; зелёная после правки — молчит', () => {
    const w = makeWorld()
    writeFileSync(w.transcript, [use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), ...run(RED)].join('\n'))
    expect(commit(w).hookSpecificOutput?.additionalContext ?? '').toContain('последняя проверка упала')
    writeFileSync(w.transcript, [use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), ...run(RED), ...run(GREEN)].join('\n'))
    expect(commit(w)).toEqual({})
    drop(w)
  })

  it('PowerShell — та же оболочка', () => {
    const w = makeWorld()
    writeFileSync(w.transcript, use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }))
    expect(commit(w, 'git commit -m x', 'PowerShell').hookSpecificOutput?.additionalContext ?? '').toContain('перед коммитом')
    drop(w)
  })

  it('сессия ничего не писала — о чужой работе сказать нечего', () => {
    const w = makeWorld([])
    writeFileSync(w.transcript, use('Bash', { command: 'ls' }))
    expect(commit(w)).toEqual({})
    drop(w)
  })

  it('режим блокировки держит коммит один раз на состояние: повтор проходит', () => {
    const w = makeWorld()
    writeFileSync(join(w.dataDir, 'gate.json'), JSON.stringify({ mode: 'block' }))
    writeFileSync(w.transcript, use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }))
    const held = commit(w)
    expect(held.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(held.hookSpecificOutput?.permissionDecisionReason ?? '').toContain('второй раз она не отменяется')
    expect(commit(w)).toEqual({})
    // новое состояние — новая отметка: после прогона и новой правки держит снова
    writeFileSync(w.transcript, [use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), ...run(RED)].join('\n'))
    expect(commit(w).hookSpecificOutput?.permissionDecision).toBe('deny')
    drop(w)
  })
})

describe('состав коммита', () => {
  const git = (w: World, ...args: string[]): void => {
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: w.proj, encoding: 'utf8' })
  }
  /** Мир с настоящим репозиторием: база закоммичена, src/a.ts правлен сессией и не проверен. */
  const repo = (): World => {
    const w = makeWorld()
    git(w, 'init', '-b', 'main')
    git(w, 'add', '.')
    git(w, 'commit', '-m', 'база')
    writeFileSync(join(w.proj, 'src', 'a.ts'), 'export const a = 2\n')
    writeFileSync(join(w.proj, 'README.md'), '# doc\n')
    writeFileSync(w.transcript, use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }))
    return w
  }

  it('незастейдженный файл в коммит не идёт — о нём молчим; застейдженный — называем', () => {
    const w = repo()
    git(w, 'add', 'README.md')
    expect(commit(w, 'git commit -m "доки"')).toEqual({}) // a.ts — незаконченная работа, в этот коммит не входит
    git(w, 'add', 'src/a.ts')
    expect(commit(w, 'git commit -m "код"').hookSpecificOutput?.additionalContext ?? '').toContain('src/a.ts')
    drop(w)
  })

  it('команда стейджит сама (git add … && commit, commit -am) — в коммит идёт всё изменённое', () => {
    for (const cmd of ['git add -A && git commit -m "x"', 'git commit -am "x"']) {
      const w = repo()
      expect(commit(w, cmd).hookSpecificOutput?.additionalContext ?? '').toContain('src/a.ts')
      drop(w)
    }
  })

  it('коммит в другом репозитории — не наше дело; cd в свой же каталог — наше', () => {
    const w = repo()
    expect(commit(w, 'cd ../other && git add -A && git commit -m "x"')).toEqual({})
    expect(commit(w, 'git -C /srv/other commit -am "x"')).toEqual({})
    expect(commitsElsewhere(`cd "${w.proj}" && git commit -am x`, w.proj)).toBe(false)
    expect(commitsElsewhere('cd /d/OSPanel/domains/Proj && git commit -am x', 'D:\\OSPanel\\domains\\proj')).toBe(false) // msys-форма того же пути
    expect(commit(w, `cd "${w.proj}" && git add -A && git commit -m "x"`).hookSpecificOutput?.additionalContext ?? '').toContain('src/a.ts')
    drop(w)
  })
})

describe('пропущенный спутник', () => {
  const pairUp = (w: World, a: string, b: string, together: number, totalA: number): void => {
    const db = openDb(join(w.dataDir, 'passport.db'))
    const [x, y] = a < b ? [a, b] : [b, a]
    db.query('INSERT OR REPLACE INTO cochange(file_a, file_b, n) VALUES(?,?,?)').run(x, y, together)
    db.query('INSERT OR REPLACE INTO cochange_totals(file, n) VALUES(?,?)').run(a, totalA)
    db.close()
  }

  it('уверенность от правленого файла и поддержка — обе обязательны; тронутый спутник не называется', () => {
    const w = makeWorld()
    pairUp(w, 'src/a.ts', 'tests/a.test.ts', 9, 10)
    const db = openDb(join(w.dataDir, 'passport.db'))
    expect(missingPartners(db, ['src/a.ts'], new Set(['src/a.ts']))).toEqual([{ file: 'src/a.ts', partner: 'tests/a.test.ts', together: 9, total: 10 }])
    expect(missingPartners(db, ['src/a.ts'], new Set(['src/a.ts', 'tests/a.test.ts']))).toEqual([])
    db.close()
    pairUp(w, 'src/a.ts', 'tests/a.test.ts', 7, 10) // уверенность 0.7
    const low = openDb(join(w.dataDir, 'passport.db'))
    expect(missingPartners(low, ['src/a.ts'], new Set())).toEqual([])
    low.close()
    pairUp(w, 'src/a.ts', 'tests/a.test.ts', PARTNER_SUPPORT - 1, PARTNER_SUPPORT - 1) // уверенность 1.0, но случаев мало
    const few = openDb(join(w.dataDir, 'passport.db'))
    expect(missingPartners(few, ['src/a.ts'], new Set())).toEqual([])
    few.close()
    drop(w)
  })

  it('на коммите: строка о спутнике, коммит не держится даже в режиме блокировки', () => {
    const w = makeWorld()
    pairUp(w, 'src/a.ts', 'tests/a.test.ts', 9, 10)
    writeFileSync(join(w.dataDir, 'gate.json'), JSON.stringify({ mode: 'block' }))
    writeFileSync(w.transcript, [use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), ...run(GREEN)].join('\n'))
    const out = commit(w)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('tests/a.test.ts исторически меняется вместе с src/a.ts (9 из 10 коммитов)')
    expect(JSON.stringify(out)).not.toContain('permissionDecision')
    drop(w)
  })

  it('спутник, которого уже нет на диске, не называется', () => {
    const w = makeWorld()
    pairUp(w, 'src/a.ts', 'tests/gone.test.ts', 9, 10)
    writeFileSync(w.transcript, [use('Edit', { file_path: join(w.proj, 'src', 'a.ts') }), ...run(GREEN)].join('\n'))
    expect(commit(w)).toEqual({})
    drop(w)
  })
})
