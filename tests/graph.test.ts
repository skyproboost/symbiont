import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractImports, resolveImport } from '../src/graph/imports'
import { buildEdges, pagerank, nodeStats, personalizedPagerank, personalizedTop, taskRelevantNeighbors, reachableUndirected, type Edge } from '../src/graph/graph'
import { buildPassport } from '../src/passport/build'
import { callTool } from '../src/mcp/handlers'

describe('extractImports', () => {
  it('все формы импорта', () => {
    const src = `
import a from './a'
import { b, c } from '../lib/b'
import * as d from '~/utils/d'
export { e } from '@/e'
const f = require('./f')
const g = await import('./g')
import './side-effect'
import pkg from 'vue'
`
    const specs = extractImports(src)
    expect(specs).toContain('./a')
    expect(specs).toContain('../lib/b')
    expect(specs).toContain('~/utils/d')
    expect(specs).toContain('@/e')
    expect(specs).toContain('./f')
    expect(specs).toContain('./g')
    expect(specs).toContain('./side-effect')
    expect(specs).toContain('vue')
  })
})

describe('resolveImport', () => {
  const files = new Set([
    'src/a.ts',
    'src/lib/b.ts',
    'utils/d.vue',
    'e.js',
    'src/util/index.ts',
  ])

  it('относительные с достройкой расширения', () => {
    expect(resolveImport('src/a.ts', './lib/b', files)).toBe('src/lib/b.ts')
    expect(resolveImport('src/lib/b.ts', '../a', files)).toBe('src/a.ts')
  })
  it('index-файлы', () => {
    expect(resolveImport('src/a.ts', './util', files)).toBe('src/util/index.ts')
  })
  it('алиасы корня ~/ @/ ~~/', () => {
    expect(resolveImport('src/a.ts', '~/utils/d', files)).toBe('utils/d.vue')
    expect(resolveImport('src/a.ts', '@/e', files)).toBe('e.js')
    expect(resolveImport('src/a.ts', '~~/e', files)).toBe('e.js')
  })
  it('пакеты и выход за корень — null', () => {
    expect(resolveImport('src/a.ts', 'vue', files)).toBe(null)
    expect(resolveImport('e.js', '../outside', files)).toBe(null)
  })
})

describe('graph + pagerank', () => {
  const files = [
    { rel: 'a.ts', content: "import b from './b'\nimport c from './c'" },
    { rel: 'b.ts', content: "import c from './c'" },
    { rel: 'c.ts', content: 'export const x = 1' },
  ]

  it('рёбра строятся, самоссылки/дубли отсекаются', () => {
    const g = buildEdges(files)
    expect(g.edges).toEqual([
      { from: 'a.ts', to: 'b.ts' },
      { from: 'a.ts', to: 'c.ts' },
      { from: 'b.ts', to: 'c.ts' },
    ])
  })

  it('хаб (все зависят) ранжируется выше всех', () => {
    const g = buildEdges(files)
    const stats = nodeStats(g)
    expect(stats[0].file).toBe('c.ts')
    expect(stats[0].inDeg).toBe(2)
  })

  it('pagerank: сумма ≈ 1, пустой граф не падает', () => {
    const g = buildEdges(files)
    const pr = pagerank(g.nodes, g.edges)
    const sum = [...pr.values()].reduce((s, v) => s + v, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    expect(pagerank([], []).size).toBe(0)
  })
})

describe('персонализированный PageRank от сида задачи', () => {
  // a → b → c → d (цепь) + ветка a → e
  const edges: Edge[] = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'a', to: 'e' },
  ]
  const nodes = ['a', 'b', 'c', 'd', 'e']

  it('сумма рангов ≈ 1; пустой граф не падает', () => {
    const pr = personalizedPagerank(nodes, edges, [{ file: 'a', weight: 50 }])
    const sum = [...pr.values()].reduce((s, v) => s + v, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    expect(personalizedPagerank([], [], []).size).toBe(0)
  })

  it('сид концентрирует ранг: сид-узел выше того же узла без персонализации', () => {
    const seeded = personalizedPagerank(nodes, edges, [{ file: 'a', weight: 50 }])
    const flat = personalizedPagerank(nodes, edges, []) // пустой сид → равномерный телепорт
    expect(seeded.get('a')!).toBeGreaterThan(flat.get('a')!)
  })

  it('масса течёт от сида к соседям: e (прямой сосед a) обгоняет d (дальний)', () => {
    const pr = personalizedPagerank(nodes, edges, [{ file: 'a', weight: 50 }])
    expect(pr.get('e')!).toBeGreaterThan(pr.get('d')!)
  })

  it('разные сиды — разное окружение: сид на c поднимает d выше, чем сид на a', () => {
    const seedA = personalizedPagerank(nodes, edges, [{ file: 'a', weight: 50 }])
    const seedC = personalizedPagerank(nodes, edges, [{ file: 'c', weight: 50 }])
    expect(seedC.get('d')!).toBeGreaterThan(seedA.get('d')!)
  })

  it('personalizedTop исключает сам сид и заданное', () => {
    const top = personalizedTop(nodes, edges, [{ file: 'a', weight: 50 }], 3)
    expect(top.map((t) => t.file)).not.toContain('a')
    const withExclude = personalizedTop(nodes, edges, [{ file: 'a', weight: 50 }], 3, new Set(['e']))
    expect(withExclude.map((t) => t.file)).not.toContain('e')
  })
})

describe('taskRelevantNeighbors — лифт подавляет god-узлы', () => {
  // S импортирует T (специфично) и H (god-узел, на него ссылаются ещё A/B/C)
  const edges: Edge[] = [
    { from: 's', to: 't' },
    { from: 's', to: 'h' },
    { from: 'a', to: 'h' },
    { from: 'b', to: 'h' },
    { from: 'c', to: 'h' },
  ]
  const nodes = ['s', 't', 'h', 'a', 'b', 'c']

  it('специфичный импорт T обгоняет god-узел H (или H отсеян порогом лифта)', () => {
    const nb = reachableUndirected(edges, new Set(['s']), 2)
    const r = taskRelevantNeighbors(nodes, edges, [{ file: 's', weight: 50 }], nb, 5, 1.3)
    const files = r.map((x) => x.file)
    expect(files).toContain('t') // специфичный — всплывает
    // H либо ниже T, либо вовсе отсеян (god-узел централен для всех → низкий лифт)
    const ti = files.indexOf('t')
    const hi = files.indexOf('h')
    expect(hi === -1 || ti < hi).toBe(true)
  })

  it('чистый сид-сток (без исходящих) → пусто (импортёры и так в nodeBrief)', () => {
    const nb = reachableUndirected(edges, new Set(['t']), 2) // t ничего не импортирует
    expect(taskRelevantNeighbors(nodes, edges, [{ file: 't', weight: 50 }], nb, 5, 1.3)).toEqual([])
  })
})

describe('reachableUndirected — окружение задачи (анти-шум)', () => {
  const edges: Edge[] = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'x', to: 'y' }, // отдельная компонента
  ]

  it('1 хоп: только прямые соседи; сид исключён', () => {
    const r = reachableUndirected(edges, new Set(['a']), 1)
    expect(r).toEqual(new Set(['b']))
  })
  it('2 хопа: ненаправленно (b от a, c от b)', () => {
    expect(reachableUndirected(edges, new Set(['a']), 2)).toEqual(new Set(['b', 'c']))
  })
  it('несвязанная компонента недостижима (сид без рёбер к ней → пусто)', () => {
    expect(reachableUndirected(edges, new Set(['a']), 3).has('y')).toBe(false)
    expect(reachableUndirected(edges, new Set(['unknown']), 3)).toEqual(new Set())
  })
})

describe('интеграция: граф в паспорте и MCP', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-graph-proj-'))
  mkdirSync(join(proj, 'utils'), { recursive: true })
  writeFileSync(join(proj, 'utils', 'core.js'), 'module.exports = { x: 1 };\n'.repeat(3))
  writeFileSync(join(proj, 'service.js'), "var core = require('./utils/core');\nvar s = core.x;\n")
  writeFileSync(join(proj, 'app.js'), "var svc = require('./service');\nvar core = require('./utils/core');\n")
  // page зависит от core ТОЛЬКО транзитивно (через service) — проверка уровней глубины
  writeFileSync(join(proj, 'page.js'), "var svc = require('./service');\n")
  const data = mkdtempSync(join(tmpdir(), 'symbiont-graph-data-'))

  it('buildPassport: граф посчитан, сводка содержит «Ключевые модули»', () => {
    const r = buildPassport(proj, data)
    expect(r.graphExecuted).toBe(true)
    expect(r.graph.edgeCount).toBe(4)
    expect(r.graph.top[0].file).toBe('utils/core.js')
    const { readFileSync } = require('node:fs')
    expect(readFileSync(r.summaryPath, 'utf8')).toContain('Ключевые модули')
  })

  it('повторный прогон: граф из кэша', () => {
    const r = buildPassport(proj, data)
    expect(r.graphExecuted).toBe(false)
  })

  it('passport_map: легенда + порядок по важности', () => {
    const text = callTool('passport_map', {}, data)
    expect(text).toContain('Легенда:')
    expect(text.split('\n')[1]).toContain('utils/core.js')
  })

  it('passport_impact: транзитивные зависимые по уровням', () => {
    const text = callTool('passport_impact', { file: 'core.js' }, data)
    expect(text).toContain('Радиус влияния utils/core.js: 3 зависимых')
    expect(text).toMatch(/1: .*service\.js/) // прямые
    expect(text).toMatch(/1: .*app\.js/) // app импортирует core напрямую → уровень 1
    expect(text).toMatch(/2: .*page\.js/) // page — только транзитивно через service
  })

  it('passport_impact: лист без зависимых', () => {
    const text = callTool('passport_impact', { file: 'app.js' }, data)
    expect(text).toContain('зависимых по импортам нет')
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(data, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})

describe('граф импортов: язык — это данные, а не привилегия JS', () => {
  const edges = (files: Array<{ rel: string; content: string }>) => buildEdges(files).edges

  it('python: относительный импорт внутри пакета', () => {
    const e = edges([
      { rel: 'pkg/main.py', content: 'from .util import helper' },
      { rel: 'pkg/util.py', content: 'def helper(x): return x' },
    ])
    expect(e).toEqual([{ from: 'pkg/main.py', to: 'pkg/util.py' }])
  })

  it('python: абсолютный импорт от корня проекта', () => {
    const e = edges([
      { rel: 'app/run.py', content: 'from core.db import conn' },
      { rel: 'core/db.py', content: 'conn = 1' },
    ])
    expect(e).toEqual([{ from: 'app/run.py', to: 'core/db.py' }])
  })

  it('python: скрипт рядом со скриптом (sys.path = свой каталог) — боевой случай', () => {
    const e = edges([
      { rel: 'scripts/sync/sidecar.py', content: 'import redact' },
      { rel: 'scripts/sync/redact.py', content: 'def redact_text(t): return t' },
    ])
    expect(e).toEqual([{ from: 'scripts/sync/sidecar.py', to: 'scripts/sync/redact.py' }])
  })

  it('python: пакет через __init__.py', () => {
    const e = edges([
      { rel: 'main.py', content: 'import lib.tools' },
      { rel: 'lib/tools/__init__.py', content: 'x = 1' },
    ])
    expect(e).toEqual([{ from: 'main.py', to: 'lib/tools/__init__.py' }])
  })

  it('php: require и require_once __DIR__', () => {
    expect(edges([
      { rel: 'app.php', content: "<?php require_once 'lib.php';" },
      { rel: 'lib.php', content: '<?php function f() {}' },
    ])).toEqual([{ from: 'app.php', to: 'lib.php' }])
    expect(edges([
      { rel: 'src/app.php', content: "<?php require __DIR__ . '/helpers.php';" },
      { rel: 'src/helpers.php', content: '<?php' },
    ])).toEqual([{ from: 'src/app.php', to: 'src/helpers.php' }])
  })

  it('внешняя библиотека ребром не становится — ни в одном языке', () => {
    expect(edges([
      { rel: 'main.py', content: 'import os\nimport numpy as np\nfrom django.db import models' },
      { rel: 'util.py', content: 'x = 1' },
    ])).toEqual([])
  })

  it('файл незнакомого языка не роняет разбор — просто нет рёбер', () => {
    // Haskell пакета не имеет, Swift исключён сознательно (`import Foo` называет
    // модуль сборки, а не файл) — оба обязаны молчать, а не падать
    expect(edges([
      { rel: 'Main.hs', content: 'import Util' },
      { rel: 'Util.hs', content: 'f = 1' },
      { rel: 'App.swift', content: 'import Core' },
      { rel: 'Core.swift', content: 'struct Core {}' },
    ])).toEqual([])
  })
})

describe('граф импортов: языки за пределами JS/PY/PHP', () => {
  const edges = (files: Array<{ rel: string; content: string }>) => buildEdges(files).edges

  it('go: пакет — это каталог, ребро идёт ко всем его файлам', () => {
    const e = edges([
      { rel: 'cmd/app/main.go', content: 'package main\n\nimport (\n\t"fmt"\n\t"example.com/svc/internal/store"\n)' },
      { rel: 'internal/store/store.go', content: 'package store' },
      { rel: 'internal/store/query.go', content: 'package store' },
    ])
    expect(e).toEqual([
      { from: 'cmd/app/main.go', to: 'internal/store/store.go' },
      { from: 'cmd/app/main.go', to: 'internal/store/query.go' },
    ])
  })

  it('go: стандартная библиотека рёбер не даёт', () => {
    expect(edges([
      { rel: 'main.go', content: 'package main\nimport "net/http"' },
      { rel: 'util.go', content: 'package main' },
    ])).toEqual([])
  })

  it('java: импорт разрешается по ОБЪЯВЛЕННОМУ пакету, а не по имени файла', () => {
    const e = edges([
      { rel: 'src/main/java/com/app/Main.java', content: 'package com.app;\nimport com.app.util.Fmt;\nimport java.util.List;' },
      { rel: 'src/main/java/com/app/util/Fmt.java', content: 'package com.app.util;\npublic class Fmt {}' },
      // Ловушка: свой класс с именем из стандартной библиотеки. Пакет он объявляет
      // другой, значит java.util.List — не он, и ребра быть не должно
      { rel: 'src/main/java/com/app/List.java', content: 'package com.app;\npublic class List {}' },
    ])
    expect(e).toEqual([{ from: 'src/main/java/com/app/Main.java', to: 'src/main/java/com/app/util/Fmt.java' }])
  })

  it('kotlin: тот же пакетный механизм', () => {
    expect(edges([
      { rel: 'app/Main.kt', content: 'package app\nimport app.data.Repo' },
      { rel: 'app/data/Repo.kt', content: 'package app.data\nclass Repo' },
    ])).toEqual([{ from: 'app/Main.kt', to: 'app/data/Repo.kt' }])
  })

  it('c#: using — зависимость от пространства целиком', () => {
    const e = edges([
      { rel: 'Api/Controller.cs', content: 'using App.Models;\nnamespace App.Api;' },
      { rel: 'Models/User.cs', content: 'namespace App.Models { class User {} }' },
      { rel: 'Models/Order.cs', content: 'namespace App.Models { class Order {} }' },
    ])
    expect(e.map((x) => x.to).sort()).toEqual(['Models/Order.cs', 'Models/User.cs'])
  })

  it('c#: using System рёбер не даёт — такого пространства проект не объявлял', () => {
    expect(edges([
      { rel: 'A.cs', content: 'using System;\nusing System.Linq;\nnamespace App;' },
      { rel: 'B.cs', content: 'namespace App;' },
    ])).toEqual([])
  })

  it('php: use по объявленному namespace (PSR-4 без чтения composer.json)', () => {
    const e = edges([
      { rel: 'src/Controller/Home.php', content: '<?php\nnamespace App\\Controller;\nuse App\\Service\\Mailer;' },
      { rel: 'src/Service/Mailer.php', content: '<?php\nnamespace App\\Service;\nclass Mailer {}' },
    ])
    expect(e).toEqual([{ from: 'src/Controller/Home.php', to: 'src/Service/Mailer.php' }])
  })

  it('php: две копии одной библиотеки — побеждает ближайшая по дереву', () => {
    const e = edges([
      { rel: 'plugins/a/lib/Aws/S3/S3Client.php', content: '<?php\nnamespace Aws\\S3;\nuse Aws\\AwsClient;' },
      { rel: 'plugins/a/lib/Aws/AwsClient.php', content: '<?php\nnamespace Aws;\nclass AwsClient {}' },
      { rel: 'plugins/b/lib/Aws/AwsClient.php', content: '<?php\nnamespace Aws;\nclass AwsClient {}' },
    ])
    expect(e).toEqual([{ from: 'plugins/a/lib/Aws/S3/S3Client.php', to: 'plugins/a/lib/Aws/AwsClient.php' }])
  })

  it('php: require с константой-префиксом — путь берётся последним литералом', () => {
    expect(edges([
      { rel: 'wp-settings.php', content: "<?php require_once ABSPATH . 'wp-includes/load.php';" },
      { rel: 'wp-includes/load.php', content: '<?php' },
    ])).toEqual([{ from: 'wp-settings.php', to: 'wp-includes/load.php' }])
  })

  it('rust: mod — сосед, use crate — от корня ящика', () => {
    const e = edges([
      { rel: 'src/main.rs', content: 'mod util;\nuse crate::store::db::open;' },
      { rel: 'src/util.rs', content: 'pub fn f() {}' },
      { rel: 'src/store/db.rs', content: 'pub fn open() {}' },
    ])
    expect(e.map((x) => x.to).sort()).toEqual(['src/store/db.rs', 'src/util.rs'])
  })

  it('ruby: require_relative', () => {
    expect(edges([
      { rel: 'lib/app.rb', content: "require_relative 'store'" },
      { rel: 'lib/store.rb', content: 'class Store; end' },
    ])).toEqual([{ from: 'lib/app.rb', to: 'lib/store.rb' }])
  })

  it('c/c++: только кавычки, системные заголовки не в счёт', () => {
    expect(edges([
      { rel: 'src/main.c', content: '#include <stdio.h>\n#include "util.h"' },
      { rel: 'src/util.h', content: 'void f(void);' },
    ])).toEqual([{ from: 'src/main.c', to: 'src/util.h' }])
  })

  it('js: алиас сборщика, уводящий выше корня исходников (@/../config)', () => {
    expect(edges([
      { rel: 'app/pages/index.vue', content: "<script setup>\nimport { langs } from '@/../config/languages'\n</script>" },
      { rel: 'config/languages.ts', content: 'export const langs = []' },
    ])).toEqual([{ from: 'app/pages/index.vue', to: 'config/languages.ts' }])
  })

  it('js: пакет из node_modules ребром не становится даже при совпадении имени', () => {
    expect(edges([
      { rel: 'src/a.ts', content: "import x from 'chalk'\nimport y from 'lodash/merge'" },
      { rel: 'chalk.ts', content: 'export default 1' },
      { rel: 'merge.ts', content: 'export default 1' },
    ])).toEqual([])
  })

  it('сосед по каталогу ближе вложенного — общий префикс у них одинаков', () => {
    // Найдено замером на WordPress: три копии functions.php в одном пакете,
    // и `require __DIR__ . '/functions.php'` обязан выбрать соседа, а не Psr7/
    expect(edges([
      { rel: 'lib/Guzzle/functions_include.php', content: "<?php require __DIR__ . '/functions.php';" },
      { rel: 'lib/Guzzle/functions.php', content: '<?php' },
      { rel: 'lib/Guzzle/Psr7/functions.php', content: '<?php' },
      { rel: 'lib/Guzzle/Promise/functions.php', content: '<?php' },
    ])).toEqual([{ from: 'lib/Guzzle/functions_include.php', to: 'lib/Guzzle/functions.php' }])
  })

  it('закомментированный импорт зависимостью не считается', () => {
    expect(edges([
      { rel: 'src/index.js', content: "// import Err from './components/Err.vue'\n/* require('./dead.js') */" },
      { rel: 'src/components/Err.vue', content: '<template/>' },
      { rel: 'src/dead.js', content: 'export default 1' },
      // phpdoc, где слово include стоит в прозе — тоже не зависимость
      { rel: 'app.php', content: "<?php\n/**\n * Values include 'plugin', 'theme'.\n */" },
      { rel: 'plugin.php', content: '<?php' },
    ])).toEqual([])
  })

  it('односегментный импорт без корня — чужая библиотека, а не файл проекта', () => {
    // Найдено на боевом проекте с виртуальным окружением: `import subprocess`
    // уводило в pip/_internal/utils/subprocess.py — совпадение имени, не связь
    expect(edges([
      { rel: 'app/main.py', content: 'import subprocess\nimport json' },
      { rel: 'lib/utils/subprocess.py', content: 'def run(): pass' },
      { rel: 'lib/json.py', content: 'def loads(): pass' },
    ])).toEqual([])
    expect(edges([
      { rel: 'cmd/main.go', content: 'package main\nimport "fmt"' },
      { rel: 'internal/fmt/fmt.go', content: 'package fmt' },
    ])).toEqual([])
    // Рядом с собой — по-прежнему связь: тут корень известен (свой каталог)
    expect(edges([
      { rel: 'app/main.py', content: 'import helper' },
      { rel: 'app/helper.py', content: 'def f(): pass' },
    ])).toEqual([{ from: 'app/main.py', to: 'app/helper.py' }])
  })

  it('неоднозначность молчит: две одинаково близкие цели — ребра нет', () => {
    expect(edges([
      { rel: 'a/x/main.go', content: 'package main\nimport "svc/store"' },
      { rel: 'b/store/s.go', content: 'package store' },
      { rel: 'c/store/s.go', content: 'package store' },
    ])).toEqual([])
  })
})
