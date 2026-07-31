/**
 * Непокрытый материал: проект может быть каким угодно — Unity, презентации, свой
 * формат данных. Молчание о незнакомом читается как «здесь нечего понимать», и
 * это самая дорогая ошибка, потому что она невидима.
 */
import { describe, expect, it } from 'bun:test'
import { findUnknownMaterial, buildUnknownPrompt, unknownFact } from '../src/miner/unknown'

const covered = { code: new Set(['.ts', '.js', '.cs']), entity: new Set(['.md']), office: new Set(['.docx']) }

describe('findUnknownMaterial', () => {
  it('видит незнакомый материал независимо от того, что это за формат', () => {
    const exts = [...Array(40).fill('.unity'), ...Array(30).fill('.prefab'), ...Array(10).fill('.cs')]
    const u = findUnknownMaterial(exts, covered)
    expect(u.kinds.map((k) => k.ext)).toEqual(['.unity', '.prefab'])
    expect(u.totalShare).toBeGreaterThan(0.8)
  })

  it('покрытое анализаторами незнакомым не считается', () => {
    const exts = [...Array(50).fill('.ts'), ...Array(20).fill('.md'), ...Array(10).fill('.docx')]
    expect(findUnknownMaterial(exts, covered).kinds).toEqual([])
  })

  it('единичная экзотика поводом не является — обещание «понимаю всё» дешевле не давать', () => {
    const exts = [...Array(200).fill('.ts'), '.blend', '.psd']
    expect(findUnknownMaterial(exts, covered).kinds).toEqual([])
  })

  it('бинарное и служебное материалом не считается — им пользуются, его не понимают', () => {
    const exts = [...Array(30).fill('.png'), ...Array(20).fill('.woff2'), ...Array(10).fill('.ts')]
    expect(findUnknownMaterial(exts, covered).kinds).toEqual([])
  })

  it('пустой проект — пусто, без выдумок', () => {
    expect(findUnknownMaterial([], covered)).toEqual({ kinds: [], totalShare: 0 })
  })
})

describe('обучение материалу', () => {
  it('промпт НЕ называет формат моделью — спрашиваются наблюдения, а не общие сведения', () => {
    const p = buildUnknownPrompt('.unity', [{ file: 'Scenes/Main.unity', content: 'GameObject:\n  m_Name: Player' }])
    expect(p).toContain('«.unity»')
    expect(p).toContain('КАК В ЭТОМ ПРОЕКТЕ принято работать')
    expect(p).toContain('Scenes/Main.unity')
    // честный ответ «правил не видно» разрешён явно
    expect(p).toContain('верни пустой массив')
  })

  it('факт признаёт границу знания, а не притворяется знающим', () => {
    const f = unknownFact(findUnknownMaterial([...Array(20).fill('.unity'), ...Array(5).fill('.ts')], covered))!
    expect(f.statement).toContain('без готового анализатора')
    expect(f.statement).toContain('выводятся из образцов')
  })

  it('нечего признавать — факта нет', () => {
    expect(unknownFact({ kinds: [], totalShare: 0 })).toBeNull()
  })
})
