/**
 * Слой 2: LLM-вербализация неписаных правил, не выводимых статистикой.
 *
 * Принципы (из концепта):
 * - явная команда, один дорогой проход — не «на каждый чих»;
 * - образец — самые связные файлы (PageRank), законы слоя 0 в промпт,
 *   чтобы LLM их НЕ повторял;
 * - LLM-факт никогда не рождается «законом» — максимум «привычка»
 *   (законы зарабатываются только статистикой);
 * - строгий JSON-парс, fail-open: мусорный ответ = ноль фактов, не мусор в журнале.
 */
import { documentsBlock, jsonOnly } from './prompt'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from '../core/db'
import { FactStore } from '../core/store'
import type { Fact } from '../miner/facts'
import type { LlmCaller } from './llm'
import { dedupeLlmFacts, type Merge } from '../gardener/dedupe'

const SAMPLE_FILES = 6
const SAMPLE_CHARS_PER_FILE = 4000

export interface VerbalizedRule {
  area: string
  statement: string
  evidence: string[]
  confidence: number
}

export function buildSample(projectRoot: string, dataDir: string): Array<{ file: string; content: string }> {
  const dbPath = join(dataDir, 'passport.db')
  if (!existsSync(dbPath)) return []
  const db = openDb(dbPath, { readonly: true })
  try {
    const rows = db
      .query('SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?')
      .all(SAMPLE_FILES) as Array<{ file: string }>
    const out: Array<{ file: string; content: string }> = []
    for (const r of rows) {
      try {
        out.push({ file: r.file, content: readFileSync(join(projectRoot, r.file), 'utf8').slice(0, SAMPLE_CHARS_PER_FILE) })
      } catch {
        continue
      }
    }
    return out
  } finally {
    db.close()
  }
}

export function buildPrompt(
  laws: string[],
  samples: Array<{ file: string; content: string }>,
  dueStatements: string[] = [],
): string {
  return [
    'Ты анализируешь кодовую базу проекта, чтобы вывести неписаные конвенции — те, что не видны простой статистике.',
    '',
    'Уже известные законы проекта. Выводи только то, чего в этом списке нет, и что из него не следует:',
    ...laws.map((l) => `- ${l}`),
    ...(dueStatements.length > 0
      ? [
          '',
          'Правила, выведенные ранее, — им пора переподтверждение. Включи в ответ те, что образец подтверждает: той же формулировкой, со свежими evidence. Остальные просто опусти:',
          ...dueStatements.map((s) => `- ${s}`),
        ]
      : []),
    '',
    'Фрагменты самых связных файлов проекта:',
    documentsBlock(samples),
    '',
    'Выведи 3–8 дополнительных конвенций: обработка ошибок, семантика именования, архитектурные привычки, паттерны API, структура модулей.',
    // Требование «минимум 3 файла» подкреплено причиной: без неё модель считает
    // порог формальностью и подгоняет evidence. Документация Anthropic отмечает,
    // что объяснённое требование выполняется точнее выданного без объяснения.
    'Правила только с подтверждением минимум в 3 файлах образца: правило, увиденное дважды, ещё неотличимо от совпадения, а этот вывод уходит в постоянный журнал проекта.',
    'Формулируй фактами в формате «предмет — вердикт» (как «ошибки — возвращаются значением, не бросаются»).',
    '',
    jsonOnly('[{"area": "область", "statement": "предмет — вердикт", "evidence": ["файл1", "файл2", "файл3"], "confidence": 0.85}]'),
  ].join('\n')
}

/** Строгий разбор ответа: мусор = пустой список, не исключение. */
export function parseRules(text: string, minEvidence = 3): VerbalizedRule[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (r): r is VerbalizedRule =>
        typeof r?.area === 'string' &&
        typeof r?.statement === 'string' &&
        r.statement.trim().length >= 10 &&
        Array.isArray(r?.evidence) &&
        r.evidence.length >= minEvidence &&
        typeof r?.confidence === 'number' &&
        r.confidence > 0 &&
        r.confidence <= 1,
    )
  } catch {
    return []
  }
}

export function ruleToFact(rule: VerbalizedRule, sampleSize: number): Fact {
  // LLM-факт: максимум «привычка», никогда «закон»
  const tier = rule.confidence >= 0.8 && rule.evidence.length >= 3 ? 'привычка' : 'гипотеза'
  return {
    area: rule.area,
    statement: rule.statement,
    positive: rule.evidence.length,
    total: Math.max(sampleSize, rule.evidence.length),
    prevalence: Math.min(rule.confidence, 0.94), // ниже порога закона by construction
    tier,
  }
}

export interface VerbalizeResult {
  model: string | null
  rules: VerbalizedRule[]
  journal: { born: number; updated: number; superseded: number }
  merges: Merge[]
}

export function runVerbalize(projectRoot: string, dataDir: string, caller: LlmCaller): VerbalizeResult {
  const empty = { born: 0, updated: 0, superseded: 0 }
  const samples = buildSample(projectRoot, dataDir)
  if (samples.length === 0) return { model: null, rules: [], journal: empty, merges: [] }

  const db = openDb(join(dataDir, 'passport.db'))
  try {
    const store = new FactStore(db)
    const laws = store.active().filter((f) => f.tier === 'закон').map((f) => f.statement)
    // FSRS: правила с истёкшим интервалом — на переподтверждение этим же проходом
    const due = store.dueForReview().map((f) => f.statement)
    const res = caller(buildPrompt(laws, samples, due))
    if (!res) return { model: null, rules: [], journal: empty, merges: [] }

    // Сырой ответ — на диск: отфильтрованный ноль должен быть вскрываемым, не тайной
    try {
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      writeFileSync(
        join(dataDir, 'layer2-last.json'),
        JSON.stringify({ model: res.model, at: new Date().toISOString(), raw: res.text }, null, 1),
        'utf8',
      )
    } catch {
      /* диагностика — не обязанность */
    }

    const rules = parseRules(res.text)
    const facts = rules.map((r) => ruleToFact(r, samples.length))
    const journal = store.assertAll(facts, `llm:layer2:${res.model}`)
    const merges = dedupeLlmFacts(db) // садовник: слить почти-дубли сразу после урожая
    return { model: res.model, rules, journal, merges }
  } finally {
    db.close()
  }
}
