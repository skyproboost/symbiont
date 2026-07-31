/**
 * Согласие двух путей: импорты для графа достаются регэкспами (синхронно, без
 * WASM), а грамматики слоя 1 приложены к плагину и умеют то же самое точно.
 * Решение оставить рантайм на регэкспах принято сознательно — асинхронность
 * WASM протянулась бы через всю синхронную сборку паспорта ради выигрыша в
 * ИЗВЛЕЧЕНИИ, тогда как узкое место — РЕЗОЛВ. Но принять решение и оставить его
 * без надзора — разные вещи: здесь грамматика работает проверяющим и обязана
 * увидеть ровно то же множество спецификаторов.
 *
 * Расхождение = регэксп отстал от языка (новая форма импорта) и должен быть
 * дописан. Отсутствие грамматики в пребилдах — честная деградация, тест молчит.
 */
import { describe, it, expect } from 'bun:test'
import { withRoot, type TSNode } from '../src/layer1/ast'
import { extractImports } from '../src/graph/imports'

/** Узлы, объявляющие зависимость, — по типам грамматик разных языков. */
const IMPORTISH = /^(import_statement|import_from_statement|import_declaration|import_spec|namespace_use_declaration|use_declaration|preproc_include|expression_statement|require_relative)/

const collect = (node: TSNode, out: string[]): void => {
  if (IMPORTISH.test(node.type)) out.push(node.text)
  for (let i = 0; i < node.namedChildCount; i++) collect(node.namedChild(i), out)
}

/** Спецификаторы из текста узла — общая форма: строка в кавычках либо имя после ключевого слова. */
function specsFromNode(text: string, lang: string): string[] {
  const quoted = [...text.matchAll(/['"]([^'"\n]+)['"]/g)].map((m) => m[1])
  if (lang === 'go' || lang === 'js' || lang === 'c' || lang === 'ruby') return quoted
  if (lang === 'php') {
    if (/^\s*use\b/.test(text)) return [...text.matchAll(/^\s*use\s+(?:function\s+|const\s+)?([\w\\]+)/gm)].map((m) => m[1])
    return quoted
  }
  if (lang === 'java') return [...text.matchAll(/import\s+(?:static\s+)?([\w.*]+)/g)].map((m) => m[1])
  if (lang === 'py') {
    const from = text.match(/^\s*from\s+([.\w]+)\s+import/)
    if (from) return [from[1]]
    return [...text.matchAll(/^\s*import\s+([.\w]+)/gm)].map((m) => m[1])
  }
  if (lang === 'rust') {
    const use = text.match(/^\s*(?:pub\s+)?use\s+([\w:]+)/)
    return use ? [use[1]] : []
  }
  return quoted
}

interface Sample {
  name: string
  ext: string
  lang: string
  src: string
}

const SAMPLES: Sample[] = [
  {
    name: 'go',
    ext: '.go',
    lang: 'go',
    src: 'package main\n\nimport (\n\t"fmt"\n\tstore "example.com/app/internal/store"\n)\n\nimport "os"\n\nfunc main() { fmt.Println(store.X, os.Args) }\n',
  },
  {
    name: 'java',
    ext: '.java',
    lang: 'java',
    src: 'package com.app;\n\nimport com.app.util.Fmt;\nimport static com.app.util.Const.MAX;\nimport java.util.List;\n\npublic class Main {}\n',
  },
  {
    name: 'python',
    ext: '.py',
    lang: 'py',
    src: 'import os\nimport pkg.mod\nfrom .rel import thing\nfrom app.core import db\n',
  },
  {
    name: 'php',
    ext: '.php',
    lang: 'php',
    src: '<?php\nnamespace App;\n\nuse App\\Service\\Mailer;\nuse function App\\Helpers\\fmt;\n\nrequire_once __DIR__ . "/bootstrap.php";\n',
  },
  {
    name: 'rust',
    ext: '.rs',
    lang: 'rust',
    src: 'use crate::store::db;\nuse std::fmt::Display;\n\nfn main() {}\n',
  },
  {
    name: 'javascript',
    ext: '.ts',
    lang: 'js',
    src: "import { a } from './a'\nimport b from '../b'\nexport { c } from './c'\nconst d = require('./d')\nconst e = await import('./e')\n",
  },
]

describe('импорты: регэксп слоя 0 и грамматика слоя 1 видят одно и то же', () => {
  for (const s of SAMPLES) {
    it(`${s.name}: множества спецификаторов совпадают`, async () => {
      const nodes = await withRoot(s.ext, s.src, (root) => {
        const out: string[] = []
        collect(root, out)
        return out
      })
      if (nodes === null) return // грамматики нет в пребилдах — деградация честна
      const fromAst = new Set(nodes.flatMap((t) => specsFromNode(t, s.lang)))
      const fromRegex = new Set(extractImports(s.src, `sample${s.ext}`))
      // Регэксп вправе видеть БОЛЬШЕ (формы вне грамматики импортов: AMD-список,
      // заголовок-ссылка), но не вправе пропустить то, что грамматика назвала импортом
      // Проверка не должна быть пустой: если грамматика не нашла ни одного
      // импорта, совпадение множеств означает лишь, что сравнивать было нечего
      expect(fromAst.size).toBeGreaterThan(1)
      const missed = [...fromAst].filter((x) => !fromRegex.has(x))
      expect(missed).toEqual([])
    })
  }
})
