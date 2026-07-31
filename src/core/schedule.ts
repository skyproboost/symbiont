/**
 * FSRS-lite: расписание перепроверок фактов.
 *
 * Разделение труда с Glicko-парой (ratings.ts): Glicko отвечает «насколько
 * верим факту», FSRS — «КОГДА дёшево перепроверить, пока не протух».
 * Касается только LLM-фактов: статистика майнера перемеряется каждым заходом
 * бесплатно, а LLM-правило без переподтверждения тускнеет — FSRS называет
 * момент, когда /sym-learn обязан спросить о нём заново.
 *
 * Кривая забывания — степенная, калибровка FSRS-4.5 (обкатана на 500M+
 * повторений Anki): R(t) = (1 + FACTOR·t/S)^DECAY, ровно R(S) = 0.9.
 * Полную машинерию FSRS (17 весов, difficulty) не берём — на наших объёмах
 * она не даёт ничего сверх пары «стабильность + порог», но убивает
 * отлаживаемость. Тот же фильтр, что отверг Glicko-2 volatility.
 */

export const RETENTION_THRESHOLD = 0.9
const DECAY = -0.5
const FACTOR = 19 / 81 // при t = S даёт R = (1 + 19/81)^-0.5 = 0.9

/** Первый интервал: правило слоя 2 — две недели; правило из поправки владельца —
 *  неделя (родилось из одного инцидента — проверять чаще, пока не окрепло). */
export function initialStability(source: string): number | null {
  if (source.startsWith('llm:corrections:')) return 7
  if (source.startsWith('llm:')) return 14
  return null // статистика майнера в FSRS не участвует
}

/** Вероятность, что факт ещё «жив», спустя время с последнего замера. */
export function retrievability(stabilityDays: number, seenAtIso: string, nowMs = Date.now()): number {
  const days = (nowMs - Date.parse(seenAtIso)) / 86_400_000
  if (!Number.isFinite(days) || days <= 0) return 1
  return Math.pow(1 + FACTOR * (days / Math.max(stabilityDays, 0.1)), DECAY)
}

/**
 * Подтверждение = успешное повторение: интервал растёт. Чем ближе факт был
 * к забвению в момент проверки (ниже R), тем больше прирост — ядро идеи FSRS:
 * подтверждение «на грани» информативнее подтверждения «сразу же».
 */
export function confirmStability(stabilityDays: number, r: number): number {
  const growth = 1.6 + 1.4 * (1 - Math.min(Math.max(r, 0), 1))
  return Math.min(stabilityDays * growth, 365)
}

/** Факту пора на перепроверку? */
export function isDue(stabilityDays: number | null, seenAtIso: string, nowMs = Date.now()): boolean {
  if (stabilityDays === null) return false
  return retrievability(stabilityDays, seenAtIso, nowMs) < RETENTION_THRESHOLD
}
