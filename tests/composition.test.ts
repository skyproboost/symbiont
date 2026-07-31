/**
 * Карта состава: как виды материала связаны между собой. Проверяется главное —
 * механизм не знает ни одного формата и работает на любом продукте одинаково.
 */
import { describe, expect, it } from 'bun:test'
import { buildComposition, buildCompositionPrompt } from '../src/miner/composition'

const unityFiles = (): string[] => {
  const f: string[] = []
  for (let i = 0; i < 20; i++) f.push(`Assets/Scenes/L${i}.unity`, `Assets/Scenes/L${i}.unity.meta`)
  for (let i = 0; i < 12; i++) f.push(`Assets/Scripts/S${i}.cs`)
  return f
}

describe('buildComposition', () => {
  it('находит пару «источник и его спутник» на незнакомом материале', () => {
    const c = buildComposition({ files: unityFiles() })
    const pair = c.pairs.find((p) => [p.a, p.b].includes('.unity') && [p.a, p.b].includes('.meta'))
    expect(pair).toBeDefined()
    expect(pair!.twinShare).toBeGreaterThan(0.9)
  })

  it('находит пару по одинаковым именам на веб-материале — тем же механизмом', () => {
    const files: string[] = []
    for (let i = 0; i < 20; i++) files.push(`src/components/C${i}.vue`, `src/components/C${i}.scss`)
    const c = buildComposition({ files })
    const pair = c.pairs.find((p) => [p.a, p.b].includes('.vue') && [p.a, p.b].includes('.scss'))
    expect(pair).toBeDefined()
    expect(pair!.twinShare).toBeGreaterThan(0.9)
  })

  it('случайное соседство парой не считается', () => {
    const files: string[] = []
    for (let i = 0; i < 20; i++) files.push(`src/a${i}.ts`)
    for (let i = 0; i < 20; i++) files.push(`src/совсем-другое-${i}.txt`)
    const c = buildComposition({ files })
    const pair = c.pairs.find((p) => [p.a, p.b].includes('.ts') && [p.a, p.b].includes('.txt'))
    // связь допустима только по соседству в каталогах, но парность нулевая
    if (pair) expect(pair.twinShare).toBeLessThan(0.3)
  })

  it('совместные правки из истории учитываются как связь', () => {
    const files: string[] = []
    for (let i = 0; i < 10; i++) files.push(`api/h${i}.ts`, `docs/d${i}.md`)
    const cochange = [
      { a: 'api/h1.ts', b: 'docs/d1.md', n: 4 },
      { a: 'api/h2.ts', b: 'docs/d2.md', n: 5 },
    ]
    const c = buildComposition({ files, cochange })
    const pair = c.pairs.find((p) => [p.a, p.b].includes('.ts') && [p.a, p.b].includes('.md'))
    expect(pair).toBeDefined()
    expect(pair!.cochanged).toBeGreaterThanOrEqual(9)
  })

  it('редкий формат в карту не идёт, размеры считаются медианой', () => {
    const files = [...Array(20).fill(0).map((_, i) => `src/a${i}.ts`), 'экзотика.qqq']
    const lines = new Map(files.map((f) => [f, f.endsWith('.ts') ? 100 : 5]))
    const c = buildComposition({ files, lines })
    expect(c.formats.some((f) => f.ext === '.qqq')).toBe(false)
    expect(c.formats.find((f) => f.ext === '.ts')!.medianLines).toBe(100)
  })

  it('пустой проект — пустая карта, без выдумок', () => {
    const c = buildComposition({ files: [] })
    expect(c.formats).toEqual([])
    expect(c.pairs).toEqual([])
  })
})

describe('buildCompositionPrompt', () => {
  it('спрашивает про устройство продукта и запрещает опираться на общие сведения', () => {
    const p = buildCompositionPrompt(buildComposition({ files: unityFiles() }), 'игра')
    expect(p).toContain('описать УСТРОЙСТВО этого продукта как системы')
    expect(p).toContain('не опираться на общеизвестные сведения о форматах')
    expect(p).toContain('вернуть пустой массив')
    expect(p).toContain('.unity')
  })
})
