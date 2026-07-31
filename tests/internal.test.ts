/**
 * Маркер собственного вызова: Symbiont не реагирует сам на себя.
 * Догфудинг-находка — свои LLM-проходы идут через headless `claude -p`, а это
 * полноценная сессия Claude Code с нашими же хуками: без метки проход из
 * временного проекта плодил паспорта-призраки в корне данных владельца.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isInternalCall, internalEnv, INTERNAL_ENV } from '../src/core/internal'
import { rmrf } from './_helpers'

const ROOT = join(import.meta.dirname, '..')

describe('isInternalCall', () => {
  it('метка распознаётся только при точном значении', () => {
    expect(isInternalCall({ [INTERNAL_ENV]: '1' })).toBe(true)
    expect(isInternalCall({})).toBe(false)
    expect(isInternalCall({ [INTERNAL_ENV]: '0' })).toBe(false)
    expect(isInternalCall({ [INTERNAL_ENV]: '' })).toBe(false)
  })
})

describe('internalEnv', () => {
  it('добавляет метку, сохраняя остальное окружение', () => {
    const out = internalEnv({ PATH: '/usr/bin', HOME: '/home/x' })
    expect(out[INTERNAL_ENV]).toBe('1')
    expect(out.PATH).toBe('/usr/bin')
    expect(out.HOME).toBe('/home/x')
  })
})

describe('каналы под меткой молчат (реальные процессы)', () => {
  it('SessionStart с меткой не пишет ни паспорта, ни heartbeat', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-internal-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-internalD-'))
    writeFileSync(join(proj, 'a.js'), 'var sName = 1\nvar aList = []\n')

    const run = (env: Record<string, string | undefined>) =>
      spawnSync('bun', ['run', join(ROOT, 'src', 'hooks', 'session-start.ts'), '--data', data], {
        input: JSON.stringify({ cwd: proj, source: 'startup', session_id: 'internal-probe' }),
        encoding: 'utf8',
        timeout: 60_000,
        cwd: proj,
        env: env as NodeJS.ProcessEnv,
      })

    const marked = run(internalEnv(process.env) as Record<string, string | undefined>)
    expect(marked.status).toBe(0)
    expect((marked.stdout ?? '').trim()).toBe('') // ни слова в контекст
    expect(readdirSync(data).length).toBe(0) // ни одного каталога-призрака

    // Контроль: без метки тот же вызов работает как обычно
    const plain = run(process.env as Record<string, string | undefined>)
    expect(plain.status).toBe(0)
    expect(readdirSync(data).length).toBeGreaterThan(0)

    rmrf(proj)
    rmrf(data)
  })

  it('Stop и PostToolUse с меткой выходят молча', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-internal-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-internalD-'))
    writeFileSync(join(proj, 'a.js'), 'const x = 1\n')
    const env = internalEnv(process.env) as NodeJS.ProcessEnv

    for (const entry of ['stop.ts', 'post-tool.ts']) {
      const r = spawnSync('bun', ['run', join(ROOT, 'src', 'hooks', entry), '--data', data], {
        input: JSON.stringify({ cwd: proj, session_id: 'internal-probe', tool_name: 'Write', tool_input: { file_path: join(proj, 'a.js') } }),
        encoding: 'utf8',
        timeout: 60_000,
        cwd: proj,
        env,
      })
      expect(r.status).toBe(0)
      expect((r.stdout ?? '').trim()).toBe('')
    }
    expect(existsSync(join(data, 'passport.db'))).toBe(false)
    expect(readdirSync(data).length).toBe(0)

    rmrf(proj)
    rmrf(data)
  })
})
