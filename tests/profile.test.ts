import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { probeProfile, profileFacts, readConceptText } from '../src/passport/profile'
import { buildPassport } from '../src/passport/build'
import { FactStore } from '../src/core/store'

function richProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiont-prof-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { prisma: '1', helmet: '1', pino: '1' },
      devDependencies: { vitest: '1' },
    }),
  )
  writeFileSync(join(root, 'README.md'), 'Сервис ставит производительность и скорость во главу. SEO критичен: sitemap обязателен. Работаем с персональными данными (GDPR).')
  mkdirSync(join(root, 'tests'))
  writeFileSync(join(root, 'tests', 'a.test.ts'), 'x')
  mkdirSync(join(root, 'prisma'))
  writeFileSync(join(root, 'prisma', 'schema.prisma'), 'x')
  writeFileSync(join(root, 'sitemap.xml'), 'x')
  writeFileSync(join(root, '.env.example'), 'X=1')
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'x')
  return root
}

const rels = ['tests/a.test.ts', 'prisma/schema.prisma', 'sitemap.xml', '.env.example', 'README.md', 'package.json']

describe('probeProfile', () => {
  it('богатый проект: оси обнаружены по трём источникам сигналов', () => {
    const root = richProject()
    const probes = probeProfile(root, rels)
    const by = new Map(probes.map((p) => [p.axis, p.evidence]))

    expect(by.get('корректность')?.join(' ')).toContain('тестовых файлов: 1')
    expect(by.get('корректность')?.join(' ')).toContain('CI') // .github найден точечной пробой
    expect(by.get('производительность')).toEqual(['заявлено в доках'])
    expect(by.get('SEO')?.join(' ')).toContain('sitemap.xml')
    expect(by.get('целостность данных')?.join(' ')).toContain('prisma')
    expect(by.get('наблюдаемость')?.join(' ')).toContain('pino')
    expect(by.get('приватность')).toEqual(['заявлено в доках'])
    expect(by.get('поставляемость')?.join(' ')).toContain('.github/workflows')
    rmrf(root)
  })

  it('безопасность присутствует всегда; слои — из зависимостей и файлов', () => {
    const root = richProject()
    const sec = probeProfile(root, rels).find((p) => p.axis === 'безопасность')!
    expect(sec.evidence.join(' ')).toContain('helmet')
    expect(sec.evidence.join(' ')).toContain('.env.example')
    rmrf(root)
  })

  it('совсем пустой мир — профилировать нечего (даже безопасность молчит)', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-prof-empty-'))
    expect(probeProfile(root, [])).toEqual([])
    rmrf(root)
  })

  it('непустой проект без защитных сигналов — безопасность присутствует без слоёв', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-prof-nosec-'))
    writeFileSync(join(root, 'main.py'), 'x = 1\n')
    const probes = probeProfile(root, ['main.py'])
    const sec = probes.find((p) => p.axis === 'безопасность')!
    expect(sec.evidence).toEqual([])
    rmrf(root)
  })

  it('readConceptText собирает README и docs бюджетно', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-prof-docs-'))
    writeFileSync(join(root, 'README.md'), 'корень')
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'a.md'), 'дока')
    const text = readConceptText(root, ['docs/a.md'])
    expect(text).toContain('корень')
    expect(text).toContain('дока')
    rmrf(root)
  })
})

describe('profileFacts', () => {
  it('ось с 2+ сигналами — привычка, с одним — гипотеза; ключ стабилен по оси', () => {
    const facts = profileFacts([
      { axis: 'SEO', evidence: ['sitemap.xml', 'заявлено в доках'] },
      { axis: 'производительность', evidence: ['заявлено в доках'] },
      { axis: 'безопасность', evidence: [] },
    ])
    expect(facts[0].tier).toBe('привычка')
    expect(facts[1].tier).toBe('гипотеза')
    expect(facts[2].statement).toContain('не обнаружено')
    for (const f of facts) expect(f.area).toBe('профиль качества')
  })
})

describe('профиль в конвейере паспорта', () => {
  it('сводка получает секцию; повторная сборка не накачивает подтверждения (red-green)', () => {
    const root = richProject()
    // немного кода, чтобы паспорт вообще строился
    const LEGACY = 'function f() {\n\tvar x = 1;\n\treturn x;\n}\n'
    for (let i = 0; i < 6; i++) writeFileSync(join(root, `m${i}.js`), LEGACY.repeat(12))
    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-prof-data-'))

    const r1 = buildPassport(root, dataDir)
    const summary = readFileSync(r1.summaryPath, 'utf8')
    expect(summary).toContain('Профиль качества')
    expect(summary).toContain('безопасность — защитные слои')
    expect(summary).toContain('SEO')

    buildPassport(root, dataDir) // ничего не менялось
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const prof = new FactStore(db).active().filter((f) => f.area === 'профиль качества')
    db.close()
    expect(prof.length).toBeGreaterThan(3)
    for (const f of prof) expect(f.confirmations).toBe(0) // пустой перезапуск ничего не «подтвердил»

    // смена сигналов -> вытеснение только затронутой оси
    writeFileSync(join(root, 'README.md'), 'Теперь только про доступность: a11y и WCAG.')
    buildPassport(root, dataDir)
    const db2 = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const prof2 = new FactStore(db2).active().filter((f) => f.area === 'профиль качества')
    db2.close()
    const axes = prof2.map((f) => f.statement.split('—')[0].trim())
    expect(axes).toContain('доступность')
    expect(axes).not.toContain('производительность') // сигнал ушёл — ось ушла

    rmrf(root)
    rmrf(dataDir)
  })
})
