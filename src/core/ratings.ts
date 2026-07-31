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

export function confirmRating(prev: Rating, newPrevalence: number): Rating {
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
