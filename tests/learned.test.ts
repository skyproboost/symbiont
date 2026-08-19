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

/**
 * У бинарного файла нет строк. Число «~169 строк» для .png получено честно —
 * байты картинки поделили по 0x0A — и потому выглядит статистикой, а не
 * ошибкой: подсказка про размер картинки уезжала в каждый проект владельца.
 */
describe('непрозрачный материал не накапливается', () => {
  it('картинки, шрифты и архивы не попадают в каталог видов', () => {
    const w = world()
    mergeLearnedMaterials(
      w,
      [
        { ext: '.png', pairsWith: ['.svg'], medianLines: 169 },
        { ext: '.woff2', pairsWith: [], medianLines: 4 },
        { ext: '.zip', pairsWith: [], medianLines: 31 },
        { ext: '.vue', pairsWith: ['.ts'], medianLines: 183 },
      ],
      'проект-1',
    )
    const kinds = readLearnedMaterials(w).map((k) => k.ext)
    expect(kinds).toEqual(['.vue'])
  })

  it('уже накопленное чистится чтением, а не ждёт миграции', () => {
    const w = world()
    // Каталог, записанный прошлой версией: строка про .png в нём уже лежит
    writeFileSync(
      join(w, 'learned-materials.json'),
      JSON.stringify([
        { ext: '.png', pairsWith: [], typicalLines: 169, seenIn: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
        { ext: '.md', pairsWith: [], typicalLines: 59, seenIn: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
      ]),
      'utf8',
    )
    expect(hintsForMaterials(w, ['.png', '.md']).join(' ')).not.toContain('.png')
    expect(hintsForMaterials(w, ['.png', '.md']).join(' ')).toContain('.md')
  })
})
