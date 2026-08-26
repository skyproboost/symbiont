/**
 * Законы по зонам: часть проекта с собственной выборкой даёт закон, которого
 * проект в целом не набирает; гейт применяет его только к файлам зоны.
 */
import { describe, it, expect } from 'bun:test'
import { deriveFacts, deriveZoneFacts, zoneAreaOf, zoneOfArea } from '../src/miner/facts'
import { analyzeFile, aggregate } from '../src/miner/analyze'
import { lawsForFile, globalLaws } from '../src/gates/checks'

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
