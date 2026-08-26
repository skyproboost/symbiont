/**
 * Фантомные импорты: имя импортируется из файла проекта, которого там нет.
 * Ловится индексом структуры сразу после правки — детерминированно и односторонне.
 */
import { describe, it, expect } from 'bun:test'
import { openDb } from '../src/core/db'
import { storeOutline } from '../src/layer1/symbols'
import { extractNamedImports, findPhantoms, renderPhantom } from '../src/verifiers/phantom'

const FILES = new Set(['src/core/db.ts', 'src/hooks/post.ts', 'src/util/x.py', 'src/util/y.py'])

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
    storeOutline(db, 'src/core/db.ts', 'h-db', [
      { name: 'openDb', kind: 'function', line: 1, endLine: 5, chars: 100 },
      { name: 'Database', kind: 'interface', line: 7, endLine: 20, chars: 300 },
      { name: 'Store.put', kind: 'method', line: 22, endLine: 30, chars: 200 },
    ])
    return db
  }
  const disk = (f: string) => (f === 'src/core/db.ts' ? 'h-db' : null)

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
    expect(findPhantoms(db, 'src/hooks/post.ts', content, FILES, () => 'other-hash', new Set())).toEqual([])
    expect(findPhantoms(db, 'src/hooks/post.ts', content, FILES, disk, new Set(['src/core/db.ts']))).toEqual([])
    db.close()
  })

  it('неразрешимый или внешний импорт не судится', () => {
    const db = world()
    expect(findPhantoms(db, 'src/hooks/post.ts', "import { x } from 'node:fs'\nimport { y } from './nowhere'\n", FILES, disk, new Set())).toEqual([])
    db.close()
  })
})
