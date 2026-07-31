/**
 * Ре-заземление знания наружу: единственное место, где система стареет без
 * механизма обновления.
 *
 * Диагноз. Знание Symbiont ВНУТРЬ (конвенции проекта) само-адаптивно: оно
 * выводится, стареет, переподтверждается. А знание НАРУЖУ — доменные плейбуки и
 * рубрика возвышения — курируемая библиотека, замороженная в момент написания.
 * Core Web Vitals меняли пороги, OWASP переиздаёт список, WCAG выпускает версии.
 * Экспертиза, верная год назад, сегодня тихо вводит в заблуждение — и это худший
 * вид ошибки: она выглядит как знание.
 *
 * КЛЮЧЕВОЕ РЕШЕНИЕ: курируемое знание НЕ переписывается. Оно остаётся сидом в
 * коде, а результат ре-заземления ложится рядом ПОПРАВКАМИ — обычными фактами
 * журнала, которые стареют и подтверждаются по общим законам. Причины две.
 * Во-первых, код правит человек, а не фоновый процесс: самоперезапись исходников
 * — это дыра, а не фича. Во-вторых, поправка с датой и источником честнее
 * молчаливой подмены: видно, что изменилось и когда мы это узнали.
 *
 * Дорого и редко: веб-проход раз в квартал на направление, только для тех, что
 * реально активны в проекте. Стандарты не меняются еженедельно.
 */
import type { Database } from '../core/db'

/** Через сколько знание о стандартах считается требующим перепроверки. */
export const GROUNDING_TTL_DAYS = 90

export interface GroundingRecord {
  domain: string
  checkedAt: string
  /** что изменилось с момента написания плейбука; пусто — подтверждено без изменений */
  correction: string
  source: string
}

export function ensureGroundingTable(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS grounding(
       domain TEXT PRIMARY KEY, checked_at TEXT NOT NULL, correction TEXT NOT NULL, source TEXT NOT NULL)`,
  )
}

export function readGrounding(db: Database): GroundingRecord[] {
  try {
    ensureGroundingTable(db)
    return (db.query('SELECT domain, checked_at, correction, source FROM grounding').all() as Array<Record<string, string>>).map((r) => ({
      domain: r.domain,
      checkedAt: r.checked_at,
      correction: r.correction,
      source: r.source,
    }))
  } catch {
    return []
  }
}

export function storeGrounding(db: Database, rec: GroundingRecord): void {
  try {
    ensureGroundingTable(db)
    db.query(
      `INSERT INTO grounding(domain, checked_at, correction, source) VALUES(?,?,?,?)
       ON CONFLICT(domain) DO UPDATE SET checked_at=excluded.checked_at, correction=excluded.correction, source=excluded.source`,
    ).run(rec.domain, rec.checkedAt, rec.correction.slice(0, 600), rec.source.slice(0, 200))
  } catch {
    /* запись поправки — обогащение; её потеря не отменяет плейбук */
  }
}

/**
 * Направления, чьё знание пора перепроверить: активные в проекте и либо ни разу
 * не проверенные, либо проверенные давно. Возвращается по одному за раз —
 * веб-проход дорог, а торопиться некуда.
 */
export function dueForGrounding(db: Database, activeDomains: string[], nowMs: number): string | null {
  if (activeDomains.length === 0) return null
  const byDomain = new Map(readGrounding(db).map((r) => [r.domain, r]))
  const ttlMs = GROUNDING_TTL_DAYS * 24 * 3600_000

  // Сначала никогда не проверенные: о них мы не знаем вообще ничего
  for (const d of activeDomains) {
    if (!byDomain.has(d)) return d
  }
  // Затем самое старое из просроченного
  const stale = activeDomains
    .map((d) => ({ d, rec: byDomain.get(d) as GroundingRecord }))
    .filter((x) => nowMs - Date.parse(x.rec.checkedAt) > ttlMs)
    .sort((a, b) => Date.parse(a.rec.checkedAt) - Date.parse(b.rec.checkedAt))
  return stale.length > 0 ? stale[0].d : null
}

/**
 * Промпт перепроверки. Спрашиваем не «расскажи про направление» (получим общие
 * места), а узко: изменилось ли ИМЕННО ЭТО с указанной даты. Узкий вопрос даёт
 * проверяемый ответ и позволяет честно сказать «ничего не изменилось».
 */
export function buildGroundingPrompt(domain: string, checklist: string[], thresholds: string[], source: string): string {
  return [
    `Проверь, не устарели ли эти инженерные ориентиры по направлению «${domain}».`,
    '',
    'Текущие ориентиры (записаны ранее из официальных источников):',
    ...checklist.slice(0, 8).map((c) => `- ${c}`),
    ...(thresholds.length > 0 ? ['', 'Пороги:', ...thresholds.map((t) => `- ${t}`)] : []),
    '',
    `Заявленный источник: ${source}`,
    '',
    'Найди в вебе АКТУАЛЬНОЕ состояние этих стандартов и ответь строго по делу: что из перечисленного изменилось, какие числа стали другими, что признано устаревшим, что добавилось важного.',
    '',
    'Ответ — ТОЛЬКО валидный JSON без markdown:',
    '{"changed": true|false, "correction": "что именно изменилось, с числами", "source": "ссылка или название источника"}',
    '',
    'Если ничего существенного не изменилось — верни changed: false и пустую correction. Это нормальный и ожидаемый ответ: стандарты меняются редко, и подтверждение не менее ценно, чем поправка.',
  ].join('\n')
}

export interface GroundingAnswer {
  changed: boolean
  correction: string
  source: string
}

/** Строгий разбор: мусор = «не изменилось», а не выдуманная поправка. */
export function parseGrounding(text: string): GroundingAnswer | null {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const changed = o.changed === true
    const correction = typeof o.correction === 'string' ? o.correction.trim() : ''
    // «Изменилось» без содержания — это не находка, а шум
    if (changed && correction.length < 15) return null
    return { changed, correction, source: typeof o.source === 'string' ? o.source.trim() : '' }
  } catch {
    return null
  }
}

/**
 * Поправка к плейбуку для подачи. Показывается рядом с курируемым знанием, а не
 * вместо него: владелец должен видеть и исходный ориентир, и то, что мы узнали
 * позже, — иначе поправка выглядит как произвол.
 */
export function renderCorrection(rec: GroundingRecord | undefined): string {
  if (!rec || !rec.correction) return ''
  const when = rec.checkedAt.slice(0, 10)
  return `уточнение от ${when}: ${rec.correction}${rec.source ? ` (${rec.source})` : ''}`
}
