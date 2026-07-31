/**
 * Детект клонов кода (дрейф инкремент 3): точные дубли нормализованных блоков.
 *
 * SlopCodeBench (2026): код AI-агентов накапливает КЛОНЫ незаметно — ревьюеры
 * реагируют нейтрально на копипаст, долг растёт молча (silent debt №1). Гейт
 * ловит разовое нарушение, слой дрейфа — тренд; здесь — сам копипаст.
 *
 * Прагматично и ДЕТЕРМИНИРОВАННО: блок = абзац кода (≥ minLines значимых строк
 * между пустыми), нормализуется (комментарии убраны, строки→S, числа→N, пробелы
 * схлопнуты), группируется по хэшу. Блок, встретившийся ≥2 раз, — клон. Точные
 * дубли (после нормализации) — главный класс копипаста; O(n), без LSH.
 *
 * Почти-дубли — второй класс, и на практике более частый: копию правят под новое
 * место (переименовали переменную, добавили строку), и точный хэш её уже не
 * видит. Ловятся SimHash-ом по тем блокам, что НЕ вошли в точные группы: 64 бита,
 * бандовая раскладка вместо полного перебора (пар квадратично много, а
 * совпадение банды отсекает почти всё), затем проверка расстояния Хэмминга.
 * Порог тугой — лучше пропустить сомнительное, чем объявить клоном чужое: ложное
 * обвинение в копипасте дороже пропуска (грабля «ложное обвинение» в истории).
 */
import { sha1 } from '../core/salsa'
// Порог «сгенерированного» — один на весь плагин (слой 0 судит им же файл целиком):
// две копии числа разошлись бы молча
import { GENERATED_LINE_CHARS } from '../miner/analyze'
import { simhash, hamming } from './simhash'

export interface CloneGroup {
  count: number // сколько копий блока
  files: string[] // в каких файлах (уникальные)
  lines: number // размер блока в значимых строках
  sample: string // первая строка блока — для узнавания
}

const MIN_LINES = 6
const MIN_CHARS = 80
/**
 * Средняя длина строки, после которой блок считается сгенерированным (минифай,
 * бандл, вложенный дамп). Отсекается ДО нормализации по двум причинам. По сути:
 * такое «дублирование» не копипаст автора — он этих строк не писал, и звать его
 * их чинить значит обвинять ложно. По цене: именно на таких строках регэкспы
 * нормализации стоят секунды — замер на боевом проекте показал 3.3с на ОДИН
 * 20-килобайтный файл и 36с на весь проход, который идёт в фоне у владельца.
 */
// Строковый литерал '…'|"…"|`…` (с экранированием) → S; число → N.
// Три явные ветки с отрицающим классом вместо одной с обратной ссылкой и
// lookahead: `(['"`])(?:\\.|(?!\1).)*\1` на незакрытой кавычке уходит в
// катастрофический бэктрекинг — 3 секунды на пятикилобайтном файле правил
// валидации (замер на боевом проекте). Запрет перевода строки внутри '' и ""
// ограничивает откат строкой, а не файлом.
const STRING_LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g
const NUMBER_LIT = /\b\d[\d._]*\b/g
const LINE_COMMENT = /\/\/.*$|#(?!!).*$/ // // … и # … (не трогаем shebang #!)

/** Нормализация блока: убрать комментарии/пустые, строки→S, числа→N, схлопнуть пробелы. */
export function normalizeBlock(block: string): { norm: string; lines: number; first: string } | null {
  const kept = block
    .split('\n')
    .map((l) => l.replace(LINE_COMMENT, '').replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
  if (kept.length < MIN_LINES) return null
  // Проверка до тяжёлых регэкспов — в этом весь смысл её места здесь
  if (kept.reduce((s, l) => s + l.length, 0) / kept.length > GENERATED_LINE_CHARS) return null
  const first = kept[0].trim().slice(0, 70)
  let s = kept.join('\n').replace(STRING_LIT, 'S').replace(NUMBER_LIT, 'N').replace(/[ \t]+/g, ' ').trim()
  if (s.length < MIN_CHARS) return null
  return { norm: s, lines: kept.length, first }
}

/** Клон-группы: одинаковые нормализованные блоки, встретившиеся ≥2 раз. */
export function findClones(files: Array<{ rel: string; content: string }>, k = 8): CloneGroup[] {
  const byHash = new Map<string, { files: Set<string>; count: number; lines: number; first: string }>()
  for (const f of files) {
    for (const raw of f.content.split(/\n[ \t]*\n/)) {
      const n = normalizeBlock(raw)
      if (!n) continue
      const h = sha1(n.norm)
      const g = byHash.get(h) ?? { files: new Set<string>(), count: 0, lines: n.lines, first: n.first }
      g.files.add(f.rel)
      g.count++
      byHash.set(h, g)
    }
  }
  return [...byHash.values()]
    .filter((g) => g.count >= 2)
    .map((g) => ({ count: g.count, files: [...g.files], lines: g.lines, sample: g.first }))
    .sort((a, b) => b.count * b.lines - a.count * a.lines)
    .slice(0, k)
}

export interface NearClone {
  /** где лежит блок и чем он узнаётся */
  a: { file: string; sample: string; lines: number }
  b: { file: string; sample: string; lines: number }
  /** расстояние Хэмминга по 64 битам: 0 — совпали бы точно, порог — NEAR_MAX_DIST */
  distance: number
}

/** Максимум различающихся бит из 64: ~94% сходства. Туго намеренно (см. заголовок). */
const NEAR_MAX_DIST = 4
/** Бандовая раскладка: совпадение любой 16-битной банды → пара-кандидат. */
const BANDS = 4
const BAND_BITS = 16n
/** Потолок числа блоков в разборе: защита от квадратичной цены на гигантском репо. */
const NEAR_MAX_BLOCKS = 4000
/** Разница в размере, после которой блоки считаются разными по сути. */
const NEAR_SIZE_TOLERANCE = 0.3
/** Сколько токенов блока участвует в SimHash — цена разбора должна быть ограничена. */
const NEAR_MAX_TOKENS = 400

interface Block {
  file: string
  sample: string
  lines: number
  hash: bigint
  /** точный хэш нормализованного блока — по нему отсеиваются полные дубли */
  exact: string
}

/**
 * Почти-дубли: блоки, не совпавшие точно, но отличающиеся на считанные биты
 * SimHash. Кандидаты берутся по совпадению банды — это отсекает подавляющее
 * большинство пар, не считая расстояние. Дополнительный фильтр по размеру:
 * блоки разной длины похожими словами обманывают SimHash чаще всего.
 */
export function findNearClones(files: Array<{ rel: string; content: string }>, k = 5): NearClone[] {
  const seen = new Map<string, number>()
  const blocks: Block[] = []
  for (const f of files) {
    for (const raw of f.content.split(/\n[ \t]*\n/)) {
      const n = normalizeBlock(raw)
      if (!n) continue
      const h = sha1(n.norm)
      seen.set(h, (seen.get(h) ?? 0) + 1)
      if (blocks.length < NEAR_MAX_BLOCKS) blocks.push({ file: f.rel, sample: n.first, lines: n.lines, hash: simhash(n.norm, NEAR_MAX_TOKENS), exact: h })
    }
  }
  // Точные дубли уже посчитаны findClones — здесь они были бы шумом
  const unique = blocks.filter((b) => (seen.get(b.exact) ?? 0) === 1)

  const buckets = new Map<string, number[]>()
  for (let i = 0; i < unique.length; i++) {
    for (let band = 0; band < BANDS; band++) {
      const key = `${band}:${(unique[i].hash >> (BigInt(band) * BAND_BITS)) & ((1n << BAND_BITS) - 1n)}`
      const list = buckets.get(key) ?? []
      list.push(i)
      buckets.set(key, list)
    }
  }

  const found = new Map<string, NearClone>()
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 64) continue // огромная банда — вырожденный блок, не сигнал
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = unique[list[x]]
        const b = unique[list[y]]
        if (a.hash === b.hash) continue // это точный дубль, его показывает findClones
        const bigger = Math.max(a.lines, b.lines)
        if (Math.abs(a.lines - b.lines) / bigger > NEAR_SIZE_TOLERANCE) continue
        const d = hamming(a.hash, b.hash)
        if (d > NEAR_MAX_DIST) continue
        const key = [`${a.file}|${a.sample}`, `${b.file}|${b.sample}`].sort().join('≈')
        if (!found.has(key)) found.set(key, { a, b, distance: d })
      }
    }
  }

  return [...found.values()]
    .sort((x, y) => x.distance - y.distance || y.a.lines - x.a.lines)
    .slice(0, k)
}

/** Строки клонов для отчёта /sym-drift; пусто → без секции. */
export function renderClones(clones: CloneGroup[], near: NearClone[] = []): string[] {
  if (clones.length === 0 && near.length === 0) return []
  const lines: string[] = []
  if (clones.length > 0) {
    lines.push(' Клоны кода (точные дубли блоков — копипаст, silent debt AI-кода)')
    for (const c of clones) {
      const where = c.files.length === 1 ? `${c.files[0]} (×${c.count})` : `${c.count} копий в ${c.files.length} файлах: ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? ', …' : ''}`
      lines.push(`   ${c.lines}-строчный блок «${c.sample}…» — ${where}`)
    }
  }
  if (near.length > 0) {
    lines.push(' Почти-дубли (копия, правленная под новое место — точный хэш её не видит)')
    for (const n of near) {
      lines.push(`   «${n.a.sample}…» (${n.a.file}) ≈ «${n.b.sample}…» (${n.b.file}) — расходятся на ${n.distance} из 64 бит`)
    }
  }
  return lines
}
