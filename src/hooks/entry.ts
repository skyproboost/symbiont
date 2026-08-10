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

/** Минимум общих файлов, чтобы прошлая сессия считалась прецедентом текущей работы: один общий файл — совпадение, не рецепт. */
const PRECEDENT_MIN_OVERLAP = 2
/** Сколько прошлых нитей просматривается: дальше по времени рецепт устаревает быстрее, чем находится. */
const PRECEDENT_LOOKBACK = 40

/**
 * Прецедент похожей работы — процедурная память без LLM: если сид текущей
 * работы заметно пересекается с нитью ПРОШЛОЙ сессии (не последней — та уже
 * показана строкой нити), её файловый рецепт и итоговый коммит дешевле
 * поднять из журнала, чем переоткрывать разведкой. Совпадение — по файлам
 * (≥PRECEDENT_MIN_OVERLAP общих), при равенстве побеждает более свежая.
 * Коммиты — untrusted-текст: бэктики вычищаются, длина ограничена.
 */
export function findPrecedent(db: Database, work: string[], lastThread: string[], nowMs: number): string {
  try {
    if (!tableExists(db, 'session_threads')) return ''
    const cols = (db.query('PRAGMA table_info(session_threads)').all() as Array<{ name: string }>).map((c) => c.name)
    if (!cols.includes('commits')) return '' // старой схеме нечем назвать работу — прецедент без итога не подаём
    const rows = db
      .query('SELECT files, commits, updated_at FROM session_threads ORDER BY updated_at DESC LIMIT ?')
      .all(PRECEDENT_LOOKBACK) as Array<{ files: string; commits: string; updated_at: string }>
    const workSet = new Set(work)
    const lastKey = JSON.stringify(lastThread)
    let best: { files: string[]; commits: string[]; ageDays: number; overlap: number } | null = null
    // Устойчивость рецепта (мотив Agent Workflow Memory): один прецедент —
    // совпадение, несколько — выученная процедура проекта, и об этом стоит
    // сказать отдельно
    let recurrences = 0
    for (const r of rows) {
      let files: string[]
      let commits: string[]
      try {
        files = JSON.parse(r.files) as string[]
        commits = JSON.parse(r.commits) as string[]
      } catch {
        continue // битая строка журнала — не основание молчать обо всех
      }
      if (JSON.stringify(files) === lastKey) continue // это и есть показанная нить
      const overlap = files.filter((f) => workSet.has(f)).length
      if (overlap < PRECEDENT_MIN_OVERLAP) continue
      recurrences++
      // Строки отсортированы по свежести: первый достаточный прецедент и есть
      // лучший при равном пересечении; больший overlap побеждает свежесть
      if (best === null || overlap > best.overlap) {
        best = { files, commits, ageDays: Math.max(0, Math.round((nowMs - Date.parse(r.updated_at)) / 86_400_000)), overlap }
      }
    }
    if (best === null) return ''
    const shownFiles = best.files.slice(0, 5).join(', ') + (best.files.length > 5 ? ', …' : '')
    const outcome = best.commits.length > 0 ? ` → "${best.commits[best.commits.length - 1].replace(/`/g, "'").slice(0, 90)}"` : ''
    const age = best.ageDays < 1 ? t('сегодня', 'today') : t(`${best.ageDays}д назад`, `${best.ageDays}d ago`)
    const stability = recurrences >= 2 ? t(` · рецепт устойчив (похожих сессий: ${recurrences})`, ` · the recipe is stable (${recurrences} similar sessions)`) : ''
    return t(
      `- похожая работа уже делалась (${age}): затронула ${shownFiles}${outcome} — рецепт, с которым стоит свериться${stability}`,
      `- similar work was already done (${age}): it touched ${shownFiles}${outcome} — a recipe worth checking against${stability}`,
    )
  } catch {
    return '' // прецедент — обогащение входа, не обязанность
  }
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
    const precedent = findPrecedent(db, work, thread, nowMs)
    if (precedent) lines.push(precedent)
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
