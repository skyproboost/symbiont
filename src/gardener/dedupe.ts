/**
 * Садовник v0: дедуп почти-одинаковых LLM-фактов.
 * Разные модели (или повторные прогоны) формулируют одно правило разными
 * словами — близкие по SimHash активные факты сливаются вытеснением:
 * побеждает более свежий замер, история цела (Datomic). Никогда не молчит —
 * возвращает список слияний.
 *
 * Проходов два, и это не дублирование: SimHash берёт почти-одинаковые СТРОКИ
 * (дёшево, детерминированно, ноль вызовов), смысловой проход — пересказы, у
 * которых общих слов нет вовсе (дорого, один вызов, только внутри и без того
 * дорогого прохода слоя 2). Замер, из-за которого появился второй, — в
 * комментарии к dedupeLlmFactsSemantic.
 */
import type { Database } from '../core/db'
import type { LlmCaller } from '../layer2/llm'
import { jsonOnly } from '../layer2/prompt'
import { simhash, hamming } from './simhash'

const THRESHOLD = 12 // из 64 бит; несвязанные тексты обычно дальше 24
/** Больше — уже не «пересказ», а сваленная в кучу область: такую группу не берём. */
const MAX_GROUP = 8
/** Дешевле не звать модель, чем звать её ради пары строк. */
const MIN_FACTS_TO_ASK = 6

export interface Merge {
  kept: string
  removed: string
}

export function dedupeLlmFacts(db: Database): Merge[] {
  const rows = db
    .query(
      "SELECT id, statement, area, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' ORDER BY seen_at DESC, id DESC",
    )
    .all() as Array<{ id: number; statement: string; area: string; seen_at: string }>
  if (rows.length < 2) return []

  const hashes = rows.map((r) => simhash(`${r.area} ${r.statement}`))
  const gone = new Set<number>()
  const merges: Merge[] = []
  const supersede = db.query('UPDATE fact_journal SET superseded_by=? WHERE id=?')

  // rows отсортированы свежие→старые: свежий побеждает
  for (let i = 0; i < rows.length; i++) {
    if (gone.has(rows[i].id)) continue
    for (let j = i + 1; j < rows.length; j++) {
      if (gone.has(rows[j].id)) continue
      if (hamming(hashes[i], hashes[j]) <= THRESHOLD) {
        supersede.run(rows[i].id, rows[j].id)
        gone.add(rows[j].id)
        merges.push({ kept: rows[i].statement, removed: rows[j].statement })
      }
    }
  }
  return merges
}

/** Строка правила для разбора: номер один на факт, идентичность — по нему. */
export function buildDedupePrompt(items: Array<{ statement: string }>): string {
  return [
    'Ниже — правила, выведенные для ОДНОГО проекта в разное время и разными проходами.',
    'Часть из них — один и тот же вердикт, пересказанный другими словами или на другом языке.',
    '',
    ...items.map((it, i) => `${i + 1}. ${it.statement}`),
    '',
    'Верни группы номеров, которые утверждают ОДНО И ТО ЖЕ правило: следуя одному из них,',
    'автор автоматически соблюдает и остальные, и никакой отдельной информации в них нет.',
    'Правила об одном предмете, но с разными требованиями, — это РАЗНЫЕ правила, не группа',
    '(«комментарий у проглоченной ошибки» и «catch пишется без биндинга» оба про catch, но требуют разного).',
    'Сомневаешься — не объединяй: потерянное правило дороже лишней строки.',
    'Правила, у которых нет пары, в ответ не включай.',
    '',
    jsonOnly('[[1, 5], [2, 7, 9]]'),
  ].join('\n')
}

/** Строгий разбор: мусор = ни одной группы, не исключение. */
export function parseGroups(text: string, count: number): number[][] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: number[][] = []
    for (const g of arr) {
      if (!Array.isArray(g)) continue
      // Индексы вне списка молча отбрасываются: модель, придумавшая номер,
      // не должна двигать факт, которого она не видела
      const idx = [...new Set(g.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count))]
      if (idx.length >= 2 && idx.length <= MAX_GROUP) out.push(idx)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Смысловой дедуп: то, чего не берёт SimHash.
 *
 * Замер на собственном паспорте: из 31 пары, размеченной глазами как один и тот
 * же вердикт, SimHash-порог не поймал НИ ОДНОЙ, а лексический Жаккар по общим
 * латинским словам при девяти пойманных дал одиннадцать ложных слияний — сливал
 * «комментарий у проглоченной ошибки» с «catch без биндинга». Причина в природе
 * дублей: это не почти-одинаковые строки, а пересказы — «exports — named only,
 * default export is not used» и «экспорт — только именованный, default не
 * используется» не делят ни одного общего слова, кроме служебных.
 *
 * Пересказ на другом языке распознаёт только то, что понимает смысл. Модель уже
 * пишет эти правила — она же и судит, где повторилась; вердикт её же природы,
 * а не более слабый. Слияние — вытеснение (superseded_by), поэтому ошибка
 * обратима и история цела, как и у любой другой правки журнала.
 *
 * Fail-open: нет ответа или мусор в нём — ноль слияний, журнал не тронут.
 */
export function dedupeLlmFactsSemantic(db: Database, caller: LlmCaller): Merge[] {
  const rows = db
    .query(
      "SELECT id, statement, area, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' ORDER BY seen_at DESC, id DESC",
    )
    .all() as Array<{ id: number; statement: string; area: string; seen_at: string }>
  if (rows.length < MIN_FACTS_TO_ASK) return []

  const res = caller(buildDedupePrompt(rows))
  if (!res) return []

  const merges: Merge[] = []
  const gone = new Set<number>()
  const supersede = db.query('UPDATE fact_journal SET superseded_by=? WHERE id=?')
  for (const group of parseGroups(res.text, rows.length)) {
    // rows отсортированы свежие→старые, поэтому меньший индекс = более свежий
    // факт: он и остаётся жить, как в SimHash-проходе выше
    const idx = group.sort((a, b) => a - b)
    const keep = rows[idx[0] - 1]
    if (gone.has(keep.id)) continue
    for (const n of idx.slice(1)) {
      const drop = rows[n - 1]
      if (drop.id === keep.id || gone.has(drop.id)) continue
      supersede.run(keep.id, drop.id)
      gone.add(drop.id)
      merges.push({ kept: keep.statement, removed: drop.statement })
    }
  }
  return merges
}
