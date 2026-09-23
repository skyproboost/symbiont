/**
 * Цена подачи с учётом повтора — вторая половина окупаемости.
 *
 * Окупаемость подачи мерилась с одной стороны: лифт отвечает, ПОМОГАЕТ ли
 * поданное, но не сколько оно СТОИТ. А строка в окне стоит не один раз:
 * каждый следующий запрос к модели несёт контекст целиком, и вставленное хуком
 * оплачивается снова на каждом запросе — до ближайшего сжатия. Экономика взята
 * из разбора SoL-Pi (NVlabs): запись в кэш один раз, чтение — каждый раз. Замер
 * на транскриптах владельца: около тысячи токенов подачи за сессию с повтором
 * становились примерно 173 тысячами, и больше трети этой массы давала сводка
 * SessionStart. Правило «пассивная цена ≈ 0» без этого числа было заявлением.
 *
 * Считается потоком по транскрипту в том же Stop, что уже читает его ради
 * гейта доказательств: с сохранённого смещения до конца, без повторного
 * разбора прочитанного. Состояние на сессию — символы нашей подачи, живущие в
 * окне сейчас (по каналам), и накопленные суммы. Ответ модели = один запрос: он
 * перечитал всё живое. Граница сжатия обнуляет живое. Одну строку ответа
 * платформа пишет несколькими записями с тем же id — поэтому дедуп по id.
 *
 * Наша вставка узнаётся по подписи в тексте: её несёт заголовок каждого канала
 * (замер: 2186 из 2186 вставок Symbiont, чужие — без неё). Имя хука в записи
 * отличает канал, но не плагин: у владельца могут стоять и другие.
 *
 * Меряются символы, а не токены: символы видны в транскрипте, токены зависят
 * от языка и токенизатора, и их пересчёт был бы оценкой под видом замера.
 * Хвост сессии после последнего Stop (обрыв посреди хода) не учитывается —
 * метрике он не нужен, а ради него пришлось бы дочитывать чужие транскрипты
 * на старте.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import type { Database } from '../core/db'
import { t } from '../core/i18n'

/** Подпись наших вставок: заголовок каждого канала подачи несёт имя плагина. */
const SIGNATURE = 'Symbiont'

/** Сколько последних id ответов помнить для дедупа записей одного ответа. */
const SEEN_IDS = 64

/** Меньше этого числа учтённых сессий цена в отчёте не показывается: одна сессия — не средняя. */
const MIN_SESSIONS = 3

interface ChannelCost {
  live: number
  once: number
  replay: number
}

interface CostState {
  offset: number
  requests: number
  channels: Record<string, ChannelCost>
  seen: string[]
}

function ensureTable(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS feed_cost(session_id TEXT PRIMARY KEY, byte_offset INTEGER NOT NULL, requests INTEGER NOT NULL, channels TEXT NOT NULL, seen TEXT NOT NULL, updated_at TEXT NOT NULL)',
  )
}

function loadState(db: Database, sid: string): CostState {
  const row = db.query('SELECT byte_offset, requests, channels, seen FROM feed_cost WHERE session_id=?').get(sid) as
    | { byte_offset: number; requests: number; channels: string; seen: string }
    | null
  if (!row) return { offset: 0, requests: 0, channels: {}, seen: [] }
  return { offset: row.byte_offset, requests: row.requests, channels: JSON.parse(row.channels), seen: JSON.parse(row.seen) }
}

/**
 * Прочитать новые полные строки транскрипта после смещения. Незавершённая
 * последняя строка (сессия пишет прямо сейчас) остаётся на следующий раз.
 */
function readNewLines(path: string, offset: number): { lines: string[]; next: number } | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null // транскрипта нет или он занят — посчитаем следующим ходом
  }
  try {
    const size = fstatSync(fd).size
    if (size < offset) return { lines: [], next: -1 } // файл короче прочитанного: это уже другой файл
    if (size === offset) return { lines: [], next: offset }
    const buf = Buffer.alloc(size - offset)
    readSync(fd, buf, 0, buf.length, offset)
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return { lines: [], next: offset }
    return { lines: buf.subarray(0, end).toString('utf8').split('\n'), next: offset + end + 1 }
  } finally {
    closeSync(fd)
  }
}

/** Применить строки транскрипта к состоянию. Чистая функция — сердце учёта. */
export function applyLines(state: CostState, lines: string[]): CostState {
  const channels: Record<string, ChannelCost> = {}
  for (const [ch, c] of Object.entries(state.channels)) channels[ch] = { ...c }
  const seen = [...state.seen]
  let requests = state.requests
  for (const line of lines) {
    // Предфильтр по подстроке: разбирать JSON каждого результата инструмента ради трёх видов записей незачем
    const boundary = line.includes('"compact_boundary"')
    const injection = !boundary && line.includes('"hook_additional_context"')
    const answer = !boundary && !injection && line.includes('"type":"assistant"')
    if (!boundary && !injection && !answer) continue
    let o: {
      type?: string
      subtype?: string
      isSidechain?: boolean
      attachment?: { type?: string; content?: unknown; hookEvent?: string; hookName?: string }
      message?: { id?: string }
    }
    try {
      o = JSON.parse(line)
    } catch {
      continue // битая строка — не повод терять остальной учёт
    }
    if (o.isSidechain === true) continue
    if (boundary && o.type === 'system' && o.subtype === 'compact_boundary') {
      for (const c of Object.values(channels)) c.live = 0
    } else if (injection && o.attachment?.type === 'hook_additional_context' && Array.isArray(o.attachment.content)) {
      const ch = String(o.attachment.hookEvent ?? o.attachment.hookName ?? '?').split(':')[0]
      for (const text of o.attachment.content) {
        if (typeof text !== 'string' || !text.includes(SIGNATURE)) continue
        const c = (channels[ch] ??= { live: 0, once: 0, replay: 0 })
        c.live += text.length
        c.once += text.length
      }
    } else if (answer && o.type === 'assistant' && typeof o.message?.id === 'string' && !seen.includes(o.message.id)) {
      seen.push(o.message.id)
      if (seen.length > SEEN_IDS) seen.shift()
      requests++
      for (const c of Object.values(channels)) c.replay += c.live
    }
  }
  return { offset: state.offset, requests, channels, seen }
}

/**
 * Дочитать транскрипт сессии и обновить её цену подачи. Идемпотентно по
 * смещению: повторный вызов без новых строк ничего не меняет. Никогда не бросает.
 */
export function accountFeedCost(db: Database, sid: string, transcriptPath: string | null, now: Date = new Date()): void {
  if (!transcriptPath) return
  try {
    ensureTable(db)
    let state = loadState(db, sid)
    const read = readNewLines(transcriptPath, state.offset)
    if (!read) return
    if (read.next === -1) {
      // Файл короче прочитанного — учёт с начала: старое смещение указывает в никуда
      state = { offset: 0, requests: 0, channels: {}, seen: [] }
      const again = readNewLines(transcriptPath, 0)
      if (!again || again.next === -1) return
      state = { ...applyLines(state, again.lines), offset: again.next }
    } else {
      if (read.next === state.offset) return
      state = { ...applyLines(state, read.lines), offset: read.next }
    }
    db.query(
      'INSERT INTO feed_cost(session_id, byte_offset, requests, channels, seen, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET byte_offset=excluded.byte_offset, requests=excluded.requests, channels=excluded.channels, seen=excluded.seen, updated_at=excluded.updated_at',
    ).run(sid, state.offset, state.requests, JSON.stringify(state.channels), JSON.stringify(state.seen), now.toISOString())
  } catch {
    /* цена подачи — телеметрия: транскрипт нестабилен, молчание безопасно, подача от него не зависит */
  }
}

export interface FeedCostStats {
  sessions: number
  /** символов подачи на сессию, если считать один раз */
  oncePerSession: number
  /** символов, перечитанных на запросах, на сессию */
  replayPerSession: number
  /** канал с наибольшей долей перечитанного и эта доля в процентах */
  top: { channel: string; share: number } | null
}

/** Средняя цена подачи по учтённым сессиям; null — сессий слишком мало для средней. */
export function feedCostStats(db: Database): FeedCostStats | null {
  try {
    const rows = db.query('SELECT channels FROM feed_cost WHERE requests > 0').all() as Array<{ channels: string }>
    if (rows.length < MIN_SESSIONS) return null
    let once = 0
    let replay = 0
    const byChannel = new Map<string, number>()
    for (const r of rows) {
      for (const [ch, c] of Object.entries(JSON.parse(r.channels) as Record<string, ChannelCost>)) {
        once += c.once
        replay += c.replay
        byChannel.set(ch, (byChannel.get(ch) ?? 0) + c.replay)
      }
    }
    if (once === 0) return null
    const best = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      sessions: rows.length,
      oncePerSession: Math.round(once / rows.length),
      replayPerSession: Math.round(replay / rows.length),
      top: best && replay > 0 ? { channel: best[0], share: Math.round((best[1] / replay) * 100) } : null,
    }
  } catch {
    return null // таблицы ещё нет — Stop с учётом ещё не бегал
  }
}

/** Тысячи символов для отчёта: 5 200 → «5.2», 780 000 → «780». */
function kilo(chars: number): string {
  const k = chars / 1000
  return k >= 100 ? String(Math.round(k)) : k.toFixed(1)
}

/** Строка цены подачи для /sym-status; пустая — показывать нечего. */
export function renderFeedCost(s: FeedCostStats | null): string {
  if (!s) return ''
  const factor = s.oncePerSession > 0 ? Math.round(s.replayPerSession / s.oncePerSession) : 0
  const top = s.top ? t(` · больше всех: ${s.top.channel} ${s.top.share}%`, ` · largest: ${s.top.channel} ${s.top.share}%`) : ''
  return t(
    `~${kilo(s.oncePerSession)} тыс. симв. за сессию, с повтором ~${kilo(s.replayPerSession)} тыс. (×${factor}: каждый запрос перечитывает окно до сжатия)${top} · по ${s.sessions} сессиям`,
    `~${kilo(s.oncePerSession)}k chars per session, ~${kilo(s.replayPerSession)}k with replay (×${factor}: every request re-reads the window until compaction)${top} · over ${s.sessions} sessions`,
  )
}
