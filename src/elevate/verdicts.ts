/**
 * Память аудита о решениях владельца.
 *
 * Боль, из которой это выросло. Аудит возвышения был безпамятным: каждый прогон
 * — чистый лист. Починенное исчезало само (его больше нет в коде), а вот
 * ОТКЛОНЁННОЕ возвращалось снова и снова, потому что решение владельца нигде не
 * жило. Живой случай: замечание про «фреймворки: nuxt» пришло дважды с разной
 * аргументацией, и оба раза было неверным — проверка показывала зависимость в
 * манифесте. Инструмент, повторяющий отвергнутый довод, тратит и токены, и
 * доверие.
 *
 * Почему вердикты хранятся текстом, а не хэшем предложения. Модель каждый раз
 * формулирует наблюдение своими словами — точное совпадение не поймало бы даже
 * тот же довод в другой обёртке. Поэтому отклонённое подаётся в следующий промпт
 * как есть, и сверку «это то же самое?» делает та же модель: она с этим
 * справляется, а хэш — нет. Отвергнуто: нормализация текста и SimHash — цена
 * ложных срабатываний (проглоченное НОВОЕ замечание) выше выигрыша.
 *
 * Хранилище — та же база паспорта: решение владельца о своём проекте живёт с
 * проектом, а не в конфиге инструмента.
 */
import type { Database } from '../core/db'

export type Verdict = 'принято' | 'отклонено'

export interface VerdictRow {
  n: number
  verdict: Verdict
  axis: string
  observation: string
  reason: string
  at: string
}

const TABLE = 'elevate_verdicts'

function ensure(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${TABLE}(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verdict TEXT NOT NULL,
      axis TEXT NOT NULL,
      observation TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL
    )`,
  )
}

/** Записать решение владельца по предложению последнего прогона. */
export function recordVerdict(
  db: Database,
  input: { verdict: Verdict; axis: string; observation: string; reason: string; at?: string },
): void {
  ensure(db)
  db.query(`INSERT INTO ${TABLE}(verdict, axis, observation, reason, at) VALUES(?,?,?,?,?)`).run(
    input.verdict,
    input.axis,
    input.observation.slice(0, 600),
    input.reason.slice(0, 400),
    input.at ?? new Date().toISOString(),
  )
}

/** Все решения, свежие сверху. Пустой список — аудит ещё ничего не знает. */
export function readVerdicts(db: Database, limit = 20): VerdictRow[] {
  try {
    ensure(db)
    const rows = db
      .query(`SELECT id, verdict, axis, observation, reason, at FROM ${TABLE} ORDER BY id DESC LIMIT ?`)
      .all(limit) as Array<{ id: number; verdict: string; axis: string; observation: string; reason: string; at: string }>
    return rows.map((r, i) => ({
      n: i + 1,
      verdict: r.verdict as Verdict,
      axis: r.axis,
      observation: r.observation,
      reason: r.reason,
      at: r.at,
    }))
  } catch {
    return [] // нет таблицы — вердиктов просто ещё нет
  }
}

/**
 * Блок для промпта аудита. Отклонённое подаётся с причиной и требованием НОВОГО
 * основания — не запретом: владелец мог ошибиться, и запрет думать был бы хуже
 * повтора. Принятое подаётся отдельно: повторно предлагать сделанное — тот же
 * шум, только с другой стороны.
 */
export function renderVerdictsForPrompt(rows: VerdictRow[]): string {
  if (rows.length === 0) return ''
  const rejected = rows.filter((r) => r.verdict === 'отклонено')
  const accepted = rows.filter((r) => r.verdict === 'принято')
  const L: string[] = ['', '## Решения владельца по прошлым предложениям (память аудита)']
  if (rejected.length > 0) {
    L.push('ОТКЛОНЕНО ранее — не повторяй тот же довод, если не появилось НОВОГО основания; если считаешь отклонение ошибочным, скажи это прямо и приведи новое доказательство:')
    for (const r of rejected) L.push(`- [${r.axis}] ${r.observation} → отклонено: ${r.reason}`)
  }
  if (accepted.length > 0) {
    L.push('УЖЕ ПРИНЯТО и сделано — не предлагай повторно:')
    for (const r of accepted) L.push(`- [${r.axis}] ${r.observation}`)
  }
  return L.join('\n')
}

/** Строки для владельца: что аудит помнит о его решениях. */
export function renderVerdicts(rows: VerdictRow[]): string {
  if (rows.length === 0) return 'Решений по предложениям пока нет: аудит ничего не помнит и предложит всё заново.'
  const L = [`Symbiont · память аудита: ${rows.length} решений (свежие сверху)`, '']
  for (const r of rows) {
    L.push(`${r.n}. ${r.verdict === 'отклонено' ? '✗' : '✓'} [${r.axis}] ${r.observation.slice(0, 120)}`)
    if (r.reason) L.push(`   причина: ${r.reason}`)
  }
  return L.join('\n')
}
