/**
 * Структура файла: извлечение оглавления, его хранение и выемка символа.
 *
 * Главное, что здесь охраняется, — отказ при расхождении с диском. Выдать по
 * устаревшим границам правдоподобный чужой кусок хуже, чем не выдать ничего:
 * ошибку такого рода в ответе не видно.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { sha1 } from '../src/core/salsa'
import { withRoot, astSource } from '../src/layer1/ast'
import {
  collectOutline,
  storeOutline,
  readOutline,
  indexedHash,
  pruneSymbols,
  outlineView,
  resolveIndexed,
  outlineTokens,
  heaviestTokens,
  tokensOf,
  ensureSymbols,
  type SymbolRow,
} from '../src/layer1/symbols'
import { callTool } from '../src/mcp/handlers'
import { slugOf } from '../src/hooks/session-start-core'

const TS = `export interface Shape {
  kind: string
}

export function area(s: Shape): number {
  return 1
}

export const scale = (n: number): number => n * 2

export class Box {
  constructor(private n: number) {}

  grow(by: number): number {
    const step = () => by + 1
    return this.n + step()
  }
}
`

const outlineOf = async (ext: string, text: string): Promise<SymbolRow[]> => {
  const src = astSource(ext, text)
  if (src === null) return []
  return (await withRoot(ext, src, (root) => collectOutline(root))) ?? []
}

describe('извлечение оглавления', () => {
  it('находит функции, стрелочные присваивания, класс и его методы', async () => {
    const rows = await outlineOf('.ts', TS)
    const names = rows.map((r) => r.name)
    expect(names).toContain('area')
    expect(names).toContain('scale') // `const f = () => {}` — имя на объявлении, функция в значении
    expect(names).toContain('Shape')
    expect(names).toContain('Box')
    expect(names).toContain('Box.grow') // метод получает имя своего класса
  })

  it('не заходит внутрь функций: замыкание в теле метода не попадает в оглавление', async () => {
    const rows = await outlineOf('.ts', TS)
    expect(rows.map((r) => r.name).some((n) => n.includes('step'))).toBe(false)
  })

  it('границы символа указывают на его настоящие строки', async () => {
    const rows = await outlineOf('.ts', TS)
    const area = rows.find((r) => r.name === 'area')!
    const lines = TS.split('\n')
    expect(lines[area.line - 1]).toContain('export function area')
    expect(lines[area.endLine - 1].trim()).toBe('}')
  })

  it('те же виды символов опознаются в другом языке', async () => {
    const rows = await outlineOf('.py', 'class Store:\n    def put(self, k):\n        return 1\n\ndef helper(x):\n    return x\n')
    const names = rows.map((r) => r.name)
    expect(names).toContain('Store')
    expect(names).toContain('Store.put')
    expect(names).toContain('helper')
  })

  it('.vue из оглавления исключён: вырезанный <script> сдвигает все строки', () => {
    expect(astSource('.vue', '<template><div/></template>\n<script>const a = 1</script>')).toBe('const a = 1')
    // сам разбор возможен, но строки в нём считаются от куска, а не от файла —
    // поэтому оглавление для .vue не строится (см. runLayer1)
    expect(astSource('.md', '# нет')).toBeNull()
  })
})

describe('цена, названная вслух', () => {
  const rows: SymbolRow[] = [
    { name: 'small', kind: 'function', line: 1, endLine: 3, chars: 100 },
    { name: 'huge', kind: 'class', line: 5, endLine: 200, chars: 8000 },
  ]

  it('оглавление стоит своего списка, а не суммы объявлений', () => {
    // Дефект, пойманный симуляцией: сумма объявлений давала «оглавление дороже
    // файла» и подсказка уговаривала читать целиком.
    expect(outlineTokens(rows)).toBeLessThan(tokensOf(8100))
    expect(outlineTokens(rows)).toBeLessThan(60)
  })

  it('самый большой символ — верхняя граница цены одной выемки', () => {
    expect(heaviestTokens(rows)).toBe(tokensOf(8000))
  })

  it('пустое оглавление ничего не стоит', () => {
    expect(outlineTokens([])).toBe(0)
    expect(heaviestTokens([])).toBe(0)
  })
})

describe('индекс структуры и выемка', () => {
  function makeWorld() {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-sym-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-sym-data-'))
    const dataDir = join(dataRoot, slugOf(proj))
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'shape.ts'), TS)
    return { proj, dataRoot, dataDir }
  }

  it('оглавление переживает запись и читается обратно', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const rows = await outlineOf('.ts', TS)
      const db = openDb(join(dataDir, 'passport.db'))
      storeOutline(db, 'src/shape.ts', sha1(TS), rows)
      expect(readOutline(db, 'src/shape.ts').map((r) => r.name)).toEqual(rows.map((r) => r.name))
      expect(indexedHash(db, 'src/shape.ts')).toBe(sha1(TS))
      db.close()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('исчезнувший с диска файл уходит и из индекса', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      storeOutline(db, 'src/shape.ts', sha1(TS), await outlineOf('.ts', TS))
      storeOutline(db, 'src/gone.ts', 'h', [{ name: 'x', kind: 'function', line: 1, endLine: 2, chars: 10 }])
      pruneSymbols(db, new Set(['src/shape.ts']))
      expect(indexedHash(db, 'src/gone.ts')).toBeNull()
      expect(readOutline(db, 'src/gone.ts')).toEqual([])
      expect(indexedHash(db, 'src/shape.ts')).not.toBeNull()
      db.close()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('хвост пути разрешается в путь индекса', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      storeOutline(db, 'src/shape.ts', sha1(TS), await outlineOf('.ts', TS))
      expect(resolveIndexed(db, 'shape.ts')).toBe('src/shape.ts')
      expect(resolveIndexed(db, 'src/shape.ts')).toBe('src/shape.ts')
      expect(resolveIndexed(db, 'нет.ts')).toBeNull()
      db.close()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('расхождение с диском видно вердиктом свежести', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      storeOutline(db, 'src/shape.ts', sha1(TS), await outlineOf('.ts', TS))
      const fresh = outlineView(db, 'src/shape.ts', () => TS, sha1)
      expect(fresh.fresh).toBe(true)
      const stale = outlineView(db, 'src/shape.ts', () => '// другое содержимое\n', sha1)
      expect(stale.fresh).toBe(false)
      db.close()
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('выемка отдаёт настоящие строки символа, а на изменённом файле отказывается', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      ensureSymbols(db)
      storeOutline(db, 'src/shape.ts', sha1(TS), await outlineOf('.ts', TS))
      db.close()

      const outline = callTool('passport_outline', { file: 'shape.ts' }, dataDir, proj)
      expect(outline).toContain('Box.grow')

      const unfold = callTool('passport_unfold', { file: 'shape.ts', symbol: 'Box.grow' }, dataDir, proj)
      expect(unfold).toContain('grow(by: number)')
      expect(unfold).not.toContain('export function area') // взят один символ, а не всё подряд

      // Файл изменился — границы указывают в прежнюю редакцию
      writeFileSync(join(proj, 'src', 'shape.ts'), '// всё переписано\nexport const x = 1\n')
      const refused = callTool('passport_unfold', { file: 'shape.ts', symbol: 'Box.grow' }, dataDir, proj)
      expect(refused).not.toContain('grow(by: number)')
      expect(refused.toLowerCase()).toContain('изменил')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })

  it('неизвестный символ отвечает списком существующих, а не пустотой', async () => {
    const { proj, dataRoot, dataDir } = makeWorld()
    try {
      const db = openDb(join(dataDir, 'passport.db'))
      storeOutline(db, 'src/shape.ts', sha1(TS), await outlineOf('.ts', TS))
      db.close()
      const answer = callTool('passport_unfold', { file: 'shape.ts', symbol: 'нетТакого' }, dataDir, proj)
      expect(answer).toContain('area')
    } finally {
      rmrf(proj)
      rmrf(dataRoot)
    }
  })
})
