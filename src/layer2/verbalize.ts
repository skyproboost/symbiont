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
import { openDb, type Database } from '../core/db'
import { sha1 } from '../core/salsa'
import { FactStore } from '../core/store'
import type { Fact } from '../miner/facts'
import type { LlmCaller } from './llm'
import { dedupeLlmFacts, dedupeLlmFactsSemantic, type Merge } from '../gardener/dedupe'

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
  knownStatements: string[] = [],
): string {
  return [
    'Ты анализируешь кодовую базу проекта, чтобы вывести неписаные конвенции — те, что не видны простой статистике.',
    '',
    'Уже известные законы проекта. Выводи только то, чего в этом списке нет, и что из него не следует:',
    ...laws.map((l) => `- ${l}`),
    // Тот же приём, что и с законами выше, — и по той же причине. Пока проход
    // видел только статистику, он каждый раз заново выводил СВОИ ЖЕ прошлые
    // правила новыми словами: «exports — named only» и «экспорт — только
    // именованный» уживались в паспорте как два разных факта, потому что
    // идентичность факта — область плюс предмет, а модель переименовывала оба.
    // Дешевле не порождать дубль, чем потом узнавать его в пересказе.
    ...(knownStatements.length > 0
      ? [
          '',
          'Уже записанные привычки этого проекта. Не выводи их заново — ни другими словами, ни на другом языке; повтор той же мысли ничего не добавляет:',
          ...knownStatements.map((s) => `- ${s}`),
        ]
      : []),
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
  /** Проход пропущен ранним срезом: материал не менялся с прошлого раза (это не отказ моделей). */
  cutoff: boolean
}

/**
 * Отпечаток материала прохода: законы в промпт + due-формулировки + содержимое
 * образца. Ключ раннего среза (early cutoff из сборочных систем): если вход
 * LLM байт-в-байт тот же, что в прошлый успешный проход, повторный вызов
 * добавил бы только сэмплинговый шум — детерминированная часть ответа уже в
 * журнале.
 *
 * Список уже записанных привычек в отпечаток НЕ входит, хотя и уходит в промпт:
 * он — наш собственный урожай, а не материал проекта. Включённый, он отменял бы
 * срез после каждого продуктивного прохода — проход менял бы свой же вход и сам
 * себе назначал повтор на неизменившемся коде.
 */
function materialFingerprint(laws: string[], due: string[], samples: Array<{ file: string; content: string }>): string {
  return sha1(JSON.stringify({ laws, due, samples: samples.map((s) => [s.file, sha1(s.content)]) }))
}

function readStoredFingerprint(db: Database): string | null {
  try {
    const row = db.query("SELECT value FROM learn_meta WHERE key='layer2_material'").get() as { value: string } | null
    return row?.value ?? null
  } catch {
    return null // таблицы ещё нет — отпечатка нет
  }
}

export function runVerbalize(projectRoot: string, dataDir: string, caller: LlmCaller): VerbalizeResult {
  const empty = { born: 0, updated: 0, superseded: 0 }
  const samples = buildSample(projectRoot, dataDir)
  if (samples.length === 0) return { model: null, rules: [], journal: empty, merges: [], cutoff: false }

  const db = openDb(join(dataDir, 'passport.db'))
  try {
    const store = new FactStore(db)
    const active = store.active()
    const laws = active.filter((f) => f.tier === 'закон').map((f) => f.statement)
    // FSRS: правила с истёкшим интервалом — на переподтверждение этим же проходом
    const dueRows = store.dueForReview()
    const due = dueRows.map((f) => f.statement)
    // Уже записанные LLM-привычки минус те, что сами ждут переподтверждения:
    // due просят повторить ТОЙ ЖЕ формулировкой, и запрет на повтор их убил бы
    const dueSet = new Set(due)
    const known = active
      .filter((f) => typeof f.source === 'string' && f.source.startsWith('llm:') && !dueSet.has(f.statement))
      .map((f) => f.statement)

    // Ранний срез (Bazel/Buck2): вход не изменился → LLM не зовём. Честность
    // среза: due-фактам освежается seen_at БЕЗ роста уверенности — вызов на
    // идентичном входе подтвердил бы их из того же образца, так что пропуск
    // ровно настолько же доказателен, насколько был бы сам вызов (и настолько
    // же ограничен образцом). Уверенность не растёт — как у touchAll.
    const fp = materialFingerprint(laws, due, samples)
    if (fp === readStoredFingerprint(db)) {
      const nowIso = new Date().toISOString()
      const upd = db.query('UPDATE fact_journal SET seen_at=? WHERE id=?')
      for (const f of dueRows) upd.run(nowIso, f.id)
      return { model: null, rules: [], journal: empty, merges: [], cutoff: true }
    }

    const res = caller(buildPrompt(laws, samples, due, known))
    if (!res) return { model: null, rules: [], journal: empty, merges: [], cutoff: false }

    // Отпечаток — только после успешного прохода: неудача не должна
    // засчитывать материал как «уже осмысленный»
    try {
      db.run('CREATE TABLE IF NOT EXISTS learn_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.query("INSERT INTO learn_meta(key,value) VALUES('layer2_material',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(fp)
    } catch {
      /* отпечаток — оптимизация; без него проход просто повторится */
    }

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
    // Садовник: сначала дешёвый проход по почти-одинаковым строкам, следом
    // смысловой — он один видит пересказ той же мысли на другом языке. Оба
    // внутри уже оплаченного дорогого прохода: отдельного повода звать модель
    // ради уборки нет, а вместе с урожаем уборка стоит один вызов.
    const merges = [...dedupeLlmFacts(db), ...dedupeLlmFactsSemantic(db, caller)]
    return { model: res.model, rules, journal, merges, cutoff: false }
  } finally {
    db.close()
  }
}
