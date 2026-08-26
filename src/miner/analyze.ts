/**
 * Слой 0 майнера: статистика по коду без AST и без LLM.
 * Все функции чистые — принимают текст, возвращают наблюдения.
 */
import { countAxes, addAxes, codeOnly, splitCode, type AxisCounts } from './packs'
import { letters } from '../core/i18n'

export interface JsStats {
  decl: { var: number; let: number; const: number }
  fn: { arrow: number; decl: number }
  fmr: { filter: number; map: number; reduce: number; forLoops: number }
  naming: { camel: number; snake: number; upper: number; pascal: number; plain: number }
  hungarianPrefixes: Record<string, number>
  hungarianBase: number
  params: { underscore: number; plain: number }
  destructuredParams: number
  quotes: { single: number; double: number }
  semiLines: { with: number; without: number }
}

export type IndentVerdict = 'tab' | 's2' | 's4' | 'other' | null

export interface FileObservation {
  path: string
  ext: string
  lines: number
  indent: IndentVerdict
  quoteVerdict: 'single' | 'double' | null
  semiVerdict: 'with' | 'without' | null
  vue: 'setup' | 'options' | null
  js: JsStats
  /** оси языкового пакета (packs.ts): по одному счётчику на конкурирующие формы */
  axes: AxisCounts
  /** буквы комментариев по алфавитам — признак языка владельца (core/i18n.ts) */
  comments: { cyr: number; lat: number }
}

const emptyJsStats = (): JsStats => ({
  decl: { var: 0, let: 0, const: 0 },
  fn: { arrow: 0, decl: 0 },
  fmr: { filter: 0, map: 0, reduce: 0, forLoops: 0 },
  naming: { camel: 0, snake: 0, upper: 0, pascal: 0, plain: 0 },
  hungarianPrefixes: {},
  hungarianBase: 0,
  params: { underscore: 0, plain: 0 },
  destructuredParams: 0,
  quotes: { single: 0, double: 0 },
  semiLines: { with: 0, without: 0 },
})

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length

function classifyIdentifier(raw: string, stats: JsStats, isVariable: boolean): void {
  // Подчёркивания по краям — пометка приватности (`_body` в C#/JS, `__init__` в
  // Python), а не стиль именования. Судить надо по существу имени: иначе каждое
  // приватное поле считалось бы snake_case. Поймано на Unity-мире, где паспорт
  // заявил закон «идентификаторы — snake_case, 72 из 72» по одному `_body`.
  const id = raw.replace(/^_+|_+$/g, '')
  if (!id) return

  if (/^[A-Z][A-Z0-9_]*$/.test(id) && id.length > 1) stats.naming.upper++
  else if (id.includes('_')) stats.naming.snake++
  else if (/^[A-Z]/.test(id)) stats.naming.pascal++
  else if (/[A-Z]/.test(id)) stats.naming.camel++
  else stats.naming.plain++

  if (isVariable && id.length >= 3 && /^[a-z]/.test(id)) {
    stats.hungarianBase++
    const m = id.match(/^([a-z]{1,2})[A-Z]/)
    if (m) stats.hungarianPrefixes[m[1]] = (stats.hungarianPrefixes[m[1]] ?? 0) + 1
  }
}

/**
 * Конвенция именования — про словарь имён, а не про число строк. Одно и то же
 * имя, встреченное в файле сто раз, — одно наблюдение: иначе повторяющийся код
 * штампует «закон» из единственного идентификатора (тот же Unity-мир: 72
 * присваивания одному полю давали 100%-й вердикт). Различаем в пределах файла —
 * повторение ОДНОГО имени в РАЗНЫХ файлах остаётся сигналом общей привычки.
 */
function uniqueClassifier(stats: JsStats): (id: string, isVariable: boolean) => void {
  const seen = new Set<string>()
  return (id: string, isVariable: boolean): void => {
    if (seen.has(id)) return
    seen.add(id)
    classifyIdentifier(id, stats, isVariable)
  }
}

/**
 * Разрез списка параметров по запятым ВЕРХНЕГО уровня.
 *
 * Наивный split(',') рвал по запятым внутри дженериков и деструктуризации:
 * `(a: Map<string, number>, b)` давал три «параметра» вместо двух, а
 * `({ x, y }: P, c)` — лишний фантом `y`. Перекос систематический и в одну
 * сторону: каждый разорванный параметр раздувал знаменатель ровно того закона,
 * который должен был его поймать.
 *
 * Отвергнуто: полноценный разбор TS. Для этого есть слой 1 (tree-sitter), а
 * слой 0 по устройству — статистика регэкспами на любом языке; здесь достаточно
 * счётчиков вложенности. Угловые скобки считаются с полом в нуле: в списке
 * параметров `<` практически всегда дженерик, но сравнение в значении по
 * умолчанию не должно уводить счётчик в минус.
 */
export function splitParams(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let angle = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (quote) {
      if (c === quote && list[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    else if (c === '<') angle++
    else if (c === '>' && list[i - 1] !== '=') angle = Math.max(0, angle - 1)
    else if (c === ',' && depth === 0 && angle === 0) {
      out.push(list.slice(start, i))
      start = i + 1
    }
  }
  out.push(list.slice(start))
  return out.filter((p) => p.trim().length > 0)
}

/**
 * Списки параметров функций и стрелок — со сбалансированными скобками.
 * Регэксп-захват `\(([^)]*)\)` обрывался на первой закрывающей скобке, поэтому
 * `(cb: () => void, x)` усекался до `cb: (` ещё до всякого разреза: глубинный
 * разбор получал бы искалеченный вход. Сканер идёт по тексту один раз.
 */
export function paramLists(code: string): string[] {
  const out: string[] = []
  const open: number[] = []
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '(') {
      open.push(i)
      continue
    }
    if (c !== ')') continue
    const start = open.pop()
    if (start === undefined) continue // лишняя закрывающая — не наша беда
    // Список параметров узнаётся по окружению: слева `function имя`, справа `=>`.
    // Стек, а не прыжок к парной скобке: стрелки живут ВНУТРИ вызовов
    // (`files.map(({ file }) => …)`), и прыжок через вызов пропускал бы их —
    // именно так первая версия этой правки обнулила счётчик деструктуризаций.
    const before = code.slice(Math.max(0, start - 40), start)
    const after = code.slice(i + 1, i + 5)
    if (/\bfunction\s*[\w$]*\s*$/.test(before) || /^\s*=>/.test(after)) out.push(code.slice(start + 1, i))
  }
  return out
}

function analyzeParams(paramList: string, stats: JsStats): void {
  for (const raw of splitParams(paramList)) {
    const p = raw.trim()
    if (!p) continue
    if (p.startsWith('{') || p.startsWith('[')) {
      stats.destructuredParams++
      continue
    }
    const id = p.match(/^([A-Za-z_$][\w$]*)/)?.[1]
    if (!id) continue
    if (id.startsWith('_')) stats.params.underscore++
    else stats.params.plain++
  }
}

/** Анализ JS/TS-текста (для .vue — передавать содержимое <script>-блоков). */
export function analyzeJs(content: string): JsStats {
  const stats = emptyJsStats()
  // Чистка тем же проходом, что и оси конвенций (codeOnly): и комментарии, и
  // СОДЕРЖИМОЕ строк. Раньше вырезались только комментарии, и `var` внутри
  // строки-фикстуры (тест или пробник, держащий чужой код текстом) считался
  // объявлением: на собственном паспорте 41% поимок гейта «var не используется»
  // приходились на такие строки — закон, которого никто не нарушал, стоял в
  // сводке первым по числу нарушений. Форма литералов сохраняется (пустые
  // кавычки), поэтому счёт кавычек не страдает.
  const noComments = codeOnly(content, '.js')

  stats.decl.var = count(noComments, /\bvar\s+[A-Za-z_$]/g)
  stats.decl.let = count(noComments, /\blet\s+[A-Za-z_$]/g)
  stats.decl.const = count(noComments, /\bconst\s+[A-Za-z_$]/g)

  stats.fn.arrow = count(noComments, /=>/g)
  stats.fn.decl = count(noComments, /\bfunction\b/g)

  stats.fmr.filter = count(noComments, /\.filter\s*\(/g)
  stats.fmr.map = count(noComments, /\.map\s*\(/g)
  stats.fmr.reduce = count(noComments, /\.reduce\s*\(/g)
  stats.fmr.forLoops = count(noComments, /\bfor\s*\(/g)

  const classify = uniqueClassifier(stats)
  for (const m of noComments.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
    classify(m[1], true)
  }
  for (const m of noComments.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    classify(m[1], false)
  }

  for (const list of paramLists(noComments)) analyzeParams(list, stats)

  stats.quotes.single = count(noComments, /'(?:[^'\\\n]|\\.)*'/g)
  stats.quotes.double = count(noComments, /"(?:[^"\\\n]|\\.)*"/g)

  // Точки с запятой: считаем только явные однострочные statement'ы
  // (начинаются с ключевого слова, заканчиваются завершённо — без хвостов вида `{`, `,`, оператора).
  for (const line of noComments.split('\n')) {
    const t = line.trim()
    if (!/^(?:var|let|const|return|throw|break|continue)\b/.test(t)) continue
    if (/;$/.test(t)) stats.semiLines.with++
    else if (/[\w$)\]'"`]$/.test(t)) stats.semiLines.without++
  }
  return stats
}

/** Вердикт по отступам файла: модальный положительный шаг между соседними строками. */
export function detectIndent(content: string): IndentVerdict {
  const lines = content.split('\n')
  let tabLed = 0
  const deltas: Record<number, number> = {}
  let prev = 0
  let indented = 0
  for (const line of lines) {
    if (!line.trim()) continue
    if (/^\t/.test(line)) {
      tabLed++
      indented++
      continue
    }
    const lead = (line.match(/^ */) as RegExpMatchArray)[0].length
    if (lead > 0) indented++
    const d = lead - prev
    if (d > 0 && d <= 8) deltas[d] = (deltas[d] ?? 0) + 1
    prev = lead
  }
  if (indented < 5) return null
  if (tabLed > indented / 2) return 'tab'
  const two = (deltas[2] ?? 0)
  const four = (deltas[4] ?? 0)
  if (two === 0 && four === 0) return null
  if (two >= four * 2) return 's2'
  if (four >= two * 2) return 's4'
  return 'other'
}

/**
 * Универсальное ядро именования: идентификаторы из присваиваний и объявлений
 * функций — работает на любом языке (PHP $x=, Python x=, Go x:=, Ruby def…).
 * Венгерская статистика намеренно не трогается — это метрика JS-пакета.
 */
function analyzeUniversalNaming(content: string, ext: string, stats: JsStats): void {
  const noComments = codeOnly(content, ext)
  const classify = uniqueClassifier(stats)
  for (const m of noComments.matchAll(/(?:^|[\s(,])\$?([A-Za-z_][A-Za-z0-9_]{2,})\s*:?=(?!=)/gm)) {
    classify(m[1], false)
  }
  for (const m of noComments.matchAll(/\b(?:def|function|func|fn)\s+&?\$?([A-Za-z_][\w]*)/g)) {
    classify(m[1], false)
  }
}

const VUE_SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/g
const JS_FAMILY = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.vue'])

/**
 * Средняя длина значимой строки, после которой файл считается сгенерированным
 * (минифай, бандл, дамп данных в синтаксисе языка). Единое число для слоя 0 и
 * для детектора клонов — там оно появилось раньше и по той же причине.
 */
export const GENERATED_LINE_CHARS = 200

/**
 * Сгенерированный файл не голосует о конвенциях: автор этих строк не писал.
 *
 * Найдено замером на боевом WordPress: два бандла AWS SDK несут файлы вида
 * `api-2.json.php` — дампы JSON в синтаксисе PHP, по 266 КБ в трёх строках.
 * Они одни давали 20 тысяч наблюдений «короткий синтаксис массивов» и
 * переворачивали вердикт по всему репозиторию, где рукописный код на `array()`.
 * Тот же класс ошибки, что «повтор — не подтверждение»: объём наблюдений без
 * объёма решений автора.
 */
export function looksGenerated(content: string): boolean {
  let chars = 0
  let lines = 0
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    chars += line.length
    lines++
  }
  return lines > 0 && chars / lines > GENERATED_LINE_CHARS
}

export function analyzeFile(path: string, ext: string, content: string): FileObservation {
  // Сгенерированное присутствует в проекте (и попадает в состав материала), но
  // о СТИЛЕ не свидетельствует — наблюдений ноль, а не «как получилось»
  if (looksGenerated(content)) {
    return {
      path,
      ext,
      lines: content.split('\n').length,
      indent: null,
      quoteVerdict: null,
      semiVerdict: null,
      vue: null,
      js: emptyJsStats(),
      axes: {},
      comments: { cyr: 0, lat: 0 },
    }
  }
  let jsContent = content
  let vue: FileObservation['vue'] = null
  if (ext === '.vue') {
    const blocks = [...content.matchAll(VUE_SCRIPT_RE)]
    jsContent = blocks.map((b) => b[1]).join('\n')
    if (/<script[^>]*\bsetup\b/.test(content)) vue = 'setup'
    else if (blocks.length > 0) vue = 'options'
  }
  // Языковой пакет JS — только для JS-семейства; универсальные анализаторы
  // (отступы, строки, именование) — для любого языка.
  const js = JS_FAMILY.has(ext) ? analyzeJs(jsContent) : emptyJsStats()
  if (!JS_FAMILY.has(ext)) analyzeUniversalNaming(content, ext, js)
  const q = js.quotes
  const s = js.semiLines
  return {
    path,
    ext,
    lines: content.split('\n').length,
    indent: detectIndent(content),
    quoteVerdict: q.single + q.double < 5 ? null : q.single >= q.double * 2 ? 'single' : q.double >= q.single * 2 ? 'double' : null,
    semiVerdict: s.with + s.without < 8 ? null : s.with >= s.without * 2 ? 'with' : s.without >= s.with * 2 ? 'without' : null,
    vue,
    js,
    // Содержимое отдаётся СЫРЫМ: чистку строк и комментариев в нужном порядке
    // делает сам счётчик осей (порядок — см. splitCode в packs.ts)
    axes: countAxes(ext, JS_FAMILY.has(ext) ? jsContent : content),
    comments: letters(splitCode(jsContent, ext).comments),
  }
}

export interface Aggregate {
  codeFiles: number
  totalLines: number
  indent: Record<string, number>
  quotes: Record<string, number>
  semis: Record<string, number>
  vue: Record<string, number>
  decl: { var: number; let: number; const: number }
  fn: { arrow: number; decl: number }
  fmr: { filter: number; map: number; reduce: number; forLoops: number }
  naming: { camel: number; snake: number; upper: number; pascal: number; plain: number }
  hungarianPrefixes: Record<string, number>
  hungarianBase: number
  params: { underscore: number; plain: number }
  destructuredParams: number
  extHist: Record<string, number>
  axes: AxisCounts
  /** язык комментариев проекта: буквы по алфавитам */
  comments: { cyr: number; lat: number }
}

export function aggregate(obs: FileObservation[], allExts: string[]): Aggregate {
  const agg: Aggregate = {
    codeFiles: obs.length,
    totalLines: 0,
    indent: {},
    quotes: {},
    semis: {},
    vue: {},
    decl: { var: 0, let: 0, const: 0 },
    fn: { arrow: 0, decl: 0 },
    fmr: { filter: 0, map: 0, reduce: 0, forLoops: 0 },
    naming: { camel: 0, snake: 0, upper: 0, pascal: 0, plain: 0 },
    hungarianPrefixes: {},
    hungarianBase: 0,
    params: { underscore: 0, plain: 0 },
    destructuredParams: 0,
    extHist: {},
    axes: {},
    comments: { cyr: 0, lat: 0 },
  }
  for (const ext of allExts) agg.extHist[ext || '(без расширения)'] = (agg.extHist[ext || '(без расширения)'] ?? 0) + 1
  for (const o of obs) {
    agg.totalLines += o.lines
    if (o.indent) agg.indent[o.indent] = (agg.indent[o.indent] ?? 0) + 1
    if (o.quoteVerdict) agg.quotes[o.quoteVerdict] = (agg.quotes[o.quoteVerdict] ?? 0) + 1
    if (o.semiVerdict) agg.semis[o.semiVerdict] = (agg.semis[o.semiVerdict] ?? 0) + 1
    if (o.vue) agg.vue[o.vue] = (agg.vue[o.vue] ?? 0) + 1
    for (const k of ['var', 'let', 'const'] as const) agg.decl[k] += o.js.decl[k]
    agg.fn.arrow += o.js.fn.arrow
    agg.fn.decl += o.js.fn.decl
    for (const k of ['filter', 'map', 'reduce', 'forLoops'] as const) agg.fmr[k] += o.js.fmr[k]
    for (const k of ['camel', 'snake', 'upper', 'pascal', 'plain'] as const) agg.naming[k] += o.js.naming[k]
    for (const [p, n] of Object.entries(o.js.hungarianPrefixes)) {
      agg.hungarianPrefixes[p] = (agg.hungarianPrefixes[p] ?? 0) + n
    }
    agg.hungarianBase += o.js.hungarianBase
    agg.params.underscore += o.js.params.underscore
    agg.params.plain += o.js.params.plain
    agg.destructuredParams += o.js.destructuredParams
    addAxes(agg.axes, o.axes)
    agg.comments.cyr += o.comments.cyr
    agg.comments.lat += o.comments.lat
  }
  return agg
}
