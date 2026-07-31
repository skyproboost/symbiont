import { describe, it, expect } from 'bun:test'
import { RUBRIC, DESIGN_PRINCIPLES, axesForArtifacts, type RubricAxis } from '../src/elevate/rubric'
import type { ArtifactClass } from '../src/passport/artifacts'

const VALID_CLASSES: ArtifactClass[] = ['код', 'контент', 'разметка-стили', 'данные', 'конфиг-инфра', 'дизайн', 'офис', 'медиа', 'прочее']

describe('целостность рубрики', () => {
  it('каждая ось: непустые линза/проверки/источник, валидные классы', () => {
    expect(RUBRIC.length).toBeGreaterThanOrEqual(12)
    for (const a of RUBRIC) {
      expect(a.axis.length).toBeGreaterThan(0)
      expect(a.lens.length).toBeGreaterThan(0)
      expect(a.checks.length).toBeGreaterThan(0)
      expect(a.source.length).toBeGreaterThan(10) // непустой авторитетный источник
      expect(a.appliesTo.length).toBeGreaterThan(0)
      for (const c of a.appliesTo) expect(VALID_CLASSES).toContain(c)
    }
  })

  it('оси уникальны', () => {
    const names = RUBRIC.map((a) => a.axis)
    expect(new Set(names).size).toBe(names.length)
  })

  it('вечные оси (безопасность, корректность) присутствуют', () => {
    const names = RUBRIC.map((a) => a.axis)
    expect(names).toContain('безопасность')
    expect(names).toContain('корректность')
  })

  it('пороги с числами имеют реальные значения (Core Web Vitals, WCAG, OWASP)', () => {
    const perf = RUBRIC.find((a) => a.axis === 'производительность')!
    expect(perf.thresholds?.join(' ')).toContain('2.5')
    expect(perf.thresholds?.join(' ')).toContain('200')
    const a11y = RUBRIC.find((a) => a.axis === 'доступность')!
    expect(a11y.thresholds?.join(' ')).toContain('4.5:1')
    const sec = RUBRIC.find((a) => a.axis === 'безопасность')!
    expect(sec.thresholds?.join(' ')).toContain('OWASP')
  })
})

describe('DESIGN_PRINCIPLES (от обратного)', () => {
  it('минимум 8 принципов, каждый с причиной и источником', () => {
    expect(DESIGN_PRINCIPLES.length).toBeGreaterThanOrEqual(8)
    for (const p of DESIGN_PRINCIPLES) {
      expect(p.rule.length).toBeGreaterThan(10)
      expect(p.because.length).toBeGreaterThan(10)
      expect(p.source).toMatch(/https?:\/\//)
    }
  })

  it('ключевые анти-болезни покрыты: молчание, ранжирование, намерение, проверка, карго-культ', () => {
    const all = DESIGN_PRINCIPLES.map((p) => p.rule).join(' | ').toLowerCase()
    expect(all).toContain('молчание')
    expect(all).toContain('радиус')
    expect(all).toContain('намерение')
    expect(all).toContain('проверять')
    const because = DESIGN_PRINCIPLES.map((p) => p.because).join(' ').toLowerCase()
    expect(because).toContain('карго') // анти-карго-культ обоснован в because
  })
})

describe('axesForArtifacts', () => {
  it('код → технические оси; контент → SEO/связность; пересечения корректны', () => {
    const code = axesForArtifacts(['код']).map((a) => a.axis)
    expect(code).toContain('производительность')
    expect(code).toContain('поддерживаемость')
    expect(code).not.toContain('находимость/SEO') // SEO не про голый код

    const content = axesForArtifacts(['контент']).map((a) => a.axis)
    expect(content).toContain('находимость/SEO')
    expect(content).toContain('связность/перелинковка')

    const design = axesForArtifacts(['дизайн']).map((a) => a.axis)
    expect(design).toContain('доступность')
    expect(design).toContain('UX/эргономика')
  })

  it('пустой состав — пустой список осей', () => {
    expect(axesForArtifacts([])).toEqual([])
  })

  it('смешанный проект объединяет оси без дублей', () => {
    const mixed = axesForArtifacts(['код', 'контент', 'данные'])
    const names = mixed.map((a: RubricAxis) => a.axis)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('целостность данных')
    expect(names).toContain('находимость/SEO')
    expect(names).toContain('производительность')
  })
})
