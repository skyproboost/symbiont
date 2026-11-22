/**
 * Слой 2: LLM-вербализация неписаных правил, не выводимых статистикой.
 *
 * Принципы (из концепта):
 * - явная команда, один дорогой проход — не «на каждый чих»;
 * - образец — самые связные файлы (PageRank), законы слоя 0 в промпт,
 *   чтобы LLM их НЕ повторял;
 * - LLM-факт никогда не рождается «законом» — максимум «привычка»
 *   (законы зарабатываются только статистикой);
 * - строгий JSON-парс, fail-open: мусорный ответ = ноль фактов, не мусор в журнале;
 * - улика — дословная строка файла образца, сверяемая символ в символ
 *   (parseQuotedRules): несверенное правило отбрасывается целиком.
 */
import { zoneOfArea } from '../miner/facts'
import { documentsBlock, jsonOnly } from './prompt'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Database } from '../core/db'
import { sha1 } from '../core/salsa'
import { FactStore, keyOf } from '../core/store'
import { canonText } from './canon'
import { recordEvidence, type Quote } from './evidence'
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
  /** сверенные цитаты по файлам — есть только у правил, прошедших сверку улик (parseQuotedRules) */
  quotes?: Quote[]
}

/** Источник правил этого прохода; о чужих он не спрашивает (см. FactStore.dueForReview). */
const OWN_SOURCE = 'llm:layer2:'

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
          'Правила, выведенные ранее, — им пора переподтверждение. Включи в ответ те, что образец подтверждает: той же формулировкой, со свежими цитатами. Остальные просто опусти:',
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
    // Причина требования — та же, что у порога выше: объяснённое выполняется
    // точнее. Слово о многоточии — потому что это самый частый способ «почти
    // процитировать»
    'Подтверждение — строка из файла образца, скопированная дословно, вместе с путём из <source>. Цитата сверяется с текстом файла по словам (отступы и переносы строк не важны; каждое слово, его регистр и порядок — важны), и правило, у которого не нашлось трёх сверенных цитат из разных файлов, отбрасывается целиком: проверяемая улика — единственное, что отличает наблюдение от правдоподобного пересказа. Сокращение, пересказ или «…» внутри цитаты сверку не проходят.',
    'Формулируй фактами в формате «предмет — вердикт» (как «ошибки — возвращаются значением, не бросаются»).',
    '',
    jsonOnly(
      '[{"area": "область", "statement": "предмет — вердикт", "evidence": [{"file": "путь из <source>", "quote": "строка из этого файла дословно"}, {"file": "…", "quote": "…"}, {"file": "…", "quote": "…"}], "confidence": 0.85}]',
    ),
  ].join('\n')
}

/** Массив из ответа модели, пережив обвязку вокруг него; мусор — пустой массив. */
function extractArray(text: string): unknown[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** Форма правила без учёта улик: область, формулировка достаточной длины, уверенность в (0, 1]. */
function hasRuleShape(r: unknown): r is { area: string; statement: string; evidence: unknown[]; confidence: number } {
  const x = r as { area?: unknown; statement?: unknown; evidence?: unknown; confidence?: unknown } | null
  return (
    typeof x?.area === 'string' &&
    typeof x?.statement === 'string' &&
    x.statement.trim().length >= 10 &&
    Array.isArray(x?.evidence) &&
    typeof x?.confidence === 'number' &&
    x.confidence > 0 &&
    x.confidence <= 1
  )
}

/** Строгий разбор ответа: мусор = пустой список, не исключение. */
export function parseRules(text: string, minEvidence = 3): VerbalizedRule[] {
  return extractArray(text).filter((r): r is VerbalizedRule => hasRuleShape(r) && r.evidence.length >= minEvidence)
}

/**
 * Цитата короче — не улика: «}» или «);» найдутся в любом файле. Порог низкий
 * намеренно: `catch {` в семь символов — законная улика правила о catch без
 * биндинга, и отсечь её значило бы отсечь правило за краткость его формы.
 */
const MIN_QUOTE_CHARS = 5

/** Цитата длиннее — уже пересказ фрагмента, а не строка-улика. */
const MAX_QUOTE_CHARS = 400

/**
 * Версия формата ответа слоя 2. Входит в отпечаток раннего среза: срез держится
 * на том, что вход модели байт-в-байт прежний, а смена формата — смена входа.
 * Без неё проект с неизменным кодом не прошёл бы новую проверку никогда.
 */
const ANSWER_FORMAT = 2

const normPath = (p: string): string => p.trim().replaceAll('\\', '/').replace(/^\.\//, '')

// Реэкспорт: канонический вид переехал в свой модуль (см. canon.ts), а берут его отсюда.
export { canonText }

/**
 * Разбор ответа слоя 2 со сверкой улик: подтверждение — пара «файл образца +
 * цитата из него», и цитата ищется в показанном модели тексте файла.
 * Правило принимается, если сверку прошли улики минимум из minEvidence РАЗНЫХ
 * файлов; иначе оно отбрасывается целиком, а не «с меньшим числом
 * подтверждений».
 *
 * Принцип взят из Evidence-Preserving Reducer (NVlabs SoL-Pi): делегированному
 * пересказу не верят — каждое его утверждение сверяется с источником, а
 * несверяемое отбрасывается. Прежде уликой было имя файла, и число имён
 * становилось основанием «выведено по N образцам». Замер на 13 проектах
 * владельца: 318 из 319 названных файлов существуют — имена модель не
 * выдумывает. Но имя не доказывает, что файл показывает ПРАВИЛО; текст из
 * файла — доказывает.
 *
 * Сверка — по каноническому виду (canonText), а не побайтно, и это решено
 * замером, а не удобством. SoL-Pi сверяет побайтно логи сборки — их модель
 * копирует как есть. Комментарии к коду она, цитируя, перекладывает: на
 * labreadai-v2 побайтная сверка отбросила 4 правила из 5, и все пять
 * несверенных цитат оказались подлинным текстом файла — пробелы после `//`
 * схлопнуты, фрагменту из середины строки приписан `// `, выброшен маркер
 * списка `•`, две строки комментария склеены в одну. Канонический вид снимает
 * ровно это — разметку и раскладку, — но не допуск: каждое слово, его регистр
 * и порядок обязаны совпасть. Отвергнуто нечёткое совпадение (расстояние
 * правки, без учёта регистра): оно возвращает доверие к пересказу, от
 * которого здесь уходят.
 */
export function parseQuotedRules(text: string, samples: Array<{ file: string; content: string }>, minEvidence = 3): { rules: VerbalizedRule[]; unverified: number } {
  const byFile = new Map(samples.map((s) => [normPath(s.file), canonText(s.content)]))
  const rules: VerbalizedRule[] = []
  let unverified = 0
  for (const r of extractArray(text)) {
    if (!hasRuleShape(r)) continue
    // Файл → первая сверенная цитата из него: она и есть улика, которую хранит журнал
    const verified = new Map<string, string>()
    for (const e of r.evidence) {
      const ev = e as { file?: unknown; quote?: unknown } | null
      if (typeof ev?.file !== 'string' || typeof ev?.quote !== 'string') continue
      if (ev.quote.length > MAX_QUOTE_CHARS) continue
      const file = normPath(ev.file)
      const quote = canonText(ev.quote)
      if (quote.length < MIN_QUOTE_CHARS) continue
      if (byFile.get(file)?.includes(quote) && !verified.has(file)) verified.set(file, ev.quote)
    }
    if (verified.size >= minEvidence) {
      rules.push({ area: r.area, statement: r.statement, evidence: [...verified.keys()], confidence: r.confidence, quotes: [...verified].map(([file, quote]) => ({ file, quote })) })
    } else unverified++
  }
  return { rules, unverified }
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
  /** Правил, отброшенных сверкой улик: цитаты не нашлись в образце дословно. */
  unverified: number
}

/**
 * Отпечаток материала прохода: законы в промпт + due-формулировки + содержимое
 * образца + версия формата ответа. Ключ раннего среза (early cutoff из
 * сборочных систем): если вход LLM байт-в-байт тот же, что в прошлый успешный
 * проход, повторный вызов добавил бы только сэмплинговый шум —
 * детерминированная часть ответа уже в журнале.
 *
 * Список уже записанных привычек в отпечаток НЕ входит, хотя и уходит в промпт:
 * он — наш собственный урожай, а не материал проекта. Включённый, он отменял бы
 * срез после каждого продуктивного прохода — проход менял бы свой же вход и сам
 * себе назначал повтор на неизменившемся коде.
 */
function materialFingerprint(laws: string[], due: string[], samples: Array<{ file: string; content: string }>): string {
  return sha1(JSON.stringify({ format: ANSWER_FORMAT, laws, due, samples: samples.map((s) => [s.file, sha1(s.content)]) }))
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
  if (samples.length === 0) return { model: null, rules: [], journal: empty, merges: [], cutoff: false, unverified: 0 }

  const db = openDb(join(dataDir, 'passport.db'))
  try {
    const store = new FactStore(db)
    const active = store.active()
    const laws = active.filter((f) => f.tier === 'закон' && zoneOfArea(f.area) === null).map((f) => f.statement)
    // FSRS: правила с истёкшим интервалом — на переподтверждение. Только свои:
    // правило о материале или об устройстве продукта образец кода не подтвердит.
    //
    // Отвергнуто «цитаты на месте → правило подтверждено без модели». Уцелевшие
    // цитаты говорят, что прежние строки не тронуты, а не что правило ещё верно:
    // конвенцию ломают в ДРУГИХ файлах, и три нетронутые строки освежали бы её
    // бессрочно, уводя от единственной смысловой перепроверки. Улики хранятся
    // (evidence.ts) и показывают, у каких правил основание ушло, — не более.
    const dueRows = store.dueForReview(Date.now(), OWN_SOURCE)
    const due = dueRows.map((f) => f.statement)
    // Уже записанные LLM-привычки минус те, что сами ждут переподтверждения:
    // due просят повторить ТОЙ ЖЕ формулировкой, и запрет на повтор их убил бы
    const dueSet = new Set(due)
    const known = active
      .filter((f) => typeof f.source === 'string' && f.source.startsWith('llm:') && !dueSet.has(f.statement))
      .map((f) => f.statement)

    // Ранний срез (Bazel/Buck2): вход не изменился → LLM не зовём. Просроченные
    // правила при этом НЕ освежаются. Раньше освежались — с доводом «вызов на том
    // же входе подтвердил бы их». Но список просроченных входит в отпечаток: он
    // совпадает с прошлым, только если прошлый вызов на этом самом входе эти
    // правила уже видел и НЕ повторил. Срез освежал ровно то, что модель
    // отказалась подтвердить, и мёртвое правило выглядело свежепроверенным.
    const fp = materialFingerprint(laws, due, samples)
    if (fp === readStoredFingerprint(db)) {
      return { model: null, rules: [], journal: empty, merges: [], cutoff: true, unverified: 0 }
    }

    const res = caller(buildPrompt(laws, samples, due, known))
    if (!res) return { model: null, rules: [], journal: empty, merges: [], cutoff: false, unverified: 0 }

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

    // Улики сверяются с тем же текстом образца, что видела модель
    const { rules, unverified } = parseQuotedRules(res.text, samples)
    const facts = rules.map((r) => ruleToFact(r, samples.length))
    const journal = store.assertAll(facts, `${OWN_SOURCE}${res.model}`)
    // Улики — к записи факта, до уборки дублей: та оставляет одну из записей, и
    // у оставшейся улики должны быть свои
    const liveByKey = db.query('SELECT id FROM fact_journal WHERE key=? AND superseded_by IS NULL')
    for (const rule of rules) {
      const row = liveByKey.get(keyOf(rule)) as { id: number } | null
      if (row && rule.quotes) recordEvidence(db, row.id, rule.quotes)
    }
    // Садовник: сначала дешёвый проход по почти-одинаковым строкам, следом
    // смысловой — он один видит пересказ той же мысли на другом языке. Оба
    // внутри уже оплаченного дорогого прохода: отдельного повода звать модель
    // ради уборки нет, а вместе с урожаем уборка стоит один вызов.
    const merges = [...dedupeLlmFacts(db), ...dedupeLlmFactsSemantic(db, caller)]
    return { model: res.model, rules, journal, merges, cutoff: false, unverified }
  } finally {
    db.close()
  }
}
