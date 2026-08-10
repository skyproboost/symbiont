/**
 * Дайджесты подсистем: смысл СООБЩЕСТВА графа в одну строку.
 *
 * Роли узлов (zsummary) отвечают «зачем этот файл»; здесь ярус выше — «частью
 * чего он является и что эта часть делает для проекта». Строка подаётся при
 * первом касании подсистемы за сессию: модель входит в чужую зону с контекстом
 * её назначения, а не собирает его чтением соседей.
 *
 * Экономика — та же, что у ролей (урок LazyGraphRAG): дайджест рождается
 * ТОЛЬКО для подсистем, куда реально заходили (node_visits), пакетом в детаче,
 * на дешёвой модели. Материал промпта — уже оплаченные роли узлов, не
 * содержимое файлов: подсистема без описанных ролей ещё «не дозрела» до
 * дайджеста и просто ждёт (двух ролей достаточно, чтобы сказать, что это).
 *
 * Инвалидация — по СОСТАВУ сообщества (хэш отсортированных участников), а не
 * по содержимому файлов: назначение подсистемы меняется, когда меняется её
 * состав, а не каждая строка кода; контентный хэш жёг бы вызов на каждый
 * коммит. Членство узла кэшируется таблицей community_member — подача не
 * пересчитывает граф на каждое касание.
 */
import { sha1 } from '../core/salsa'
import { jsonOnly } from '../layer2/prompt'
import type { Database } from '../core/db'
import type { LlmCaller } from '../layer2/llm'
import { communityLabels, communityName } from './communities'
import type { Edge } from './graph'

/** Меньше этого файлов — не подсистема, а кучка: дайджест не пишется. */
const MIN_MEMBERS = 4
/** Минимум уже описанных ролей в сообществе — материал, из которого рождается дайджест. */
const MIN_ROLES = 2
/** Подсистем на один пакетный вызов. */
export const MAX_DIGEST_BATCH = 4
const MAX_DIGEST_CHARS = 220

export interface CommunityPending {
  label: string
  name: string
  members: string[]
  roles: Array<{ file: string; z1: string }>
}

export function ensureDigestTables(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS community_digest(label TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL, members_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)',
  )
  db.run('CREATE TABLE IF NOT EXISTS community_member(file TEXT PRIMARY KEY, label TEXT NOT NULL)')
}

/** Сообщества текущего графа: label → участники (только достаточно крупные). */
export function communitiesOf(db: Database): Map<string, string[]> {
  const nodes = (db.query('SELECT file FROM graph_nodes').all() as Array<{ file: string }>).map((r) => r.file)
  const edges = (db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>).map(
    (e) => ({ from: e.from_file, to: e.to_file }) as Edge,
  )
  const labels = communityLabels(nodes, edges)
  const groups = new Map<string, string[]>()
  for (const [file, label] of labels) {
    const list = groups.get(label) ?? []
    list.push(file)
    groups.set(label, list)
  }
  for (const [label, files] of groups) if (files.length < MIN_MEMBERS) groups.delete(label)
  return groups
}

const membersHash = (files: string[]): string => sha1([...files].sort().join('\n'))

/**
 * Подсистемы, которым нужен дайджест: их посещали, у них есть материал (роли),
 * а дайджеста нет или состав изменился с прошлого раза.
 */
export function pendingDigests(db: Database, limit = MAX_DIGEST_BATCH): CommunityPending[] {
  try {
    ensureDigestTables(db)
    const visited = new Set((db.query('SELECT file FROM node_visits').all() as Array<{ file: string }>).map((r) => r.file))
    if (visited.size === 0) return []
    const out: CommunityPending[] = []
    for (const [label, members] of communitiesOf(db)) {
      if (out.length >= limit) break
      if (!members.some((f) => visited.has(f))) continue // сюда не заходили — не тратимся
      const have = db.query('SELECT members_hash FROM community_digest WHERE label=?').get(label) as { members_hash: string } | null
      if (have && have.members_hash === membersHash(members)) continue // свежий
      const roles: Array<{ file: string; z1: string }> = []
      for (const f of members) {
        const r = db.query('SELECT z1 FROM node_summary WHERE file=?').get(f) as { z1: string } | null
        if (r) roles.push({ file: f, z1: r.z1 })
      }
      if (roles.length < MIN_ROLES) continue // материала нет — подсистема ещё не дозрела
      out.push({ label, name: communityName(members), members, roles })
    }
    return out
  } catch {
    return [] // дайджесты — обогащение; без таблиц/графа просто нечего делать
  }
}

export function buildDigestPrompt(pending: CommunityPending[]): string {
  const blocks = pending.map((p) => {
    const roles = p.roles.slice(0, 12).map((r) => `  - ${r.file}: ${r.z1}`)
    return [`Подсистема «${p.name}» (${p.members.length} файлов), известные роли файлов:`, ...roles].join('\n')
  })
  return [
    'Ты описываешь ПОДСИСТЕМЫ проекта одной строкой каждую — по уже известным ролям их файлов.',
    '',
    'Требования к строке:',
    '- что подсистема делает для проекта в целом и за что отвечает — не пересказ ролей по файлам;',
    `- одна строка до ${MAX_DIGEST_CHARS} символов, без markdown;`,
    '- формулируй фактом, без оценок и советов.',
    '',
    ...blocks,
    '',
    jsonOnly('[{"name": "имя подсистемы как в заголовке", "digest": "назначение одной строкой"}]'),
  ].join('\n')
}

export interface Digest {
  name: string
  digest: string
}

/** Строгий разбор; мусор = пусто, не исключение. */
export function parseDigests(text: string): Digest[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: Digest[] = []
    for (const r of arr) {
      if (typeof r?.name !== 'string' || typeof r?.digest !== 'string') continue
      const digest = r.digest.replace(/\s+/g, ' ').trim()
      if (digest.length >= 10) out.push({ name: r.name, digest: digest.slice(0, MAX_DIGEST_CHARS) })
    }
    return out
  } catch {
    return []
  }
}

export interface DigestResult {
  model: string | null
  requested: number
  stored: number
}

/** Пакетный проход: свежие дайджесты + карта членства для дешёвой подачи. */
export function runCommunityDigests(db: Database, caller: LlmCaller, nowIso: string): DigestResult {
  const pending = pendingDigests(db)
  if (pending.length === 0) return { model: null, requested: 0, stored: 0 }
  const res = caller(buildDigestPrompt(pending))
  if (!res) return { model: null, requested: pending.length, stored: 0 }
  const byName = new Map(parseDigests(res.text).map((d) => [d.name, d.digest]))
  let stored = 0
  ensureDigestTables(db)
  const putDigest = db.query(
    `INSERT INTO community_digest(label, name, digest, members_hash, model, created_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(label) DO UPDATE SET name=excluded.name, digest=excluded.digest, members_hash=excluded.members_hash, model=excluded.model, created_at=excluded.created_at`,
  )
  const putMember = db.query('INSERT INTO community_member(file, label) VALUES(?,?) ON CONFLICT(file) DO UPDATE SET label=excluded.label')
  for (const p of pending) {
    const digest = byName.get(p.name)
    if (!digest) continue // модель промолчала об этой — дозреет следующим пакетом
    putDigest.run(p.label, p.name, digest, membersHash(p.members), res.model, nowIso)
    for (const f of p.members) putMember.run(f, p.label)
    stored++
  }
  return { model: res.model, requested: pending.length, stored }
}

/** Свежий дайджест подсистемы файла — для подачи по касанию; null = сказать нечего. */
export function digestForFile(db: Database, file: string): { label: string; name: string; digest: string } | null {
  try {
    const m = db.query('SELECT label FROM community_member WHERE file=?').get(file) as { label: string } | null
    if (!m) return null
    const d = db.query('SELECT name, digest FROM community_digest WHERE label=?').get(m.label) as
      | { name: string; digest: string }
      | null
    return d ? { label: m.label, name: d.name, digest: d.digest } : null
  } catch {
    return null
  }
}
