/**
 * Слой 1 → факты: семантические конвенции из AST-метрик.
 * Пороговая философия та же, что у слоя 0: вердикт только на достаточной
 * выборке, ярус — из распространённости (tierOf).
 */
import type { AstMetrics } from './ast'
import { tierOf, type Fact } from '../miner/facts'
import { pair } from '../core/i18n'

const push = (facts: Fact[], area: string, statement: string, positive: number, total: number): void => {
  const prevalence = total > 0 ? positive / total : 0
  facts.push({ area, statement, positive, total, prevalence, tier: tierOf(prevalence, total) })
}

/**
 * Формулировки правил и их английские соответствия — таблица уровня модуля.
 * Именно уровня: перевод регистрируется при загрузке, а не при срабатывании
 * ветки, иначе процесс, который только ЧИТАЕТ факты из журнала, показал бы
 * их по-русски (см. core/i18n.ts).
 */
const L = {
  L0: pair('пустые catch-блоки — не встречаются (ошибка всегда обрабатывается)', 'empty catch blocks — never (errors are always handled)'),
  L1: pair('пустые catch-блоки — обычное дело (осознанное глушение)', 'empty catch blocks — common (deliberate silencing)'),
  L2: pair('ошибки из catch — возвращаются значением, не пробрасываются', 'errors from catch — returned as a value, not rethrown'),
  L3: pair('ошибки из catch — пробрасываются дальше (re-throw)', 'errors from catch — rethrown further'),
  L4: pair('исключения — ловятся, но свои не бросаются (throw почти не встречается)', 'exceptions — caught but not raised (throw is rare)'),
  L5: pair('async-функции — преобладают', 'async functions — predominant'),
  L6: pair('async-функции — почти не используются', 'async functions — barely used'),
  L7: pair('классы — не используются (функции и модули)', 'classes — not used (functions and modules)'),
  L8: pair('классы — основной строительный блок', 'classes — the main building block'),
}

export function deriveAstFacts(m: AstMetrics): Fact[] {
  const facts: Fact[] = []

  if (m.catchCount >= 10) {
    const nonEmpty = m.catchCount - m.emptyCatch
    if (m.emptyCatch / m.catchCount <= 0.05) {
      push(facts, 'обработка ошибок', L.L0, nonEmpty, m.catchCount)
    } else if (m.emptyCatch / m.catchCount >= 0.3) {
      push(facts, 'обработка ошибок', L.L1, m.emptyCatch, m.catchCount)
    }

    if (m.catchWithReturn / m.catchCount >= 0.7) {
      push(facts, 'обработка ошибок', L.L2, m.catchWithReturn, m.catchCount)
    } else if (m.catchWithRethrow / m.catchCount >= 0.7) {
      push(facts, 'обработка ошибок', L.L3, m.catchWithRethrow, m.catchCount)
    }
  }

  if (m.tryCount >= 10 && m.throwCount <= m.tryCount * 0.05) {
    push(facts, 'обработка ошибок', L.L4, m.tryCount, m.tryCount + m.throwCount)
  }

  if (m.fnTotal >= 20) {
    const asyncShare = m.fnAsync / m.fnTotal
    if (asyncShare >= 0.5) {
      push(facts, 'функции', L.L5, m.fnAsync, m.fnTotal)
    } else if (asyncShare <= 0.05 && m.fnAsync >= 0) {
      push(facts, 'функции', L.L6, m.fnTotal - m.fnAsync, m.fnTotal)
    }

    if (m.classCount === 0) {
      push(facts, 'архитектура', L.L7, m.fnTotal, m.fnTotal)
    } else if (m.classCount >= m.fnTotal * 0.15) {
      push(facts, 'архитектура', L.L8, m.classCount, m.classCount + m.fnTotal)
    }
  }

  return facts
}
