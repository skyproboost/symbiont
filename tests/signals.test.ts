import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SIGNALS, matchSignal, readManifestDeps } from '../src/passport/signals'
import { detectStack } from '../src/passport/stack'
import { probeProfile } from '../src/passport/profile'

describe('границы слов на кириллице (грабля \\b, пойманная селф-линтом)', () => {
  it('русские доки распознаются наравне с английскими', () => {
    // До фикса `\b(seo|поисков…)` молча не матчил русские ветки: детекторы
    // SEO, тестов и доступности были слепы к русскоязычным докам.
    expect(SIGNALS.seo.docs!.test('улучшаем поисковую видимость')).toBe(true)
    expect(SIGNALS.seo.docs!.test('our SEO strategy')).toBe(true)
    expect(SIGNALS.testing.docs!.test('покрытие тестами важно')).toBe(true)
    expect(SIGNALS.a11y.docs!.test('доступность интерфейса')).toBe(true)
  })

  it('граница слова соблюдается — середина слова не ловится', () => {
    expect(SIGNALS.seo.docs!.test('кроссовки')).toBe(false)
    expect(SIGNALS.a11y.docs!.test('недоступность')).toBe(false)
  })
})

describe('readManifestDeps — мульти-экосистема (не только npm)', () => {
  it('Python requirements.txt + pyproject', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-sig-py-'))
    writeFileSync(join(root, 'requirements.txt'), 'Django==5.0\nsqlalchemy>=2\npsycopg2-binary')
    const d = readManifestDeps(root)
    expect(d.all).toContain('django')
    expect(d.all).toContain('sqlalchemy')
    rmrf(root)
  })
  it('Go go.mod', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-sig-go-'))
    writeFileSync(join(root, 'go.mod'), 'module x\n\nrequire (\n\tgorm.io/gorm v1.25.0\n\tgithub.com/gin-gonic/gin v1.9.1\n)')
    const d = readManifestDeps(root)
    expect(d.all).toContain('gorm')
    rmrf(root)
  })
  it('PHP composer.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-sig-php-'))
    writeFileSync(join(root, 'composer.json'), JSON.stringify({ require: { 'doctrine/orm': '^2', 'laravel/framework': '^11' } }))
    const d = readManifestDeps(root)
    expect(d.all).toContain('doctrine/orm')
    expect(d.all).toContain('orm')
    rmrf(root)
  })
  it('Ruby Gemfile + Rust Cargo.toml', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-sig-rb-'))
    writeFileSync(join(root, 'Gemfile'), "gem 'rails'\ngem 'pg'")
    writeFileSync(join(root, 'Cargo.toml'), '[dependencies]\ndiesel = "2"\ntokio = "1"')
    const d = readManifestDeps(root)
    expect(d.all).toContain('rails')
    expect(d.all).toContain('diesel')
    rmrf(root)
  })
})

describe('единый источник сигналов — согласованность stack и profile', () => {
  it('Python+Django+Postgres проект: БД видят И направление, И ось качества', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-sig-consist-'))
    writeFileSync(join(root, 'requirements.txt'), 'django==5.0\npsycopg2')
    mkdirSync(join(root, 'app', 'migrations'), { recursive: true })
    writeFileSync(join(root, 'app', 'migrations', '0001_initial.py'), 'x')
    const rels = ['requirements.txt', 'app/migrations/0001_initial.py', 'manage.py']

    const stack = detectStack(root, rels)
    const profile = probeProfile(root, rels)
    // раньше был рассинхрон: направление БД ловилось, а ось «целостность данных» — нет
    expect(stack.domains).toContain('база данных')
    expect(profile.map((p) => p.axis)).toContain('целостность данных')
    rmrf(root)
  })

  it('matchSignal работает по путям/зависимостям/докам', () => {
    expect(matchSignal(SIGNALS.db, { paths: ['app/migrations/x.py'] })).toBe(true)
    expect(matchSignal(SIGNALS.db, { deps: ['sqlalchemy'] })).toBe(true)
    expect(matchSignal(SIGNALS.seo, { docs: 'нужен хороший SEO' })).toBe(true)
    expect(matchSignal(SIGNALS.db, { paths: ['README.md'] })).toBe(false)
  })
})
