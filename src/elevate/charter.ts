/**
 * /sym-charter — приёмник требований (переосмысленный init, идея владельца).
 * Клиент пишет требования СВОБОДНО (вагонно, наивно, завуалированно). Модель
 * сопоставляет с уже покрытым (оси профиля + рубрика + плейбуки + авто-
 * конституция): что уже под капотом — отсекает («не нужно повторять»), что
 * уникально — фиксирует как явную волю владельца (побеждает выведенное).
 *
 * Это не «инициализация» (паспорт строится сам): это разовый разговор о воле.
 */
import { jsonOnly } from '../layer2/prompt'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb } from '../core/db'
import { FactStore } from '../core/store'
import { RUBRIC } from './rubric'
import { PLAYBOOKS, playbooksFor } from '../domains/playbooks'
import { detectStack } from '../passport/stack'
import { walkFiles } from '../miner/walk'
import { relative } from 'node:path'
import type { LlmCaller } from '../layer2/llm'

export interface CharterVerdict {
  requirement: string
  status: 'уже-покрыто' | 'уникальное' | 'уточнение'
  coveredBy?: string // чем покрыто (ось/плейбук), если уже-покрыто
  asWill?: string // формулировка воли, если уникальное (пара цель+ограничение)
}

/** Свод того, что система УЖЕ покрывает — для сопоставления с требованиями. */
export function coveredCapabilities(projectRoot: string, dataDir: string): string[] {
  const caps = new Set<string>()
  for (const a of RUBRIC) caps.add(`ось «${a.axis}»: ${a.lens}`)
  const rels = (() => {
    try {
      return walkFiles(projectRoot).map((f) => relative(projectRoot, f.path).replaceAll('\\', '/'))
    } catch {
      return []
    }
  })()
  const stack = detectStack(projectRoot, rels)
  for (const p of playbooksFor(stack)) caps.add(`плейбук «${p.domain}»: ${p.checklist.slice(0, 3).join('; ')}`)
  // авто-конституция уже в журнале
  const dbPath = join(dataDir, 'passport.db')
  if (existsSync(dbPath)) {
    const db = openDb(dbPath, { readonly: true })
    try {
      for (const f of new FactStore(db).active().filter((f) => f.area === 'конституция' || f.area === 'профиль качества')) {
        caps.add(f.statement)
      }
    } catch {
      /* нет журнала */
    } finally {
      db.close()
    }
  }
  return [...caps]
}

export function buildCharterPrompt(requirements: string, covered: string[]): string {
  return [
    'Владелец продукта описал требования/условия к проекту СВОИМИ словами (возможно вагонно, наивно или завуалированно).',
    'Твоя задача — сопоставить каждое требование с тем, что система УЖЕ покрывает автоматически, и классифицировать:',
    '- «уже-покрыто»: требование по сути совпадает с существующей осью качества / плейбуком / выведенной конституцией (даже если сказано другими словами) → повторно фиксировать НЕ нужно, укажи чем покрыто;',
    '- «уникальное»: невыводимая из кода стратегическая воля владельца → зафиксировать парой «цель + ограничение»;',
    '- «уточнение»: усиливает/сужает уже покрытое (например «приватность ВАЖНЕЕ скорости») → зафиксировать как приоритет.',
    'НЕ дублируй под капотное. Будь честен: если требование уже под капотом — так и скажи.',
    '',
    '## Что система уже покрывает автоматически',
    ...covered.map((c) => `- ${c}`),
    '',
    '## Требования владельца (свободный текст)',
    requirements,
    '',
    jsonOnly('[{"requirement":"исходное требование","status":"уже-покрыто|уникальное|уточнение","coveredBy":"чем (если уже-покрыто)","asWill":"цель — … · ограничение — … (если уникальное/уточнение)"}]'),
  ].join('\n')
}

export function parseCharter(text: string): CharterVerdict[] {
  try {
    const s = text.indexOf('[')
    const e = text.lastIndexOf(']')
    if (s === -1 || e <= s) return []
    const arr = JSON.parse(text.slice(s, e + 1))
    if (!Array.isArray(arr)) return []
    const valid = new Set(['уже-покрыто', 'уникальное', 'уточнение'])
    return arr
      .filter((r): r is CharterVerdict => typeof r?.requirement === 'string' && valid.has(r?.status))
      .map((r) => ({
        requirement: r.requirement,
        status: r.status,
        coveredBy: typeof r.coveredBy === 'string' ? r.coveredBy : undefined,
        asWill: typeof r.asWill === 'string' ? r.asWill : undefined,
      }))
  } catch {
    return []
  }
}

export interface CharterResult {
  model: string | null
  verdicts: CharterVerdict[]
}

export function runCharter(projectRoot: string, dataDir: string, requirements: string, caller: LlmCaller): CharterResult {
  if (!requirements.trim()) return { model: null, verdicts: [] }
  const covered = coveredCapabilities(projectRoot, dataDir)
  const res = caller(buildCharterPrompt(requirements, covered))
  if (!res) return { model: null, verdicts: [] }
  return { model: res.model, verdicts: parseCharter(res.text) }
}

/** Уникальные/уточняющие вердикты → пары воли для upsertConstitution. */
export function verdictsToPairs(verdicts: CharterVerdict[]): Array<{ goal: string; constraint: string }> {
  const pairs: Array<{ goal: string; constraint: string }> = []
  for (const v of verdicts) {
    if (v.status === 'уже-покрыто' || !v.asWill) continue
    // asWill формата «цель — X · ограничение — Y»
    const goalM = v.asWill.match(/цель\s*—\s*([^·]+)/i)
    const conM = v.asWill.match(/ограничение\s*—\s*(.+)/i)
    pairs.push({
      goal: (goalM?.[1] ?? v.requirement).trim(),
      constraint: (conM?.[1] ?? 'соблюдать в рамках задачи, не сверх').trim(),
    })
  }
  return pairs
}

export function renderCharter(r: CharterResult): string {
  if (!r.model) return 'Symbiont · устав: модели недоступны или требования пусты.'
  if (r.verdicts.length === 0) return 'Symbiont · устав: не удалось разобрать требования (попробуй переформулировать).'
  const L = [`Symbiont · устав (модель ${r.model}) — сопоставление требований с уже покрытым:`, '']
  const covered = r.verdicts.filter((v) => v.status === 'уже-покрыто')
  const unique = r.verdicts.filter((v) => v.status !== 'уже-покрыто')
  if (covered.length > 0) {
    L.push('Уже под капотом (повторять не нужно):')
    for (const v of covered) L.push(`- «${v.requirement}» → ${v.coveredBy ?? 'покрыто'}`)
    L.push('')
  }
  if (unique.length > 0) {
    L.push('Уникальная воля владельца (зафиксирую в конституции, побеждает выведенное):')
    for (const v of unique) L.push(`- «${v.requirement}» → ${v.asWill ?? v.requirement}`)
  }
  return L.join('\n')
}
