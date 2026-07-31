import type { Aggregate } from './analyze'
import { AXES } from './packs'
import { pair } from '../core/i18n'

export type Tier = 'закон' | 'привычка' | 'гипотеза' | 'нет консенсуса'

export interface Fact {
  area: string
  statement: string
  positive: number
  total: number
  prevalence: number
  tier: Tier
}

/** Ярус уверенности из распространённости и объёма выборки. */
export function tierOf(prevalence: number, total: number): Tier {
  if (prevalence >= 0.95 && total >= 30) return 'закон'
  if (prevalence >= 0.7 && total >= 10) return 'привычка'
  if (prevalence >= 0.55) return 'гипотеза'
  return 'нет консенсуса'
}

function dominant(rec: Record<string, number>): { key: string; positive: number; total: number } | null {
  const entries = Object.entries(rec)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  return { key: entries[0][0], positive: entries[0][1], total }
}

function pushDominant(
  facts: Fact[],
  area: string,
  rec: Record<string, number>,
  label: (key: string) => string,
): void {
  const d = dominant(rec)
  if (!d) return
  const prevalence = d.positive / d.total
  facts.push({
    area,
    statement: label(d.key),
    positive: d.positive,
    total: d.total,
    prevalence,
    tier: tierOf(prevalence, d.total),
  })
}

/**
 * Формулировки правил и их английские соответствия — таблица уровня модуля.
 * Именно уровня: перевод регистрируется при загрузке, а не при срабатывании
 * ветки, иначе процесс, который только ЧИТАЕТ факты из журнала, показал бы
 * их по-русски (см. core/i18n.ts).
 */
const L = {
  L0: pair('отступы — 2 пробела', 'indentation — 2 spaces'),
  L1: pair('отступы — 4 пробела', 'indentation — 4 spaces'),
  L2: pair('отступы — табы', 'indentation — tabs'),
  L3: pair('отступы — нестандартный шаг', 'indentation — non-standard step'),
  L4: pair('кавычки — одинарные', 'quotes — single'),
  L5: pair('кавычки — двойные', 'quotes — double'),
  L6: pair('точки с запятой — используются', 'semicolons — used'),
  L7: pair('точки с запятой — не используются', 'semicolons — not used'),
  L8: pair('переменные — только var', 'variables — var only'),
  L9: pair('переменные — const/let (var не используется)', 'variables — const/let (no var)'),
  L10: pair('стрелочные функции — не используются', 'arrow functions — not used'),
  L11: pair('стрелочные функции — используются свободно', 'arrow functions — used freely'),
  L12: pair('filter/map/reduce — не используются (только циклы)', 'filter/map/reduce — not used (loops only)'),
  L13: pair('filter/map/reduce — используются свободно', 'filter/map/reduce — used freely'),
  L14: pair('идентификаторы — snake_case', 'identifiers — snake_case'),
  L15: pair('идентификаторы — camelCase', 'identifiers — camelCase'),
  L16: pair('параметры функций — с префиксом _', 'function parameters — prefixed with _'),
  L17: pair('деструктуризация в параметрах — не используется', 'destructuring in parameters — not used'),
  L18: pair('Vue-компоненты — <script setup>', 'Vue components — <script setup>'),
  L19: pair('Vue-компоненты — Options API', 'Vue components — Options API'),
}

const INDENT_LABEL: Record<string, string> = {
  s2: L.L0,
  s4: L.L1,
  tab: L.L2,
  other: L.L3,
}

/** Из агрегата — список выведенных фактов-конвенций. */
export function deriveFacts(agg: Aggregate): Fact[] {
  const facts: Fact[] = []

  pushDominant(facts, 'форматирование', agg.indent, (k) => INDENT_LABEL[k] ?? k)
  pushDominant(facts, 'форматирование', agg.quotes, (k) =>
    k === 'single' ? L.L4 : L.L5,
  )
  pushDominant(facts, 'форматирование', agg.semis, (k) =>
    k === 'with' ? L.L6 : L.L7,
  )

  const declTotal = agg.decl.var + agg.decl.let + agg.decl.const
  if (declTotal > 0) {
    const modern = agg.decl.let + agg.decl.const
    const varShare = agg.decl.var / declTotal
    if (varShare >= 0.5) {
      facts.push({
        area: 'объявления',
        statement: L.L8,
        positive: agg.decl.var,
        total: declTotal,
        prevalence: varShare,
        tier: tierOf(varShare, declTotal),
      })
    } else {
      const p = modern / declTotal
      facts.push({
        area: 'объявления',
        statement: L.L9,
        positive: modern,
        total: declTotal,
        prevalence: p,
        tier: tierOf(p, declTotal),
      })
    }
  }

  const fnTotal = agg.fn.arrow + agg.fn.decl
  if (fnTotal >= 20) {
    const arrowShare = agg.fn.arrow / fnTotal
    if (arrowShare <= 0.05) {
      facts.push({
        area: 'функции',
        statement: L.L10,
        positive: agg.fn.decl,
        total: fnTotal,
        prevalence: 1 - arrowShare,
        tier: tierOf(1 - arrowShare, fnTotal),
      })
    } else {
      facts.push({
        area: 'функции',
        statement: L.L11,
        positive: agg.fn.arrow,
        total: fnTotal,
        prevalence: arrowShare,
        tier: tierOf(arrowShare, fnTotal),
      })
    }
  }

  const fmr = agg.fmr.filter + agg.fmr.map + agg.fmr.reduce
  const iter = fmr + agg.fmr.forLoops
  if (iter >= 20) {
    if (fmr / iter <= 0.05) {
      facts.push({
        area: 'итерации',
        statement: L.L12,
        positive: agg.fmr.forLoops,
        total: iter,
        prevalence: 1 - fmr / iter,
        tier: tierOf(1 - fmr / iter, iter),
      })
    } else {
      facts.push({
        area: 'итерации',
        statement: L.L13,
        positive: fmr,
        total: iter,
        prevalence: fmr / iter,
        tier: tierOf(fmr / iter, iter),
      })
    }
  }

  const namingTotal =
    agg.naming.camel + agg.naming.snake + agg.naming.plain + agg.naming.pascal
  if (namingTotal >= 20) {
    const camelish = agg.naming.camel + agg.naming.plain
    const p = camelish / namingTotal
    if (agg.naming.snake > camelish) {
      facts.push({
        area: 'именование',
        statement: L.L14,
        positive: agg.naming.snake,
        total: namingTotal,
        prevalence: agg.naming.snake / namingTotal,
        tier: tierOf(agg.naming.snake / namingTotal, namingTotal),
      })
    } else {
      facts.push({
        area: 'именование',
        statement: L.L15,
        positive: camelish,
        total: namingTotal,
        prevalence: p,
        tier: tierOf(p, namingTotal),
      })
    }
  }

  const hungarianTotal = Object.values(agg.hungarianPrefixes).reduce((s, n) => s + n, 0)
  if (agg.hungarianBase >= 30) {
    const share = hungarianTotal / agg.hungarianBase
    if (share >= 0.3) {
      const top = Object.entries(agg.hungarianPrefixes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([p, n]) => `${p}* (${n})`)
        .join(', ')
      facts.push({
        area: 'именование',
        statement: `венгерская нотация — префиксы типа: ${top}`,
        positive: hungarianTotal,
        total: agg.hungarianBase,
        prevalence: share,
        tier: tierOf(share, agg.hungarianBase),
      })
    }
  }

  const paramsTotal = agg.params.underscore + agg.params.plain
  if (paramsTotal >= 30) {
    const share = agg.params.underscore / paramsTotal
    if (share >= 0.5) {
      facts.push({
        area: 'параметры',
        statement: L.L16,
        positive: agg.params.underscore,
        total: paramsTotal,
        prevalence: share,
        tier: tierOf(share, paramsTotal),
      })
    }
    const destrTotal = paramsTotal + agg.destructuredParams
    const destrShare = agg.destructuredParams / destrTotal
    if (destrShare <= 0.02 && destrTotal >= 50) {
      facts.push({
        area: 'параметры',
        statement: L.L17,
        positive: destrTotal - agg.destructuredParams,
        total: destrTotal,
        prevalence: 1 - destrShare,
        tier: tierOf(1 - destrShare, destrTotal),
      })
    }
  }

  pushDominant(facts, 'vue', agg.vue, (k) =>
    k === 'setup' ? L.L18 : L.L19,
  )

  // Оси языковых пакетов (packs.ts). Вердикт по каждой — та же арифметика, что
  // у остальных фактов: побеждает более частая форма, ярус даёт tierOf. Таблица
  // осей знает только, ЧТО измерять; что здесь принято — говорят числа проекта
  for (const axis of AXES) {
    const c = agg.axes[axis.id]
    if (!c) continue
    const total = c.a + c.b
    if (total < axis.min) continue
    const positive = Math.max(c.a, c.b)
    const prevalence = positive / total
    facts.push({
      area: axis.area,
      statement: c.a >= c.b ? axis.labelA : axis.labelB,
      positive,
      total,
      prevalence,
      tier: tierOf(prevalence, total),
    })
  }

  return facts
}
