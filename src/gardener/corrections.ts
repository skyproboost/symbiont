/**
 * Анализ поправок владельца: LLM-интерпретация диффов «модель написала →
 * человек исправил» в правила-кандидаты. Замыкание петли самообучения.
 *
 * Принципы: явный дорогой проход (внутри /sym-learn); правила из поправок
 * рождаются «гипотезами» (мало подтверждений by construction — повторные
 * поправки поднимут); поправки потребляются (analyzed=1), не жуются повторно.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import { FactStore } from '../core/store'
import { parseRules, ruleToFact } from '../layer2/verbalize'
import type { LlmCaller } from '../layer2/llm'
import { dedupeLlmFacts } from './dedupe'
import { recordLesson, zoneOf } from './lessons'

const MAX_PER_PASS = 5
const MAX_CHARS = 2000

export interface CorrectionsResult {
  analyzed: number
  born: number
  statements: string[]
}

export function buildCorrectionsPrompt(
  items: Array<{ file: string; before: string; after: string }>,
): string {
  return [
    'Владелец проекта исправил код, написанный ИИ-ассистентом. Каждая правка — сигнал о неписаном правиле проекта, которое ассистент нарушил.',
    '',
    ...items.flatMap((c) => [
      `=== ${c.file} ===`,
      '--- ассистент написал: ---',
      c.before.slice(0, MAX_CHARS),
      '--- владелец исправил на: ---',
      c.after.slice(0, MAX_CHARS),
      '',
    ]),
    'Выведи правила, которые объясняют эти правки (1–4 правила). Только то, что реально следует из диффов, без домыслов.',
    'Ответ — ТОЛЬКО валидный JSON-массив:',
    '[{"area": "область", "statement": "правило, которое нарушил ассистент и восстановил владелец", "evidence": ["файл1"], "confidence": 0.7}]',
  ].join('\n')
}

export function analyzeCorrections(
  db: Database,
  projectRoot: string,
  caller: LlmCaller,
): CorrectionsResult {
  const none = { analyzed: 0, born: 0, statements: [] }
  const hasTable =
    (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='corrections'").get() as { n: number }).n > 0
  if (!hasTable) return none

  const pending = db
    .query('SELECT id, file, before_content FROM corrections WHERE analyzed=0 ORDER BY id LIMIT ?')
    .all(MAX_PER_PASS) as Array<{ id: number; file: string; before_content: string }>
  if (pending.length === 0) return none

  const items = pending
    .map((p) => {
      try {
        return { id: p.id, file: p.file, before: p.before_content, after: readFileSync(join(projectRoot, p.file), 'utf8') }
      } catch {
        return { id: p.id, file: p.file, before: p.before_content, after: '' }
      }
    })
    .filter((c) => c.after.length > 0)

  const markAnalyzed = db.query('UPDATE corrections SET analyzed=1 WHERE id=?')
  if (items.length === 0) {
    for (const p of pending) markAnalyzed.run(p.id)
    return { analyzed: pending.length, born: 0, statements: [] }
  }

  const res = caller(buildCorrectionsPrompt(items))
  if (!res) return none // модели недоступны — поправки НЕ потребляем, дожуём позже

  const rules = parseRules(res.text, 1) // поправка может касаться одного файла
  const facts = rules.map((r) => ruleToFact(r, items.length))
  const store = new FactStore(db)
  const journal = store.assertAll(facts, `llm:corrections:${res.model}`)
  dedupeLlmFacts(db)

  // Компаундинг: тот же вывод из поправки — ещё и УРОК, привязанный к зоне файла.
  // Глобальный факт теряет якорь; урок всплывёт JIT при возврате в эту зону.
  const now = new Date().toISOString()
  for (const r of rules) {
    const file = (Array.isArray(r.evidence) && r.evidence[0]) || items[0].file
    recordLesson(db, zoneOf(file), r.statement, `correction:${res.model}`, now)
  }
  for (const p of pending) markAnalyzed.run(p.id)

  return { analyzed: pending.length, born: journal.born, statements: rules.map((r) => r.statement) }
}
