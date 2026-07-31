/**
 * Накопленное знание о ВИДАХ МАТЕРИАЛА — единственное, что вправе переезжать
 * между проектами владельца.
 *
 * Зачем. Встретив незнакомый вид файлов, Symbiont учится его понимать — но до
 * сих пор это знание умирало вместе с проектом: в следующем репозитории всё
 * начиналось с нуля. Система адаптировалась, но не накапливала.
 *
 * ГРАНИЦА ПРИВАТНОСТИ — главный инвариант модуля, и она проведена по смыслу, а
 * не по удобству. Переезжает знание О ФОРМАТЕ: что такой вид файлов обычно
 * ходит парой с другим, каков его характерный размер, чем он бывает — исходником
 * или производным. НЕ переезжает ничего о проекте: ни путей, ни имён файлов, ни
 * имён репозиториев, ни содержимого, ни статистики конкретного продукта. Правило
 * проверяется на записи, а не на честном слове: всё, что не является
 * расширением или отношением видов, отбрасывается при сохранении.
 *
 * Почему это не противоречит «индивидуальности»: перенесённое знание —
 * ПОДСКАЗКА, а не вердикт. Наблюдение в текущем проекте всегда сильнее: если
 * здесь .scss живёт отдельно от компонентов, так и будет записано, независимо
 * от того, что мы видели в пяти других репозиториях.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MaterialKnowledge {
  /** вид материала — расширение и ничего больше */
  ext: string
  /** виды, с которыми он обычно ходит парой */
  pairsWith: string[]
  /** характерный размер в строках (медиана медиан по проектам) */
  typicalLines: number
  /** в скольких РАЗНЫХ проектах наблюдался (имена проектов не хранятся) */
  seenIn: number
  updatedAt: string
}

const FILE = 'learned-materials.json'
/** Подсказка появляется, только когда вид встречен не единожды. */
const MIN_PROJECTS = 2
const MAX_ENTRIES = 200

/** Расширение — и только оно: путь, имя проекта или содержимое сюда не пройдут. */
const isSafeExt = (s: string): boolean => /^\.[a-z0-9][a-z0-9._-]{0,20}$/i.test(s) || s === '(без расширения)'

/**
 * Санитайзер границы приватности. Всё, что не расширение и не число, вырезается
 * молча: тихая потеря подозрительного поля безопаснее, чем попытка его починить.
 */
function sanitize(entry: unknown): MaterialKnowledge | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.ext !== 'string' || !isSafeExt(e.ext)) return null
  const pairs = Array.isArray(e.pairsWith) ? e.pairsWith.filter((p): p is string => typeof p === 'string' && isSafeExt(p)) : []
  const lines = typeof e.typicalLines === 'number' && Number.isFinite(e.typicalLines) ? Math.max(0, Math.round(e.typicalLines)) : 0
  const seen = typeof e.seenIn === 'number' && Number.isFinite(e.seenIn) ? Math.max(1, Math.round(e.seenIn)) : 1
  return {
    ext: e.ext,
    pairsWith: [...new Set(pairs)].slice(0, 6),
    typicalLines: lines,
    seenIn: Math.min(seen, 999),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt.slice(0, 30) : new Date().toISOString(),
  }
}

export function readLearnedMaterials(root: string): MaterialKnowledge[] {
  try {
    const p = join(root, FILE)
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.map(sanitize).filter((x): x is MaterialKnowledge => x !== null)
  } catch {
    return [] // битый файл — знание начнётся заново, это дешевле починки
  }
}

export interface MaterialObservation {
  ext: string
  pairsWith: string[]
  medianLines: number
}

/**
 * Влить наблюдения текущего проекта в общий каталог. Счётчик проектов растёт
 * только при первой встрече вида в ЭТОМ проекте — иначе один активный
 * репозиторий выдавал бы себя за десять и создавал ложную уверенность.
 */
export function mergeLearnedMaterials(
  root: string,
  observations: MaterialObservation[],
  projectKey: string,
  nowIso = new Date().toISOString(),
): number {
  try {
    const existing = readLearnedMaterials(root)
    const byExt = new Map(existing.map((e) => [e.ext, e]))
    const seenPath = join(root, 'learned-seen.json')
    let seen: Record<string, string[]> = {}
    try {
      seen = existsSync(seenPath) ? (JSON.parse(readFileSync(seenPath, 'utf8')) as Record<string, string[]>) : {}
    } catch {
      seen = {}
    }

    let changed = 0
    for (const o of observations) {
      const safe = sanitize({ ext: o.ext, pairsWith: o.pairsWith, typicalLines: o.medianLines, seenIn: 1, updatedAt: nowIso })
      if (!safe) continue
      const prev = byExt.get(safe.ext)
      const projects = new Set(seen[safe.ext] ?? [])
      const isNewProject = !projects.has(projectKey)
      projects.add(projectKey)
      seen[safe.ext] = [...projects].slice(-50)

      if (!prev) {
        byExt.set(safe.ext, safe)
      } else {
        // Пары объединяются: разные проекты видят разные грани одного вида
        prev.pairsWith = [...new Set([...prev.pairsWith, ...safe.pairsWith])].slice(0, 6)
        prev.typicalLines = safe.typicalLines > 0 ? Math.round((prev.typicalLines + safe.typicalLines) / 2) : prev.typicalLines
        if (isNewProject) prev.seenIn = Math.min(prev.seenIn + 1, 999)
        prev.updatedAt = nowIso
      }
      changed++
    }

    const out = [...byExt.values()].sort((a, b) => b.seenIn - a.seenIn).slice(0, MAX_ENTRIES)
    writeFileSync(join(root, FILE), JSON.stringify(out, null, 1), 'utf8')
    writeFileSync(seenPath, JSON.stringify(seen, null, 1), 'utf8')
    return changed
  } catch {
    return 0 // накопление — обогащение; его сбой не касается работы с проектом
  }
}

/**
 * Подсказка для видов материала текущего проекта: что о них известно по опыту
 * других проектов. Только для видов, встреченных не единожды, — единичное
 * наблюдение это совпадение, а не знание.
 */
export function hintsForMaterials(root: string, exts: string[]): string[] {
  const known = readLearnedMaterials(root)
  const wanted = new Set(exts)
  const out: string[] = []
  for (const k of known) {
    if (!wanted.has(k.ext) || k.seenIn < MIN_PROJECTS) continue
    const parts: string[] = []
    if (k.pairsWith.length > 0) parts.push(`обычно ходит парой с ${k.pairsWith.join(', ')}`)
    if (k.typicalLines > 0) parts.push(`характерный размер ~${k.typicalLines} строк`)
    if (parts.length > 0) out.push(`${k.ext}: ${parts.join(', ')} (по опыту ${k.seenIn} проектов)`)
  }
  return out.slice(0, 5)
}
