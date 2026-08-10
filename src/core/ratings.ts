/**
 * Живая механика уверенности фактов: Glicko-подобная пара (рейтинг, отклонение).
 *
 * - Рождение: статистика с большой выборкой — низкое отклонение; LLM — высокое
 *   (наблюдение, не измерение).
 * - Подтверждение (повторный замер того же вердикта): рейтинг тянется к свежему
 *   значению с весом неуверенности, отклонение сжимается.
 * - Старение: отклонение растёт лениво от давности последнего замера
 *   (forward-decay: ничего не пересчитывается фоном) — неподтверждаемое знание
 *   тускнеет само. Живой проект перемеряет статистику каждым стартом сессии,
 *   так что старение бьёт в первую очередь по LLM-фактам — как и задумано.
 * - Ярус вычисляется живьём из (рейтинг, эффективное отклонение, выборка).
 */
import type { Tier } from '../miner/facts'

export interface Rating {
  rating: number
  deviation: number
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)

export function initRating(source: string, prevalence: number, total: number): Rating {
  if (source.startsWith('llm:')) {
    return { rating: Math.min(prevalence, 0.94), deviation: 0.22 }
  }
  return { rating: prevalence, deviation: clamp(1 / Math.sqrt(Math.max(total, 1)), 0.03, 0.35) }
}

/**
 * Порог сюрприза: расхождение свежего замера с накопленным рейтингом больше
 * этого — не «подтверждение похуже», а сигнал, что мир изменился. Величина
 * выбрана выше шума перемеров живого проекта (правки двигают долю на сотые)
 * и ниже смены вердикта (та идёт вытеснением, не сюда).
 */
export const SURPRISE_GAP = 0.1

/** Сюрприз ли свежий замер относительно накопленной уверенности (единственное место определения). */
export function isSurprise(prev: Rating, newPrevalence: number): boolean {
  return Math.abs(newPrevalence - prev.rating) > SURPRISE_GAP
}

export function confirmRating(prev: Rating, newPrevalence: number): Rating {
  if (isSurprise(prev, newPrevalence)) {
    // Деоптимизация (паттерн V8: сломанное предположение снимает оптимизацию
    // МГНОВЕННО, а не при следующей профилировке). Без этой ветви закон с
    // малым отклонением реагировал бы на смену мира весом w≈0.1 за замер —
    // месяцы принуждения гейтом правила, которое проект уже отменил.
    // Отклонение раздувается на величину сюрприза (ярус падает сейчас),
    // рейтинг тянется к свежему уже с весом раздутой неуверенности.
    // Отвергнуто: немедленный сброс рейтинга к замеру — одиночный аномальный
    // перемер (полурефакторинг, срез по подкаталогу) стирал бы годы улик.
    const deviation = Math.min(prev.deviation + Math.abs(newPrevalence - prev.rating), 0.35)
    const w = Math.min(deviation * 2, 0.5)
    return { rating: prev.rating * (1 - w) + newPrevalence * w, deviation }
  }
  const w = Math.min(prev.deviation * 2, 0.5) // чем неувереннее — тем сильнее тянет к свежему
  return {
    rating: prev.rating * (1 - w) + newPrevalence * w,
    deviation: Math.max(prev.deviation * 0.85, 0.02),
  }
}

const MONTH_MS = 30 * 24 * 3600_000
const AGING_PER_MONTH = 0.05
const DEVIATION_CAP = 0.5

export function effectiveDeviation(deviation: number, seenAtIso: string, nowMs = Date.now()): number {
  const months = Math.max(0, (nowMs - Date.parse(seenAtIso)) / MONTH_MS)
  if (!Number.isFinite(months)) return DEVIATION_CAP
  return Math.min(deviation + AGING_PER_MONTH * months, DEVIATION_CAP)
}

/**
 * Живой ярус: «сильное правило, в котором мы уверены».
 * Пороги отклонения калиброваны на СОХРАНЕНИЕ рождений: закон 0.19 (dev(30)≈0.183),
 * привычка 0.32 (dev(10)≈0.316 — привычка из 10 наблюдений рождается привычкой,
 * а не проваливается в гипотезу). Старение честно снимает ярусы без замеров:
 * закон — после ~3.5 мес забвения, привычка малой выборки — уже через ~1–2 мес.
 */
export function liveTier(rating: number, effDeviation: number, total: number): Tier {
  if (rating >= 0.95 && effDeviation <= 0.19 && total >= 30) return 'закон'
  if (rating >= 0.7 && effDeviation <= 0.32 && total >= 3) return 'привычка'
  if (rating >= 0.55) return 'гипотеза'
  return 'нет консенсуса'
}
