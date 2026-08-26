/**
 * Фантомные импорты: имя импортируется из файла проекта, которого там нет.
 * Ловится индексом структуры сразу после правки — детерминированно и односторонне.
 */
import { describe, it, expect } from 'bun:test'
import { openDb } from '../src/core/db'
import { storeOutline } from '../src/layer1/symbols'
import { extractNamedImports, findPhantoms, renderPhantom, declaredInSource } from '../src/verifiers/phantom'
import { sha1 } from '../src/core/salsa'

const FILES = new Set(['src/core/db.ts', 'src/hooks/post.ts', 'src/util/x.py', 'src/util/y.py'])
const DB_SRC = "export function openDb() {}\nexport interface Database {}\nexport const CODE_EXT = new Set(['.ts'])\nclass Store { put() {} }\n"


describe('извлечение именованных импортов', () => {
  it('JS/TS: фигурные скобки, as, type; Python: from … import', () => {
    const js = extractNamedImports("import { openDb, type Database, run as go } from '../core/db'\nimport x from './d'\n", 'src/hooks/post.ts')
    expect(js).toEqual([{ spec: '../core/db', names: ['openDb', 'Database', 'run'] }])
    const py = extractNamedImports('from .y import helper, other as o\nfrom os import path\n', 'src/util/x.py')
    expect(py[0]).toEqual({ spec: '.y', names: ['helper', 'other'] })
  })
})

describe('поиск фантомов', () => {
  const world = () => {
    const db = openDb(':memory:')
    storeOutline(db, 'src/core/db.ts', sha1(DB_SRC), [
      { name: 'openDb', kind: 'function', line: 1, endLine: 5, chars: 100 },
      { name: 'Database', kind: 'interface', line: 7, endLine: 20, chars: 300 },
      { name: 'Store.put', kind: 'method', line: 22, endLine: 30, chars: 200 },
    ])
    return db
  }
  const disk = (f: string) => (f === 'src/core/db.ts' ? DB_SRC : null)

  it('имя, которого нет в источнике, — фантом; существующие молчат', () => {
    const db = world()
    const content = "import { openDb, fooBar } from '../core/db'\n"
    const found = findPhantoms(db, 'src/hooks/post.ts', content, FILES, disk, new Set())
    expect(found.map((p) => p.name)).toEqual(['fooBar'])
    expect(found[0].source).toBe('src/core/db.ts')
    expect(renderPhantom(found[0])).toContain('fooBar')
    expect(renderPhantom(found[0])).toContain('openDb')
    db.close()
  })

  it('несвежий индекс источника — молчание; файл, писанный сессией, — молчание', () => {
    const db = world()
    const content = "import { fooBar } from '../core/db'\n"
    expect(findPhantoms(db, 'src/hooks/post.ts', content, FILES, () => 'export const changed = 1\n', new Set())).toEqual([])
    expect(findPhantoms(db, 'src/hooks/post.ts', content, FILES, disk, new Set(['src/core/db.ts']))).toEqual([])
    db.close()
  })

  it('неразрешимый или внешний импорт не судится', () => {
    const db = world()
    expect(findPhantoms(db, 'src/hooks/post.ts', "import { x } from 'node:fs'\nimport { y } from './nowhere'\n", FILES, disk, new Set())).toEqual([])
    db.close()
  })
})

describe('объявления в тексте — вторая опора после индекса', () => {
  it('экспортированная константа не в оглавлении, но объявлена — не фантом', () => {
    const db = openDb(':memory:')
    storeOutline(db, 'src/core/db.ts', sha1(DB_SRC), [{ name: 'openDb', kind: 'function', line: 1, endLine: 1, chars: 10 }])
    const found = findPhantoms(db, 'src/hooks/post.ts', "import { CODE_EXT, nope } from '../core/db'\n", FILES, (f) => (f === 'src/core/db.ts' ? DB_SRC : null), new Set())
    expect(found.map((p) => p.name)).toEqual(['nope'])
    db.close()
  })

  it('формы объявления: export const/type/enum, export {…}, CommonJS, Python def/=/__all__', () => {
    expect(declaredInSource('export const A = 1\n', 'A')).toBe(true)
    expect(declaredInSource('export type T = string\n', 'T')).toBe(true)
    expect(declaredInSource('const B = 1\nexport { B as C }\n', 'C')).toBe(true)
    expect(declaredInSource('module.exports = { helper }\n', 'helper')).toBe(true)
    expect(declaredInSource('def helper():\n    pass\n', 'helper')).toBe(true)
    expect(declaredInSource('VALUE = 3\n', 'VALUE')).toBe(true)
    expect(declaredInSource("__all__ = ['x', 'y']\n", 'y')).toBe(true)
    expect(declaredInSource('export const A = 1\n', 'AB')).toBe(false)
    expect(declaredInSource('const inner = () => 1\n', 'inner')).toBe(true) // объявлено, пусть и не экспортировано — не фантом
  })
})
