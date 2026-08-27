/**
 * Устные правила владельца: то, что он сказал модели в чате, а не поправил в коде.
 *
 * Петля поправок видит только правку («модель написала → человек исправил»).
 * Правило, произнесённое в чате — «не трогай прод-оплаты», «всегда гоняй
 * канарейку» — в код не попадает и умирает вместе с сессией; в следующей его
 * говорят заново. Транскрипт у нас уже читается (гейт доказательств, серия
 * разведки), и стоит это ноль новых процессов — отсюда и берётся сырьё.
 *
 * Что считается сырьём. ТОЛЬКО набранное владельцем: строка `type:"user"`, у
 * которой content — строка (результаты инструментов приходят массивом), без
 * isMeta, не служебная (`<command-name>`, `<system-reminder>`) и человеческой
 * длины. Замер на собственных транскриптах: без этого фильтра «правилами
 * владельца» становились строки паспорта из НАШИХ ЖЕ headless-промптов —
 * 62 «сессии» повторяли «всегда дожидается снятия локов».
 *
 * Что считается правилом. Форма предписания или запрета (никогда/всегда/
 * нельзя/не …/never/always/don't), без вопросительного знака и без кода.
 * Форма, не смысл: смысл здесь не судится, а копится — правило показывается
 * владельцу, когда повторилось в ≥ VOICED_MIN_SESSIONS разных сессиях, и
 * только как кандидат в устав. Одиночная фраза молчит: она может быть про
 * одну задачу, а не про проект.
 *
 * Отвергнуто: хранить ходы транскрипта целиком и искать по ним (как делают
 * «памяти сессий»). Сырой ход несёт отозванные вердикты и чужие цитаты, и
 * поданный обратно выглядит авторитетно ровно потому, что пришёл тем же
 * каналом. Здесь хранится только форма правила, и только повтор даёт ей голос.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Database } from '../core/db'
import { t } from '../core/i18n'

/** В скольких разных сессиях правило должно прозвучать, чтобы получить голос. */
export const VOICED_MIN_SESSIONS = 2
/** Длиннее — уже не сообщение владельца, а вставленный документ или наш промпт. */
const OWNER_PROMPT_MAX = 2000
const SENTENCE_MIN = 12
const SENTENCE_MAX = 220
const TAIL_LINES = 4000
/** Сколько кандидатов показывать в сводке: это приглашение в устав, не сам устав. */
const SHOW_MAX = 3

/** Форма предписания/запрета — по началу предложения или по маркеру внутри. */
const RULE_FORM =
  /^(не |никогда|всегда|нельзя|обязательно|запрещ|никаких|без |never|always|don't|do not|must|avoid|only )|( никогда | всегда | нельзя | обязательно | never | always | must not | don't )/i
/** Вопрос, состояние, оценка — не правило, хотя начинается с «не». */
const NOT_RULE = /\?|^не (понял|понимаю|знаю|вижу|уверен|работает|получ|могу|хочу|очень|надо ли)|^no,|^not sure/i
/** Код и разметка — цитата, а не речь. */
const CODE_LIKE = /^\/\/|^#|=>|\(\)|[{};]$|`/

export interface VoicedRule {
  key: string
  statement: string
  sessions: number
  last_at: string
}

/** Ключ повтора: слова длиннее трёх букв, обрезанные до пяти — одна и та же мысль в разных окончаниях. */
export function voicedKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.slice(0, 5))
    .join(' ')
}

/** Предложения формы правила из одного сообщения владельца. */
export function ruleSentences(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/(?<=[.!;\n])\s+|\n/)) {
    const s = raw.trim().replace(/^[-*•\d.)\s]+/, '')
    if (s.length < SENTENCE_MIN || s.length > SENTENCE_MAX) continue
    if (!RULE_FORM.test(s) || NOT_RULE.test(s) || CODE_LIKE.test(s)) continue
    if (voicedKey(s).split(' ').length < 3) continue // слишком коротко, чтобы быть мыслью
    out.push(s)
  }
  return out
}

/**
 * Набранные владельцем сообщения из транскрипта. Форма строки — единственный
 * признак авторства, который у нас есть; любая неожиданность = пусто.
 */
export function ownerMessages(transcriptPath: string | null): string[] {
  if (!transcriptPath || !existsSync(transcriptPath)) return []
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return [] // транскрипт занят — сырьё подождёт следующего хода
  }
  if (lines.length > TAIL_LINES) lines = lines.slice(-TAIL_LINES)
  const out: string[] = []
  for (const line of lines) {
    if (!line.includes('"type":"user"')) continue
    let obj: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type !== 'user' || obj.isMeta) continue
    const c = obj.message?.content
    if (typeof c !== 'string' || c.length > OWNER_PROMPT_MAX) continue
    const text = c.trim()
    if (!text || text.startsWith('<')) continue
    out.push(text)
  }
  return out
}

export function ensureVoiced(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS voiced_rules(
      key TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL
    )`,
  )
  db.run('CREATE TABLE IF NOT EXISTS voiced_seen(key TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY(key, session_id))')
}

/**
 * Снять правила формы из транскрипта сессии. Идемпотентно: повторный проход по
 * тому же транскрипту ничего не удваивает (пара key+session — первичный ключ),
 * поэтому курсор не нужен. Возвращает число новых пар «правило × сессия».
 */
export function harvestVoiced(db: Database, transcriptPath: string | null, sessionId: string, now: string): number {
  const messages = ownerMessages(transcriptPath)
  if (messages.length === 0) return 0
  ensureVoiced(db)
  const upsert = db.query(
    'INSERT INTO voiced_rules(key, statement, first_at, last_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET last_at=excluded.last_at',
  )
  const seen = db.query('INSERT OR IGNORE INTO voiced_seen(key, session_id) VALUES(?,?)')
  let added = 0
  for (const m of messages) {
    for (const s of ruleSentences(m)) {
      const key = voicedKey(s)
      upsert.run(key, s, now, now)
      added += Number(seen.run(key, sessionId).changes)
    }
  }
  return added
}

const hasTable = (db: Database, name: string): boolean =>
  (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name) as { n: number }).n > 0

/**
 * Правила, прозвучавшие в ≥ minSessions сессиях, кроме уже зафиксированных
 * (exclude — тексты устава: цель/ограничение сравниваются тем же ключом).
 */
export function voicedCandidates(db: Database, minSessions: number, exclude: string[] = []): VoicedRule[] {
  if (!hasTable(db, 'voiced_rules') || !hasTable(db, 'voiced_seen')) return []
  const known = exclude.map((s) => voicedKey(s).split(' ').filter(Boolean))
  const rows = db
    .query(
      `SELECT r.key, r.statement, r.last_at, COUNT(s.session_id) sessions
       FROM voiced_rules r JOIN voiced_seen s ON s.key = r.key
       GROUP BY r.key HAVING sessions >= ? ORDER BY sessions DESC, r.last_at DESC`,
    )
    .all(minSessions) as VoicedRule[]
  return rows.filter((r) => !known.some((k) => sameThought(r.key.split(' '), k)))
}

/** Порог совпадения мысли: доля общих слов от более короткого ключа. */
const SAME_THOUGHT = 0.75

/**
 * Одна и та же мысль в разной формулировке: «никогда не трогай прод-оплаты» и
 * «не трогать прод-оплаты» из устава. Точное равенство ключей здесь не
 * работает — устав пишут короче, чем говорят; поэтому сравнивается доля общих
 * слов от меньшего ключа.
 */
export function sameThought(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  let shared = 0
  for (const w of b) if (set.has(w)) shared++
  return shared / Math.min(a.length, b.length) >= SAME_THOUGHT
}

/** Блок сводки: приглашение в устав, не закон. Пусто — ничего не показывать. */
export function renderVoiced(rules: VoicedRule[]): string {
  if (rules.length === 0) return ''
  const lines = [
    `## ${t(
      'Сказано владельцем вслух (повторялось в разных сессиях; в уставе нет — справочно, зафиксировать: /symbiont:charter)',
      'Said aloud by the owner (repeated across sessions; not in the charter — for reference, record with /symbiont:charter)',
    )}`,
    '',
  ]
  for (const r of rules.slice(0, SHOW_MAX)) lines.push(`- «${r.statement}» · ×${r.sessions}`)
  return lines.join('\n')
}
