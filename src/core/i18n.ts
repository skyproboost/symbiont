/**
 * Язык подачи: на каком языке Symbiont ГОВОРИТ с владельцем.
 *
 * Речь не про язык кода и не про язык модели — язык собеседника модель видит
 * сама. Речь про строки, которые пишет плагин: стартовую сводку, вывод команд,
 * формулировки выведенных правил, сообщения гейта.
 *
 * КАК ВЫБИРАЕТСЯ. Тем же способом, что и всё остальное здесь — наблюдением, а
 * не вопросом человеку. Порядок от самого достоверного к самому косвенному:
 *
 *   1) выбор владельца, если он сказал вслух (`lang.json`, поле choice);
 *   2) переменная окружения SYMBIONT_LANG — разовые прогоны и тесты;
 *   3) ЯЗЫК СООБЩЕНИЙ ВЛАДЕЛЬЦА МОДЕЛИ. После первого же обращения язык известен
 *      точно: человек пишет модели на своём языке. Наблюдается в UserPromptSubmit,
 *      копится с затуханием — смена языка со временем перевешивает прошлое;
 *   4) до первого обращения — КОММЕНТАРИИ В КОДЕ проекта. Комментарий человек
 *      пишет для себя, а не для чужого читателя, поэтому он честнее прочего
 *      текста в репозитории;
 *   5) тексты проекта (README и документация);
 *   6) язык системы (Intl) — «человек за этой машиной»;
 *   7) темы коммитов — САМЫЙ СЛАБЫЙ признак и потому последний: английские
 *      коммиты по конвенции пишут и те, кто говорит по-русски (проверено на
 *      проектах владельца);
 *   8) английский — умолчание для мира.
 *
 * Выбор и накопленные наблюдения лежат в корне данных, поэтому определение
 * стоит одно чтение файла, а не опрос окружения на каждый хук.
 *
 * ПОЧЕМУ ПАРА СТРОК, А НЕ КЛЮЧИ. `t('Готово', 'Done')` вместо `t('common.done')`:
 * ключ можно потерять, переименовать или забыть перевести — и тогда наружу
 * уходит служебное имя. Пара живёт в одном месте с текстом, её нельзя
 * рассинхронизировать, и она читается в коде без словаря.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type Lang = 'ru' | 'en'

const FILE = 'lang.json'

/**
 * Английский — умолчание процесса: плагин публичный, и человек, о котором ещё
 * ничего не известно, скорее говорит по-английски. Русский включается сам по
 * первому же русскому сообщению владельца — и остаётся, потому что наблюдение
 * сильнее умолчания. Переменная окружения действует СРАЗУ при загрузке модуля, не дожидаясь
 * initLang: иначе строка, отрисованная до инициализации, ушла бы на другом языке.
 */
let current: Lang = ((): Lang => {
  const v = (process.env.SYMBIONT_LANG ?? '').toLowerCase()
  return v === 'ru' || v === 'en' ? v : 'en'
})()

export const lang = (): Lang => current
export const setLang = (l: Lang): void => {
  current = l
}

/** Строка на текущем языке. Русский — исходный, английский — перевод. */
export const t = (ru: string, en: string): string => (current === 'en' ? en : ru)

/** Буквы по алфавитам: кириллица против латиницы. Без словарей и списков языков. */
export function letters(text: string): { cyr: number; lat: number } {
  let cyr = 0
  let lat = 0
  for (const ch of text) {
    if (ch >= 'а' && ch <= 'я') cyr++
    else if (ch >= 'А' && ch <= 'Я') cyr++
    else if (ch === 'ё' || ch === 'Ё') cyr++
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) lat++
  }
  return { cyr, lat }
}

/**
 * Порог намеренно низкий. Технические тексты русскоязычного человека всегда
 * наполовину латиница — имена файлов, команды, термины: «поправь src/core/db.ts,
 * там busy_timeout». При пороге в половину такой текст считался бы английским.
 * Обратная ошибка требует уже 15% кириллицы, что случайно не набирается.
 */
const RU_SHARE = 0.15
const decide = (cyr: number, lat: number): Lang => (cyr + lat > 0 && cyr / (cyr + lat) >= RU_SHARE ? 'ru' : 'en')

interface Counts {
  cyr: number
  lat: number
  n: number
}

/** Откуда взялся выбор языка. Ключ, а не фраза — файл не должен зависеть от того, каким языком его писали. */
export type LangSource = 'choice' | 'env' | 'prompts' | 'comments' | 'docs' | 'system' | 'commits' | 'default'

/** Основание выбора словами — переводится в момент показа, а не записи. */
export const sourceLabel = (key: LangSource): string =>
  ({
    choice: t('ваш выбор', 'your choice'),
    env: t('переменная окружения', 'environment variable'),
    prompts: t('язык ваших сообщений', 'the language you write in'),
    comments: t('язык комментариев в коде', 'the language of code comments'),
    docs: t('язык документации проекта', 'the language of project docs'),
    system: t('язык системы', 'system language'),
    commits: t('язык коммитов', 'the language of commits'),
    default: t('умолчание', 'default'),
  })[key]

interface LangState {
  /** сказанное владельцем вслух — сильнее любого наблюдения */
  choice: Lang | null
  /** язык обращений владельца к модели (с затуханием) */
  prompts: Counts
  /** язык комментариев в коде проекта */
  comments: Counts
  /** последнее решение и его основание — для показа человеку */
  lang: Lang
  source: LangSource
  at: string
}

const EMPTY: LangState = {
  choice: null,
  prompts: { cyr: 0, lat: 0, n: 0 },
  comments: { cyr: 0, lat: 0, n: 0 },
  lang: 'ru',
  source: 'default',
  at: '',
}

export function readState(dataDir: string): LangState {
  try {
    const p = join(dataDir, FILE)
    if (!existsSync(p)) return { ...EMPTY }
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<LangState>
    return {
      choice: raw.choice === 'ru' || raw.choice === 'en' ? raw.choice : null,
      prompts: { ...EMPTY.prompts, ...(raw.prompts ?? {}) },
      comments: { ...EMPTY.comments, ...(raw.comments ?? {}) },
      lang: raw.lang === 'en' ? 'en' : 'ru',
      source: (raw.source as LangSource) ?? 'default',
      at: raw.at ?? '',
    }
  } catch {
    return { ...EMPTY } // порча файла = наблюдений нет, определим заново
  }
}

function writeState(dataDir: string, s: LangState): void {
  try {
    writeFileSync(join(dataDir, FILE), `${JSON.stringify(s, null, 2)}\n`, 'utf8')
  } catch {
    /* не записалось — язык определится заново в следующий раз, потери нет */
  }
}

/** Язык системы: ru-RU → русский. Косвенно, но бесплатно и без сети. */
function langFromSystem(): Lang | null {
  try {
    const locale = process.env.LANG ?? process.env.LC_ALL ?? Intl.DateTimeFormat().resolvedOptions().locale ?? ''
    if (/^ru/i.test(locale)) return 'ru'
    return /^[a-z]{2}/i.test(locale) ? 'en' : null
  } catch {
    return null // среда без Intl — признак просто отсутствует
  }
}

/** Язык текстов проекта (README и корневые доки); null — читать нечего. */
export function langFromDocs(projectRoot: string): Lang | null {
  const names = ['README.md', 'readme.md', 'README.txt', 'CONTRIBUTING.md', 'docs/README.md']
  let text = ''
  for (const n of names) {
    try {
      const p = join(projectRoot, n)
      if (existsSync(p)) text += readFileSync(p, 'utf8').slice(0, 20_000)
    } catch {
      continue // нечитаемый файл — остальные могут ответить
    }
  }
  const l = letters(text)
  return l.cyr + l.lat < 200 ? null : decide(l.cyr, l.lat)
}

/** Язык тем коммитов; null — истории нет. Признак слабый (см. заголовок). */
export function langFromCommits(projectRoot: string): Lang | null {
  try {
    const r = spawnSync('git', ['log', '--format=%s', '-n', '120'], { cwd: projectRoot, encoding: 'utf8', timeout: 4000, windowsHide: true })
    if (r.status !== 0 || !r.stdout) return null
    const l = letters(r.stdout)
    return l.cyr + l.lat < 100 ? null : decide(l.cyr, l.lat)
  } catch {
    return null // git недоступен — не наша беда
  }
}

/** Достаточно ли наблюдений, чтобы им верить. */
const enough = (c: Counts, min: number): boolean => c.cyr + c.lat >= min

/** Решение по накопленному состоянию + окружению проекта. */
function decideFrom(state: LangState, projectRoot: string | null): { lang: Lang; source: LangSource } {
  if (state.choice) return { lang: state.choice, source: 'choice' }
  // Одно обращение к модели уже отвечает на вопрос: человек пишет на своём языке
  if (enough(state.prompts, 25)) return { lang: decide(state.prompts.cyr, state.prompts.lat), source: 'prompts' }
  if (enough(state.comments, 200)) return { lang: decide(state.comments.cyr, state.comments.lat), source: 'comments' }
  if (projectRoot) {
    const docs = langFromDocs(projectRoot)
    if (docs) return { lang: docs, source: 'docs' }
  }
  const sys = langFromSystem()
  if (sys) return { lang: sys, source: 'system' }
  if (projectRoot) {
    const commits = langFromCommits(projectRoot)
    if (commits) return { lang: commits, source: 'commits' }
  }
  return { lang: 'en', source: 'default' }
}

const envLang = (): Lang | null => {
  const v = (process.env.SYMBIONT_LANG ?? '').toLowerCase()
  return v === 'ru' || v === 'en' ? v : null
}

/**
 * Установить язык процесса. Зовётся точками входа (хуки, команды) один раз, до
 * первой отрисовки; без корня данных остаётся исходный русский.
 */
export function initLang(dataDir: string | null, projectRoot: string | null): { lang: Lang; source: LangSource } {
  const env = envLang()
  if (env) {
    setLang(env)
    return { lang: env, source: 'env' }
  }
  if (!dataDir) return { lang: current, source: 'default' }
  const state = readState(dataDir)
  const verdict = decideFrom(state, projectRoot)
  setLang(verdict.lang)
  // Решение записывается, только если оно изменилось: хук не должен трогать
  // диск на каждом сообщении ради одного и того же вывода
  if (state.lang !== verdict.lang || state.source !== verdict.source) {
    writeState(dataDir, { ...state, lang: verdict.lang, source: verdict.source, at: new Date().toISOString() })
  }
  return verdict
}

/**
 * Наблюдение за сообщением владельца модели. Затухание 0.7 на сообщение: язык
 * можно сменить, и система обязана это заметить, но не с одного «ok».
 */
export function observePrompt(dataDir: string, text: string): void {
  const l = letters(text)
  if (l.cyr + l.lat < 5) return // «да», «ок», путь к файлу — не свидетельство
  const state = readState(dataDir)
  const decay = 0.7
  state.prompts = {
    cyr: Math.round((state.prompts.cyr * decay + l.cyr) * 100) / 100,
    lat: Math.round((state.prompts.lat * decay + l.lat) * 100) / 100,
    n: state.prompts.n + 1,
  }
  const verdict = decideFrom(state, null)
  state.lang = verdict.lang
  state.source = verdict.source
  state.at = new Date().toISOString()
  writeState(dataDir, state)
}

/** Наблюдение за комментариями проекта (считает майнер при сборке паспорта). */
export function observeComments(dataDir: string, cyr: number, lat: number): void {
  if (cyr + lat < 50) return
  const state = readState(dataDir)
  if (state.comments.cyr === cyr && state.comments.lat === lat) return // не изменилось — диск не трогаем
  state.comments = { cyr, lat, n: 1 }
  const verdict = decideFrom(state, null)
  state.lang = verdict.lang
  state.source = verdict.source
  state.at = new Date().toISOString()
  writeState(dataDir, state)
}

/** Явный выбор владельца; null — вернуться к наблюдению. */
export function chooseLang(dataDir: string, choice: Lang | null): { lang: Lang; source: LangSource } {
  const state = readState(dataDir)
  state.choice = choice
  const verdict = decideFrom(state, null)
  state.lang = verdict.lang
  state.source = verdict.source
  state.at = new Date().toISOString()
  writeState(dataDir, state)
  setLang(verdict.lang)
  return verdict
}

// ── Формулировки выведенных правил ───────────────────────────────────────────

/**
 * Пара «как записано в журнале» → «как показать по-английски».
 *
 * Формулировка факта — часть его личности: по ней считается ключ вытеснения, а
 * журнал фактов неприкосновенен. Поэтому перевод живёт НЕ в журнале, а на
 * последней миле: в базе по-прежнему русская строка, наружу уходит английская.
 * Регистрация идёт при загрузке модуля-таблицы, а не при срабатывании ветки, —
 * иначе процесс, который только ЧИТАЕТ факты из базы, ничего бы о них не знал.
 */
const STATEMENTS = new Map<string, string>()

/** Объявить пару и вернуть русскую формулировку (она и пишется в журнал). */
export function pair(ru: string, en: string): string {
  STATEMENTS.set(ru, en)
  return ru
}

/**
 * Шаблонные формулировки: «<ось> — заявлена в доках…», «приоритет: <ось> — …».
 *
 * Пара строк не годится там, где в формулировку подставлены данные проекта:
 * зарегистрировать все варианты нельзя, а без перевода факт уходит наружу
 * по-русски. Поэтому рядом с таблицей пар живёт таблица образцов: регулярка
 * ловит форму, функция собирает английскую формулировку из тех же групп.
 * Регистрируется, как и пары, при загрузке модуля-владельца формулировки.
 */
const PATTERNS: Array<{ re: RegExp; en: (m: RegExpMatchArray) => string }> = []

/** Объявить образец формулировки. Возвращает ничего — русская строка строится на месте. */
export function pattern(re: RegExp, en: (m: RegExpMatchArray) => string): void {
  PATTERNS.push({ re, en })
}

/**
 * Название оси качества. Оси — ВНУТРЕННИЕ КЛЮЧИ: по ним ходят правила, рубрика
 * возвышения и профиль, они лежат в журнале. Поэтому ключ остаётся русским
 * всегда, а перевод случается в момент показа — как у яруса и области.
 */
export const axisName = (ru: string): string =>
  current === 'en'
    ? ({
        безопасность: 'security',
        корректность: 'correctness',
        производительность: 'performance',
        поддерживаемость: 'maintainability',
        отказоустойчивость: 'resilience',
        наблюдаемость: 'observability',
        'находимость/SEO': 'findability/SEO',
        'связность/перелинковка': 'connectedness/interlinking',
        'полнота/покрытие': 'completeness/coverage',
        доступность: 'accessibility',
        'легитимность/контекст': 'legitimacy/context',
        совместимость: 'compatibility',
        'целостность данных': 'data integrity',
        поставляемость: 'deliverability',
        'масштабируемость (горизонт+вертикаль)': 'scalability (horizontal + vertical)',
        согласованность: 'consistency',
        'UX/эргономика': 'UX/ergonomics',
        стоимость: 'cost',
        приватность: 'privacy',
        SEO: 'SEO',
      } as Record<string, string>)[ru] ?? ru
    : ru

/** Список осей на языке подачи (порядок сохраняется — он несёт вес сигналов). */
export const axisList = (axes: string[]): string => axes.map(axisName).join(', ')

/** Формулировка факта на текущем языке; незнакомая (от модели) — как есть. */
export function statement(ru: string): string {
  if (current !== 'en') return ru
  const known = STATEMENTS.get(ru)
  if (known) return known
  for (const p of PATTERNS) {
    const m = ru.match(p.re)
    if (m) return p.en(m)
  }
  // Шаблонная формулировка: «венгерская нотация — префиксы типа: s* (12), a* (4)».
  // Переводится голова до двоеточия, хвост с числами остаётся как есть — он и
  // так на языке кода
  const colon = ru.indexOf(': ')
  if (colon > 0) {
    const head = STATEMENTS.get(ru.slice(0, colon))
    if (head) return `${head}: ${ru.slice(colon + 2)}`
  }
  return ru
}

/** Ярус уверенности — в базе по-русски, наружу на языке подачи. */
export const tier = (ru: string): string =>
  current === 'en' ? ({ закон: 'law', привычка: 'habit', гипотеза: 'hypothesis', 'нет консенсуса': 'no consensus' } as Record<string, string>)[ru] ?? ru : ru

const AREAS: Record<string, string> = {
  форматирование: 'formatting',
  объявления: 'declarations',
  функции: 'functions',
  итерации: 'iteration',
  именование: 'naming',
  параметры: 'parameters',
  строки: 'strings',
  сигнатуры: 'signatures',
  массивы: 'arrays',
  сравнения: 'comparisons',
  методы: 'methods',
  'обработка ошибок': 'error handling',
  асинхронность: 'asynchrony',
  классы: 'classes',
  vue: 'vue',
}

/** Область факта (форматирование, объявления…) — то же правило. */
export const area = (ru: string): string => (current === 'en' ? AREAS[ru] ?? ru : ru)

/** Перечень областей на языке подачи — для описаний инструментов и подсказок. */
export const areaList = (): string => Object.keys(AREAS).map(area).join(', ')

/**
 * Обратный ход: как область НАЗВАЛИ снаружи → её ключ в журнале.
 *
 * Нужен там, где имя области принимается от человека или модели. Показать
 * список по-английски и не принять английское имя — та же ловушка, что была с
 * ключевыми словами возвышения: прочитать можно, выполнить нельзя. Русский ключ
 * принимается всегда, независимо от языка подачи, — он остаётся идентичностью.
 */
export function areaKey(input: string): string {
  const low = input.trim().toLowerCase()
  if (!low) return ''
  for (const ru of Object.keys(AREAS)) {
    if (ru.toLowerCase() === low || AREAS[ru].toLowerCase() === low) return ru
  }
  return low // незнакомое имя отдаём как есть: фильтр по подстроке разберётся
}
