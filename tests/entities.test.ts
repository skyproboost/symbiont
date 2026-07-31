import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractContentLinks,
  buildResolveIndex,
  resolveContentTarget,
  buildEntityGraph,
  renderEntityBlock,
} from '../src/graph/entities'
import { buildPassport } from '../src/passport/build'
import { callTool } from '../src/mcp/handlers'

describe('extractContentLinks', () => {
  it('markdown: inline, wiki, reference-определения, инлайновый html', () => {
    const md = `
# Заголовок
Смотри [Статью A](a.md) и [хаб](./hub/index.md "подсказка").
Картинка не ссылка: ![альт](pic.png)
Вики: [[b]] и [[c|видимый текст]] и [[d#секция]]
Ссылка-референс [текст][ref1]

[ref1]: guides/setup.md
<a href="/faq">Вопросы</a>
Самостраничный якорь [тут](#anchor) не считается.
`
    const links = extractContentLinks('.md', md)
    const targets = links.map((l) => l.target)
    expect(targets).toContain('a.md')
    expect(targets).toContain('./hub/index.md')
    expect(targets).toContain('b')
    expect(targets).toContain('c')
    expect(targets).toContain('d')
    expect(targets).toContain('guides/setup.md')
    expect(targets).toContain('/faq')
    expect(targets).not.toContain('pic.png')
    expect(targets).not.toContain('#anchor')
    // анкоры нормализованы: нижний регистр, схлопнутые пробелы
    expect(links.find((l) => l.target === 'a.md')?.anchor).toBe('статью a')
    expect(links.find((l) => l.target === 'c')?.anchor).toBe('видимый текст')
  })

  it('markdown: картинка в начале строки и файла не матчится', () => {
    const links = extractContentLinks('.md', '![лого](logo.svg)\n![ещё](x.png)')
    expect(links).toEqual([])
  })

  it('html: href двойные/одинарные кавычки, чистый якорь отброшен', () => {
    const html = `<nav><a href="/a">Один</a><a href='b.html'>Два</a><a href="#top">Верх</a></nav>`
    const links = extractContentLinks('.html', html)
    expect(links.map((l) => l.target)).toEqual(['/a', 'b.html'])
    expect(links[0].anchor).toBe('один')
  })

  it('yaml с встроенным markdown (frontmatter-CMS: Nuxt Content/Astro/Hugo)', () => {
    // Реальная форма лабрида: перелинковка живёт как markdown внутри content:/summary:
    const yaml = `
slug: acute-kidney-injury
ru:
  summary: |
    - Ключевые анализы — [креатинин](/indicators/creatinine) и [мочевина](/indicators/urea).
  content: |
    В отличие от [хронической болезни почек](/posts/chronic-kidney-disease), ОПП — острое.
pages:
  - content/related.md
`
    const links = extractContentLinks('.yaml', yaml)
    const explicit = links.filter((l) => l.explicit).map((l) => l.target)
    expect(explicit).toContain('/indicators/creatinine')
    expect(explicit).toContain('/indicators/urea')
    expect(explicit).toContain('/posts/chronic-kidney-disease')
    // структурный yaml-путь — мягкая ссылка
    const soft = links.filter((l) => !l.explicit).map((l) => l.target)
    expect(soft).toContain('content/related.md')
    // анкор явной ссылки сохранён (для детекции размытых анкоров по всему корпусу)
    expect(links.find((l) => l.target === '/indicators/creatinine')?.anchor).toBe('креатинин')
  })

  it('yaml: только путеподобные значения, прозу и значения с пробелами не берёт', () => {
    const yaml = `
title: Статья о вирусе
url: /hpv/faq
pages:
  - content/a.md
  - "content/b.md"
note: обычный текст без пути
site: https://example.com/page
`
    const links = extractContentLinks('.yaml', yaml)
    const targets = links.map((l) => l.target)
    expect(targets).toContain('/hpv/faq')
    expect(targets).toContain('content/a.md')
    expect(targets).toContain('content/b.md')
    expect(targets).toContain('https://example.com/page') // внешняя — отсеется на резолве
    expect(targets).not.toContain('Статья о вирусе')
    expect(targets).not.toContain('обычный текст без пути')
  })
})

describe('resolveContentTarget', () => {
  const index = buildResolveIndex([
    'content/a.md',
    'content/hub/index.md',
    'content/hpv/faq.md',
    'pages/pricing.html',
    'B.md',
  ])

  it('относительные с достройкой расширения и без ./', () => {
    expect(resolveContentTarget('content/x.md', 'a.md', index)).toEqual({ kind: 'entity', rel: 'content/a.md' })
    expect(resolveContentTarget('content/x.md', './a', index)).toEqual({ kind: 'entity', rel: 'content/a.md' })
    expect(resolveContentTarget('content/hpv/faq.md', '../a.md', index)).toEqual({ kind: 'entity', rel: 'content/a.md' })
  })

  it('каталог резолвится в index', () => {
    expect(resolveContentTarget('content/a.md', 'hub', index)).toEqual({ kind: 'entity', rel: 'content/hub/index.md' })
    expect(resolveContentTarget('content/a.md', 'hub/', index)).toEqual({ kind: 'entity', rel: 'content/hub/index.md' })
  })

  it('абсолютный роут сайта матчится по суффиксу пути (граница на «/»)', () => {
    expect(resolveContentTarget('B.md', '/hpv/faq', index)).toEqual({ kind: 'entity', rel: 'content/hpv/faq.md' })
    expect(resolveContentTarget('B.md', '/pricing', index)).toEqual({ kind: 'entity', rel: 'pages/pricing.html' })
    // «faq» без пути — тоже слаг (yaml-ссылки)
    expect(resolveContentTarget('B.md', 'hpv/faq', index)).toEqual({ kind: 'entity', rel: 'content/hpv/faq.md' })
  })

  it('регистр прощается (Windows-first), якоря и query отрезаются', () => {
    expect(resolveContentTarget('content/a.md', '../b.MD#sec?x=1', index)).toEqual({ kind: 'entity', rel: 'B.md' })
  })

  it('внешние: протоколы и протокол-относительные', () => {
    expect(resolveContentTarget('B.md', 'https://ex.com/a.md', index)).toEqual({ kind: 'external' })
    expect(resolveContentTarget('B.md', 'mailto:x@y.z', index)).toEqual({ kind: 'external' })
    expect(resolveContentTarget('B.md', '//cdn.ex.com/lib.md', index)).toEqual({ kind: 'external' })
  })

  it('битое — только контентное расширение; бесхвостый роут — unresolved (не шумим)', () => {
    expect(resolveContentTarget('B.md', 'missing.md', index)).toEqual({ kind: 'broken' })
    expect(resolveContentTarget('B.md', '/no/such/page.html', index)).toEqual({ kind: 'broken' })
    expect(resolveContentTarget('B.md', '/api/generated-route', index)).toEqual({ kind: 'unresolved' })
    expect(resolveContentTarget('B.md', 'style.css', index)).toEqual({ kind: 'unresolved' })
  })
})

describe('buildEntityGraph', () => {
  const files = [
    {
      rel: 'content/index.md',
      ext: '.md',
      content: '- [Статья A](a.md)\n- [Статья B](b.md)\n- [тут](c.md)\n- [Статья D](d.md)\n- [Статья E](e.md)\n',
    },
    { rel: 'content/a.md', ext: '.md', content: 'Вики-ссылка на [[b]].' },
    { rel: 'content/b.md', ext: '.md', content: '[тут](a.md)\n[дальше](missing.md)\n' },
    { rel: 'content/c.md', ext: '.md', content: 'Лист.' },
    { rel: 'content/d.md', ext: '.md', content: 'Лист.' },
    { rel: 'content/e.md', ext: '.md', content: 'Лист.' },
    { rel: 'content/orphan.md', ext: '.md', content: 'Никто не ссылается.' },
    { rel: 'content/loop1.md', ext: '.md', content: '[цикл](loop2.md)' },
    { rel: 'content/loop2.md', ext: '.md', content: '[цикл](loop1.md)' },
    { rel: 'page.html', ext: '.html', content: '<a href="/content/b">B</a>' },
    { rel: 'data/things.yaml', ext: '.yaml', content: 'main: content/a.md\nghost: content/ghost.md\n' },
  ]
  const g = buildEntityGraph(files)

  it('рёбра из всех видов источников (md, wiki, html, yaml), самоссылки исключены', () => {
    const pairs = g.edges.map((e) => `${e.from}>${e.to}`)
    expect(pairs).toContain('content/index.md>content/a.md')
    expect(pairs).toContain('content/a.md>content/b.md') // wiki
    expect(pairs).toContain('page.html>content/b.md') // абсолютный роут из html
    expect(pairs).toContain('data/things.yaml>content/a.md') // yaml-значение
  })

  it('хаб по out-степени и по имени index; глубина BFS от хабов', () => {
    expect(g.hubs).toContain('content/index.md')
    const depth = new Map(g.nodes.map((n) => [n.file, n.depth]))
    expect(depth.get('content/index.md')).toBe(0)
    expect(depth.get('content/a.md')).toBe(1)
    expect(depth.get('content/c.md')).toBe(1)
    expect(depth.get('content/orphan.md')).toBe(null)
  })

  it('сироты (0 входящих), недостижимые из хабов — раздельно', () => {
    expect(g.orphans).toContain('content/orphan.md')
    expect(g.orphans).toContain('page.html')
    expect(g.orphans).toContain('data/things.yaml')
    // цикл связан внутри себя, но вне хабового дерева — недостижим, не сирота
    expect(g.unreachable).toEqual(['content/loop1.md', 'content/loop2.md'])
    expect(g.orphans).not.toContain('content/loop1.md')
  })

  it('битые внутренние — только явные ссылки; мягкие yaml-значения не битые', () => {
    expect(g.broken).toEqual([{ from: 'content/b.md', target: 'missing.md' }])
    // content/ghost.md отсутствует, но это yaml-скаляр (мягкая ссылка) → не битое
    expect(g.broken.some((b) => b.target.includes('ghost'))).toBe(false)
  })

  it('дубли анкоров: один текст → разные цели', () => {
    const dup = g.dupAnchors.find((d) => d.anchor === 'тут')
    expect(dup?.targets).toEqual(['content/a.md', 'content/c.md'])
  })

  it('степени по различным партнёрам', () => {
    const b = g.nodes.find((n) => n.file === 'content/b.md')
    expect(b?.inDeg).toBe(3) // index, a (wiki), page.html
    const a = g.nodes.find((n) => n.file === 'content/a.md')
    expect(a?.inDeg).toBe(3) // index, b, things.yaml
  })

  it('пустой мир и мир без ссылок не падают и молчат', () => {
    const empty = buildEntityGraph([])
    expect(empty.nodes).toEqual([])
    expect(renderEntityBlock(empty)).toBe('')
    const silent = buildEntityGraph([{ rel: 'a.md', ext: '.md', content: 'текст' }])
    expect(silent.hubs).toEqual([])
    expect(silent.unreachable).toEqual([]) // без хабов недостижимость не считается
    expect(renderEntityBlock(silent)).toBe('')
  })

  it('блок сводки: счётчики и проблемы одной строкой', () => {
    const block = renderEntityBlock(g)
    expect(block).toContain('Контент-граф')
    expect(block).toContain(`сущностей: ${g.nodes.length}`)
    expect(block).toContain('сироты (0 входящих): 3')
    expect(block).toContain('битые внутренние ссылки: 1')
  })
})

describe('интеграция: контент-граф в паспорте и MCP', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-entities-proj-'))
  mkdirSync(join(proj, 'content'), { recursive: true })
  writeFileSync(
    join(proj, 'content', 'index.md'),
    '- [Статья A](a.md)\n- [Статья B](b.md)\n- [C](c.md)\n- [D](d.md)\n- [E](e.md)\n',
  )
  writeFileSync(join(proj, 'content', 'a.md'), 'Ссылка на [B](b.md).')
  writeFileSync(join(proj, 'content', 'b.md'), '[битая](missing.md)')
  writeFileSync(join(proj, 'content', 'c.md'), 'Лист.')
  writeFileSync(join(proj, 'content', 'd.md'), 'Лист.')
  writeFileSync(join(proj, 'content', 'e.md'), 'Лист.')
  writeFileSync(join(proj, 'content', 'orphan.md'), 'Сирота.')
  writeFileSync(join(proj, 'content', 'empty.md'), '') // пустой файл — узел, не битая цель
  writeFileSync(join(proj, 'content', 'f.md'), '[пустой](empty.md)')
  const data = mkdtempSync(join(tmpdir(), 'symbiont-entities-data-'))

  it('buildPassport: таблицы записаны, сводка содержит «Контент-граф»', () => {
    const r = buildPassport(proj, data)
    expect(readFileSync(r.summaryPath, 'utf8')).toContain('Контент-граф')
  })

  it('ссылка на пустой файл НЕ битая (файл существует)', () => {
    const text = callTool('passport_orphans', {}, data)
    expect(text).not.toContain('empty.md →')
    expect(text).toContain('content/b.md → missing.md')
  })

  it('passport_orphans: сироты и битые', () => {
    const text = callTool('passport_orphans', {}, data)
    expect(text).toContain('Сироты')
    expect(text).toContain('content/orphan.md')
    expect(text).toContain('Битые внутренние ссылки — 1:')
  })

  it('passport_reach: хабы, распределение глубины, недостижимые', () => {
    const text = callTool('passport_reach', {}, data)
    expect(text).toContain('content/index.md')
    expect(text).toContain('Глубина от хабов')
    expect(text).toMatch(/0:1/) // один хаб на глубине 0
  })

  it('passport_reach по файлу: глубина, входящие, исходящие', () => {
    const text = callTool('passport_reach', { file: 'b.md' }, data)
    expect(text).toContain('content/b.md')
    expect(text).toContain('глубина от хаба: 1')
    expect(text).toContain('content/index.md')
    expect(text).toContain('content/a.md')
  })

  it('cleanup', () => {
    rmrf(proj)
    rmrf(data)
    expect(true).toBe(true)
  })
})
