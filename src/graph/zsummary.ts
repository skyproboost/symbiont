/**
 * Ленивые z-резюме узлов (зум-граф ч.4, CONCEPT §4.1): смысл узла в одну строку.
 *
 * Что чинит: срез графа даёт СТРУКТУРУ («store.ts · вход:25 исход:3»), но не
 * РОЛЬ — модель знает связи и не знает, зачем файл существует. z1-резюме
 * добавляет смысл там, где структура молчит.
 *
 * Ленивость — главный урок LazyGraphRAG (Microsoft дезавуировал upfront-
 * индексацию GraphRAG, сжёгши на ней десятки тысяч долларов): резюме рождается
 * при первом ВИЗИТЕ узла (подача каналом), а не обходом всего графа — на 1300
 * файлов лабрида upfront-проход стоил бы сотни вызовов ради узлов, которых
 * никто не откроет. Посещённое — единицы в сессию.
 *
 * Инвалидация — по content-hash из file_cache (его уже ведёт buildPassport):
 * файл изменился → резюме протухло и узел снова в очереди. Отвергнута
 * инвалидация по mtime: правка-возврат к прежнему содержимому меняла бы mtime и
 * жгла вызов впустую, а хэш честно говорит «текст тот же».
 *
 * Цена: генерация ТОЛЬКО в детаче (auto-learn), пакетом (один вызов на N узлов);
 * каналы подачи лишь читают готовое из SQLite — латентность хука не растёт.
 */
import { documentsBlock, jsonOnly } from '../layer2/prompt'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import type { LlmCaller } from '../layer2/llm'

/** Узлов на один пакетный проход: держит вызов в разумном окне и цене. */
export const MAX_BATCH = 10
const SAMPLE_CHARS = 3000
const MAX_Z1_CHARS = 200

export interface PendingNode {
  file: string
  visits: number
}

export interface ZSummary {
  file: string
  z1: string
}

export function ensureSummaryTables(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)',
  )
  db.run('CREATE TABLE IF NOT EXISTS node_visits(file TEXT PRIMARY KEY, visits INTEGER NOT NULL, last_at TEXT NOT NULL)')
}

/**
 * Отметить визит узла (его подали каналом) — это и есть «первый визит» канона.
 * Отдельный счётчик, а не node_heat: тепло распадается по времени (оно про
 * недавность работы), очередь на резюме терять кандидатов не должна.
 */
export function markVisited(db: Database, file: string, nowIso: string): void {
  try {
    ensureSummaryTables(db)
    db.query(
      'INSERT INTO node_visits(file, visits, last_at) VALUES(?,1,?) ON CONFLICT(file) DO UPDATE SET visits=visits+1, last_at=excluded.last_at',
    ).run(file, nowIso)
  } catch {
    /* очередь резюме — обогащение, подача важнее её учёта */
  }
}

/** Свежее резюме узла или null (нет / протухло по хэшу) — читают каналы подачи. */
export function summaryFor(db: Database, file: string, contentHash: string | null): string | null {
  try {
    const row = db.query('SELECT z1, content_hash FROM node_summary WHERE file=?').get(file) as
      | { z1: string; content_hash: string }
      | null
    if (!row) return null
    // Хэш неизвестен (файла нет в кэше сборки) — доверяем последнему резюме:
    // молчание хуже слегка устаревшей строки, протухание поймает следующий проход.
    if (contentHash && row.content_hash !== contentHash) return null
    return row.z1
  } catch {
    return null
  }
}

/** Хэш одного файла из кэша сборки — точечно, для подачи одного узла. */
export function contentHashOf(db: Database, file: string): string | null {
  try {
    const row = db.query('SELECT hash FROM file_cache WHERE path=?').get(file) as { hash: string } | null
    return row ? row.hash : null
  } catch {
    return null // кэша сборки нет — свежесть не проверяем, см. summaryFor
  }
}

/** Карта file→content_hash из кэша сборки (его ведёт buildPassport); нет таблицы → пусто. */
export function contentHashes(db: Database): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='file_cache'").get() as { n: number }).n > 0
    if (!has) return out
    for (const r of db.query('SELECT path, hash FROM file_cache').all() as Array<{ path: string; hash: string }>) {
      out.set(r.path, r.hash)
    }
  } catch {
    /* кэша нет — очередь просто не отфильтруется по свежести */
  }
  return out
}

/**
 * Посещённые узлы, которым резюме нужно: его нет или оно протухло по хэшу.
 * Приоритет — по числу визитов (чаще смотрят → раньше окупится).
 */
export function pendingSummaries(db: Database, hashes: Map<string, string>, limit = MAX_BATCH): PendingNode[] {
  try {
    ensureSummaryTables(db)
    const rows = db
      .query(
        `SELECT v.file AS file, v.visits AS visits, s.content_hash AS have
         FROM node_visits v LEFT JOIN node_summary s ON s.file = v.file
         ORDER BY v.visits DESC, v.last_at DESC`,
      )
      .all() as Array<{ file: string; visits: number; have: string | null }>
    const out: PendingNode[] = []
    for (const r of rows) {
      if (out.length >= limit) break
      const fresh = r.have !== null && r.have === (hashes.get(r.file) ?? r.have)
      if (fresh) continue
      out.push({ file: r.file, visits: r.visits })
    }
    return out
  } catch {
    return []
  }
}

export function buildSummaryPrompt(samples: Array<{ file: string; content: string }>): string {
  return [
    'Ты описываешь роль файлов в проекте одной строкой каждый — для карты проекта, которую читает другой инженер.',
    '',
    'Требования к строке:',
    '- зачем файл существует и что он держит: строку читает инженер, которому нужно решить, открывать ли файл, а пересказ кода построчно на этот вопрос не отвечает;',
    '- максимально конкретно: named сущности, ответственность, чем он является для остальных;',
    `- одна строка до ${MAX_Z1_CHARS} символов, без markdown, без имени файла в начале;`,
    '- формулируй фактом, без оценок и советов.',
    '',
    'Файлы:',
    documentsBlock(samples),
    '',
    jsonOnly('[{"file": "путь как в заголовке", "z1": "роль файла одной строкой"}]'),
  ].join('\n')
}

const asSummary = (file: unknown, z1: unknown): ZSummary | null => {
  if (typeof file !== 'string' || typeof z1 !== 'string') return null
  const text = z1.replace(/\s+/g, ' ').trim()
  return text.length >= 10 ? { file, z1: text.slice(0, MAX_Z1_CHARS) } : null
}

/**
 * Спасательный разбор, когда строгий JSON.parse упал. Причина реальная: модель
 * иногда кладёт в z1 сырой перевод строки, а он в JSON-строке запрещён — и одна
 * такая строка уносила бы ВЕСЬ пакет из десяти резюме. Достаём пары по одной.
 */
function salvageSummaries(text: string): ZSummary[] {
  const out: ZSummary[] = []
  for (const m of text.matchAll(/\{[^{}]*?"file"\s*:\s*"([^"]+)"[^{}]*?"z1"\s*:\s*"([\s\S]*?)"\s*\}/g)) {
    const s = asSummary(m[1], m[2])
    if (s) out.push(s)
  }
  return out
}

/** Строгий разбор со спасением частично битого; мусор = пусто, не исключение. */
export function parseSummaries(text: string): ZSummary[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  const slice = text.slice(start, end + 1)
  try {
    const arr = JSON.parse(slice)
    if (!Array.isArray(arr)) return []
    const out: ZSummary[] = []
    for (const r of arr) {
      const s = asSummary(r?.file, r?.z1)
      if (s) out.push(s)
    }
    return out
  } catch {
    return salvageSummaries(slice)
  }
}

export function storeSummary(db: Database, s: ZSummary, contentHash: string, model: string, nowIso: string): void {
  ensureSummaryTables(db)
  db.query(
    `INSERT INTO node_summary(file, z1, content_hash, model, created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(file) DO UPDATE SET z1=excluded.z1, content_hash=excluded.content_hash, model=excluded.model, created_at=excluded.created_at`,
  ).run(s.file, s.z1, contentHash, model, nowIso)
}

export interface ZSummaryResult {
  model: string | null
  requested: number
  stored: number
}

/**
 * Один ленивый проход: посещённые-без-резюме → пакетный вызов → кэш.
 * Вызывается ТОЛЬКО из детача; нет очереди/модели → тихий ноль.
 */
export function runZSummaries(
  db: Database,
  projectRoot: string,
  caller: LlmCaller,
  nowIso = new Date().toISOString(),
  limit = MAX_BATCH,
  dataDir: string | null = null,
): ZSummaryResult {
  const hashes = contentHashes(db)
  const pending = pendingSummaries(db, hashes, limit)
  if (pending.length === 0) return { model: null, requested: 0, stored: 0 }

  const samples: Array<{ file: string; content: string }> = []
  for (const p of pending) {
    const abs = join(projectRoot, p.file)
    if (!existsSync(abs)) continue
    try {
      samples.push({ file: p.file, content: readFileSync(abs, 'utf8').slice(0, SAMPLE_CHARS) })
    } catch {
      continue // нечитаемый файл — просто не в этом пакете
    }
  }
  if (samples.length === 0) return { model: null, requested: pending.length, stored: 0 }

  const res = caller(buildSummaryPrompt(samples))
  if (!res) return { model: null, requested: pending.length, stored: 0 }

  const known = new Set(samples.map((s) => s.file))
  const parsed = parseSummaries(res.text)
  let stored = 0
  for (const s of parsed) {
    if (!known.has(s.file)) continue // модель выдумала путь — не пишем
    storeSummary(db, s, hashes.get(s.file) ?? '', res.model, nowIso)
    stored++
  }
  // Сырой ответ на диск: пропущенный моделью файл (пакет неполон) должен быть
  // вскрываемым, а не тайной — тот же приём, что layer2-last.json у слоя 2.
  if (dataDir) {
    try {
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      const missed = samples.map((s) => s.file).filter((f) => !parsed.some((p) => p.file === f))
      writeFileSync(
        join(dataDir, 'zsummary-last.json'),
        JSON.stringify({ model: res.model, at: nowIso, asked: samples.map((s) => s.file), missed, raw: res.text }, null, 1),
        'utf8',
      )
    } catch {
      /* диагностика — не обязанность */
    }
  }
  return { model: res.model, requested: pending.length, stored }
}

/** Сколько узлов уже имеют резюме и сколько ждёт очередь — для /sym-status. */
export function summaryStats(db: Database): { have: number; pending: number } {
  try {
    ensureSummaryTables(db)
    const have = (db.query('SELECT COUNT(*) n FROM node_summary').get() as { n: number }).n
    const pending = pendingSummaries(db, contentHashes(db), 1000).length
    return { have, pending }
  } catch {
    return { have: 0, pending: 0 }
  }
}
