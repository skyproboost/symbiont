/**
 * Срез узла графа для каналов подачи (JIT и PostToolUse).
 * Общий дедуп jit_log: файл, уже поданный любым каналом в этой сессии,
 * второй раз не подкладывается — контекст не засоряется.
 *
 * Подача узла = его ВИЗИТ: отмечается в очереди z-резюме (ленивая генерация
 * смысла — только для узлов, которые действительно смотрят), а готовое резюме
 * тут же входит в срез строкой «роль».
 */
import type { Database } from '../core/db'
import { markVisited, summaryFor, contentHashOf } from '../graph/zsummary'
import { t } from '../core/i18n'
import { noteSurfaced, noteUsed, noteWithheld, noteWithheldUsed, shouldWithhold, type FeedKind } from '../gardener/utility'
import { readConfigEdges, renderConfigInfluence } from '../env/links'

export interface GraphNode {
  file: string
  in_deg: number
  out_deg: number
}

/**
 * Ключи дедупа, общие для двух каналов. Живут здесь, а не у своего канала:
 * ключ пишет один канал (подача до чтения), а зачитывает пользу другой
 * (правка в PostToolUse), и импорт «канал из канала» замкнул бы их в кольцо.
 */
export const OUTLINE_KIND = 'outline'
export const outlineKey = (rel: string): string => `#outline:${rel}`

export function ensureFeedLog(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS jit_log(session_id TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(session_id, file))',
  )
  // Телеметрия эффективности: used=1, если поданный файл потом реально тронут
  // (surfaced→edited — детерминированный прокси «знание использовано», не LLM-судья)
  const cols = (db.query('PRAGMA table_info(jit_log)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('used')) db.run('ALTER TABLE jit_log ADD COLUMN used INTEGER NOT NULL DEFAULT 0')
  // Вид подачи: без него нельзя понять, ЧТО именно окупается на этом проекте
  if (!cols.includes('kind')) db.run("ALTER TABLE jit_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'graph'")
  // Контрольная группа: подача решена, но удержана — «пригодилось ли» считается отдельно
  if (!cols.includes('withheld')) db.run('ALTER TABLE jit_log ADD COLUMN withheld INTEGER NOT NULL DEFAULT 0')
}

/**
 * true — ключ ещё не подавался в этой сессии (и теперь помечен поданным).
 * kind — вид подачи: он копит статистику окупаемости (см. gardener/utility.ts).
 */
export function claimNode(db: Database, sessionId: string, file: string, kind: FeedKind = 'graph'): boolean {
  if (kind === 'graph' && briefSilenced(db, sessionId, file)) return false
  // Удержание решается ДО записи: удержанная подача — тоже запись (иначе её
  // повторили бы следующим касанием и контрольная группа исчезла бы)
  const withheld = shouldWithhold(sessionId, file, kind)
  const fresh =
    Number(
      db.query('INSERT OR IGNORE INTO jit_log(session_id, file, kind, withheld) VALUES(?,?,?,?)').run(sessionId, file, kind, withheld ? 1 : 0).changes,
    ) > 0
  if (!fresh) return false
  if (withheld) {
    noteWithheld(db, kind)
    return false
  }
  noteSurfaced(db, kind)
  return true
}

/** Столько сессий подряд бриф узла не пригодился — дальше молчим. */
const SILENCE_AFTER = 3
/** Столько сессий молчим, потом пробуем снова: проект меняется, узел мог стать нужным. */
const SILENCE_SESSIONS = 5

/**
 * Межсессионная тишина для брифов графа.
 *
 * Дедуп jit_log живёт в пределах сессии, и один и тот же узел приходил в
 * каждую новую сессию заново: на собственном паспорте `src/cli/symbiont.ts`
 * подавался 18 сессий и пригодился в 4, `gardener/truth.ts` — 13 и ни разу.
 * Узел, чей бриф три сессии подряд не вёл к правке, молчит пять сессий, потом
 * пробуется снова — тот же зонд, что у глушения видов подачи (utility.ts),
 * только по узлу. Правка узла (used=1) рвёт серию. Порядковый номер сессии —
 * число записей в `sessions`: журнал append-only, номер монотонный.
 */
function briefSilenced(db: Database, sessionId: string, file: string): boolean {
  try {
    db.run('CREATE TABLE IF NOT EXISTS brief_silence(file TEXT PRIMARY KEY, since_ordinal INTEGER NOT NULL)')
    const ordinal = Number((db.query('SELECT COUNT(*) n FROM sessions').get() as { n: number } | null)?.n ?? 0)
    const row = db.query('SELECT since_ordinal FROM brief_silence WHERE file=?').get(file) as { since_ordinal: number } | null
    if (row) {
      if (ordinal - row.since_ordinal < SILENCE_SESSIONS) return true
      db.query('DELETE FROM brief_silence WHERE file=?').run(file)
      return false
    }
    // Последние подачи этого узла в ДРУГИХ сессиях, новые первыми
    const recent = db
      .query(
        `SELECT j.used FROM jit_log j LEFT JOIN sessions s ON s.session_id = j.session_id
         WHERE j.file=? AND j.kind='graph' AND j.session_id<>? ORDER BY s.started_at DESC LIMIT ?`,
      )
      .all(file, sessionId, SILENCE_AFTER) as Array<{ used: number }>
    if (recent.length < SILENCE_AFTER || recent.some((r) => r.used === 1)) return false
    db.query('INSERT OR REPLACE INTO brief_silence(file, since_ordinal) VALUES(?,?)').run(file, ordinal)
    return true
  } catch {
    return false // таблиц может не быть — подача важнее тишины
  }
}

/**
 * Пометить поданное использованным: файл тронут после подачи. Польза
 * зачитывается ВСЕМ видам, чья подача покрывала этот файл, — сам узел, а также
 * зональные ключи (уроки, каскад) и переданные каналом покрывающие ключи
 * (например плейбук направления). Иначе окупаемость видели бы только срезы
 * графа, а зональное знание выглядело бы вечно бесполезным.
 */
export function markUsed(db: Database, sessionId: string, file: string, coveringKeys: string[] = []): void {
  try {
    const keys = [file, ...coveringKeys]
    const marked = new Set<string>()
    for (const key of keys) {
      const row = db.query('SELECT kind, used, withheld FROM jit_log WHERE session_id=? AND file=?').get(sessionId, key) as
        | { kind: string; used: number; withheld: number }
        | null
      if (!row || row.used === 1 || marked.has(key)) continue
      db.query('UPDATE jit_log SET used=1 WHERE session_id=? AND file=?').run(sessionId, key)
      marked.add(key)
      if (row.withheld === 1) noteWithheldUsed(db, row.kind ?? 'graph')
      else noteUsed(db, row.kind ?? 'graph')
    }
  } catch {
    /* старая схема без колонок — телеметрия best-effort */
  }
}

/** Одна плотная строка о узле: роль (z1, если уже выведена) + связи + co-change прецеденты. */
export function nodeBrief(db: Database, node: GraphNode): string {
  // Визит: узел смотрят — он попадает в очередь ленивых z-резюме (детач выведет
  // роль к следующему разу). Само резюме, если уже есть и свежее, идёт первым:
  // «зачем этот файл» полезнее степеней связности, когда доступно и то и другое.
  markVisited(db, node.file, new Date().toISOString())
  const z1 = summaryFor(db, node.file, contentHashOf(db, node.file))
  const deps = (
    db.query('SELECT from_file FROM graph_edges WHERE to_file = ? ORDER BY from_file LIMIT 6').all(node.file) as Array<{
      from_file: string
    }>
  ).map((r) => r.from_file)
  const outs = (
    db.query('SELECT to_file FROM graph_edges WHERE from_file = ? ORDER BY to_file LIMIT 6').all(node.file) as Array<{
      to_file: string
    }>
  ).map((r) => r.to_file)
  const parts = [`${node.file} · ${t('вход', 'in')}:${node.in_deg} ${t('исход', 'out')}:${node.out_deg}`]
  if (z1) parts.push(`${t('роль', 'role')}: ${z1}`)
  // Какая настройка управляет этим кодом. Связи нет ни в одном импорте, но
  // именно она объясняет отказы в проде — поэтому идёт рядом со связями кода.
  const influence = renderConfigInfluence(readConfigEdges(db, node.file))
  if (influence) {
    parts.push(
      influence.replace(
        t('Symbiont · этим кодом управляет конфигурация: ', 'Symbiont · this code is governed by configuration: '),
        t('управляет конфигурация: ', 'governed by configuration: '),
      ),
    )
  }
  if (deps.length > 0) parts.push(`${t('зависят', 'depended on by')}: ${deps.join(', ')}${node.in_deg > deps.length ? ', …' : ''}`)
  if (outs.length > 0) parts.push(`${t('зависит от', 'depends on')}: ${outs.join(', ')}${node.out_deg > outs.length ? ', …' : ''}`)
  const hasCochange =
    (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cochange'").get() as { n: number }).n > 0
  if (hasCochange) {
    const rel = (
      db
        .query(
          `SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n
           FROM cochange WHERE file_a = ? OR file_b = ? ORDER BY n DESC LIMIT 3`,
        )
        .all(node.file, node.file, node.file) as Array<{ partner: string; n: number }>
    ).map((r) => `${r.partner} (${r.n})`)
    if (rel.length > 0) parts.push(`${t('исторически правятся вместе', 'historically changed together')}: ${rel.join(', ')}`)
  }
  return parts.join(' · ')
}
