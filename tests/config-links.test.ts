/**
 * Связи конфигурации с кодом как рёбра графа. Половина проверок — про ТОЧНОСТЬ:
 * улика обязана быть редкой, иначе карта превращается в кашу (живая находка —
 * токен с именем проекта связал конфиг со всеми тестами разом).
 */
import { describe, expect, it } from 'bun:test'
import { openDb } from '../src/core/db'
import { parseConfigFile, lexicalLinks, historicalLinks, significantTokens, isConfigFile } from '../src/env/config-graph'
import { collectConfigLinks, storeConfigEdges, readConfigEdges, renderConfigInfluence } from '../src/env/links'

describe('распознавание конфигурации', () => {
  it('по расширению и по имени, без списка технологий', () => {
    expect(isConfigFile('nuxt.config.ts')).toBe(true)
    expect(isConfigFile('deploy/nginx.conf')).toBe(true)
    expect(isConfigFile('.env.example')).toBe(true)
    expect(isConfigFile('docker-compose.yml')).toBe(true)
    expect(isConfigFile('src/components/Button.vue')).toBe(false)
  })

  it('разбирает пары ключ-значение в разных форматах', () => {
    const json = parseConfigFile('a.json', '{"REDIS_URL": "redis://cache:6379", "retries": 3}')
    expect(json.some((e) => e.key === 'REDIS_URL')).toBe(true)
    const nginx = parseConfigFile('nginx.conf', 'add_header Content-Security-Policy "media-src blob:";')
    expect(nginx.some((e) => e.value.includes('media-src'))).toBe(true)
  })
})

describe('точность улик', () => {
  it('сильные формы годятся в улики: порт, домен, ИМЯ_ПЕРЕМЕННОЙ, директива', () => {
    const strong = significantTokens('', 'api.example.com 6379 REDIS_URL media-src', true)
    expect(strong).toContain('api.example.com')
    expect(strong).toContain('6379')
    expect(strong).toContain('REDIS_URL')
    expect(strong).toContain('media-src')
  })

  it('слабые слова уликой НЕ становятся — они есть в любом проекте', () => {
    const strict = significantTokens('', 'generate always description', true)
    expect(strict).toEqual([])
    // но как материал для выведенных правил они годятся
    expect(significantTokens('', 'generate always', false).length).toBeGreaterThan(0)
  })

  it('токен, встречающийся в большинстве файлов кода, связь не порождает', () => {
    const entries = parseConfigFile('app.json', '{"NAME": "MyProject"}')
    const files = Array.from({ length: 20 }, (_, i) => ({ rel: `src/f${i}.ts`, content: 'MyProject везде' }))
    expect(lexicalLinks(entries, files).length).toBe(0)
  })

  it('редкий токен связь порождает и несёт улику', () => {
    const entries = parseConfigFile('.env.example', 'STRIPE_SECRET=\n')
    const files = [
      { rel: 'src/pay.ts', content: 'process.env.STRIPE_SECRET' },
      ...Array.from({ length: 12 }, (_, i) => ({ rel: `src/o${i}.ts`, content: 'ничего общего' })),
    ]
    const links = lexicalLinks(entries, files)
    expect(links.length).toBe(1)
    expect(links[0].codeFile).toBe('src/pay.ts')
    expect(links[0].token).toBe('STRIPE_SECRET')
  })
})

describe('исторические связи', () => {
  it('конфиг и код, правленные вместе, связаны — это след инцидента', () => {
    const links = historicalLinks([{ a: 'nuxt.config.ts', b: 'src/Video.vue', n: 3 }])
    expect(links.length).toBe(1)
    expect(links[0].configFile).toBe('nuxt.config.ts')
    expect(links[0].via).toBe('история')
  })

  it('пара из двух кодовых или двух конфигов — не наш случай', () => {
    expect(historicalLinks([{ a: 'src/a.ts', b: 'src/b.ts', n: 5 }])).toEqual([])
    expect(historicalLinks([{ a: 'a.json', b: 'b.yml', n: 5 }])).toEqual([])
  })
})

describe('хранение и подача', () => {
  it('история идёт вперёд лексики и сохраняется, дубли не плодятся', () => {
    const db = openDb(':memory:')
    const links = collectConfigLinks(
      parseConfigFile('.env.example', 'API_TOKEN=\n'),
      [{ rel: 'src/api.ts', content: 'process.env.API_TOKEN' }],
      [{ a: '.env.example', b: 'src/api.ts', n: 4 }],
    )
    storeConfigEdges(db, links)
    const rows = readConfigEdges(db, 'src/api.ts')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].via).toBe('история') // доказательнее лексики
    db.close()
  })

  it('подача говорит «управляет», а не «связан» — направление подсказывает, куда смотреть', () => {
    const s = renderConfigInfluence([
      { configFile: 'nuxt.config.ts', codeFile: 'src/Video.vue', via: 'история', key: '(файл целиком)', token: null },
    ])
    expect(s).toContain('управляет конфигурация')
    expect(s).toContain('nuxt.config.ts')
    expect(s).toContain('правились вместе')
  })

  it('связей нет — молчание', () => {
    expect(renderConfigInfluence([])).toBe('')
  })
})
