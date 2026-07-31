/**
 * Движок /sym-elevate: глубокий аудит возвышения проекта.
 *
 * Собирает контекст (паспорт: состав артефактов + активные оси + профиль +
 * конституция + выборка самых связных файлов) + применимые оси рубрики +
 * принципы «от обратного» → один LLM-проход, выдающий РАНЖИРОВАННЫЕ
 * предложения по возвышению до топ-1. Встроенная состязательная самопроверка:
 * каждое предложение обязано пройти попытку опровержения (дефолт концепта —
 * симулированная проверка в размышлении дешевле реальной панели).
 *
 * Ничего не применяет. Fail-open парс: мусор = ноль предложений, не мусор.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from '../core/db'
import { readVerdicts, renderVerdictsForPrompt } from './verdicts'
import { axesForArtifacts, DESIGN_PRINCIPLES, type RubricAxis } from './rubric'
import type { ArtifactClass } from '../passport/artifacts'
import type { LlmCaller } from '../layer2/llm'
import { walkFiles } from '../miner/walk'
import { isNonCodeMinable, extractContent } from '../miner/noncode'
import { detectStack } from '../passport/stack'
import { playbooksFor } from '../domains/playbooks'
import { relative } from 'node:path'

export type Scope = 'локальное' | 'модуль' | 'архитектура' | 'концепция'
const SCOPES: Scope[] = ['локальное', 'модуль', 'архитектура', 'концепция']
const EFFORT = ['низкое', 'среднее', 'высокое']
const RISK = ['низкий', 'средний', 'высокий']

export interface Proposal {
  axis: string
  scope: Scope
  observation: string
  proposal: string
  impact: string
  effort: string
  risk: string
  confidence: number
  survivesRefutation: boolean
}

export interface ElevateContext {
  summary: string
  activeAxes: string[]
  rubric: RubricAxis[]
  samples: Array<{ file: string; content: string }>
  playbooks: Array<{ domain: string; checklist: string[]; thresholds?: string[]; pitfalls: string[] }>
  /** Весь обнаруженный стек — включая незнакомое (otherDeps), чтобы модель
   *  применяла экспертизу к технологиям без курируемого плейбука. */
  stack: { frameworks: string[]; infra: string[]; domains: string[]; otherDeps: string[]; evidence?: Record<string, string> }
  /** Что владелец уже решил по прошлым предложениям; пусто — памяти ещё нет */
  verdictsBlock: string
}

const SAMPLE_FILES = 8
const SAMPLE_CHARS = 3500
const DEFAULT_THRESHOLD = 70

/** Контекст возвышения из паспорта проекта. */
export function buildContext(projectRoot: string, dataDir: string, presentOverride?: ArtifactClass[]): ElevateContext {
  let summary = ''
  try {
    summary = readFileSync(join(dataDir, 'SUMMARY.md'), 'utf8')
  } catch {
    /* сводки может не быть */
  }

  const classes = presentOverride ?? inferClassesFromSummary(summary)
  const rubric = axesForArtifacts(classes)
  const axesActive = deriveActiveFromSummary(summary)

  // Выборка — самые связные файлы графа (PageRank), как у слоя 2
  const samples: Array<{ file: string; content: string }> = []
  let verdictsBlock = ''
  const dbPath = join(dataDir, 'passport.db')
  if (existsSync(dbPath)) {
    const db = openDb(dbPath, { readonly: true })
    try {
      const nodes = db.query('SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?').all(SAMPLE_FILES) as Array<{ file: string }>
      for (const r of nodes) {
        try {
          samples.push({ file: r.file, content: readFileSync(join(projectRoot, r.file), 'utf8').slice(0, SAMPLE_CHARS) })
        } catch {
          continue
        }
      }
      // Память о решениях владельца: без неё отклонённое возвращается каждый прогон
      verdictsBlock = renderVerdictsForPrompt(readVerdicts(db))
    } finally {
      db.close()
    }
  }

  // Не-код проект (граф пуст/мал: дизайн/документы/данные) — добираем выборку
  // из не-код артефактов, чтобы elevate работал не только по коду.
  if (samples.length < SAMPLE_FILES) {
    for (const s of gatherNonCodeSamples(projectRoot, SAMPLE_FILES - samples.length)) samples.push(s)
  }

  // Доменные плейбуки активного стека — экспертиза направлений в аудит
  const stack = detectStack(projectRoot, walkFilesRel(projectRoot))
  const playbooks = playbooksFor(stack).map((p) => ({ domain: p.domain, checklist: p.checklist, thresholds: p.thresholds, pitfalls: p.pitfalls }))

  return { summary, activeAxes: axesActive, rubric, samples, playbooks, stack, verdictsBlock }
}

function walkFilesRel(projectRoot: string): string[] {
  try {
    return walkFiles(projectRoot).map((f) => relative(projectRoot, f.path).replaceAll('\\', '/'))
  } catch {
    return []
  }
}

/** Активные оси из готовой сводки (там уже есть строка «активные оси качества: …»). */
function deriveActiveFromSummary(summary: string): string[] {
  const m = summary.match(/активные оси качества:\s*(.+)/)
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
}

/** Классы артефактов из секции «Состав проекта» сводки (грубо, по подписям). */
function inferClassesFromSummary(summary: string): ArtifactClass[] {
  const map: Array<[RegExp, ArtifactClass]> = [
    [/код —/, 'код'], [/контент\/тексты —/, 'контент'], [/разметка\/стили —/, 'разметка-стили'],
    [/данные —/, 'данные'], [/конфиг\/инфра —/, 'конфиг-инфра'], [/дизайн\/графика —/, 'дизайн'],
    [/офис-документы —/, 'офис'], [/медиа —/, 'медиа'],
  ]
  const out = map.filter(([re]) => re.test(summary)).map(([, c]) => c)
  return out.length > 0 ? out : ['код'] // дефолт — код, если состав не распознан
}

/** Не-код артефакты как выборка (для не-код проектов). Приоритет по плотности
 *  сигнала: office/данные несут больше смысла на файл, чем разрозненный текст. */
function gatherNonCodeSamples(projectRoot: string, limit: number): Array<{ file: string; content: string }> {
  if (limit <= 0) return []
  const priority = (ext: string): number =>
    ext === '.docx' || ext === '.pptx' || ext === '.xlsx' ? 0 : ext === '.csv' || ext === '.tsv' ? 1 : 2
  let files: Array<{ path: string; ext: string }>
  try {
    files = walkFiles(projectRoot)
      .filter((f) => isNonCodeMinable(f.ext))
      .sort((a, b) => priority(a.ext) - priority(b.ext))
      .slice(0, limit * 4) // запас: часть не извлечётся
  } catch {
    return []
  }
  const out: Array<{ file: string; content: string }> = []
  for (const f of files) {
    if (out.length >= limit) break
    const content = extractContent(f.path, f.ext)
    if (content) out.push({ file: relative(projectRoot, f.path).replaceAll('\\', '/'), content: content.slice(0, SAMPLE_CHARS) })
  }
  return out
}

export function buildElevatePrompt(ctx: ElevateContext): string {
  const axesList = ctx.rubric
    .map((a) => `- ${a.axis}${a.iso ? ` [ISO ${a.iso}]` : ''}: ${a.lens}. Смотреть: ${a.checks.join('; ')}.${a.thresholds ? ` Пороги: ${a.thresholds.join('; ')}.` : ''}`)
    .join('\n')
  const principles = DESIGN_PRINCIPLES.map((p) => `- ${p.rule}`).join('\n')
  const playbookBlock = ctx.playbooks.length > 0
    ? [
        '',
        '## Доменная экспертиза активных направлений (топ-уровень; заземлено на стандарты)',
        ...ctx.playbooks.flatMap((p) => [
          `### ${p.domain}`,
          `эталон: ${p.checklist.slice(0, 8).join('; ')}`,
          p.thresholds && p.thresholds.length ? `пороги: ${p.thresholds.join(' · ')}` : '',
          `частые провалы: ${p.pitfalls.join('; ')}`,
        ]).filter(Boolean),
      ].join('\n')
    : ''
  const st = ctx.stack
  // Основание срабатывания идёт вместе с именем: без него аудит домысливает
  // причину вывода и выдаёт догадку за наблюдение (реально случилось дважды)
  const withWhy = (names: string[]): string =>
    names.map((n) => (st.evidence?.[n] ? `${n} (${st.evidence[n]})` : n)).join(', ')
  const stackLine = [
    st.frameworks.length ? `фреймворки: ${withWhy(st.frameworks)}` : '',
    st.infra.length ? `инфра: ${withWhy(st.infra)}` : '',
    st.domains.length ? `направления: ${withWhy(st.domains)}` : '',
    st.otherDeps.length ? `прочие зависимости: ${st.otherDeps.join(', ')}` : '',
  ].filter(Boolean).join(' · ')
  return [
    'Ты — аудитор возвышения проекта до уровня топ-1. Твоя задача — предложить точечные улучшения по осям качества, применимым ИМЕННО к этому проекту.',
    'ВАЖНО: НЕ используй инструменты и НЕ читай файлы — весь нужный контекст (паспорт, оси, фрагменты) уже приведён ниже. Ответь напрямую JSON-ом за один ход.',
    '',
    '## Паспорт проекта (уже выведен системой)',
    ctx.summary.slice(0, 4000),
    '',
    stackLine ? `## Обнаруженный стек\n${stackLine}` : '',
    'Для технологий/направлений стека, по которым НИЖЕ нет готового плейбука, применяй СВОЮ актуальную (2026) экспертизу топ-уровня по этой конкретной технологии — не ограничивайся приведёнными плейбуками.',
    '',
    '## Оси качества, применимые к составу этого проекта (заземлены на стандарты)',
    axesList,
    playbookBlock,
    '',
    '## Обязательные принципы (нарушение = брак ответа)',
    principles,
    ctx.verdictsBlock,
    '',
    '## Фрагменты самых связных файлов',
    ...ctx.samples.flatMap((s) => [``, `=== ${s.file} ===`, s.content]),
    '',
    '## Что вернуть',
    'Ранжированный список предложений по возвышению — от самого влиятельного. Для КАЖДОГО обязательна попытка опровержения: если предложение её не переживает — НЕ включай его. Не выдумывай находки ради количества: на здоровой зоне верни пустой список — это достойный ответ.',
    'Scope: «локальное» | «модуль» | «архитектура» | «концепция» (концепция = переработка самой идеи продукта). Рекомендуй из СОБСТВЕННЫХ конвенций проекта, не из generic best-practice.',
    '',
    'Ответ — ТОЛЬКО валидный JSON-массив без пояснений и markdown:',
    '[{"axis":"ось","scope":"локальное","observation":"что наблюдаем в коде/контенте","proposal":"что конкретно изменить","impact":"ожидаемый эффект","effort":"низкое|среднее|высокое","risk":"низкий|средний|высокий","confidence":0-100,"refutation":"как это может быть неверно","survives":true}]',
  ].join('\n')
}

/** Строгий разбор: мусор = пустой список. Отсев по порогу уверенности и провалу опровержения. */
export function parseProposals(text: string, threshold = DEFAULT_THRESHOLD): Proposal[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: Proposal[] = []
    for (const r of arr) {
      if (
        typeof r?.axis !== 'string' ||
        typeof r?.observation !== 'string' ||
        typeof r?.proposal !== 'string' ||
        typeof r?.confidence !== 'number'
      ) {
        continue
      }
      const survives = r.survives !== false // по умолчанию считаем пережившим, если поле есть — уважаем
      if (!survives || r.confidence < threshold) continue
      out.push({
        axis: r.axis,
        scope: SCOPES.includes(r.scope) ? r.scope : 'локальное',
        observation: r.observation,
        proposal: r.proposal,
        impact: typeof r.impact === 'string' ? r.impact : '',
        effort: EFFORT.includes(r.effort) ? r.effort : 'среднее',
        risk: RISK.includes(r.risk) ? r.risk : 'средний',
        confidence: Math.round(r.confidence),
        survivesRefutation: true,
      })
    }
    // Ранжирование: уверенность × вес охвата (радиус влияния — прокси через scope)
    const scopeWeight: Record<Scope, number> = { концепция: 1.3, архитектура: 1.2, модуль: 1.05, локальное: 1 }
    return out.sort((a, b) => b.confidence * scopeWeight[b.scope] - a.confidence * scopeWeight[a.scope])
  } catch {
    return []
  }
}

export interface ElevateResult {
  model: string | null
  proposals: Proposal[]
  axesConsidered: string[]
}

export function runElevate(projectRoot: string, dataDir: string, caller: LlmCaller, threshold = DEFAULT_THRESHOLD): ElevateResult {
  const ctx = buildContext(projectRoot, dataDir)
  if (ctx.rubric.length === 0) return { model: null, proposals: [], axesConsidered: [] }
  const res = caller(buildElevatePrompt(ctx))
  // сырой ответ на диск — вскрываемость отфильтрованного нуля
  try {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(join(dataDir, 'elevate-last.json'), JSON.stringify({ at: new Date().toISOString(), raw: res }, null, 1), 'utf8')
  } catch {
    /* диагностика необязательна */
  }
  if (!res) return { model: null, proposals: [], axesConsidered: ctx.rubric.map((a) => a.axis) }
  return { model: res.model, proposals: parseProposals(res.text, threshold), axesConsidered: ctx.rubric.map((a) => a.axis) }
}

export function renderProposals(r: ElevateResult): string {
  if (!r.model) return 'Symbiont · возвышение: модели цепочки недоступны или паспорт не построен.'
  if (r.proposals.length === 0) {
    return `Symbiont · возвышение · оси рассмотрены: ${r.axesConsidered.join(', ')}.\nПредложений выше порога уверенности нет — по рассмотренным зонам проект здоров (это достойный результат, не пустой).`
  }
  const L = [`Symbiont · возвышение · ${r.proposals.length} предложений (модель ${r.model}), ранжировано по влиянию:`, '']
  let i = 1
  for (const p of r.proposals) {
    L.push(`${i}. [${p.axis} · ${p.scope} · уверенность ${p.confidence} · усилие ${p.effort} · риск ${p.risk}]`)
    L.push(`   наблюдение: ${p.observation}`)
    L.push(`   предложение: ${p.proposal}`)
    if (p.impact) L.push(`   эффект: ${p.impact}`)
    L.push('')
    i++
  }
  L.push('Ничего не применено — это карта возможностей, решение за владельцем.')
  return L.join('\n')
}
