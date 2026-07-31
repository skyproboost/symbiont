import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectStack, renderStack } from '../src/passport/stack'
import { buildPassport } from '../src/passport/build'

function proj(pkg: object, files: string[] = []): { root: string; rels: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'symbiont-stack-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  for (const f of files) {
    const full = join(root, f)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, 'x')
  }
  return { root, rels: files }
}

describe('detectStack', () => {
  it('Nuxt+Nitro+Postgres+Drizzle: фреймворки, инфра, направления', () => {
    const { root, rels } = proj(
      { dependencies: { nuxt: '3', nitropack: '2', 'drizzle-orm': '1', 'postgres': '3' } },
      ['nuxt.config.ts', 'server/db/schema/index.ts', 'server/db/migrations/0001.sql', 'app/components/Button.vue', 'sitemap.xml'],
    )
    const s = detectStack(root, rels)
    expect(s.frameworks).toEqual(expect.arrayContaining(['nuxt', 'nitro']))
    expect(s.infra).toContain('postgres')
    expect(s.domains).toEqual(expect.arrayContaining(['база данных', 'фронтенд', 'SEO']))
    rmrf(root)
  })

  it('Express+Redis+nginx: бэкенд-стек', () => {
    const { root, rels } = proj(
      { dependencies: { express: '4', ioredis: '5' } },
      ['nginx/site.conf', 'src/api/users.ts', 'Dockerfile'],
    )
    const s = detectStack(root, rels)
    expect(s.frameworks).toContain('express')
    expect(s.infra).toEqual(expect.arrayContaining(['redis', 'nginx', 'docker']))
    expect(s.domains).toEqual(expect.arrayContaining(['веб-сервер', 'API', 'деплой/инфра']))
    rmrf(root)
  })

  it('не-node: Django по manage.py, ноль package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-stack-dj-'))
    writeFileSync(join(root, 'manage.py'), 'x')
    const s = detectStack(root, ['manage.py', 'app/settings.py'])
    expect(s.frameworks).toContain('django')
    rmrf(root)
  })

  it('контентный/пустой проект — пустой стек, не падение', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-stack-empty-'))
    const s = detectStack(root, ['readme.md'])
    expect(s.frameworks).toEqual([])
    expect(s.infra).toEqual([])
    expect(s.otherDeps).toEqual([])
    rmrf(root)
  })

  it('незнакомая технология видна через otherDeps (без перечисления в каталоге)', () => {
    const { root, rels } = proj(
      { dependencies: { 'solid-js': '1', 'some-exotic-orm-2099': '1', react: '18' }, devDependencies: { '@types/node': '1' } },
      ['src/app.tsx'],
    )
    const s = detectStack(root, rels)
    expect(s.frameworks).toContain('react') // именованное
    expect(s.otherDeps).toContain('solid-js') // незнакомое — но видно
    expect(s.otherDeps).toContain('some-exotic-orm-2099')
    expect(s.otherDeps).not.toContain('react') // именованное не дублируется в otherDeps
    expect(s.otherDeps).not.toContain('@types/node') // типы отфильтрованы
    rmrf(root)
  })

  it('деплой/оркестрация: k8s/helm/terraform/pm2/systemd', () => {
    const { root, rels } = proj(
      { dependencies: { pm2: '5' } },
      ['k8s/deployment.yaml', 'charts/Chart.yaml', 'infra/main.tf', 'ecosystem.config.js', 'deploy/app.service'],
    )
    const s = detectStack(root, rels)
    expect(s.infra).toEqual(expect.arrayContaining(['kubernetes', 'helm', 'terraform', 'pm2', 'systemd']))
    expect(s.domains).toEqual(expect.arrayContaining(['деплой/инфра', 'оркестрация/масштабирование']))
    rmrf(root)
  })

  it('дизайн/документы как направления', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-stack-d-'))
    const s = detectStack(root, ['brand/logo.psd', 'deck/pitch.pptx'])
    expect(s.domains).toEqual(expect.arrayContaining(['дизайн-ассеты', 'документы']))
    rmrf(root)
  })
})

describe('renderStack', () => {
  it('секция со стеком; пустой — пусто', () => {
    const block = renderStack({ frameworks: ['nuxt'], infra: ['postgres'], domains: ['база данных'], otherDeps: ['solid-js'] })
    expect(block).toContain('Стек и направления')
    expect(block).toContain('фреймворки: nuxt')
    expect(block).toContain('инфра/хранилища: postgres')
    expect(block).toContain('направления: база данных')
    expect(block).toContain('прочие ключевые зависимости: solid-js')
    expect(renderStack({ frameworks: [], infra: [], domains: [], otherDeps: [] })).toBe('')
  })
})

describe('стек в конвейере паспорта', () => {
  it('секция «Стек и направления» в сводке проекта', () => {
    const { root } = proj({ dependencies: { nuxt: '3', 'drizzle-orm': '1' } }, ['nuxt.config.ts'])
    const CODE = 'export const f = () => 1\n'
    for (let i = 0; i < 6; i++) writeFileSync(join(root, `m${i}.ts`), CODE.repeat(12))
    mkdirSync(join(root, 'server/db/migrations'), { recursive: true })
    writeFileSync(join(root, 'server/db/migrations/0001.sql'), 'CREATE TABLE x();')
    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-stack-data-'))
    const r = buildPassport(root, dataDir)
    const summary = readFileSync(r.summaryPath, 'utf8')
    expect(summary).toContain('Стек и направления')
    expect(summary).toContain('nuxt')
    expect(summary).toContain('база данных')
    rmrf(root)
    rmrf(dataDir)
  })
})

describe('основание срабатывания: вывод не заставляет догадываться', () => {
  it('фреймворк из зависимости манифеста назван так прямо', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-why-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4.0.0' } }))
    const s = detectStack(dir, ['app/app.vue'])
    expect(s.evidence?.nuxt).toBe('зависимость в манифесте')
    expect(renderStack(s)).toContain('nuxt (зависимость в манифесте)')
    rmrf(dir)
  })

  it('фреймворк без зависимости, но с конфигом в корне — основание другое', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-why2-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(dir, 'nuxt.config.ts'), 'export default {}')
    const s = detectStack(dir, [])
    expect(s.evidence?.nuxt).toBe('файл конфигурации в корне')
    rmrf(dir)
  })

  it('старый снимок без оснований рендерится без падения (fail-open)', () => {
    const out = renderStack({ frameworks: ['vue'], infra: [], domains: [], otherDeps: [] })
    expect(out).toContain('vue')
  })
})
