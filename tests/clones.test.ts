import { describe, it, expect } from 'bun:test'
import { normalizeBlock, findClones, findNearClones, renderClones } from '../src/gardener/clones'

const BLOCK = `function validateUser(input) {
  if (!input.name) throw new Error('no name')
  if (!input.email) throw new Error('no email')
  const clean = sanitize(input)
  const record = save(clean)
  return record
}`

describe('normalizeBlock', () => {
  it('строки→S, числа→N, комментарии убраны, пробелы схлопнуты', () => {
    const n = normalizeBlock(
      "const message = 'hello world' // коммент про сообщение\nconst counter = 42\nconst result = computeSomething(argument)\nconst another = anotherFunction(withArgs)\nconst third = 100\nconst fourth = combine(a, b)",
    )
    expect(n).not.toBeNull()
    expect(n!.norm).toContain('const message = S')
    expect(n!.norm).toContain('const counter = N')
    expect(n!.norm).not.toContain('коммент')
  })
  it('короткий блок (<6 значимых строк) → null', () => {
    expect(normalizeBlock('const a = 1\nconst b = 2\nconst c = 3')).toBeNull()
  })
  it('длинный по строкам, но мало символов → null (не тащим тривиальное)', () => {
    expect(normalizeBlock('a\nb\nc\nd\ne\nf\ng')).toBeNull()
  })
  it('сгенерированное (минифай) отсеивается: автор этих строк не писал', () => {
    const minified = Array.from({ length: 8 }, (_, i) => `!function(t){var r={};function n(e){if(r[e])return r[e].exports;var s=r[e]={i:e,l:!1,exports:{}};return t[e].call(s.exports,s,s.exports,n),s.l=!0,s.exports}n.m=t,n.c=r,n.d=function(e,t,r){n.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:r})},n.p="",n(n.s=${i})}([]);`).join('\n')
    expect(normalizeBlock(minified)).toBeNull()
  })
  it('незакрытая кавычка не вешает нормализацию (катастрофический бэктрекинг)', () => {
    // 3 секунды на пятикилобайтном файле правил валидации — реальный замер
    const tricky = Array.from({ length: 40 }, (_, i) => `  const rule${i} = check(value, /it's a "quoted" thing/, 'ok')`).join('\n')
    const t = performance.now()
    normalizeBlock(`${tricky}\n  const unbalanced = "не закрыта`)
    expect(performance.now() - t).toBeLessThan(300)
  })
})

describe('findClones — точные дубли блоков', () => {
  it('копипаст одного блока в двух файлах → клон-группа', () => {
    const clones = findClones([
      { rel: 'src/a.ts', content: `const top = 1\n\n${BLOCK}\n\nconst bottom = 2` },
      { rel: 'src/b.ts', content: `${BLOCK}\n\nexport const other = 3` },
    ])
    expect(clones.length).toBe(1)
    expect(clones[0].count).toBe(2)
    expect(clones[0].files.sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(clones[0].lines).toBe(7)
  })

  it('почти-копия (переименован идентификатор) точным дублем НЕ считается — её ловит SimHash', () => {
    const modified = BLOCK.replace('validateUser', 'validateAdmin')
    const clones = findClones([
      { rel: 'a.ts', content: BLOCK },
      { rel: 'b.ts', content: modified },
    ])
    expect(clones.length).toBe(0) // отличается → не точный дубль
  })

  it('копипаст 3× (в т.ч. в одном файле) — count учитывает все', () => {
    const clones = findClones([
      { rel: 'a.ts', content: `${BLOCK}\n\n${BLOCK}` }, // дважды в одном файле
      { rel: 'b.ts', content: BLOCK },
    ])
    expect(clones[0].count).toBe(3)
    expect(clones[0].files.sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('строковые/числовые различия нормализуются → копии с разными литералами = клон', () => {
    const b1 = "function f() {\n  const url = 'http://a.com'\n  const n = 10\n  const r = fetch(url)\n  const d = parse(r)\n  return d\n}"
    const b2 = "function f() {\n  const url = 'http://b.org'\n  const n = 99\n  const r = fetch(url)\n  const d = parse(r)\n  return d\n}"
    const clones = findClones([{ rel: 'a.ts', content: b1 }, { rel: 'b.ts', content: b2 }])
    expect(clones.length).toBe(1) // литералы нормализованы → одинаковые
  })

  it('уникальный код → ноль клонов', () => {
    expect(findClones([{ rel: 'a.ts', content: BLOCK }])).toEqual([])
  })
})

describe('findNearClones — копия, правленная под новое место', () => {
  it('переименованный идентификатор не прячет копипаст', () => {
    const modified = BLOCK.replace('validateUser', 'validateAdmin').replace('record', 'entry')
    const near = findNearClones([
      { rel: 'src/a.ts', content: BLOCK },
      { rel: 'src/b.ts', content: modified },
    ])
    expect(near.length).toBe(1)
    expect([near[0].a.file, near[0].b.file].sort()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(near[0].distance).toBeGreaterThan(0) // точным дублем это не было
  })

  it('точные дубли сюда НЕ попадают — их показывает findClones (не дублируем отчёт)', () => {
    const near = findNearClones([
      { rel: 'a.ts', content: BLOCK },
      { rel: 'b.ts', content: BLOCK },
    ])
    expect(near).toEqual([])
  })

  it('разный код похожим не объявляется: ложное обвинение дороже пропуска', () => {
    const other = `function renderInvoice(order) {
  const rows = order.items.map(toRow)
  const total = rows.reduce(sum, 0)
  const header = buildHeader(order.customer)
  const html = template(header, rows, total)
  return html
}`
    expect(findNearClones([{ rel: 'a.ts', content: BLOCK }, { rel: 'b.ts', content: other }])).toEqual([])
  })

  it('блоки сильно разной длины не пара, даже при похожем словаре', () => {
    const inflated = `${BLOCK.slice(0, -1)}\n  const extra1 = compute(record)\n  const extra2 = compute(extra1)\n  const extra3 = compute(extra2)\n  const extra4 = compute(extra3)\n  const extra5 = compute(extra4)\n  const extra6 = compute(extra5)\n  return extra6\n}`
    expect(findNearClones([{ rel: 'a.ts', content: BLOCK }, { rel: 'b.ts', content: inflated }])).toEqual([])
  })

  it('цена ограничена: большой проект разбирается за секунды, а не минуты', () => {
    const files = Array.from({ length: 300 }, (_, i) => ({
      rel: `src/m${i}.ts`,
      content: `${BLOCK.replace('validateUser', `validate${i}`)}\n\nexport const c${i} = ${i}`,
    }))
    const t = performance.now()
    findNearClones(files)
    expect(performance.now() - t).toBeLessThan(5000)
  })
})

describe('renderClones', () => {
  it('секция с числом копий и файлами; пусто → без секции', () => {
    const clones = findClones([{ rel: 'a.ts', content: BLOCK }, { rel: 'b.ts', content: BLOCK }])
    const lines = renderClones(clones)
    expect(lines[0]).toContain('Клоны кода')
    expect(lines.join('\n')).toContain('2 копий')
    expect(renderClones([])).toEqual([])
  })
})
