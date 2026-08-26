/**
 * SubagentStart-канал: срез паспорта сабагенту в момент его старта.
 *
 * Зачем отдельный канал, когда SessionStart уже ловит fork. Матчер fork
 * покрывает только форк-сабагентов (унаследованный контекст); СВЕЖИЙ сабагент
 * (разведка, планирование, ревью) стартует с чистым окном — паспорт теряется
 * ровно там, где принимаются решения о чужом коде. SubagentStart платформа
 * шлёт для каждого типа агента и принимает additionalContext.
 *
 * Чего канал НЕ делает — не льёт полную сводку. У сабагента узкая задача и
 * короткая жизнь; полный паспорт на каждый спавн — налог, за который умирали
 * memory-плагины. Срез — два самых плотных знания: законы стиля (что здесь
 * нарушать нельзя — их же принуждает гейт) и карта ключевых модулей с ролями
 * (куда смотреть). Порядок секций — по типу агента: планировщику законы
 * важнее карты, разведчику наоборот. Бюджет жёсткий (SUBAGENT_CHAR_BUDGET).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { zoneOfArea } from '../miner/facts'
import { openDb } from '../core/db'
import { t, statement, initLang } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации
import { FactStore } from '../core/store'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'

/** Бюджет среза: доля процента окна сабагента — цена, которую не нужно оправдывать. */
export const SUBAGENT_CHAR_BUDGET = 1400
const LAWS_MAX = 6
const NODES_MAX = 6

export interface SubagentStartInput {
  cwd?: string
  session_id?: string
  agent_type?: string
}

export interface SubagentStartOutput {
  hookSpecificOutput?: {
    hookEventName: 'SubagentStart'
    additionalContext: string
  }
}

export function handleSubagentStart(input: SubagentStartInput, dataRoot: string): SubagentStartOutput {
  try {
    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    // Язык подачи — до первой отрисованной строки: без этого канал говорит на
    // умолчании процесса, а не на языке владельца (см. core/i18n.ts).
    initLang(dataDir, cwd)
    beat(dataDir, 'SubagentStart', { agent: input.agent_type ?? null })
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const db = openDb(dbPath, { readonly: true })
    try {
      const laws = new FactStore(db)
        .active()
        .filter((f) => f.tier === 'закон' && zoneOfArea(f.area) === null) // зональный закон без файла не читается
        .slice(0, LAWS_MAX)
        .map((f) => statement(f.statement))
      let nodes: Array<{ file: string; in_deg: number; z1: string | null }> = []
      try {
        nodes = db
          .query(
            'SELECT g.file, g.in_deg, s.z1 FROM graph_nodes g LEFT JOIN node_summary s ON s.file = g.file ORDER BY g.rank DESC LIMIT ?',
          )
          .all(NODES_MAX) as Array<{ file: string; in_deg: number; z1: string | null }>
      } catch {
        // node_summary ещё не родился — карта без ролей
        try {
          nodes = (db.query('SELECT file, in_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?').all(NODES_MAX) as Array<{
            file: string
            in_deg: number
          }>).map((n) => ({ ...n, z1: null }))
        } catch {
          nodes = [] // графа нет — карты нет
        }
      }

      const lawsSec =
        laws.length > 0
          ? `${t('Законы стиля (нарушение ловит гейт)', 'Style laws (violations are caught by the gate)')}: ${laws.join(' · ')}`
          : ''
      const mapSec =
        nodes.length > 0
          ? `${t('Ключевые модули', 'Key modules')}: ${nodes
              .map((n) => `${n.file} (${t('вход', 'in')} ${n.in_deg}${n.z1 ? ` — ${n.z1}` : ''})`)
              .join('; ')}`
          : ''
      if (!lawsSec && !mapSec) return {}

      // Планировщику законы важнее карты; разведчику и остальным — наоборот
      // (карта отвечает «куда смотреть», а это первый вопрос свежего окна)
      const planner = /plan/i.test(input.agent_type ?? '')
      const sections = (planner ? [lawsSec, mapSec] : [mapSec, lawsSec]).filter(Boolean)
      const header = t(
        `Symbiont · паспорт проекта для сабагента${input.agent_type ? ` (${input.agent_type})` : ''} — выведено из самого проекта`,
        `Symbiont · project passport for the subagent${input.agent_type ? ` (${input.agent_type})` : ''} — derived from the project itself`,
      )
      let text = `${header}:\n${sections.map((s) => `- ${s}`).join('\n')}`
      // Режем по границе строки: обрыв посреди слова («pair-string rend…»)
      // читается как ошибка подачи, а не как бюджет
      if (text.length > SUBAGENT_CHAR_BUDGET) {
        const cut = text.slice(0, SUBAGENT_CHAR_BUDGET)
        const nl = cut.lastIndexOf('\n')
        text = `${nl > SUBAGENT_CHAR_BUDGET / 2 ? cut.slice(0, nl) : cut}\n…`
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: text,
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open: спавн сабагента важнее нашего среза
  }
}
