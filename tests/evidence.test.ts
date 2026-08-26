/**
 * Гейт доказательств: правка кода без запущенной после неё проверки — «готово»
 * без доказательства. Источник — транскрипт сессии, ни одного нового процесса.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { evidenceFromTranscript, isCheckCommand } from '../src/gates/evidence'
import { recordEdit } from '../src/hooks/post-tool-core'
import { handleStop } from '../src/hooks/stop-core'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const line = (name: string, input: Record<string, unknown>): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })

describe('распознавание проверки', () => {
  it('тесты, линтеры и тайпчек — проверка; сборка и запуск сервера — нет', () => {
    for (const c of ['bun test', 'npm test', 'pytest -q', 'go test ./...', 'cargo test', 'npx tsc --noEmit', 'bun run scripts/canary.ts --dist', 'eslint src']) {
      expect(isCheckCommand(c)).toBe(true)
    }
    for (const c of ['npm run build', 'git status', 'node server.js', 'ls -la']) expect(isCheckCommand(c)).toBe(false)
  })
})

describe('разбор транскрипта', () => {
  it('правка после последней проверки — без доказательства; проверка после правки — чисто', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-ev-'))
    const p = join(dir, 't.jsonl')
    const own = new Set(['src/a.ts', 'src/b.ts'])
    const toRel = (abs: string) => abs.replace(/^\/proj\//, '')
    writeFileSync(
      p,
      [line('Edit', { file_path: '/proj/src/a.ts' }), line('Bash', { command: 'bun test' }), line('Edit', { file_path: '/proj/src/b.ts' }), '{"type":"user"}', '{broken'].join('\n'),
    )
    const ev = evidenceFromTranscript(p, own, toRel)
    expect(ev.readable).toBe(true)
    expect(ev.checkedOnce).toBe(true)
    expect(ev.uncheckedFiles).toEqual(['src/b.ts'])
    writeFileSync(p, [line('Edit', { file_path: '/proj/src/a.ts' }), line('Bash', { command: 'bun test tests/a.test.ts' })].join('\n'))
    expect(evidenceFromTranscript(p, own, toRel).uncheckedFiles).toEqual([])
    // чужие файлы (не own) не судятся; нет транскрипта — не читается
    writeFileSync(p, line('Write', { file_path: '/proj/README.md' }))
    expect(evidenceFromTranscript(p, own, toRel).uncheckedFiles).toEqual([])
    expect(evidenceFromTranscript(join(dir, 'nope.jsonl'), own, toRel).readable).toBe(false)
    rmrf(dir)
  })
})

describe('на Stop', () => {
  it('dry-run: строка «доказательств нет» один раз на набор файлов; после проверки — молчит', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-ev-proj-'))
    const g = (...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: proj, encoding: 'utf8' })
    g('init', '-b', 'main')
    mkdirSync(join(proj, 'src'))
    mkdirSync(join(proj, 'tests'))
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(proj, 'tests', 'a.test.ts'), "import { a } from '../src/a'\n")
    g('add', '.')
    g('commit', '-m', 'база')
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-ev-data-'))
    handleSessionStart({ cwd: proj, source: 'startup', session_id: 'e-1' }, dataRoot)
    const db = openDb(join(dataRoot, slugOf(proj), 'passport.db'))
    recordEdit(db, 'e-1', 'src/a.ts')
    db.close()
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 2\n')
    const transcript = join(dataRoot, 't.jsonl')
    writeFileSync(transcript, line('Edit', { file_path: join(proj, 'src', 'a.ts') }))

    const first = handleStop({ cwd: proj, session_id: 'e-1', transcript_path: transcript }, dataRoot)
    const ctx = JSON.stringify(first)
    expect(ctx).toContain('доказательств нет')
    expect(ctx).toContain('src/a.ts')
    expect(first.decision).toBeUndefined() // dry-run: наблюдение, не блок
    const again = handleStop({ cwd: proj, session_id: 'e-1', transcript_path: transcript }, dataRoot)
    expect(JSON.stringify(again)).not.toContain('доказательств нет') // тот же набор — один раз

    writeFileSync(transcript, [line('Edit', { file_path: join(proj, 'src', 'a.ts') }), line('Bash', { command: 'bun test' })].join('\n'))
    const checked = handleStop({ cwd: proj, session_id: 'e-1', transcript_path: transcript }, dataRoot)
    expect(JSON.stringify(checked)).not.toContain('доказательств нет')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
