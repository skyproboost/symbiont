import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openDb } from '../src/core/db'
import { parseCommitLog, deriveSignals, deriveConstitutionFacts } from '../src/passport/constitution-derive'
import { buildPassport } from '../src/passport/build'
import { FactStore } from '../src/core/store'
import type { ProfileProbe } from '../src/passport/profile'

describe('parseCommitLog', () => {
  it('разбирает @hash\\tsubject + файлы', () => {
    const log = '@abc\tfix(decode): падение\nserver/utils/decode/case.ts\n@def\tfeat(seo): sitemap\napp/seo.ts\napp/og.ts'
    const c = parseCommitLog(log)
    expect(c.length).toBe(2)
    expect(c[0].subject).toBe('fix(decode): падение')
    expect(c[0].files).toEqual(['server/utils/decode/case.ts'])
    expect(c[1].files.length).toBe(2)
  })
})

describe('deriveSignals', () => {
  it('считает типы коммитов, откаты и хрупкие зоны', () => {
    const commits = [
      { subject: 'fix(payment): двойное списание', files: ['server/utils/payment/ledger.ts'] },
      { subject: 'fix(payment): округление', files: ['server/utils/payment/calc.ts'] },
      { subject: 'feat(ui): кнопка', files: ['app/x.vue'] },
      { subject: 'revert: сломанная миграция', files: ['server/db/schema/x.ts'] },
    ]
    const s = deriveSignals(commits)
    expect(s.commitTypes.fix).toBe(2)
    expect(s.commitTypes.feat).toBe(1)
    expect(s.reverts).toBe(1)
    expect(s.fixZones['server/utils']).toBe(2) // обе fix-правки в этой зоне
    expect(s.fixZones['server/db']).toBe(1) // revert тоже считается починкой
  })
})

const profile: ProfileProbe[] = [
  { axis: 'SEO', evidence: ['sitemap.xml', 'заявлено в доках'] },
  { axis: 'корректность', evidence: ['тестов: 40'] },
  { axis: 'безопасность', evidence: ['zod', 'helmet'] },
]

describe('deriveConstitutionFacts', () => {
  it('приоритеты из топ-осей, фокус из коммитов, хрупкость и защита — в ограничения', () => {
    const signals = {
      commitTypes: { fix: 30, feat: 10 },
      reverts: 3,
      fixZones: { 'server/utils': 9, 'app/pages': 2 },
      totalCommits: 50,
    }
    const facts = deriveConstitutionFacts(signals, profile)
    const st = facts.map((f) => f.statement).join(' | ')
    expect(st).toContain('приоритет: SEO')
    expect(st).toContain('фокус работы: надёжность') // fix преобладает (30/50)
    expect(st).toContain('зона server/utils — хрупкая') // 9 ≥ порога
    expect(st).not.toContain('app/pages') // 2 < порога 4
    expect(st).toContain('есть откаты')
    expect(st).toContain('защитные слои')
    for (const f of facts) expect(f.area).toBe('конституция')
  })

  it('пустая история — только то, что даёт профиль (приоритеты + защита)', () => {
    const facts = deriveConstitutionFacts({ commitTypes: {}, reverts: 0, fixZones: {}, totalCommits: 0 }, profile)
    const st = facts.map((f) => f.statement).join(' | ')
    expect(st).toContain('приоритет: SEO')
    expect(st).toContain('защитные слои')
    expect(st).not.toContain('хрупкая')
    expect(st).not.toContain('фокус работы')
  })
})

describe('авто-конституция в конвейере (живой git)', () => {
  it('выводится в сводку, red-green не качает подтверждения, хрупкая зона отражена', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-const-der-'))
    const g = (...a: string[]) => {
      const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: proj, encoding: 'utf8' })
      if (r.status !== 0 && a[0] !== 'commit') throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
      return r
    }
    g('init', '-b', 'main')
    const LEGACY = 'function f() {\n\tvar x = 1;\n\treturn x;\n}\n'
    // код + README с SEO-сигналом (для профиля)
    for (let i = 0; i < 6; i++) writeFileSync(join(proj, `server/m${i}.js`.replace('server/', '')), LEGACY.repeat(12))
    writeFileSync(join(proj, 'README.md'), 'SEO критичен, sitemap обязателен.')
    writeFileSync(join(proj, 'sitemap.xml'), '<urlset/>')
    g('add', '.'); g('commit', '-m', 'feat: старт')
    // серия fix-коммитов в одной зоне → хрупкость
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(proj, `m0.js`), LEGACY.repeat(12 + i))
      g('add', '.'); g('commit', '-m', `fix: правка ${i}`)
    }

    const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-const-der-data-'))
    const r1 = buildPassport(proj, dataDir)
    const summary = readFileSync(r1.summaryPath, 'utf8')
    expect(summary).toContain('Приоритеты и ограничения')
    expect(summary).toContain('приоритет: SEO')
    expect(summary).toContain('хрупкая') // зона с 4+ fix-коммитами выведена
    expect(summary).not.toContain('фокус работы') // guard малой выборки: <20 коммитов — молчим

    // повтор без изменений — конституция не качает подтверждения
    buildPassport(proj, dataDir)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const cf = new FactStore(db).active().filter((f) => f.area === 'конституция')
    db.close()
    expect(cf.length).toBeGreaterThan(0)
    for (const f of cf) expect(f.confirmations).toBe(0)

    rmrf(proj)
    rmrf(dataDir)
  })
})

describe('ценности из формулировок работы (замена интервью /sym-init)', () => {
  it('то, о чём владелец пишет из релиза в релиз, становится ценностью', () => {
    const commits = Array.from({ length: 20 }, (_, i) =>
      i < 8
        ? { subject: `perf(v0.${i}): ускорили загрузку, оптимизация скорости`, files: ['a.ts'] }
        : { subject: `feat(v0.${i}): новая форма`, files: ['b.ts'] },
    )
    const facts = deriveConstitutionFacts(deriveSignals(commits), [])
    const value = facts.find((f) => f.statement.startsWith('ценность:'))
    expect(value).toBeDefined()
    expect(value!.statement).toContain('производительность')
    expect(value!.statement).toContain('из 20 коммитов')
  })

  it('редкое упоминание ценностью не становится (порог доли и числа)', () => {
    const commits = Array.from({ length: 40 }, (_, i) => ({
      subject: i === 0 ? 'perf: чуть ускорил' : `feat(${i}): работа`,
      files: ['a.ts'],
    }))
    const facts = deriveConstitutionFacts(deriveSignals(commits), [])
    expect(facts.some((f) => f.statement.startsWith('ценность:'))).toBe(false)
  })

  it('сигналы прошлой версии без нового поля не роняют вывод', () => {
    const legacy = { commitTypes: { feat: 30 }, reverts: 0, fixZones: {}, totalCommits: 30 }
    expect(() => deriveConstitutionFacts(legacy, [])).not.toThrow()
  })
})
