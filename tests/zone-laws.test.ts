/**
 * Законы по зонам: часть проекта с собственной выборкой даёт закон, которого
 * проект в целом не набирает; гейт применяет его только к файлам зоны.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveFacts, deriveZoneFacts, zoneAreaOf, zoneOfArea } from '../src/miner/facts'
import { analyzeFile, aggregate } from '../src/miner/analyze'
import { lawsForFile, globalLaws } from '../src/gates/checks'
import { buildPassport } from '../src/passport/build'
import { openDb } from '../src/core/db'
import { FactStore, keyOf } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const obs = (rel: string, withVar: boolean) => ({
  rel,
  obs: analyzeFile(rel, '.ts', withVar ? 'var a = 1\nvar b = 2\nvar c = 3\n' : 'const a = 1\nconst b = 2\nconst c = 3\n'),
})

describe('законы по зонам', () => {
  it('зона с собственной выборкой даёт закон, которого проект в целом не набирает; малая зона молчит', () => {
    const all = [
      ...Array.from({ length: 12 }, (_, i) => obs(`src/m${i}.ts`, false)),
      ...Array.from({ length: 12 }, (_, i) => obs(`tests/t${i}.ts`, true)),
      ...Array.from({ length: 3 }, (_, i) => obs(`scripts/s${i}.ts`, false)),
    ]
    const global = deriveFacts(aggregate(all.map((o) => o.obs), ['.ts']))
    const varGlobal = global.find((f) => f.statement.startsWith('переменные'))
    expect(varGlobal).toBeDefined()
    expect(varGlobal?.tier).not.toBe('закон') // 50/50 по проекту
    const zoned = deriveZoneFacts(all, ['.ts'], global)
    const keys = zoned.map((f) => `${f.area} :: ${f.statement.split(' — ')[0]}`)
    expect(keys).toContain(`${zoneAreaOf(varGlobal?.area ?? '', 'src')} :: переменные`)
    expect(keys).toContain(`${zoneAreaOf(varGlobal?.area ?? '', 'tests')} :: переменные`)
    expect(zoned.some((f) => zoneOfArea(f.area) === 'scripts')).toBe(false) // 3 файла — не выборка
    for (const f of zoned) expect(f.tier).toBe('закон')
  })

  it('глобальный закон зонами не дублируется', () => {
    const all = Array.from({ length: 40 }, (_, i) => obs(`${i % 2 ? 'src' : 'lib'}/m${i}.ts`, false))
    const global = deriveFacts(aggregate(all.map((o) => o.obs), ['.ts']))
    expect(global.find((f) => f.statement.startsWith('переменные'))?.tier).toBe('закон')
    expect(deriveZoneFacts(all, ['.ts'], global).some((f) => f.statement.startsWith('переменные'))).toBe(false)
  })

  it('гейт применяет зональный закон только к файлам зоны', () => {
    const laws = [
      { area: 'форматирование', statement: 'кавычки — одинарные' },
      { area: zoneAreaOf('форматирование', 'src'), statement: 'переменные — const/let (var не используется)' },
    ]
    expect(lawsForFile(laws, 'src/a.ts').map((l) => l.statement)).toEqual(['кавычки — одинарные', 'переменные — const/let (var не используется)'])
    expect(lawsForFile(laws, 'tests/a.test.ts').map((l) => l.statement)).toEqual(['кавычки — одинарные'])
    expect(lawsForFile(laws, 'srcx/a.ts').length).toBe(1) // префикс каталога, не строки
    expect(globalLaws(laws).length).toBe(1)
  })
})

describe('отзыв статистики, которую свежий замер больше не выводит', () => {
  // Живой случай: в проекте удалили scripts/ и genesis/, а сводка ещё неделю
  // подавала «отступы — 2 пробела · только в scripts/» — замер статистики
  // вносился в журнал, но исчезнувшее из него не отзывалось никогда
  const world = (): { proj: string; data: string; dataDir: string } => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-zone-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-zone-data-'))
    mkdirSync(join(proj, 'src'), { recursive: true })
    mkdirSync(join(proj, 'legacy'), { recursive: true })
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(proj, 'src', `m${i}.ts`), 'const a = 1\nconst b = 2\nconst c = 3\n')
      writeFileSync(join(proj, 'legacy', `t${i}.ts`), 'var a = 1\nvar b = 2\nvar c = 3\n')
    }
    return { proj, data, dataDir: join(data, slugOf(proj)) }
  }
  const activeMiner = (dataDir: string) => {
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const rows = new FactStore(db).active().filter((f) => f.source === 'miner:layer0')
    db.close()
    return rows
  }

  it('закон зоны уходит из активных, когда зоны не стало; история остаётся', () => {
    const { proj, data, dataDir } = world()
    buildPassport(proj, dataDir)
    const zoneLaw = activeMiner(dataDir).find((f) => zoneOfArea(f.area) === 'legacy')
    expect(zoneLaw).toBeDefined()

    rmSync(join(proj, 'legacy'), { recursive: true, force: true })
    buildPassport(proj, dataDir)

    expect(activeMiner(dataDir).some((f) => zoneOfArea(f.area) === 'legacy')).toBe(false)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    const history = new FactStore(db).history(zoneLaw?.key ?? '')
    db.close()
    expect(history.length).toBeGreaterThan(0) // журнал не тронут: факт отозван, не стёрт

    rmrf(proj)
    rmrf(data)
  })

  it('после сборки активная статистика не шире свежего замера', () => {
    const { proj, data, dataDir } = world()
    buildPassport(proj, dataDir)
    rmSync(join(proj, 'legacy'), { recursive: true, force: true })
    const fresh = new Set(buildPassport(proj, dataDir).facts.map((f) => keyOf(f)))

    const leftover = activeMiner(dataDir).filter((f) => !fresh.has(f.key)).map((f) => f.key)
    expect(leftover).toEqual([])

    rmrf(proj)
    rmrf(data)
  })

  it('правила о виде материала уходят с последним файлом этого вида, но не раньше', () => {
    // Живой случай: 25 правил о .sh («шебанг», «паузы через sleep») подавались в
    // проекте, где не осталось ни одного .sh
    const { proj, data, dataDir } = world()
    mkdirSync(join(proj, 'ops'), { recursive: true })
    writeFileSync(join(proj, 'ops', 'run.xyz'), 'step one\nstep two\n')
    writeFileSync(join(proj, 'ops', 'stop.xyz'), 'step one\n')
    buildPassport(proj, dataDir)
    const rule = { area: 'оформление', statement: 'первая строка — step one', positive: 2, total: 2, prevalence: 1, tier: 'гипотеза' as const }
    {
      const db = openDb(join(dataDir, 'passport.db'))
      new FactStore(db).assertAll([rule], 'llm:material:.xyz')
      db.close()
    }
    const alive = (): boolean => {
      const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
      const found = new FactStore(db).active().some((f) => f.source === 'llm:material:.xyz')
      db.close()
      return found
    }

    rmSync(join(proj, 'ops', 'stop.xyz'))
    buildPassport(proj, dataDir)
    expect(alive()).toBe(true) // один файл ещё есть — правило не опровергнуто

    rmSync(join(proj, 'ops', 'run.xyz'))
    buildPassport(proj, dataDir)
    expect(alive()).toBe(false)
    const db = openDb(join(dataDir, 'passport.db'), { readonly: true })
    expect(new FactStore(db).history(keyOf(rule)).length).toBe(1) // отозвано, не стёрто
    db.close()

    rmrf(proj)
    rmrf(data)
  })

  it('сборка без изменений ничего не отзывает', () => {
    const { proj, data, dataDir } = world()
    buildPassport(proj, dataDir)
    const before = activeMiner(dataDir).map((f) => f.id)
    buildPassport(proj, dataDir)
    expect(activeMiner(dataDir).map((f) => f.id)).toEqual(before)

    rmrf(proj)
    rmrf(data)
  })
})
