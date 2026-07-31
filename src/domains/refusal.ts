/**
 * Петля закалки об отказы (рамка легитимности, инкремент 2).
 *
 * Проблема родом из боевой практики владельца: на легитимном чувствительном
 * контенте (медицина, безопасность, финансы) модель иногда отказывает — и работа
 * встаёт, хотя задача законная. Рамка легитимности (frame.ts) уже выводит из
 * самого проекта сухие правдивые факты, снимающие такие отказы, но до сих пор
 * она подавалась только в сессию владельца. Собственные LLM-проходы плагина
 * (вербализация, роли узлов, аудит возвышения) шли БЕЗ неё и молча падали в ноль:
 * снаружи это выглядело как «модель недоступна».
 *
 * Здесь — три вещи, замыкающие петлю:
 * 1) детект отказа (в отличие от ошибки сети или лимита — это разные события);
 * 2) авто-ретест С рамкой: отказ без рамки → ровно один повтор с ней. Это и есть
 *    закалка в действии, и она же — измерение: помогла рамка или нет;
 * 3) журнал отказов — сырьё для оценки, какие факты рамки реально работают
 *    (Glicko-подход к рамке: подтверждается тем, что снимает отказы).
 *
 * Честная граница: отказы в сессии ВЛАДЕЛЬЦА мы не видим — платформа не отдаёт
 * stop_reason хукам. Меряем только свои вызовы и не притворяемся, что знаем
 * больше (аксиома «факты, не догадки»).
 */
import type { Database } from '../core/db'

/**
 * Маркеры отказа в тексте ответа — кросс-язычные, намеренно узкие.
 * Без \b в русских шаблонах: в JS граница слова определена через [A-Za-z0-9_],
 * кириллица в неё не входит, и `\b` перед «не» не срабатывает НИКОГДА
 * (грабля, пойманная в проекте трижды — теперь её стережёт селф-линт).
 */
const REFUSAL_MARKERS = [
  /\bI can(?:'|no)t (?:help|assist|provide|continue)/i,
  /\bI(?:'m| am) (?:unable|not able) to (?:help|assist|provide)/i,
  /не могу (?:помочь|предоставить|продолжить|выполнить)/i,
  /я не буду/i,
  /это выходит за рамки того, что я могу/i,
]

export interface RefusalVerdict {
  refused: boolean
  /** почему так решили — попадает в журнал, чтобы вердикт был проверяем */
  reason: string
}

/**
 * Отказ ли это. Приоритет у явного признака платформы (stop_reason), текстовые
 * маркеры — запасной путь. Пустой ответ отказом НЕ считается: это ошибка
 * доставки, и лечится она ретраем модели, а не рамкой.
 */
export function detectRefusal(parsed: Record<string, unknown>, text: string): RefusalVerdict {
  if (parsed.stop_reason === 'refusal') return { refused: true, reason: 'stop_reason=refusal' }
  const trimmed = text.trim()
  if (trimmed.length === 0) return { refused: false, reason: 'пустой ответ — не отказ, а сбой доставки' }
  // Короткий ответ + маркер: длинный текст с такой фразой внутри — обычно
  // рассуждение о отказах, а не отказ (анти-шум).
  if (trimmed.length <= 600) {
    for (const m of REFUSAL_MARKERS) {
      if (m.test(trimmed)) return { refused: true, reason: `маркер отказа: ${m.source.slice(0, 40)}` }
    }
  }
  return { refused: false, reason: '' }
}

export function ensureRefusalLog(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS refusal_log(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, framed INTEGER NOT NULL, resolved INTEGER NOT NULL, reason TEXT NOT NULL)',
  )
}

/**
 * Записать событие отказа. framed — была ли рамка в промпте; resolved — снял ли
 * повтор с рамкой этот отказ. Вместе они и отвечают на вопрос «работает ли рамка».
 */
export function recordRefusal(
  db: Database,
  ev: { model: string; purpose: string; framed: boolean; resolved: boolean; reason: string; at?: string },
): void {
  try {
    ensureRefusalLog(db)
    db.query('INSERT INTO refusal_log(at, model, purpose, framed, resolved, reason) VALUES(?,?,?,?,?,?)').run(
      ev.at ?? new Date().toISOString(),
      ev.model,
      ev.purpose,
      ev.framed ? 1 : 0,
      ev.resolved ? 1 : 0,
      ev.reason.slice(0, 200),
    )
  } catch {
    /* журнал отказов — наблюдаемость, его потеря не ломает вызов */
  }
}

/**
 * Пометить последние отказы снятыми: проход всё-таки получил ответ (другой
 * моделью или с рамкой). Без этого журнал показывал бы только провалы и
 * выглядел бы страшнее реальности — а нам нужна честная мера, не тревога.
 */
export function markRefusalsResolved(db: Database, count: number): void {
  if (count <= 0) return
  try {
    ensureRefusalLog(db)
    db.query('UPDATE refusal_log SET resolved=1 WHERE id IN (SELECT id FROM refusal_log ORDER BY id DESC LIMIT ?)').run(count)
  } catch {
    /* см. recordRefusal */
  }
}

export interface RefusalStats {
  total: number
  /** отказов, снятых повтором с рамкой — прямая мера её пользы */
  resolvedByFrame: number
  /** отказов, случившихся ДАЖЕ с рамкой — сигнал, что фактов не хватает */
  refusedWithFrame: number
}

export function refusalStats(db: Database): RefusalStats {
  try {
    ensureRefusalLog(db)
    const row = db
      .query(
        'SELECT COUNT(*) total, SUM(resolved) resolved, SUM(CASE WHEN framed=1 AND resolved=0 THEN 1 ELSE 0 END) withFrame FROM refusal_log',
      )
      .get() as { total: number; resolved: number | null; withFrame: number | null }
    return { total: row.total, resolvedByFrame: row.resolved ?? 0, refusedWithFrame: row.withFrame ?? 0 }
  } catch {
    return { total: 0, resolvedByFrame: 0, refusedWithFrame: 0 }
  }
}

/** Строка наблюдаемости: молчит, пока отказов не было. */
export function renderRefusals(s: RefusalStats): string {
  if (s.total === 0) return ''
  const parts = [`отказов на своих проходах: ${s.total}`]
  if (s.resolvedByFrame > 0) parts.push(`снято рамкой: ${s.resolvedByFrame}`)
  if (s.refusedWithFrame > 0) parts.push(`⚠ не снято даже с рамкой: ${s.refusedWithFrame} (фактов легитимности не хватает)`)
  return parts.join(' · ')
}
