/**
 * Зрелость как непрерывная величина. Главное, что защищается: слабое звено
 * определяет целое. Проект с прекрасным стилем, но без проверок — не зрелый;
 * проект, который постоянно чинят, — не зрелый, каким бы большим он ни был.
 */
import { describe, expect, it } from 'bun:test'
import {
  assessMaturity,
  binaryEntropy,
  canonCertainty,
  massScore,
  verifiabilityScore,
  stabilityScore,
  levelOf,
  maturityStance,
  maturityFact,
  renderMaturity,
  contentIntegrityScore,
} from '../src/passport/maturity'

const base = { codeFiles: 0, commits: 0, testFiles: 0, hasCi: false, prevalences: [] as number[], fixCommits: 0, reverts: 0 }

describe('энтропия и определённость канона', () => {
  it('однозначный вопрос несёт нулевую неопределённость, спорный — максимум', () => {
    expect(binaryEntropy(1)).toBe(0)
    expect(binaryEntropy(0)).toBe(0)
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 5)
    expect(binaryEntropy(0.97)).toBeLessThan(0.25)
  })

  it('устоявшийся канон близок к 1, размытый — к 0', () => {
    expect(canonCertainty([0.98, 0.97, 0.99])).toBeGreaterThan(0.85)
    expect(canonCertainty([0.5, 0.52, 0.48])).toBeLessThan(0.05)
  })

  it('отсутствие конвенций — это ноль определённости, а не идеал', () => {
    expect(canonCertainty([])).toBe(0)
  })
})

describe('измерения', () => {
  it('масса насыщается: разница 5→50 велика, 500→5000 почти нет', () => {
    const small = massScore(5, 5)
    const mid = massScore(50, 50)
    const big = massScore(500, 500)
    const huge = massScore(5000, 5000)
    expect(mid - small).toBeGreaterThan(0.2)
    expect(huge - big).toBeLessThan(0.1)
  })

  it('проверяемость учитывает и тесты, и CI', () => {
    expect(verifiabilityScore(90, 0, false)).toBe(0)
    expect(verifiabilityScore(90, 0, true)).toBeCloseTo(0.2, 5)
    expect(verifiabilityScore(90, 30, true)).toBeCloseTo(1, 5)
  })

  it('стабильность падает от доли починок и от откатов', () => {
    expect(stabilityScore(100, 5, 0)).toBeCloseTo(0.95, 5)
    expect(stabilityScore(100, 60, 0)).toBeCloseTo(0.4, 5)
    expect(stabilityScore(100, 10, 10)).toBeLessThan(0.75)
    expect(stabilityScore(0, 0, 0)).toBe(0) // истории нет — нечего утверждать
  })
})

describe('слабое звено определяет целое', () => {
  it('большой ухоженный проект БЕЗ тестов не может быть зрелым', () => {
    const m = assessMaturity({ ...base, codeFiles: 300, commits: 400, prevalences: [0.98, 0.97], fixCommits: 40 })
    expect(m.weakest!.name).toBe('проверяемость')
    expect(m.level).toBe('молодой')
    expect(m.score).toBeLessThan(0.2)
  })

  it('проект, который постоянно чинят, не зрелый несмотря на размер и тесты', () => {
    const m = assessMaturity({
      ...base,
      codeFiles: 150,
      commits: 300,
      testFiles: 50,
      hasCi: true,
      prevalences: [0.95, 0.93],
      fixCommits: 200,
      reverts: 12,
    })
    expect(m.weakest!.name).toBe('стабильность')
    expect(m.level).not.toBe('зрелый')
  })

  it('размытый канон тянет вниз даже при отличных прочих осях', () => {
    const m = assessMaturity({ ...base, codeFiles: 120, commits: 200, testFiles: 40, hasCi: true, prevalences: [0.52, 0.48] })
    expect(m.weakest!.name).toBe('определённость канона')
    expect(m.level).toBe('молодой')
  })

  it('здоровый зрелый проект набирает высоко по всем осям', () => {
    const m = assessMaturity({
      ...base,
      codeFiles: 171,
      commits: 112,
      testFiles: 64,
      hasCi: true,
      prevalences: [0.98, 0.97, 0.99, 0.95],
      fixCommits: 12,
    })
    expect(m.score).toBeGreaterThan(0.7)
    expect(m.level).toBe('зрелый')
  })

  it('маленький аккуратный проект — растущий, а не зрелый: массы не хватает', () => {
    const m = assessMaturity({ ...base, codeFiles: 12, commits: 8, testFiles: 5, hasCi: true, prevalences: [0.9] })
    expect(m.weakest!.name).toBe('масса')
    expect(m.level).toBe('растущий')
  })
})

describe('шкала и ярлыки', () => {
  it('ярлык — подпись к числу, границы явные и монотонные', () => {
    expect(levelOf(0.1)).toBe('молодой')
    expect(levelOf(0.45)).toBe('растущий')
    expect(levelOf(0.8)).toBe('зрелый')
  })

  it('вердикт всегда объясним: у каждого измерения есть деталь', () => {
    const m = assessMaturity({ ...base, codeFiles: 50, commits: 30, testFiles: 10 })
    expect(m.dimensions.length).toBe(4)
    for (const d of m.dimensions) expect(d.detail.length).toBeGreaterThan(3)
  })
})

describe('стойка и вывод', () => {
  it('на молодом сказано, что подражать нечему; на зрелом — следовать канону', () => {
    expect(maturityStance('молодой').join(' ')).toContain('подражать текущему коду нечему')
    expect(maturityStance('зрелый').join(' ')).toContain('по прецеденту')
  })

  it('у каждой стадии есть ограничитель, а не только амбиция', () => {
    for (const level of ['молодой', 'растущий', 'зрелый'] as const) {
      expect(maturityStance(level).some((s) => s.startsWith('ограничение:'))).toBe(true)
    }
  })

  it('в сводке названо слабейшее измерение — коэффициент без рычага бесполезен', () => {
    const r = renderMaturity(assessMaturity({ ...base, codeFiles: 300, commits: 400, prevalences: [0.98] }))
    expect(r).toContain('Зрелость проекта')
    expect(r).toContain('слабее всего: проверяемость')
  })

  it('пустой каталог не получает ни строки и ни одного факта', () => {
    const m = assessMaturity(base)
    expect(m.empty).toBe(true)
    expect(renderMaturity(m)).toBe('')
  })

  it('факт зрелости несёт число и разбор по осям', () => {
    const f = maturityFact(assessMaturity({ ...base, codeFiles: 50, commits: 40, testFiles: 10, prevalences: [0.9] }))
    expect(f.area).toBe('зрелость проекта')
    expect(f.statement).toMatch(/зрелость проекта — 0\.\d\d/)
    expect(f.statement).toContain('определённость канона')
  })
})

describe('природа материала решает, чем измерять проверяемость', () => {
  it('контентный проект оценивается целостностью связей, а не тестами', () => {
    // Живая находка: вики получала 0.07 из-за «отсутствия тестов», которых
    // в репозитории статей быть и не должно.
    const m = assessMaturity({
      ...base,
      nature: 'контент',
      codeFiles: 4,
      commits: 60,
      prevalences: [0.9],
      content: { entities: 200, broken: 0, orphans: 10 },
    })
    const dim = m.dimensions.find((d) => d.name === 'целостность контента')
    expect(dim).toBeDefined()
    expect(dim!.value).toBeGreaterThan(0.9)
    expect(m.dimensions.some((d) => d.name === 'проверяемость')).toBe(false)
  })

  it('битые ссылки бьют сильнее сирот: первые обманывают, вторые лишь не найдены', () => {
    const broken = contentIntegrityScore({ entities: 100, broken: 20, orphans: 0 })
    const orphans = contentIntegrityScore({ entities: 100, broken: 0, orphans: 20 })
    expect(broken).toBeLessThan(orphans)
  })

  it('кодовый проект по-прежнему измеряется тестами', () => {
    const m = assessMaturity({ ...base, nature: 'код', codeFiles: 100, commits: 100, testFiles: 30, hasCi: true, prevalences: [0.95] })
    expect(m.dimensions.some((d) => d.name === 'проверяемость')).toBe(true)
    expect(m.dimensions.some((d) => d.name === 'целостность контента')).toBe(false)
  })

  it('смешанный проект оценивается по коду — тесты сильнее как подтверждение', () => {
    const m = assessMaturity({
      ...base,
      nature: 'смешанный',
      codeFiles: 80,
      commits: 100,
      testFiles: 20,
      prevalences: [0.9],
      content: { entities: 50, broken: 0, orphans: 0 },
    })
    expect(m.dimensions.some((d) => d.name === 'проверяемость')).toBe(true)
  })
})
