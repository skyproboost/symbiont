/**
 * Протокол самостарта (CONCEPT §4.2): промпт пользователя — сид, а не карта.
 * «Продолжи вчерашний файл» не исполняется вслепую — сначала реконструируется
 * СОСТОЯНИЕ работы: над чем шла работа (нить прошлой сессии + незакоммиченное) и
 * её граф-окружение (персонализированный PageRank от этого сида — что ЕЩЁ
 * относится к задаче, чего в промпте нет). Модель входит с полным пониманием.
 *
 * Чистая логика над graph_edges/graph_nodes/node_heat (тестируется с БД в памяти),
 * fail-open: нет графа/сида — пустая строка, сводка без блока.
 */
import type { Database } from '../core/db'
import { taskRelevantNeighbors, reachableUndirected, type Edge, type SeedWeight } from '../graph/graph'
import { readHeatRows, effectiveHeat, hotFiles } from '../graph/heat'

function tableExists(db: Database, name: string): boolean {
  return (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name) as { n: number }).n > 0
}

/**
 * Блок «Вход в работу» для сводки SessionStart. thread — файлы прошлой сессии,
 * dirty — незакоммиченные сейчас. Сид PPR: работа ×50, недавно тронутое ×10.
 * Возвращает '' если реконструировать нечего (нет сигнала непрерывности или графа).
 */
export function reconstructEntry(db: Database, thread: string[], dirty: string[], nowMs: number): string {
  try {
    if (!tableExists(db, 'graph_nodes') || !tableExists(db, 'graph_edges')) return ''
    const nodes = (db.query('SELECT file FROM graph_nodes').all() as Array<{ file: string }>).map((r) => r.file)
    if (nodes.length === 0) return ''
    const nodeSet = new Set(nodes)

    // Сид работы = нить + незакоммиченное + недавно горячее: на границе сессии
    // всё это ОДИНАКОВО «над чем шла работа» (тепло здесь не второй тир, как в JIT,
    // а полноправный сигнал недавней работы). Только узлы графа.
    const heat = effectiveHeat(readHeatRows(db), nowMs)
    const hot = hotFiles(heat, 0.5, 3)
    const work = [...new Set([...thread, ...dirty, ...hot])].filter((f) => nodeSet.has(f))
    if (work.length === 0) return '' // нечего реконструировать — молчим

    const seeds: SeedWeight[] = work.map((f) => ({ file: f, weight: 50 }))
    const seedSet = new Set(seeds.map((s) => s.file))
    const edges = (db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>).map(
      (e) => ({ from: e.from_file, to: e.to_file }) as Edge,
    )
    if (edges.length === 0) return ''

    const neighborhood = reachableUndirected(edges, seedSet, 2)
    const related = taskRelevantNeighbors(nodes, edges, seeds, neighborhood, 4).map((t) => t.file)

    const lines = ['## Вход в работу (что было в работе до этого сообщения)', '']
    lines.push(`- над чем шла работа: ${work.slice(0, 6).join(', ')}${work.length > 6 ? ', …' : ''}`)
    if (related.length > 0) lines.push(`- рядом по связям проекта (не названо, но связано): ${related.join(', ')}`)
    lines.push('- «продолжи» ложи на это состояние, а не на букву промпта: восстанови намерение, сверь с git-диффом и нитью, затем действуй')
    return lines.join('\n')
  } catch {
    return '' // fail-open: реконструкция — обогащение, не обязанность
  }
}
