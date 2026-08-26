/**
 * Авто-конституция: приоритеты и ограничения, ВЫВЕДЕННЫЕ из наблюдаемого
 * поведения, а не из выдуманной воли (её выдумывать концепт запрещает).
 *
 * Источники — правдивые факты, не догадки:
 * - git-история: reverts (что откатывали → «не трогать без проверки»),
 *   плотность fix-коммитов на зону (хрупкое → «осторожно»), преобладающий
 *   тип коммитов (что владелец реально двигает);
 * - профиль качества: топ-оси по силе сигналов → приоритеты;
 * - защитные слои профиля → ограничение «не ослаблять».
 *
 * Ручная воля владельца (constitution.json) — опциональный оверлей ПОВЕРХ
 * (см. build.ts): человек побеждает вывод. Команда /sym-init не обязательна.
 */
import type { Fact } from '../miner/facts'
import type { ProfileProbe } from './profile'
import { SIGNALS } from './signals'
import { axisName, pattern } from '../core/i18n'

export interface CommitInfo {
  subject: string
  files: string[]
}

/** Разбор `git log --name-only --pretty=format:@%H%x09%s` в коммиты с темой и файлами. */
export function parseCommitLog(text: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  let cur: CommitInfo | null = null
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@')) {
      if (cur) commits.push(cur)
      const tab = raw.indexOf('\t')
      cur = { subject: tab >= 0 ? raw.slice(tab + 1) : '', files: [] }
      continue
    }
    const line = raw.trim()
    if (line && cur) cur.files.push(line.replaceAll('\\', '/'))
  }
  if (cur) commits.push(cur)
  return commits
}

const CONVENTIONAL = /^(feat|fix|perf|seo|refactor|docs|test|chore|style|build|ci)(\([^)]*\))?!?:/i
const REVERT = /^revert|откат|\brollback\b/i

/** Зона файла: первый значимый сегмент пути (server/, app/, content/…). */
function zoneOf(file: string): string {
  const parts = file.split('/')
  if (parts.length <= 1) return '(корень)'
  // два сегмента для широких деревьев (server/utils, app/pages), иначе один
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0]
}

export interface DerivedSignals {
  commitTypes: Record<string, number>
  reverts: number
  fixZones: Record<string, number> // зона → сколько fix-коммитов её касалось
  totalCommits: number
  /**
   * Сколько коммитов упоминают каждое направление — ценности, выраженные делом.
   * Может отсутствовать у сигналов, собранных прошлой версией: читатели обязаны
   * это переживать (см. deriveConstitutionFacts).
   */
  valueMentions?: Record<string, number>
}

/**
 * Ценности владельца — из ФОРМУЛИРОВОК его работы. Каталог не заводится: берём
 * тот же единый источник сигналов (signals.ts), которым определяются оси и
 * направления, и применяем к новому измерению — тексту коммитов. То, о чём
 * владелец пишет из релиза в релиз, и есть то, что он ценит; интервью для этого
 * не нужно (и было бы хуже: люди декларируют одно, а делают другое).
 */
function countValueMentions(subjects: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const subj of subjects) {
    for (const [name, sig] of Object.entries(SIGNALS)) {
      if (sig.docs && sig.docs.test(subj)) out[name] = (out[name] ?? 0) + 1
    }
  }
  return out
}

/** Сбор сигналов из коммитов (subject + затронутые файлы). */
export function deriveSignals(commits: CommitInfo[]): DerivedSignals {
  const commitTypes: Record<string, number> = {}
  const fixZones: Record<string, number> = {}
  let reverts = 0
  for (const c of commits) {
    const subj = c.subject.trim()
    if (REVERT.test(subj)) reverts++
    const m = subj.match(CONVENTIONAL)
    const type = m ? m[1].toLowerCase() : null
    if (type) commitTypes[type] = (commitTypes[type] ?? 0) + 1
    if (type === 'fix' || REVERT.test(subj)) {
      const zones = new Set(c.files.map(zoneOf))
      for (const z of zones) fixZones[z] = (fixZones[z] ?? 0) + 1
    }
  }
  return {
    commitTypes,
    reverts,
    fixZones,
    totalCommits: commits.length,
    valueMentions: countValueMentions(commits.map((c) => c.subject)),
  }
}

/**
 * Английская форма выведенной конституции. Формулировки — факты журнала (в базе
 * по-русски, ключ вытеснения считается по ним), поэтому перевод живёт образцами
 * на последней миле: русская запись неприкосновенна, наружу уходит английская.
 */
const labelEn = (ru: string): string =>
  ({
    'развитие функций': 'feature development',
    'надёжность и устранение дефектов': 'reliability and defect fixing',
    'поисковая видимость': 'search visibility',
    'чистота архитектуры': 'architectural cleanliness',
    проверяемость: 'testability',
  })[ru] ?? axisName(ru)

pattern(/^приоритет: (.+) — ось качества с наибольшим числом сигналов в проекте$/, (m) => `priority: ${axisName(m[1])} — the quality axis with the most signals in this project`)
pattern(/^фокус работы: (.+) — преобладающий тип коммитов$/, (m) => `focus of work: ${labelEn(m[1])} — the prevailing commit type`)
pattern(
  /^ценность: (.+) — владелец возвращается к ней в формулировках работы \((\d+) из (\d+) коммитов\)$/,
  (m) => `value: ${labelEn(m[1])} — the owner keeps returning to it when describing the work (${m[2]} of ${m[3]} commits)`,
)
pattern(
  /^ограничение: зона (.+) — хрупкая \((\d+) правок-починок в истории\), менять осторожно и с проверкой$/,
  (m) => `constraint: the ${m[1]} area is fragile (${m[2]} fix commits in history) — change it carefully and with verification`,
)
pattern(
  /^ограничение: в истории есть откаты \((\d+)\) — рискованные правки проверять до коммита \(регрессии тут случались\)$/,
  (m) => `constraint: history contains reverts (${m[1]}) — verify risky changes before committing (regressions have happened here)`,
)
pattern(
  /^ограничение: защитные слои \((.+)\) не ослаблять без явного решения владельца$/,
  (m) => `constraint: protective layers (${m[1]}) must not be weakened without the owner's explicit decision`,
)

const CONSTRAINT_MIN_FIXES = 4 // зона считается хрупкой от стольких fix-коммитов
const AXIS_LABEL: Record<string, string> = {
  feat: 'развитие функций',
  fix: 'надёжность и устранение дефектов',
  perf: 'производительность',
  seo: 'поисковая видимость',
  refactor: 'чистота архитектуры',
  test: 'проверяемость',
}

/**
 * Выведенные пары «приоритет/ограничение» → факты (area «конституция»).
 * Ключ стабилен по сути пункта, чтобы обновление было заменой, а исчезновение —
 * отзывом (retractMissingBySource в конвейере).
 */
export function deriveConstitutionFacts(signals: DerivedSignals, profile: ProfileProbe[]): Fact[] {
  const facts: Fact[] = []
  const push = (statement: string, positive: number, total: number, tier: Fact['tier']): void => {
    facts.push({ area: 'конституция', statement, positive, total: Math.max(total, positive, 1), prevalence: 1, tier })
  }

  // Приоритет 1: топ-оси профиля качества (что важно этому продукту)
  const topAxes = profile
    .filter((p) => p.axis !== 'безопасность')
    .sort((a, b) => b.evidence.length - a.evidence.length)
    .slice(0, 2)
  for (const a of topAxes) {
    push(`приоритет: ${a.axis} — ось качества с наибольшим числом сигналов в проекте`, a.evidence.length, a.evidence.length, a.evidence.length >= 2 ? 'привычка' : 'гипотеза')
  }

  // Приоритет 2: что владелец реально двигает (преобладающий тип коммитов)
  const types = Object.entries(signals.commitTypes).sort((a, b) => b[1] - a[1])
  if (types.length > 0 && signals.totalCommits >= 20) {
    const [type, n] = types[0]
    const label = AXIS_LABEL[type] ?? type
    if (n / signals.totalCommits >= 0.25) {
      // Числа — в основании, не в формулировке: иначе каждый коммит менял текст и
      // вытеснял факт (25 версий одного ключа на собственном паспорте)
      push(`фокус работы: ${label} — преобладающий тип коммитов`, n, signals.totalCommits, 'привычка')
    }
  }

  // Приоритет 3: ценности, выраженные ДЕЛОМ — о чём владелец пишет из релиза в
  // релиз. Заменяет собой интервью: декларация в опроснике расходится с
  // практикой, а формулировки собственной работы — нет.
  const VALUE_LABEL: Record<string, string> = {
    performance: 'производительность',
    security: 'безопасность',
    seo: 'поисковая видимость',
    a11y: 'доступность',
    testing: 'проверяемость',
    db: 'целостность данных',
    deploy: 'поставляемость',
    privacy: 'приватность',
    observability: 'наблюдаемость',
  }
  const VALUE_MIN_SHARE = 0.12
  // ?? {} — сигналы могли быть собраны прошлой версией (или собраны без истории):
  // отсутствие измерения не должно ронять вывод остальной конституции
  const values = Object.entries(signals.valueMentions ?? {})
    .filter((e) => VALUE_LABEL[e[0]] !== undefined && e[1] >= 3 && e[1] / Math.max(signals.totalCommits, 1) >= VALUE_MIN_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
  for (const v of values) {
    push(
      `ценность: ${VALUE_LABEL[v[0]]} — владелец возвращается к ней в формулировках работы (${v[1]} из ${signals.totalCommits} коммитов)`,
      v[1],
      signals.totalCommits,
      v[1] >= 6 ? 'привычка' : 'гипотеза',
    )
  }

  // Ограничение 1: хрупкие зоны (много fix-коммитов) — осторожность = сдержанность
  const fragile = Object.entries(signals.fixZones)
    .filter(([, n]) => n >= CONSTRAINT_MIN_FIXES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  for (const [zone, n] of fragile) {
    push(`ограничение: зона ${zone} — хрупкая (${n} правок-починок в истории), менять осторожно и с проверкой`, n, signals.totalCommits, n >= CONSTRAINT_MIN_FIXES * 2 ? 'привычка' : 'гипотеза')
  }

  // Ограничение 2: откаты в истории → «не ломать то, что уже откатывали»
  if (signals.reverts >= 2) {
    push(`ограничение: в истории есть откаты (${signals.reverts}) — рискованные правки проверять до коммита (регрессии тут случались)`, signals.reverts, signals.totalCommits, 'гипотеза')
  }

  // Ограничение 3: защитные слои неприкосновенны
  const sec = profile.find((p) => p.axis === 'безопасность')
  if (sec && sec.evidence.length > 0) {
    push(`ограничение: защитные слои (${sec.evidence.slice(0, 4).join(', ')}) не ослаблять без явного решения владельца`, sec.evidence.length, sec.evidence.length, 'привычка')
  }

  return facts
}
