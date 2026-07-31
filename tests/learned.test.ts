/**
 * Накопление знания между проектами. ГЛАВНОЕ, что проверяется, — граница
 * приватности: переезжает знание О ВИДЕ МАТЕРИАЛА и НИЧЕГО о проекте. Правило
 * должно держаться на санитайзере, а не на честном слове вызывающего.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLearnedMaterials, mergeLearnedMaterials, hintsForMaterials } from '../src/core/learned'
import { rmrf } from './_helpers'

const world = (): string => mkdtempSync(join(tmpdir(), 'symbiont-learn-'))

describe('ГРАНИЦА ПРИВАТНОСТИ', () => {
  it('пути, имена файлов и содержимое не сохраняются ни при каких входных данных', () => {
    const w = world()
    mergeLearnedMaterials(
      w,
      [
        { ext: '.unity', pairsWith: ['.meta'], medianLines: 120 },
        // попытка протащить проектное под видом вида материала
        { ext: 'Assets/Secret/Player.unity', pairsWith: ['/home/user/project'], medianLines: 10 },
        { ext: '.env', pairsWith: ['STRIPE_SECRET=sk_live_123'], medianLines: 5 },
      ],
      'проект-1',
    )
    const raw = readFileSync(join(w, 'learned-materials.json'), 'utf8')
    expect(raw).not.toContain('Assets/Secret')
    expect(raw).not.toContain('/home/user')
    expect(raw).not.toContain('sk_live_123')
    expect(raw).toContain('.unity')
    rmrf(w)
  })

  it('в записи остаются только расширение, пары видов и числа', () => {
    const w = world()
    mergeLearnedMaterials(w, [{ ext: '.vue', pairsWith: ['.scss'], medianLines: 80 }], 'п1')
    const entry = readLearnedMaterials(w)[0]
    expect(Object.keys(entry).sort()).toEqual(['ext', 'pairsWith', 'seenIn', 'typicalLines', 'updatedAt'])
    rmrf(w)
  })

  it('битый или подменённый файл не роняет систему — знание просто начнётся заново', () => {
    const w = world()
    writeFileSync(join(w, 'learned-materials.json'), '{ это не массив }')
    expect(readLearnedMaterials(w)).toEqual([])
    rmrf(w)
  })
})

describe('накопление', () => {
  it('счётчик проектов растёт только на НОВОМ проекте, а не на повторных прогонах', () => {
    const w = world()
    for (let i = 0; i < 5; i++) mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'один-и-тот-же')
    expect(readLearnedMaterials(w)[0].seenIn).toBe(1)

    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'другой')
    expect(readLearnedMaterials(w)[0].seenIn).toBe(2)
    rmrf(w)
  })

  it('пары из разных проектов объединяются — каждый видит свою грань', () => {
    const w = world()
    mergeLearnedMaterials(w, [{ ext: '.vue', pairsWith: ['.scss'], medianLines: 90 }], 'п1')
    mergeLearnedMaterials(w, [{ ext: '.vue', pairsWith: ['.spec.ts'], medianLines: 70 }], 'п2')
    const e = readLearnedMaterials(w)[0]
    expect(e.pairsWith.sort()).toEqual(['.scss', '.spec.ts'])
    rmrf(w)
  })
})

describe('подсказки', () => {
  it('единичное наблюдение подсказкой не становится — это совпадение, а не знание', () => {
    const w = world()
    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'п1')
    expect(hintsForMaterials(w, ['.unity'])).toEqual([])
    rmrf(w)
  })

  it('вид, встреченный в двух проектах, даёт подсказку с указанием опыта', () => {
    const w = world()
    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'п1')
    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 120 }], 'п2')
    const hints = hintsForMaterials(w, ['.unity'])
    expect(hints.length).toBe(1)
    expect(hints[0]).toContain('.unity')
    expect(hints[0]).toContain('парой с .meta')
    expect(hints[0]).toContain('2 проектов')
    rmrf(w)
  })

  it('о видах, которых в текущем проекте нет, система молчит', () => {
    const w = world()
    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'п1')
    mergeLearnedMaterials(w, [{ ext: '.unity', pairsWith: ['.meta'], medianLines: 100 }], 'п2')
    expect(hintsForMaterials(w, ['.ts', '.md'])).toEqual([])
    rmrf(w)
  })
})
