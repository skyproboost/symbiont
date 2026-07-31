import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { detectSecurityRegressions } from '../src/verifiers/security'
import { slugOf } from '../src/hooks/session-start-core'
import { SessionLog } from '../src/core/sessions'
import { handleStop } from '../src/hooks/stop-core'

const diff = (removed: string[], added: string[]): string =>
  ['--- a/f', '+++ b/f', ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)].join('\n')

describe('detectSecurityRegressions — снятая защита', () => {
  it('снят CSP-заголовок', () => {
    const f = detectSecurityRegressions(diff(["res.setHeader('Content-Security-Policy', csp)"], []))
    expect(f.some((x) => x.kind.includes('security-заголовок'))).toBe(true)
  })
  it('снята валидация входа (zod/parse)', () => {
    expect(detectSecurityRegressions(diff(['const data = schema.parse(req.body)'], [])).some((x) => x.kind.includes('валидация'))).toBe(true)
  })
  it('снята аутентификация', () => {
    expect(detectSecurityRegressions(diff(['router.get("/x", requireAuth, handler)'], [])).some((x) => x.kind.includes('аутентификаци'))).toBe(true)
  })
  it('снят rate-limit', () => {
    expect(detectSecurityRegressions(diff(['app.use(rateLimit({ max: 100 }))'], [])).some((x) => x.kind.includes('rate-limit'))).toBe(true)
  })
})

describe('detectSecurityRegressions — внесённый риск', () => {
  it('CORS расширен до *', () => {
    expect(detectSecurityRegressions(diff([], ["res.setHeader('Access-Control-Allow-Origin', '*')"])).some((x) => x.kind.includes('CORS'))).toBe(true)
  })
  it('отключена проверка TLS (rejectUnauthorized:false / verify=False)', () => {
    expect(detectSecurityRegressions(diff([], ['const a = { rejectUnauthorized: false }'])).some((x) => x.kind.includes('TLS'))).toBe(true)
    expect(detectSecurityRegressions(diff([], ['requests.get(url, verify=False)'])).some((x) => x.kind.includes('TLS'))).toBe(true)
  })
  it('внесён eval / os.system', () => {
    expect(detectSecurityRegressions(diff([], ['const r = eval(userInput)'])).some((x) => x.kind.includes('eval'))).toBe(true)
    expect(detectSecurityRegressions(diff([], ['os.system(cmd)'])).some((x) => x.kind.includes('eval'))).toBe(true)
  })
  it('внесён небезопасный HTML (dangerouslySetInnerHTML / v-html)', () => {
    expect(detectSecurityRegressions(diff([], ['<div dangerouslySetInnerHTML={{__html: x}} />'])).some((x) => x.kind.includes('HTML'))).toBe(true)
  })
  it('подавлен анализатор безопасности (# nosec)', () => {
    expect(detectSecurityRegressions(diff([], ['os.system(cmd)  # nosec'])).some((x) => x.kind.includes('подавлен'))).toBe(true)
  })
})

describe('detectSecurityRegressions — анти-шум', () => {
  it('перемещение защиты (снята и возвращена в том же диффе) НЕ флагается', () => {
    const d = diff(["app.use(rateLimit({ max: 100 }))"], ["app.use(rateLimit({ max: 200 }))"])
    expect(detectSecurityRegressions(d).some((x) => x.kind.includes('rate-limit'))).toBe(false)
  })
  it('generic parse (marked.parse/JSON.parse/Date.parse) НЕ флагается как валидация (догфудинг-находка)', () => {
    expect(detectSecurityRegressions(diff(['let out = marked.parse(raw)'], []))).toEqual([])
    expect(detectSecurityRegressions(diff(['const o = JSON.parse(s)'], []))).toEqual([])
    // но реальная валидация — флагается
    expect(detectSecurityRegressions(diff(['const d = userSchema.parse(body)'], [])).some((x) => x.kind.includes('валидация'))).toBe(true)
    expect(detectSecurityRegressions(diff(['const d = input.safeParse(body)'], [])).some((x) => x.kind.includes('валидация'))).toBe(true)
  })

  it('чистый и пустой дифф → ничего', () => {
    expect(detectSecurityRegressions(diff(['const x = 1'], ['const x = 2']))).toEqual([])
    expect(detectSecurityRegressions('')).toEqual([])
  })
  it('дедуп по виду находки', () => {
    const d = diff(['schema.parse(a)', 'validate(b)'], [])
    expect(detectSecurityRegressions(d).filter((x) => x.kind.includes('валидация')).length).toBe(1)
  })
})

describe('симуляция: страж в Stop через реальный git', () => {
  // Паспорт настраиваем НАПРЯМУЮ (SessionLog), без handleSessionStart: тот делает
  // ~5 git-вызовов сборки — главный источник флака под параллельной нагрузкой
  // Windows. Здесь git трогает только handleStop (status + diff) — надёжно.
  function gitRepo(sid: string) {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-sec-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-sec-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    const run = (args: string[]) => spawnSync('git', args, { cwd: proj, encoding: 'utf8' })
    run(['init', '-b', 'main'])
    run(['config', 'user.email', 't@t.t'])
    run(['config', 'user.name', 't'])
    writeFileSync(join(proj, 'api.js'), "app.use(rateLimit({ max: 100 }))\napp.get('/x', handler)\n")
    run(['add', '-A'])
    run(['commit', '-m', 'init'])
    // сессия открыта ЧАС назад → правка сейчас видна как «в этой сессии»
    const db = openDb(join(dataDir, 'passport.db'))
    new SessionLog(db).open(sid, 'startup', new Date(Date.now() - 3600_000).toISOString())
    db.close()
    return { proj, dataRoot }
  }

  it('коммит с rate-limit → снятие → Stop сообщает ослабление защиты', () => {
    const { proj, dataRoot } = gitRepo('s1')
    writeFileSync(join(proj, 'api.js'), "app.get('/x', handler)\n") // снять rate-limit
    const out = handleStop({ cwd: proj, session_id: 's1' }, dataRoot)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('защитный слой')
    expect(ctx).toContain('rate-limit')
    rmrf(proj)
    rmrf(dataRoot)
  })

  it('cleanup-safe: чистая правка не флагает защиту', () => {
    const { proj, dataRoot } = gitRepo('s2')
    writeFileSync(join(proj, 'api.js'), "app.use(rateLimit({ max: 100 }))\napp.get('/x', handler)\napp.get('/y', h2)\n")
    const out = handleStop({ cwd: proj, session_id: 's2' }, dataRoot)
    expect(out.hookSpecificOutput?.additionalContext ?? '').not.toContain('защитный слой')
    rmrf(proj)
    rmrf(dataRoot)
  })
})
