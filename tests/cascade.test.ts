/**
 * Каскад осей профиля (CONCEPT §4.1): наследование по дереву как CSS по DOM,
 * специфичность (локальное побеждает), подача только дельты к корню.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import {
  zoneAncestors,
  computeZoneProfiles,
  effectiveProfile,
  renderEffective,
  rootAxesFromFacts,
  storeZoneProfiles,
  readZoneProfiles,
} from '../src/passport/cascade'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { buildPassport } from '../src/passport/build'
import { rmrf } from './_helpers'

describe('zoneAncestors', () => {
  it('цепочка от общего к частному — порядок = рост специфичности', () => {
    expect(zoneAncestors('src/core/store.ts')).toEqual(['src', 'src/core'])
    expect(zoneAncestors('a/b/c/d.ts')).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('файл в корне зон не имеет; разделители нормализуются', () => {
    expect(zoneAncestors('README.md')).toEqual([])
    expect(zoneAncestors('src\\core\\x.ts')).toEqual(['src', 'src/core'])
  })
})

describe('computeZoneProfiles', () => {
  it('оси выводятся по содержимому зоны, а не задаются списком', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-casc-'))
    const profiles = computeZoneProfiles(root, [
      'server/db/migrations/001_init.sql',
      'server/db/schema.prisma',
      'tests/unit/a.test.ts',
      'tests/unit/b.test.ts',
    ])
    const byZone = new Map(profiles.map((p) => [p.zone, p]))
    expect(byZone.get('server/db')!.axes).toContain('целостность данных')
    expect(byZone.get('tests')!.axes).toContain('корректность')
    expect(byZone.get('server/db')!.axes).not.toContain('корректность')
    rmrf(root)
  })

  it('устаревшая зона даёт ограничение — амбиция уступает специфичности', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-casc-'))
    const profiles = computeZoneProfiles(root, ['app/legacy/old-widget.js', 'app/legacy/helpers.js'])
    const legacy = profiles.find((p) => p.zone === 'app/legacy')!
    expect(legacy.constraints.join(' ')).toContain('устаревшей')
  })

  it('локальные доки зоны объявляют её устаревшей', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-casc-'))
    mkdirSync(join(root, 'modules', 'billing'), { recursive: true })
    writeFileSync(join(root, 'modules', 'billing', 'README.md'), 'Модуль заморожен, считается устаревшим — переписывается в новом сервисе.\n')
    writeFileSync(join(root, 'modules', 'billing', 'index.ts'), 'export const pay = () => 1\n')
    const profiles = computeZoneProfiles(root, ['modules/billing/README.md', 'modules/billing/index.ts'])
    const zone = profiles.find((p) => p.zone === 'modules/billing')!
    expect(zone.constraints.join(' ')).toContain('устаревшей')
    rmrf(root)
  })

  it('хрупкость из git-истории становится локальным ограничением', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-casc-'))
    const profiles = computeZoneProfiles(root, ['server/utils/a.ts', 'server/utils/b.ts'], { 'server/utils': 26 })
    const zone = profiles.find((p) => p.zone === 'server/utils')!
    expect(zone.constraints.join(' ')).toContain('хрупкая (26 правок-починок')
    rmrf(root)
  })

  it('редкие правки хрупкой зону не делают; одиночный файл — не зона', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiont-casc-'))
    const profiles = computeZoneProfiles(root, ['server/utils/a.ts', 'server/utils/b.ts', 'solo/only.ts'], { 'server/utils': 2 })
    expect(profiles.find((p) => p.zone === 'server/utils')).toBeUndefined() // ни осей, ни ограничений
    expect(profiles.find((p) => p.zone === 'solo')).toBeUndefined()
    rmrf(root)
  })
})

describe('effectiveProfile — специфичность', () => {
  const profiles = [
    { zone: 'app', axes: ['фронтенд'], constraints: [] },
    { zone: 'app/legacy', axes: [], constraints: ['зона объявлена устаревшей — менять минимально, улучшения сверх задачи не вносить'] },
    { zone: 'server/db', axes: ['целостность данных'], constraints: ['зона хрупкая (26 правок-починок в истории) — менять осторожно и с проверкой'] },
  ]

  it('ограничения предков накапливаются, имя берётся у ближайшей зоны', () => {
    const eff = effectiveProfile('app/legacy/widget.js', ['корректность'], profiles)!
    expect(eff.zone).toBe('app/legacy')
    expect(eff.addedAxes).toEqual(['фронтенд']) // унаследовано от app
    expect(eff.constraints.join(' ')).toContain('устаревшей')
  })

  it('оси корня вычитаются — сводка не повторяется по каждому касанию', () => {
    const eff = effectiveProfile('server/db/schema.sql', ['целостность данных', 'корректность'], profiles)!
    expect(eff.addedAxes).toEqual([]) // ось уже глобальная
    expect(eff.constraints.length).toBe(1) // но ограничение зоны остаётся
  })

  it('зона без дельты и файл вне зон — молчание', () => {
    expect(effectiveProfile('README.md', [], profiles)).toBeNull()
    expect(effectiveProfile('other/x.ts', [], profiles)).toBeNull()
    expect(effectiveProfile('app/page.vue', ['фронтенд'], profiles)).toBeNull() // ось совпала с корнем
  })
})

describe('rootAxesFromFacts', () => {
  it('вытаскивает имя оси из формулировки факта', () => {
    expect(
      rootAxesFromFacts(['корректность — ось качества здесь (тестов: 53)', 'безопасность — защитные слои: zod (их ослабление — не рядовая правка)']),
    ).toEqual(['корректность', 'безопасность'])
  })
})

describe('renderEffective', () => {
  it('подаёт фактами, без императивов', () => {
    const s = renderEffective({ zone: 'server/db', addedAxes: ['целостность данных'], constraints: ['зона хрупкая (26 правок-починок в истории) — менять осторожно и с проверкой'] })
    expect(s).toContain('условия каталога server/db')
    expect(s).toContain('дополнительно важно здесь: целостность данных')
    expect(s).not.toMatch(/\b(ты обязан|немедленно|запрещено)\b/i)
  })
})

describe('хранение проекции', () => {
  it('перезаписывается целиком, читается обратно, fail-open без таблицы', () => {
    const db = openDb(':memory:')
    expect(readZoneProfiles(db)).toEqual([])
    storeZoneProfiles(db, [{ zone: 'a', axes: ['x'], constraints: ['c'] }])
    storeZoneProfiles(db, [{ zone: 'b', axes: [], constraints: ['d'] }]) // старое не копится
    const read = readZoneProfiles(db)
    expect(read.length).toBe(1)
    expect(read[0]).toEqual({ zone: 'b', axes: [], constraints: ['d'] })
    db.close()
  })
})

describe('симуляция: сквозной каскад в живом проекте', () => {
  it('паспорт строит зоны, касание legacy-файла подаёт ограничение, повтор — молчит', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-casc-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-casc-data-'))
    mkdirSync(join(proj, 'app', 'legacy'), { recursive: true })
    mkdirSync(join(proj, 'server', 'db', 'migrations'), { recursive: true })
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(proj, 'app', 'legacy', `old${i}.js`), 'var sName = 1\nvar aList = []\n')
    }
    writeFileSync(join(proj, 'server', 'db', 'migrations', '001_init.sql'), 'CREATE TABLE t(id int);\n')
    writeFileSync(join(proj, 'server', 'db', 'schema.sql'), 'CREATE TABLE u(id int);\n')
    writeFileSync(join(proj, 'README.md'), 'Сервис. Производительность важна.\n')

    const slug = require('../src/hooks/session-start-core').slugOf(proj) as string
    buildPassport(proj, join(data, slug))

    const db = openDb(join(data, slug, 'passport.db'), { readonly: true })
    const zones = readZoneProfiles(db).map((z) => z.zone)
    db.close()
    expect(zones).toContain('app/legacy')
    expect(zones).toContain('server/db')

    const out = handlePostTool(
      { cwd: proj, session_id: 'sim-1', tool_name: 'Read', tool_input: { file_path: join(proj, 'app', 'legacy', 'old0.js') } },
      data,
    )
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('условия каталога app/legacy')
    expect(ctx).toContain('устаревшей')

    // дедуп по зоне: второй файл той же зоны условия не повторяет
    const again = handlePostTool(
      { cwd: proj, session_id: 'sim-1', tool_name: 'Read', tool_input: { file_path: join(proj, 'app', 'legacy', 'old1.js') } },
      data,
    )
    expect(again.hookSpecificOutput?.additionalContext ?? '').not.toContain('условия каталога')

    rmrf(proj)
    rmrf(data)
  })
})
