/**
 * Момент коммита: состояние доказательств там, где «готово» становится историей.
 *
 * Гейт доказательств живёт на Stop — в конце хода. Но модель нередко коммитит
 * ВНУТРИ хода, и к Stop говорить уже поздно: непроверенное лежит в истории.
 * Замер на собственных транскриптах: из 174 коммитов с правкой кода полным
 * зелёным прогоном на этом состоянии подтверждены 67; 12 сделаны после правки
 * без прогона, 8 — прямо на красном.
 *
 * Почему это стало возможно только сейчас. Оболочку мы не хукаем принципиально:
 * каждый запуск хука — ~80 мс старта рантайма, а команд оболочки в сессии сотни.
 * У обработчика хука появилось условие `if` в синтаксисе правил доступа
 * (`Bash(git commit *)`): при несовпадении процесс не спавнится вовсе, а
 * составные команды сверяются по подкомандам. Налог платится только на коммитах.
 * Условие — best-effort (команду, которую платформа не смогла разобрать, она
 * отдаёт хуку как есть), поэтому форма команды проверяется и здесь, первым делом,
 * до любой работы: чужая команда выходит за цену старта процесса.
 *
 * Что говорится: правки кода после последней проверки; последняя проверка
 * красная; файл, который исторически меняется вместе с правленым, в этой сессии
 * не тронут. Последнее — с тугими порогами: бэктест на 582 коммитах боевого
 * репозитория дал при уверенности ≥0.9 и поддержке ≥5 точность 76% и ложную
 * тревогу в 3% коммитов, а при поддержке ≥3 — уже в 12%.
 *
 * Dry-run — строка в контекст, коммит идёт. Режим блокировки отменяет коммит
 * ОДИН раз на данное состояние доказательств: повтор той же команды проходит.
 * Тот же довод, что у оглавления вместо чтения, — отмена обязывает нас быть
 * правыми, а проверка может быть здесь законно не нужна; настоявший прав.
 * Пропущенный партнёр не отменяет коммит никогда: это статистика, не нарушение.
 */
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { t, initLang } from '../core/i18n'
import { openDb, type Database } from '../core/db'
import { sha1 } from '../core/salsa'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { toRelNode } from './post-tool-core'
import { evidenceFromTranscript, runHistory } from '../gates/evidence'
import { readGateMode } from '../gates/config'
import { isConfigFile, isSecretCarrier } from '../env/config-graph'
import { ENTITY_EXT } from '../graph/entities'
import { inDerivedZone } from '../miner/walk'

// Коммит — по форме команды: глобальные флаги git (`-C путь`, `-c ключ=значение`)
// между словами допустимы; `commit-graph` и `commit-tree` — другие команды, а
// пробный `--dry-run` историю не пишет.
const COMMIT_COMMAND = /\bgit\s+(?:-[Cc]\s+\S+\s+)*commit(?![\w-])(?![^\n;&|]*--dry-run)/

export const isCommitCommand = (command: string): boolean => COMMIT_COMMAND.test(command)

/** Пороги предупреждения о пропущенном партнёре — из бэктеста, см. заголовок. */
export const PARTNER_CONFIDENCE = 0.9
export const PARTNER_SUPPORT = 5
const MAX_PARTNERS = 3

export interface CommitGateInput {
  cwd?: string
  session_id?: string
  transcript_path?: string
  tool_name?: string
  tool_input?: { command?: string }
}

export interface CommitGateOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse'
    additionalContext?: string
    permissionDecision?: 'deny'
    permissionDecisionReason?: string
  }
}

export interface MissingPartner {
  /** правленый файл */
  file: string
  /** его исторический спутник, которого сессия не тронула */
  partner: string
  together: number
  total: number
}

/**
 * Спутники правленых файлов, которых эта правка обошла. Уверенность считается
 * от ПРАВЛЕНОГО файла (в скольких его коммитах участвовал спутник) — правило
 * направленное: тест меняется вместе с кодом чаще, чем код вместе с тестом.
 */
export function missingPartners(db: Database, edited: string[], touched: Set<string>): MissingPartner[] {
  const out: MissingPartner[] = []
  try {
    const total = db.query('SELECT n FROM cochange_totals WHERE file=?')
    const pairs = db.query('SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n FROM cochange WHERE (file_a = ? OR file_b = ?) AND n >= ?')
    for (const file of edited) {
      const n = (total.get(file) as { n: number } | null)?.n ?? 0
      if (n < PARTNER_SUPPORT) continue
      for (const p of pairs.all(file, file, file, PARTNER_SUPPORT) as Array<{ partner: string; n: number }>) {
        if (p.n / n < PARTNER_CONFIDENCE || touched.has(p.partner)) continue
        if (inDerivedZone(p.partner) || isSecretCarrier(p.partner)) continue
        // Дубль спутника от разных правленых файлов: остаётся самая уверенная пара
        const seen = out.find((m) => m.partner === p.partner)
        if (seen && seen.together / seen.total >= p.n / n) continue
        if (seen) out.splice(out.indexOf(seen), 1)
        out.push({ file, partner: p.partner, together: p.n, total: n })
      }
    }
  } catch {
    return [] // таблиц co-change нет — истории git не было, советовать не из чего
  }
  return out.sort((a, b) => b.together / b.total - a.together / a.total).slice(0, MAX_PARTNERS)
}

interface WorkTree {
  /** всё изменённое: спутник мог быть правлен руками владельца, мимо PostToolUse */
  dirty: Set<string>
  /** уже в индексе — то, что войдёт в коммит без `git add` и без `-a` */
  staged: Set<string>
  readable: boolean
}

/** Рабочее дерево одним запуском git: первая буква статуса porcelain — индекс, вторая — дерево. */
function workTree(cwd: string): WorkTree {
  const none: WorkTree = { dirty: new Set(), staged: new Set(), readable: false }
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (r.status !== 0 || typeof r.stdout !== 'string') return none
    const dirty = new Set<string>()
    const staged = new Set<string>()
    for (const l of r.stdout.split('\n')) {
      if (l.length <= 3) continue
      const file = l.slice(3).split(' -> ').pop()!.trim()
      dirty.add(file)
      if (l[0] !== ' ' && l[0] !== '?') staged.add(file)
    }
    return { dirty, staged, readable: true }
  } catch {
    return none // git не ответил — состав коммита неизвестен
  }
}

// Команда сама кладёт файлы в индекс: `git add …` перед коммитом или `commit -a`
const STAGES_ITSELF = /\bgit\s+(?:-[Cc]\s+\S+\s+)*add\b|\bcommit(?![\w-])[^\n;&|]*\s-[a-zA-Z]*a/

/**
 * Что войдёт в коммит. Индекс — точный ответ, пока команда не стейджит сама;
 * если стейджит (`git add … && git commit`, `commit -am`), на момент хука индекс
 * ещё пуст, и честная оценка сверху — всё изменённое. Без этого гейт говорил бы
 * о незаконченном файле, который в этот коммит вообще не идёт.
 */
function commitSet(command: string, tree: WorkTree): Set<string> {
  return STAGES_ITSELF.test(command) ? tree.dirty : tree.staged
}

/** Путь для сравнения: прямые слэши, без кавычек и хвостового слэша, msys-форма `/d/x` → `d:/x`, без регистра. */
const samePathKey = (p: string): string =>
  p
    .replace(/^['"]|['"]$/g, '')
    .replaceAll('\\', '/')
    .replace(/^\/([a-zA-Z])\//, '$1:/')
    .replace(/\/+$/, '')
    .toLowerCase()

/**
 * Коммит в другом репозитории (`cd ../other && git commit`, `git -C ../other
 * commit`): состояние НАШИХ файлов к нему отношения не имеет. Относительный путь
 * считается чужим — свой каталог так не называют.
 */
export function commitsElsewhere(command: string, cwd: string): boolean {
  const here = samePathKey(cwd)
  const targets = [...command.matchAll(/(?:^|[;&|\n(]\s*)cd\s+("[^"]+"|'[^']+'|\S+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/g)].map((m) => samePathKey(m[1] ?? m[2]))
  return targets.some((p) => p !== here && p !== '.')
}

export function handleCommitGate(input: CommitGateInput, dataRoot: string): CommitGateOutput {
  try {
    // Первым делом и до любой работы: условие `if` у платформы best-effort
    const command = String(input.tool_input?.command ?? '')
    if (!isCommitCommand(command)) return {}

    const cwd = input.cwd ?? process.cwd()
    if (commitsElsewhere(command, cwd)) return {}
    const dataDir = join(dataRoot, slugOf(cwd))
    // Язык подачи — до первой отрисованной строки (см. core/i18n.ts)
    initLang(dataDir, cwd)
    beat(dataDir, 'PreToolUse')
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}

    const db = openDb(dbPath)
    try {
      const sid = input.session_id ?? 'manual'
      let own: string[] = []
      try {
        own = (db.query('SELECT file FROM session_edits WHERE session_id=?').all(sid) as Array<{ file: string }>).map((r) => r.file)
      } catch {
        own = [] // журнала авторства нет — эта сессия ничего не писала
      }
      if (own.length === 0) return {} // коммитится чужая работа — о ней нам сказать нечего

      let transcript: string | null = input.transcript_path ?? null
      if (!transcript) {
        try {
          transcript = (db.query('SELECT transcript_path FROM sessions WHERE session_id=?').get(sid) as { transcript_path: string | null } | null)?.transcript_path ?? null
        } catch {
          transcript = null // журнала сессий нет
        }
      }

      // Судится только то, что идёт в ЭТОТ коммит. Дерево не прочиталось — состав
      // неизвестен, и судим по всему своему: молчание тут было бы потерей гейта
      const tree = workTree(cwd)
      const going = commitSet(command, tree)
      const inCommit = tree.readable ? own.filter((f) => going.has(f)) : own
      if (inCommit.length === 0) return {}

      // Доказательства — те же условия, что на Stop: только подтверждённо свой код
      // и только в проекте, где проверка вообще есть
      const evidence: string[] = []
      const codeOwn = new Set(inCommit.filter((f) => !ENTITY_EXT.has(extname(f).toLowerCase()) && !isConfigFile(f) && !inDerivedZone(f)))
      let hasTests = false
      try {
        hasTests = codeOwn.size > 0 && (db.query("SELECT COUNT(*) n FROM graph_nodes WHERE file LIKE '%test%' OR file LIKE '%spec%'").get() as { n: number }).n > 0
      } catch {
        hasTests = false // графа нет — паспорт ещё не собран
      }
      if (hasTests) {
        const toRel = (abs: string): string | null => toRelNode(cwd, abs)
        const ev = evidenceFromTranscript(transcript, codeOwn, toRel)
        if (ev.readable && ev.uncheckedFiles.length > 0) {
          const files = [...ev.uncheckedFiles].sort()
          const shown = `${files.slice(0, 4).join(', ')}${files.length > 4 ? `, … (+${files.length - 4})` : ''}`
          evidence.push(t(`- после последней правки проверка не запускалась (${shown})`, `- no check was run after the last edit (${shown})`))
        } else if (ev.readable && runHistory(transcript, toRel).lastRun === 'red') {
          evidence.push(t('- последняя проверка упала, зелёного прогона после неё не было', '- the last check failed and no green run followed it'))
        }
      }

      const touched = new Set([...own, ...tree.dirty])
      const partners = missingPartners(db, inCommit.filter((f) => !inDerivedZone(f)), touched)
        .filter((m) => existsSync(join(cwd, m.partner)))
        .map((m) =>
          t(
            `- ${m.partner} исторически меняется вместе с ${m.file} (${m.together} из ${m.total} коммитов) — в этой сессии не тронут`,
            `- ${m.partner} has historically changed together with ${m.file} (${m.together} of ${m.total} commits) — untouched in this session`,
          ),
        )

      const lines = [...evidence, ...partners]
      if (lines.length === 0) return {}

      // Один раз на СОСТОЯНИЕ: повтор коммита с теми же фактами молчит и проходит
      db.run('CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))')
      const fresh = Number(db.query('INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)').run(sid, '#коммит', sha1(lines.join('\n'))).changes) > 0
      if (!fresh) return {}

      if (evidence.length > 0 && readGateMode(dataDir) === 'block') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: t(
              `Symbiont · коммит отложен (режим блокировки): на этом состоянии нет доказательства.\n${lines.join('\n')}\nЗапусти проверку и повтори коммит. Если проверка здесь не нужна — повтори ту же команду: второй раз она не отменяется, а владельцу стоит сказать почему.`,
              `Symbiont · the commit is held back (blocking mode): there is no evidence for this state.\n${lines.join('\n')}\nRun the check and commit again. If no check is needed here, repeat the same command: it is not cancelled twice — and tell the owner why.`,
            ),
          },
        }
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: t(
            `Symbiont · перед коммитом (ничего не блокируется — состояние на этот момент):\n${lines.join('\n')}`,
            `Symbiont · before the commit (nothing is blocked — the state at this moment):\n${lines.join('\n')}`,
          ),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open: канал не вправе мешать коммиту
  }
}
