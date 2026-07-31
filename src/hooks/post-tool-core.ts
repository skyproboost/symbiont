/**
 * PostToolUse-канал: знание приходит в момент касания файла.
 *
 * Два дара по месту работы:
 * 1) правка (Edit/Write) — МГНОВЕННЫЙ dry-run гейт: файл проверяется против
 *    законов паспорта сразу, а не в конце хода (Stop лишь добьёт пропущенное —
 *    дедуп общий, повторов не будет);
 * 2) любое касание (включая Read) — срез узла графа: связи и co-change
 *    прецеденты тронутого файла (дедуп общий с JIT — второй раз не подкладывается).
 *
 * Молчание по умолчанию; fail-open; ничего не блокирует.
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { t, statement } from '../core/i18n'
import { openDb, type Database } from '../core/db'
import { FactStore } from '../core/store'
import { checkAgainstLaws } from '../gates/checks'
import { runContentVerifiers, contentVerifierActive, loadEntityResolver } from '../verifiers/content'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { ensureFeedLog, claimNode, markUsed, nodeBrief, type GraphNode } from './node-brief'
import { bumpHeat } from '../graph/heat'
import { fileDomains } from '../passport/stack'
import { readZoneProfiles, effectiveProfile, renderEffective, rootAxesFromFacts, zoneAncestors } from '../passport/cascade'
import { shouldFeed } from '../gardener/utility'
import { zoneOf } from '../gardener/lessons'
import { playbooksFor, renderPlaybookBrief } from '../domains/playbooks'
import { readGrounding, renderCorrection } from '../domains/grounding'

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TOUCH_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])
const MAX_CONTENT = 1_000_000 // гейт не жуёт гигантов
const SKIP_ZONES = /(^|\/)(node_modules|\.git|\.data|dist|build|\.nuxt|vendor)(\/|$)/

export interface PostToolInput {
  cwd?: string
  session_id?: string
  tool_name?: string
  tool_input?: { file_path?: string; notebook_path?: string }
}

export interface PostToolOutput {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    additionalContext: string
  }
}

/** Путь инструмента → путь узла графа (относительный, forward-slash). */
export function toRelNode(cwd: string, filePath: string): string | null {
  // Разделители приводятся к прямым слэшам ДО сравнения путей: node:path на
  // Linux не считает обратный слэш разделителем, и виндовый путь читался бы как
  // одно имя — файл внутри проекта выглядел бы внешним
  const rel = relative(cwd.replaceAll('\\', '/'), filePath.replaceAll('\\', '/')).replaceAll('\\', '/')
  if (!rel || rel.startsWith('..') || rel.includes(':')) return null // вне проекта
  if (SKIP_ZONES.test(rel)) return null
  return rel
}

/**
 * Журнал авторства правок: единственное место, где ТОЧНО известно, что файл
 * изменила именно эта сессия.
 *
 * Зачем отдельная запись, когда есть git. `git status` показывает ОБЩЕЕ рабочее
 * дерево: при двух живых сессиях Claude Code в одном репозитории он одинаково
 * отдаёт работу обеих, а эвристика Stop «грязный + свежий mtime» приписывала
 * чужие правки себе. Дальше по цепочке model_state → corrections это порождало
 * ложные «поправки владельца» из нормальной работы соседа — и выведенные из них
 * правила уходили в неприкосновенный журнал фактов, откуда их уже не убрать.
 *
 * Таблица эфемерная (чистится pruneEphemeral): истина о правках живёт в git,
 * здесь — только атрибуция на время жизни сессии.
 */
export function recordEdit(db: Database, sid: string, rel: string): void {
  try {
    db.run(
      'CREATE TABLE IF NOT EXISTS session_edits(session_id TEXT NOT NULL, file TEXT NOT NULL, edited_at TEXT NOT NULL, PRIMARY KEY(session_id, file))',
    )
    db.query(
      'INSERT INTO session_edits(session_id, file, edited_at) VALUES(?,?,?) ON CONFLICT(session_id, file) DO UPDATE SET edited_at=excluded.edited_at',
    ).run(sid, rel, new Date().toISOString())
  } catch {
    // Атрибуция — обогащение: без неё Stop в одиночной сессии работает по
    // прежней эвристике mtime, а в параллельной осторожно молчит
  }
}

export function handlePostTool(input: PostToolInput, dataRoot: string): PostToolOutput {
  try {
    const tool = input.tool_name ?? ''
    if (!TOUCH_TOOLS.has(tool)) return {}
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path
    if (!filePath) return {}

    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    beat(dataDir, 'PostToolUse')
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const rel = toRelNode(cwd, filePath)
    if (!rel) return {}

    const db = openDb(dbPath)
    try {
      const sid = input.session_id ?? 'manual'
      const lines: string[] = []

      // Телеметрия: правка файла = использование его подачи (если он подавался
      // JIT/PostToolUse). Surfaced→edited — детерминированный прокси пользы.
      if (WRITE_TOOLS.has(tool)) {
        ensureFeedLog(db)
        // Пользу зачитываем всем видам, чья подача покрывала этот файл: зональные
        // (уроки, каскад) и доменные (плейбук) знания не привязаны к имени файла,
        // но работали именно на него — иначе они выглядели бы вечно бесполезными.
        const covering = [`#lesson:${zoneOf(rel)}`, ...zoneAncestors(rel).map((z) => `#zone:${z}`), ...fileDomains(rel).map((d) => `#playbook:${d}`)]
        markUsed(db, sid, rel, covering)
        recordEdit(db, sid, rel)
      }

      // 1) Мгновенный гейт: только на правках. Законы формы — кодовым файлам;
      // верификаторы направления — контент-файлам (эмерджентно по расширению).
      if (WRITE_TOOLS.has(tool)) {
        const ext = extname(rel).toLowerCase()
        let content: string | null = null
        try {
          content = readFileSync(join(cwd, rel), 'utf8')
        } catch {
          content = null // файл удалён/переименован — гейту нечего проверять
        }
        if (content !== null && content.length <= MAX_CONTENT) {
          db.run(
            'CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))',
          )
          const dedup = db.query('INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)')
          const laws = new FactStore(db).active().filter((f) => f.tier === 'закон')
          for (const v of checkAgainstLaws(content, ext, laws)) {
            if (Number(dedup.run(sid, rel, v.law).changes) === 0) continue
            lines.push(t(`- отклонение от закона «${statement(v.law)}» · ${v.detail}`, `- deviation from the law “${statement(v.law)}” · ${v.detail}`))
          }
          // Верификаторы направления «контент» (чистота алфавита, целостность ссылок)
          if (contentVerifierActive(ext)) {
            const resolve = loadEntityResolver(db)
            for (const v of runContentVerifiers(rel, content, ext, { resolve })) {
              if (Number(dedup.run(sid, rel, v.verifier).changes) === 0) continue
              lines.push(t(`- верификатор «${v.verifier}» · ${v.detail}`, `- verifier “${v.verifier}” · ${v.detail}`))
            }
          }
        }
      }

      // 2) Срез узла графа — если файл в графе и ещё не подавался этой сессии
      const node = db.query('SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?').get(rel) as GraphNode | null
      if (node) {
        // Тепло: касание узла излучает релевантность (влияет на подачу и hotspot)
        try {
          bumpHeat(db, node.file, new Date().toISOString())
        } catch {
          /* тепло — обогащение, не критично */
        }
        ensureFeedLog(db)
        if (claimNode(db, sid, node.file)) lines.push(`- ${nodeBrief(db, node)}`)
      }

      // 3) Каскад осей профиля: спускаясь в зону, агент получает её ЭФФЕКТИВНЫЕ
      // условия — только дельту к корню (корневые уже пришли сводкой). Дедуп по
      // зоне на сессию: условия зоны не меняются от файла к файлу.
      try {
        const profiles = readZoneProfiles(db)
        if (profiles.length > 0) {
          const rootAxes = rootAxesFromFacts(
            new FactStore(db).active().filter((f) => f.area === 'профиль качества').map((f) => f.statement),
          )
          const eff = effectiveProfile(rel, rootAxes, profiles)
          if (eff && shouldFeed(db, 'zone')) {
            ensureFeedLog(db)
            if (claimNode(db, sid, `#zone:${eff.zone}`, 'zone')) lines.push('', renderEffective(eff))
          }
        }
      } catch {
        /* каскад — обогащение подачи, молчим при любой заминке */
      }

      // 4) Доменный плейбук — если файл относится к направлению с плейбуком,
      // подаём его срез один раз за сессию (дедуп через общий jit_log)
      const domains = fileDomains(rel)
      if (domains.length > 0 && shouldFeed(db, 'playbook')) {
        ensureFeedLog(db)
        const active = playbooksFor({ frameworks: [], infra: [], domains })
        const corrections = new Map(readGrounding(db).map((r) => [r.domain, r]))
        for (const pb of active) {
          if (!claimNode(db, sid, `#playbook:${pb.domain}`, 'playbook')) continue
          lines.push('', renderPlaybookBrief(pb))
          // Поправка показывается РЯДОМ с курируемым знанием, а не вместо него:
          // видно и исходный ориентир, и то, что мы узнали позже
          const corr = renderCorrection(corrections.get(pb.domain))
          if (corr) lines.push(corr)
        }
      }

      if (lines.length === 0) return {}
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Symbiont · ${rel}:\n${lines.join('\n')}`,
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open
  }
}
