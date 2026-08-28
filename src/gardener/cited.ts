/**
 * Самоотчёт модели о поданном: названо ли поданное в её собственном ответе.
 *
 * У окупаемости подачи было два сигнала: «поданный файл потом правили»
 * (jit_log.used) и лифт против удержанной группы. Оба молчат о подаче,
 * которая пригодилась, но не привела к правке: модель прочла срез узла,
 * поняла, что править надо не здесь, и назвала владельцу правильный модуль.
 * Третий сигнал — сама речь модели: поданный файл, упомянутый в её тексте
 * (не в вызовах инструментов — там путь стоит и у слепого чтения), считается
 * НАЗВАННЫМ. Это прямой аналог self-report'а в feedback-ledger'е duet
 * («worker возвращает memoryFeedback, но только по UUID, показанным в этом
 * turn»), только без просьбы к модели что-либо возвращать: транскрипт уже на
 * диске, ни одного нового процесса и ни одного токена.
 *
 * Границы честности. Судятся только ключи, поданные В ЭТОЙ сессии, и только
 * текст ассистента этой сессии. Удержанные подачи (контрольная группа) тоже
 * считаются — упоминание удержанного файла даёт базовую линию «модель назвала
 * бы его и без нас», и лифт по этому сигналу считается так же, как по правке.
 * Имя файла без каталога засчитывается, только если оно единственное среди
 * поданных в сессии: «index.ts» в ответе ничего не доказывает.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Database } from '../core/db'

/** Хвост транскрипта: тот же предел, что у гейта доказательств. */
const TAIL_LINES = 4000

/** Весь текст ассистента из транскрипта, одной строкой; пусто — если транскрипта нет. */
export function assistantText(transcriptPath: string | null): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return ''
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return '' // транскрипт занят — самоотчёт подождёт следующего хода
  }
  if (lines.length > TAIL_LINES) lines = lines.slice(-TAIL_LINES)
  const out: string[] = []
  for (const line of lines) {
    if (!line.includes('"type":"assistant"') || !line.includes('"text"')) continue
    let obj: { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue // обрезанная строка (сессия пишет прямо сейчас)
    }
    if (obj.type !== 'assistant' || !Array.isArray(obj.message?.content)) continue
    for (const c of obj.message?.content ?? []) if (c.type === 'text' && typeof c.text === 'string') out.push(c.text)
  }
  return out.join('\n')
}

/** Какие из поданных ключей названы в тексте (путь целиком или уникальное имя файла). */
export function citedKeys(surfaced: string[], text: string): string[] {
  if (!text) return []
  const byBase = new Map<string, number>()
  for (const f of surfaced) byBase.set(basename(f), (byBase.get(basename(f)) ?? 0) + 1)
  return surfaced.filter((f) => text.includes(f) || (byBase.get(basename(f)) === 1 && text.includes(basename(f))))
}

/**
 * Отметить в jit_log названные подачи сессии. Идемпотентно; возвращает число
 * новых отметок. Синтетические ключи (#playbook/#lesson) — не файлы, в тексте
 * их не бывает, поэтому они вне разбора.
 */
export function markCited(db: Database, sessionId: string, transcriptPath: string | null): number {
  try {
    const rows = db.query("SELECT file FROM jit_log WHERE session_id=? AND cited=0 AND file NOT LIKE '#%'").all(sessionId) as Array<{ file: string }>
    if (rows.length === 0) return 0
    const text = assistantText(transcriptPath)
    if (!text) return 0
    const upd = db.query('UPDATE jit_log SET cited=1 WHERE session_id=? AND file=?')
    let n = 0
    for (const key of citedKeys(rows.map((r) => r.file), text)) n += Number(upd.run(sessionId, key).changes)
    return n
  } catch {
    return 0 // старая схема без колонки — самоотчёт best-effort, как и остальная телеметрия
  }
}

export interface CitedStats {
  surfaced: number
  cited: number
  /** лифт в процентных пунктах против удержанной группы; null — группа мала */
  lift: number | null
}

/** Ниже этого числа удержаний лифт не показывается — тот же порог, что у правок (utility.ts). */
const MIN_WITHHELD = 8

/** Сколько поданных файлов модель назвала в ответах, и лифт против удержанных. */
export function citedStats(db: Database): CitedStats | null {
  try {
    const row = db
      .query(
        `SELECT
           SUM(CASE WHEN withheld=0 THEN 1 ELSE 0 END) s,
           SUM(CASE WHEN withheld=0 AND cited=1 THEN 1 ELSE 0 END) sc,
           SUM(CASE WHEN withheld=1 THEN 1 ELSE 0 END) w,
           SUM(CASE WHEN withheld=1 AND cited=1 THEN 1 ELSE 0 END) wc
         FROM jit_log WHERE file NOT LIKE '#%'`,
      )
      .get() as { s: number | null; sc: number | null; w: number | null; wc: number | null } | null
    const surfaced = row?.s ?? 0
    if (surfaced === 0) return null
    const cited = row?.sc ?? 0
    const withheld = row?.w ?? 0
    const lift = withheld >= MIN_WITHHELD ? Math.round((cited / surfaced - (row?.wc ?? 0) / withheld) * 100) : null
    return { surfaced, cited, lift }
  } catch {
    return null
  }
}
