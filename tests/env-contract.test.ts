/**
 * Контракт среды — третий вид связи: код ↔ конфигурация.
 *
 * Приёмочный сценарий взят из боевого случая владельца: сделали генерацию mp4,
 * выкатили, видео не работает — CSP блокировал blob:. Обе половины противоречия
 * лежали в репозитории, но граф импортов их не связывал.
 *
 * Половина тестов — на МОЛЧАНИЕ: проект без политики не должен получать ни одной
 * претензии, иначе слой превратится в шум и его выключат.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCapabilities, extractEnvUsage } from '../src/env/capabilities'
import { parseCspString, findCsp, findDeclaredEnv, findServices, readPolicies, cspAllows } from '../src/env/policies'
import { checkContract, renderContract, renderPolicySummary } from '../src/env/contract'
import { rmrf } from './_helpers'

const world = (): string => mkdtempSync(join(tmpdir(), 'symbiont-env-'))

describe('извлечение требований кода', () => {
  it('видит blob-URL, видеопоток, воркер, eval и инлайн-стиль', () => {
    const ids = (code: string): string[] => extractCapabilities(code).map((h) => h.rule.id)
    expect(ids('const url = URL.createObjectURL(blob)')).toContain('blob-url')
    expect(ids('const rec = new MediaRecorder(stream)')).toContain('media-stream')
    expect(ids('const w = new Worker("./w.js")')).toContain('worker')
    expect(ids('const f = new Function("return 1")')).toContain('eval')
    expect(ids('el.style.cssText = "color:red"')).toContain('inline-style')
    expect(ids('canvas.toDataURL("image/png")')).toContain('data-image')
  })

  it('видит внешние адреса как отдельное требование', () => {
    const hits = extractCapabilities('await fetch("https://api.stripe.com/v1/charges")')
    const remote = hits.find((h) => h.rule.id === 'remote-call')
    expect(remote).toBeDefined()
    expect(remote!.target).toBe('api.stripe.com')
  })

  it('обычный код требований не порождает', () => {
    expect(extractCapabilities('export const sum = (a, b) => a + b\n')).toEqual([])
  })

  it('переменные окружения — кросс-язык', () => {
    expect(extractEnvUsage('process.env.STRIPE_KEY')).toContain('STRIPE_KEY')
    expect(extractEnvUsage('import.meta.env.API_URL')).toContain('API_URL')
    expect(extractEnvUsage("os.environ['DB_PASSWORD']")).toContain('DB_PASSWORD')
    expect(extractEnvUsage('getenv("REDIS_HOST")')).toContain('REDIS_HOST')
    expect(extractEnvUsage('const x = process.env.ab')).toEqual([]) // не похоже на имя переменной
  })
})

describe('извлечение политик', () => {
  it('разбирает CSP-строку в директивы', () => {
    const p = parseCspString("default-src 'self'; media-src 'self'; script-src 'self' 'unsafe-inline'", 'test')!
    expect(p.directives.get('media-src')).toEqual(["'self'"])
    expect(p.directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
  })

  it('находит CSP в конфиге фреймворка, nginx и meta-теге', () => {
    const a = world()
    writeFileSync(join(a, 'nuxt.config.ts'), `export default { routeRules: { '/**': { headers: { 'Content-Security-Policy': "default-src 'self'; media-src 'self'" } } } }`)
    expect(findCsp(a)!.directives.get('media-src')).toEqual(["'self'"])
    rmrf(a)

    const b = world()
    writeFileSync(join(b, 'nginx.conf'), `add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:";`)
    expect(findCsp(b)!.directives.get('img-src')).toContain('data:')
    rmrf(b)

    const c = world()
    writeFileSync(join(c, 'index.html'), `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`)
    expect(findCsp(c)!.directives.get('default-src')).toEqual(["'self'"])
    rmrf(c)
  })

  it('нет CSP — null, а не выдуманная политика', () => {
    const w = world()
    writeFileSync(join(w, 'index.html'), '<html><body>hi</body></html>')
    expect(findCsp(w)).toBeNull()
    rmrf(w)
  })

  it('читает объявленные переменные и поднятые сервисы', () => {
    const w = world()
    writeFileSync(join(w, '.env.example'), 'API_URL=\n# комментарий\nSTRIPE_KEY=sk_test\n')
    writeFileSync(join(w, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n')
    const p = readPolicies(w)
    expect([...p.declaredEnv].sort()).toEqual(['API_URL', 'STRIPE_KEY'])
    expect([...p.services].some((s) => s.includes('redis'))).toBe(true)
    rmrf(w)
  })
})

describe('cspAllows — наследование от default-src', () => {
  const csp = parseCspString("default-src 'self'; media-src 'self' blob:; script-src *", 'test')!

  it('явно разрешённое проходит, неразрешённое — нет', () => {
    expect(cspAllows(csp, 'media-src', 'blob:')).toBe(true)
    expect(cspAllows(csp, 'style-src', "'unsafe-inline'")).toBe(false) // наследует default-src 'self'
    expect(cspAllows(csp, 'script-src', "'unsafe-eval'")).toBe(true) // wildcard
  })

  it('нерегулируемая директива запретом не считается', () => {
    const bare = parseCspString("media-src 'self'", 'test')!
    expect(cspAllows(bare, 'worker-src', 'blob:')).toBe(true) // ни worker-src, ни default-src не заданы
  })
})

describe('ПРИЁМОЧНЫЙ СЦЕНАРИЙ: mp4 против CSP', () => {
  it('ловит боевой случай — код делает blob-видео, а media-src его не разрешает', () => {
    const w = world()
    writeFileSync(
      join(w, 'nuxt.config.ts'),
      `export default { routeRules: { '/**': { headers: { 'Content-Security-Policy': "default-src 'self'; media-src 'self'" } } } }`,
    )
    const policies = readPolicies(w)
    const code = `
      const recorder = new MediaRecorder(stream)
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/mp4' })
        video.src = URL.createObjectURL(blob)
      }
    `
    const issues = checkContract(code, policies)
    const csp = issues.filter((i) => i.kind === 'csp')
    expect(csp.length).toBeGreaterThan(0)
    expect(csp[0].certainty).toBe('противоречие')
    expect(csp.some((i) => i.detail.includes('blob:'))).toBe(true)
    expect(csp.some((i) => i.policy.includes('media-src'))).toBe(true)
    expect(csp.some((i) => i.policy.includes('nuxt.config.ts'))).toBe(true) // сказано, где чинить
    rmrf(w)
  })

  it('инлайн-стиль при настроенном CSP тоже ловится', () => {
    const w = world()
    writeFileSync(join(w, 'nginx.conf'), `add_header Content-Security-Policy "default-src 'self'";`)
    const issues = checkContract('el.style.cssText = "color: red"', readPolicies(w))
    expect(issues.some((i) => i.kind === 'csp' && i.requirement.includes('инлайновые стили'))).toBe(true)
    rmrf(w)
  })

  it('МОЛЧАНИЕ: тот же код в проекте без CSP не даёт ни одной претензии', () => {
    const w = world()
    writeFileSync(join(w, 'index.html'), '<html></html>')
    const code = 'const url = URL.createObjectURL(new Blob([data]))\nel.style.cssText = "color:red"\neval("1")'
    expect(checkContract(code, readPolicies(w))).toEqual([])
    rmrf(w)
  })

  it('МОЛЧАНИЕ: CSP разрешает — претензии нет', () => {
    const w = world()
    writeFileSync(join(w, 'nginx.conf'), `add_header Content-Security-Policy "default-src 'self'; media-src 'self' blob:";`)
    const issues = checkContract('video.src = URL.createObjectURL(blob)', readPolicies(w))
    expect(issues.filter((i) => i.kind === 'csp')).toEqual([])
    rmrf(w)
  })
})

describe('переменные окружения и сервисы', () => {
  it('код читает переменную, которой нет в образце — противоречие', () => {
    const w = world()
    writeFileSync(join(w, '.env.example'), 'API_URL=\n')
    const issues = checkContract('const k = process.env.STRIPE_SECRET_KEY', readPolicies(w))
    expect(issues.some((i) => i.kind === 'env' && i.requirement.includes('STRIPE_SECRET_KEY'))).toBe(true)
    rmrf(w)
  })

  it('нет образца окружения — молчим (проект не ведёт такой контракт)', () => {
    const w = world()
    expect(checkContract('process.env.ANYTHING_AT_ALL', readPolicies(w))).toEqual([])
    rmrf(w)
  })

  it('сервис вне инфраструктуры — наблюдение, а не приговор (может быть внешним)', () => {
    const w = world()
    writeFileSync(join(w, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n')
    const issues = checkContract('const redis = new Redis(process.env.REDIS_URL)', readPolicies(w))
    const svc = issues.find((i) => i.kind === 'service')
    expect(svc).toBeDefined()
    expect(svc!.certainty).toBe('наблюдение')
    rmrf(w)
  })
})

describe('подача', () => {
  it('рендер расхождения называет требование, политику и адрес починки', () => {
    const lines = renderContract([
      { kind: 'csp', requirement: 'код создаёт blob:-URL', policy: "media-src: 'self' — nuxt.config.ts", certainty: 'противоречие', detail: 'нужен blob:' },
    ])
    expect(lines[0]).toContain('контракт среды (противоречие)')
    expect(lines[0]).toContain('nuxt.config.ts')
  })

  it('сводка политик показывает действующий CSP, а на проекте без политик молчит', () => {
    const w = world()
    writeFileSync(join(w, 'nginx.conf'), `add_header Content-Security-Policy "default-src 'self'; media-src 'self'";`)
    expect(renderPolicySummary(readPolicies(w))).toContain('CSP')
    rmrf(w)

    const bare = world()
    expect(renderPolicySummary(readPolicies(bare))).toBe('')
    rmrf(bare)
  })
})
