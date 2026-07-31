/**
 * Конституция владельца: стоячие цели парами «цель + ограничение»
 * (сдержанность — часть ядра наравне с амбицией, аксиома §3.9).
 *
 * Источник — интервью /sym-init (владелец диктует, не выводится из кода);
 * живёт читаемым JSON-файлом в данных проекта, правится и руками.
 * Подаётся в каждую сессию: цели не нужно повторять в промптах.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ConstitutionPair {
  goal: string
  constraint: string
}

export interface Constitution {
  pairs: ConstitutionPair[]
  updated_at: string
}

const FILE = 'constitution.json'

export function readConstitution(dataDir: string): Constitution | null {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, FILE), 'utf8')) as Constitution
    if (!Array.isArray(j.pairs)) return null
    const pairs = j.pairs.filter(
      (p): p is ConstitutionPair => typeof p?.goal === 'string' && typeof p?.constraint === 'string' && p.goal.trim().length > 0,
    )
    return pairs.length > 0 ? { pairs, updated_at: j.updated_at ?? '' } : null
  } catch {
    return null
  }
}

/** Идемпотентное дообогащение: новые пары добавляются, дубли (по цели) обновляют ограничение. */
export function upsertConstitution(dataDir: string, incoming: ConstitutionPair[], now = new Date().toISOString()): Constitution {
  const current = readConstitution(dataDir)?.pairs ?? []
  const byGoal = new Map(current.map((p) => [p.goal.trim().toLowerCase(), p]))
  for (const p of incoming) {
    if (typeof p?.goal !== 'string' || typeof p?.constraint !== 'string' || !p.goal.trim()) continue
    byGoal.set(p.goal.trim().toLowerCase(), { goal: p.goal.trim(), constraint: p.constraint.trim() })
  }
  const next: Constitution = { pairs: [...byGoal.values()], updated_at: now }
  writeFileSync(join(dataDir, FILE), JSON.stringify(next, null, 1), 'utf8')
  return next
}

/** Блок для сводки сессии: воля владельца ПОВЕРХ выведенного (ручное побеждает). */
export function renderConstitution(c: Constitution): string {
  const lines = ['## Воля владельца (задана явно, поверх выведенных приоритетов; действует без повторения в промптах)', '']
  for (const p of c.pairs) lines.push(`- цель: ${p.goal} · ограничение: ${p.constraint}`)
  return lines.join('\n')
}
