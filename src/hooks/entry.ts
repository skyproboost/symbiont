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
import { t } from '../core/i18n'

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
    // Имя параметра НЕ `t`: в этом файле так зовётся перевод строки, и тень над
    // ним ниже по функции читалась бы как вызов и молча вернула бы поле объекта.
    const related = taskRelevantNeighbors(nodes, edges, seeds, neighborhood, 4).map((n) => n.file)

    const lines = [t('## Вход в работу (что было в работе до этого сообщения)', '## Picking up the work (what was in progress before this message)'), '']
    lines.push(
      t(
        `- над чем шла работа: ${work.slice(0, 6).join(', ')}${work.length > 6 ? ', …' : ''}`,
        `- what was being worked on: ${work.slice(0, 6).join(', ')}${work.length > 6 ? ', …' : ''}`,
      ),
    )
    if (related.length > 0) {
      lines.push(
        t(
          `- рядом по связям проекта (не названо, но связано): ${related.join(', ')}`,
          `- nearby through the project's links (not named, but connected): ${related.join(', ')}`,
        ),
      )
    }
    lines.push(
      t(
        '- «продолжи» ложи на это состояние, а не на букву промпта: восстанови намерение, сверь с git-диффом и нитью, затем действуй',
        '- read "carry on" against this state, not against the letter of the prompt: reconstruct the intent, check it against the git diff and the thread, then act',
      ),
    )
    return lines.join('\n')
  } catch {
    return '' // fail-open: реконструкция — обогащение, не обязанность
  }
}
