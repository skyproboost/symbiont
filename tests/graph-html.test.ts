/**
 * Интерактивная карта: самодостаточность (ни одного внешнего запроса),
 * приватность (в файл не утекает код проекта) и валидность генерируемой страницы.
 */
import { describe, expect, it } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { collectGraphData, renderGraphHtml } from '../src/cli/graph-html'

const seed = (): Database => {
  const db = openDb(':memory:')
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  db.run('CREATE TABLE graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL)')
  db.run('CREATE TABLE node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)')
  db.run('CREATE TABLE node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)')
  db.run("INSERT INTO graph_nodes VALUES('src/core/store.ts',0.09,25,3), ('src/core/ratings.ts',0.04,1,1), ('app/page.vue',0.02,0,2)")
  db.run("INSERT INTO graph_edges VALUES('src/core/store.ts','src/core/ratings.ts'), ('app/page.vue','src/core/store.ts')")
  db.run("INSERT INTO node_heat VALUES('src/core/store.ts',2.5,'2026-07-30T10:00:00Z')")
  db.run("INSERT INTO node_summary VALUES('src/core/store.ts','журнал фактов паспорта','h','haiku','2026-07-30T10:00:00Z')")
  return db
}

describe('collectGraphData', () => {
  it('собирает узлы, связи, зоны, тепло и роли из проекций', () => {
    const db = seed()
    const d = collectGraphData(db, 'proj', { 'узлов в графе': '3' })
    expect(d.nodes.length).toBe(3)
    expect(d.edges.length).toBe(2)
    expect(d.nodes[0].file).toBe('src/core/store.ts') // по убыванию важности
    expect(d.nodes[0].zone).toBe('src/core')
    expect(d.nodes[0].heat).toBe(2.5)
    expect(d.nodes[0].role).toContain('журнал фактов')
    db.close()
  })

  it('рёбра ссылаются на индексы существующих узлов, петли отброшены', () => {
    const db = seed()
    db.run("INSERT INTO graph_edges VALUES('src/core/store.ts','src/core/store.ts'), ('нет-такого.ts','app/page.vue')")
    const d = collectGraphData(db, 'proj', {})
    for (const e of d.edges) {
      expect(e[0]).toBeGreaterThanOrEqual(0)
      expect(e[1]).toBeLessThan(d.nodes.length)
      expect(e[0]).not.toBe(e[1]) // самопетля не рисуется
    }
    expect(d.edges.length).toBe(2) // добавленные мусорные не попали
    db.close()
  })

  it('нет тепла и ролей — не падает, просто пусто', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
    db.run("INSERT INTO graph_nodes VALUES('a.ts',0.5,0,0)")
    const d = collectGraphData(db, 'proj', {})
    expect(d.nodes[0].heat).toBe(0)
    expect(d.nodes[0].role).toBeNull()
    expect(d.edges).toEqual([])
    db.close()
  })
})

describe('renderGraphHtml', () => {
  it('НИ ОДНОГО внешнего запроса — работает по file:// и офлайн', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, 'proj', {}))
    expect(html).not.toMatch(/src="https?:\/\//)
    expect(html).not.toMatch(/href="https?:\/\//)
    expect(html).not.toContain('@import')
    expect(html).not.toContain('fetch(')
    expect(html).not.toContain('XMLHttpRequest')
    db.close()
  })

  it('приватность: в файл уходят пути и связи, но не код проекта', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, 'proj', {}))
    expect(html).toContain('src/core/store.ts')
    expect(html).toContain('журнал фактов паспорта')
    // из проекций код и не читается — фиксируем это как инвариант
    const payload = html.slice(html.indexOf('const DATA = '), html.indexOf('const cv'))
    expect(payload).not.toContain('export ')
    expect(payload).not.toContain('function ')
    db.close()
  })

  it('встроенный скрипт синтаксически валиден', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, 'proj', {}))
    const js = html.split('<script>')[1].split('</script>')[0]
    expect(() => new Function('document', 'window', 'requestAnimationFrame', js)).not.toThrow()
    db.close()
  })

  it('теги сбалансированы, заголовок несёт имя проекта', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, 'мой-проект', {}))
    expect(html).toContain('<title>Symbiont · карта проекта «мой-проект»</title>')
    for (const tag of ['html', 'head', 'body', 'style', 'script', 'aside']) {
      const open = (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
      expect(open).toBe(close)
    }
    db.close()
  })

  it('имя проекта экранируется — разметка не ломается', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, '<script>alert(1)</script>', {}))
    expect(html).not.toContain('<title>Symbiont · карта проекта «<script>')
    expect(html).toContain('&lt;script&gt;')
    db.close()
  })

  it('статистика попадает в панель', () => {
    const db = seed()
    const html = renderGraphHtml(collectGraphData(db, 'proj', { 'фактов живо': '42' }))
    expect(html).toContain('фактов живо')
    expect(html).toContain('42')
    db.close()
  })
})

describe('рёбра «настройка управляет кодом»', () => {
  it('конфиг попадает на карту отдельным узлом и связывается с кодом', () => {
    const db = seed()
    db.run('CREATE TABLE config_edges(config_file TEXT, code_file TEXT, via TEXT, config_key TEXT, token TEXT)')
    db.run("INSERT INTO config_edges VALUES('nuxt.config.ts','src/core/store.ts','история','(файл целиком)',NULL)")
    const d = collectGraphData(db, 'proj', {})
    const cfg = d.nodes.find((n) => n.file === 'nuxt.config.ts')
    expect(cfg).toBeDefined()
    expect(cfg!.isConfig).toBe(true)
    expect(d.configEdges.length).toBe(1)
    // ребро указывает на существующие индексы
    expect(d.nodes[d.configEdges[0][0]].file).toBe('nuxt.config.ts')
    expect(d.nodes[d.configEdges[0][1]].file).toBe('src/core/store.ts')
    db.close()
  })

  it('связь с кодом вне карты не рисуется — узел был бы висячим', () => {
    const db = seed()
    db.run('CREATE TABLE config_edges(config_file TEXT, code_file TEXT, via TEXT, config_key TEXT, token TEXT)')
    db.run("INSERT INTO config_edges VALUES('nuxt.config.ts','нет/такого.ts','лексика','k','t')")
    const d = collectGraphData(db, 'proj', {})
    expect(d.configEdges.length).toBe(0)
    expect(d.nodes.some((n) => n.file === 'nuxt.config.ts')).toBe(false)
    db.close()
  })

  it('таблицы связей нет — карта строится без неё', () => {
    const db = seed()
    const d = collectGraphData(db, 'proj', {})
    expect(d.configEdges).toEqual([])
    db.close()
  })

  it('в странице есть пунктирная отрисовка и легенда управления', () => {
    const db = seed()
    db.run('CREATE TABLE config_edges(config_file TEXT, code_file TEXT, via TEXT, config_key TEXT, token TEXT)')
    db.run("INSERT INTO config_edges VALUES('nuxt.config.ts','src/core/store.ts','история','(файл целиком)',NULL)")
    const html = renderGraphHtml(collectGraphData(db, 'proj', {}))
    expect(html).toContain('setLineDash')
    expect(html).toContain('настройка управляет кодом')
    expect(html).toContain('управляет этим кодом')
    db.close()
  })
})
