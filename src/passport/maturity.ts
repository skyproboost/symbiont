/**
 * Зрелость проекта как НЕПРЕРЫВНАЯ величина, а не три ступеньки.
 *
 * Что измеряем. Зрелость — это степень, в которой проект УЖЕ ОПРЕДЕЛИЛСЯ:
 * насколько его решения устоялись, повторяемы и подкреплены проверками. От неё
 * зависит режим работы: следовать прецеденту (он есть) или задавать планку (её
 * ещё нет). Ошибиться здесь дорого в обе стороны, поэтому нужна мера, а не ярлык.
 *
 * ПОЧЕМУ ЭНТРОПИЯ. Определённость канона — не «сколько конвенций найдено», а
 * «насколько они однозначны». Конвенция с долей 97% почти не несёт
 * неопределённости; конвенция 53/47 — чистый шум, выбор ещё не сделан. Это в
 * точности шенноновская энтропия распределения, и она даёт непрерывную шкалу
 * без единого порога, придуманного человеком.
 *
 * ПОЧЕМУ ГЕОМЕТРИЧЕСКОЕ СРЕДНЕЕ, А НЕ ВЕСА. Взвешенная сумма требует весов,
 * которые пришлось бы назначить произвольно (и это был бы хардкод в чистом
 * виде). Геометрическое среднее решает задачу без весов: одно нулевое измерение
 * обнуляет результат. Так формула САМА выражает правило «зрелость требует всех
 * признаков сразу»: проект без единой проверки не зрелый, сколько бы файлов в
 * нём ни было. Раньше это же правило было записано лестницей порогов вручную.
 *
 * ЧТО ЭТО ДАЁТ СВЕРХ ЯРЛЫКА. Видно не только «насколько», но и «что тянет вниз»:
 * слабейшее измерение — это и есть точка приложения усилий. Ярлык («молодой»,
 * «растущий», «зрелый») остаётся, но становится подписью к числу, а не сущностью.
 */
import type { Fact } from '../miner/facts'
import { t, pattern } from '../core/i18n'

export type MaturityLevel = 'молодой' | 'растущий' | 'зрелый'

/**
 * Природа материала. Проверяемость кода — это тесты; проверяемость контента —
 * целостность связей. Требовать тестов от репозитория статей так же бессмысленно,
 * как требовать перелинковки от библиотеки. Найдено на боевом прогоне: вики
 * получила 0.07 из-за «отсутствия тестов», которых там и не должно быть.
 */
export type ProjectNature = 'код' | 'контент' | 'смешанный'

export interface ContentIntegrity {
  /** сущностей контент-графа (статьи, страницы, документы) */
  entities: number
  /** ссылок в никуда */
  broken: number
  /** сущностей, до которых не дойти ни из одного хаба */
  orphans: number
}

export interface MaturityInput {
  nature?: ProjectNature
  /** целостность контента — материал для проверяемости контентного проекта */
  content?: ContentIntegrity
  codeFiles: number
  commits: number
  testFiles: number
  hasCi: boolean
  /** доли конвенций (0..1): насколько единообразно решён каждый вопрос стиля */
  prevalences: number[]
  /** коммитов-починок — рост говорит о нестабильности решений */
  fixCommits: number
  /** откатов в истории */
  reverts: number
}

export interface Dimension {
  name: string
  value: number
  /** объяснение числа человеку — вердикт обязан быть проверяемым */
  detail: string
  /**
   * Есть ли данные для этого измерения. «Неизвестно» — не то же самое, что
   * «плохо»: проект без git-истории не хаотичен, о нём просто нечего сказать.
   * Найдено на боевых проектах владельца: отсутствие истории обнуляло
   * стабильность и роняло зрелость до 0.07 у совершенно нормальных проектов.
   */
  known: boolean
}

export interface Maturity {
  /** 0..1 — непрерывный коэффициент зрелости */
  score: number
  level: MaturityLevel
  dimensions: Dimension[]
  /** слабейшее измерение: точка приложения усилий */
  weakest: Dimension | null
  /** проекта фактически нет — отдельно от «молодого» (молчание важнее вердикта) */
  empty: boolean
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/**
 * Двоичная энтропия доли p (0..1). Максимум 1 при p=0.5 (полная неопределённость),
 * ноль при p=0 или p=1 (вопрос решён однозначно).
 */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))
}

/**
 * Определённость канона: 1 − средняя энтропия конвенций. Проект, где каждый
 * вопрос стиля решён однозначно, получает 1; где всё пополам — 0.
 * Нет конвенций вовсе → 0: канона нет, а не «канон идеален».
 */
export function canonCertainty(prevalences: number[]): number {
  if (prevalences.length === 0) return 0
  const mean = prevalences.reduce((s, p) => s + binaryEntropy(clamp01(p)), 0) / prevalences.length
  return clamp01(1 - mean)
}

/**
 * Масса проекта по логарифмической шкале: разница между 5 и 50 файлами
 * существенна, между 500 и 5000 — почти нет. Опорная точка не «правильный
 * размер», а масштаб, на котором статистика конвенций вообще осмысленна.
 */
const MASS_HALF_FILES = 40
const MASS_HALF_COMMITS = 60

export function massScore(codeFiles: number, commits: number): number {
  // Насыщающая кривая x/(x+половина), а не логарифм: логарифм слишком щедр на
  // малых значениях — двенадцать файлов получали половину шкалы и вытягивали
  // крошечный проект в «зрелые». Здесь half-точка честно означает «масштаб, на
  // котором статистика конвенций становится надёжной».
  const f = Math.max(0, codeFiles) / (Math.max(0, codeFiles) + MASS_HALF_FILES)
  const c = Math.max(0, commits) / (Math.max(0, commits) + MASS_HALF_COMMITS)
  // История и объём взаимозаменяемы лишь отчасти: берём их среднее, чтобы
  // большой дамп без истории не выглядел зрелым, а долгая история крошечного
  // репозитория — тоже.
  return clamp01((clamp01(f) + clamp01(c)) / 2)
}

/** Проверяемость КОДА: доля проверок относительно кода, CI — отдельный вклад. */
export function verifiabilityScore(codeFiles: number, testFiles: number, hasCi: boolean): number {
  if (codeFiles === 0) return 0
  // Отношение тестов к коду 1:3 считаем полноценным — дальше насыщение.
  const ratio = clamp01(testFiles / (codeFiles / 3))
  return clamp01(ratio * 0.8 + (hasCi ? 0.2 : 0))
}

/**
 * Проверяемость КОНТЕНТА: связность вместо тестов. Материал считается
 * проверенным, когда ссылки ведут куда обещано и до каждой сущности можно дойти.
 * Это ровно то, что тесты дают коду: подтверждение, что заявленное работает.
 */
export function contentIntegrityScore(c: ContentIntegrity): number {
  if (c.entities === 0) return 0
  const brokenShare = clamp01(c.broken / c.entities)
  const orphanShare = clamp01(c.orphans / c.entities)
  // Битая ссылка хуже сироты: первая обманывает читателя, вторая лишь не найдена
  return clamp01(1 - brokenShare * 1.5 - orphanShare * 0.5)
}

/**
 * Стабильность: какая доля работы уходит НЕ на починки. Проект, где каждый
 * второй коммит — фикс, ещё не устоялся, даже если он большой и старый.
 * Откаты штрафуются отдельно: это признак решений, которые не пережили встречу
 * с реальностью.
 */
export function stabilityScore(commits: number, fixCommits: number, reverts: number): number {
  if (commits === 0) return 0
  const fixShare = clamp01(fixCommits / commits)
  const revertPenalty = clamp01(reverts / Math.max(commits, 1)) * 2
  return clamp01(1 - fixShare - revertPenalty)
}

/**
 * Гармоническое среднее: величина доминируется САМЫМ СЛАБЫМ измерением.
 *
 * Выбрано вместо геометрического после проверки на крайних случаях. Проект, где
 * две трети коммитов — починки, при геометрическом среднем получал 0.64 и
 * назывался зрелым: корень четвёртой степени слишком сглаживал единственную
 * провальную ось. Гармоническое даёт 0.54 — «растущий», что и есть правда.
 *
 * Это не подгонка, а верная модель предмета: зрелость — цепь, а не сумма. Проект
 * с прекрасным стилем, но без единой проверки не зрел; проект, который постоянно
 * чинят, не зрел, каким бы большим он ни был. Слабое звено определяет целое.
 */
function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0
  // Пол вместо нуля: без него одно «пока ноль» делает шкалу нечувствительной к
  // прогрессу по остальным осям (деление на ноль обнуляет всё намертво).
  const floored = values.map((v) => Math.max(v, 0.02))
  const sumInverse = floored.reduce((s, v) => s + 1 / v, 0)
  return clamp01(floored.length / sumInverse)
}

/** Ярлык — подпись к числу, а не сущность. Границы объявлены явно и здесь. */
export function levelOf(score: number): MaturityLevel {
  if (score >= 0.62) return 'зрелый'
  if (score >= 0.3) return 'растущий'
  return 'молодой'
}

/**
 * Проверяемость выбирается по природе материала, а не назначается одна на всех.
 * Смешанный проект оценивается по коду: там, где есть и то и другое, тесты
 * остаются более сильным подтверждением корректности.
 */
function verifiabilityDimension(input: MaturityInput): Dimension {
  const nature = input.nature ?? (input.codeFiles > 0 ? 'код' : 'контент')
  if (nature === 'контент' && input.content && input.content.entities > 0) {
    const c = input.content
    return {
      name: 'целостность контента',
      value: contentIntegrityScore(c),
      known: true,
      detail: t(`${c.entities} сущностей, битых ссылок ${c.broken}, сирот ${c.orphans}`, `${c.entities} entities, ${c.broken} broken links, ${c.orphans} orphans`),
    }
  }
  return {
    name: 'проверяемость',
    value: verifiabilityScore(input.codeFiles, input.testFiles, input.hasCi),
    known: input.codeFiles > 0,
    detail: t(`${input.testFiles} тестов${input.hasCi ? ', CI настроен' : ', CI не найден'}`, `${input.testFiles} test files${input.hasCi ? ', CI configured' : ', no CI found'}`),
  }
}

export function assessMaturity(input: MaturityInput): Maturity {
  const empty = input.codeFiles === 0 && input.commits === 0

  const dimensions: Dimension[] = [
    {
      name: 'определённость канона',
      value: canonCertainty(input.prevalences),
      known: input.prevalences.length > 0,
      detail:
        input.prevalences.length === 0
          ? t('конвенций пока не выведено', 'no conventions derived yet')
          : t(
              `${input.prevalences.length} конвенций, средняя неопределённость ${(1 - canonCertainty(input.prevalences)).toFixed(2)} бит`,
              `${input.prevalences.length} conventions, average uncertainty ${(1 - canonCertainty(input.prevalences)).toFixed(2)} bits`,
            ),
    },
    {
      name: 'масса',
      value: massScore(input.codeFiles, input.commits),
      known: true,
      detail: t(`${input.codeFiles} файлов кода, ${input.commits} коммитов`, `${input.codeFiles} code files, ${input.commits} commits`),
    },
    verifiabilityDimension(input),
    {
      name: 'стабильность',
      value: stabilityScore(input.commits, input.fixCommits, input.reverts),
      known: input.commits > 0,
      detail:
        input.commits === 0
          ? t('истории ещё нет', 'no history yet')
          : t(
              `починок ${input.fixCommits} из ${input.commits}${input.reverts > 0 ? `, откатов ${input.reverts}` : ''}`,
              `${input.fixCommits} fixes out of ${input.commits}${input.reverts > 0 ? `, ${input.reverts} reverts` : ''}`,
            ),
    },
  ]

  // В среднее идут только измеримые оси: неизвестное не наказывает
  const measured = dimensions.filter((d) => d.known)
  const score = empty || measured.length === 0 ? 0 : harmonicMean(measured.map((d) => d.value))
  const weakest = measured.length === 0 ? null : measured.reduce((a, b) => (b.value < a.value ? b : a))
  return { score, level: levelOf(score), dimensions, weakest, empty }
}

/**
 * Стойка качества под стадию. Пары «что делать» + «чего не делать» — сдержанность
 * в ядре: амбиция без ограничителя ломает проекты.
 */
export function maturityStance(level: MaturityLevel): string[] {
  if (level === 'зрелый') {
    return [
      t('канон проекта сложился: типовая работа делается по прецеденту, а не изобретается заново', 'the canon here is settled: routine work follows precedent instead of being reinvented'),
      t('отклонение от конвенции здесь — осознанное решение, которое стоит назвать вслух', 'departing from a convention here is a deliberate decision worth saying out loud'),
      t('ограничение: массовые переделки работающего кода не входят в задачу', 'constraint: sweeping rewrites of working code are out of scope'),
    ]
  }
  if (level === 'растущий') {
    return [
      t('канон ещё складывается: удачное решение стоит закреплять, повторяя его', 'the canon is still forming: a good decision is worth cementing by repeating it'),
      t('противоречие с уже принятым решением — повод выбрать одно, а не держать оба', 'a contradiction with an earlier decision is a reason to pick one, not to keep both'),
      t('ограничение: единообразие важнее локальной элегантности', 'constraint: consistency outweighs local elegance'),
    ]
  }
  return [
    t('канона ещё нет: решения принимаются впервые и станут прецедентом для всего проекта', 'there is no canon yet: decisions are being made for the first time and will become precedent'),
    t('планка задаётся сразу — структура, обработка ошибок, границы модулей и проверяемость закладываются с первой строки, а не «потом»', 'the bar is set now — structure, error handling, module boundaries and testability start with the first line, not “later”'),
    t('подражать текущему коду нечему: несколько файлов — это случайность, а не конвенция', 'there is nothing to imitate yet: a handful of files is an accident, not a convention'),
    t('ограничение: сложность вводится только под названную задачу, архитектура «на вырост» без потребности запрещена', 'constraint: complexity only for a named task; architecture “for future growth” without a need is out'),
  ]
}

/** Факт для журнала: то же старение и подтверждение, что у остальных. */
export function maturityFact(m: Maturity): Fact {
  // Уровень — в формулировке, балл — в основании (positive из 100): текст с
  // баллом менялся на каждом пересчёте и вытеснял сам себя (18 версий)
  const dims = m.dimensions.filter((d) => d.known).map((d) => d.name).join(', ')
  return {
    area: 'зрелость проекта',
    statement: `зрелость проекта — ${m.level}: ${dims}`,
    positive: Math.round(m.score * 100),
    total: 100,
    prevalence: 1,
    tier: 'привычка',
  }
}

/** Блок сводки; пустой каталог не получает ни строки (инвариант молчания). */
/** Имена измерений и стадий на языке подачи (в журнале они остаются русскими). */
const dimName = (ru: string): string =>
  t(ru, ({ 'определённость канона': 'canon certainty', масса: 'mass', проверяемость: 'testability', стабильность: 'stability' } as Record<string, string>)[ru] ?? ru)
const levelName = (ru: string): string =>
  t(ru, ({ зрелый: 'mature', растущий: 'growing', молодой: 'young', 'только начат': 'just started' } as Record<string, string>)[ru] ?? ru)

/**
 * Формулировка факта зрелости — переводится ОБРАЗЦОМ, а не парой строк.
 *
 * В журнал она уходит по-русски всегда (по ней считается ключ вытеснения), но в
 * неё подставлены числа проекта, поэтому зарегистрировать все варианты парами
 * нельзя — их бесконечно много. Регулярка ловит форму, а имена стадии и
 * измерений собираются теми же функциями, что и в сводке: двух словарей об одном
 * и том же быть не должно. Без этого образца факт уходил в MCP по-русски даже
 * при английской подаче — единственная формулировка, которая там оставалась.
 */
pattern(/^зрелость проекта — (.+?): (.+)$/, (m) => `project maturity — ${levelName(m[1])}: ${m[2].split(', ').map(dimName).join(', ')}`)
// Старая форма с баллом в тексте — для записей журнала, уже вытесненных, но видимых в passport_history
pattern(/^зрелость проекта — ([\d.]+) \((.+?)\): (.+)$/, (m) => {
  const dims = m[3]
    .split(', ')
    .map((part) => {
      const cut = part.lastIndexOf(' ')
      return cut > 0 ? `${dimName(part.slice(0, cut))} ${part.slice(cut + 1)}` : part
    })
    .join(', ')
  return `project maturity — ${m[1]} (${levelName(m[2])}): ${dims}`
})

export function renderMaturity(m: Maturity): string {
  if (m.empty) return ''
  const dims = m.dimensions.map((d) => (d.known ? `${dimName(d.name)} ${d.value.toFixed(2)}` : `${dimName(d.name)}${t(' — нет данных', ' — no data')}`)).join(' · ')
  const lines = [t(`## Зрелость проекта: ${m.score.toFixed(2)} из 1 — ${m.level}`, `## Project maturity: ${m.score.toFixed(2)} of 1 — ${levelName(m.level)}`), '', t(`- измерения: ${dims}`, `- dimensions: ${dims}`)]
  // Слабейшее измерение называем всегда: коэффициент без точки приложения
  // усилий — украшение, а с ней — рычаг.
  if (m.weakest && m.weakest.value < 0.5) {
    lines.push(t(`- слабее всего: ${m.weakest.name} (${m.weakest.value.toFixed(2)}) — ${m.weakest.detail}`, `- weakest: ${dimName(m.weakest.name)} (${m.weakest.value.toFixed(2)}) — ${m.weakest.detail}`))
  }
  lines.push('')
  for (const s of maturityStance(m.level)) lines.push(`- ${s}`)
  return lines.join('\n')
}
