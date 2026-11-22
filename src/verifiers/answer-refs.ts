/**
 * Сверка ссылок в ответе: путь и `файл:строка`, названные моделью владельцу,
 * сверяются с диском и с тем, что сессия действительно видела.
 *
 * Зачем. Гейт «готово требует проверки» работает только там, где есть тесты, а
 * выдуманная ссылка дешевле всего как раз в проекте без тестов: отчёт называет
 * файл, которого нет, или строку за концом файла, и проверить это глазами
 * владелец может только открыв файл. Сверка детерминирована — ни модели, ни
 * токенов: ссылка либо находится, либо нет.
 *
 * Что считается найденным. Путь есть на диске — найден. Пути на диске нет, но
 * он встречался в сессии (вызовы инструментов, их вывод, слова владельца,
 * подача хуков) — тоже найден: о созданном и тут же удалённом файле, о файле с
 * другой машины и о пути из вывода команды модель говорит по праву. Не найдено
 * ни там, ни там — ссылку не на что опереть.
 *
 * Точность важнее полноты (порог выката — 90% верных срабатываний на своих
 * транскриптах): блоки кода пропускаются целиком — там примеры и вставленный
 * вывод; адреса сети, маски и заготовки с угловыми скобками ссылками не
 * считаются; имя без каталога судится только в форме `файл:строка`.
 *
 * Наблюдение, не блокировка: страж не знает намерения. Путь файла, который
 * только предстоит создать, выглядит так же, как выдуманный.
 */

export interface AnswerRef {
  /** как написано в ответе */
  raw: string
  /** путь с прямыми слэшами, без `./` */
  path: string
  /** номер строки из формы `файл:строка` или `файл#Lстрока`; null — ссылка без строки */
  line: number | null
}

export type RefProblem = 'missing' | 'line'

export interface RefFinding {
  ref: AnswerRef
  problem: RefProblem
  /** сколько строк в файле на самом деле — для ссылки за концом файла */
  lines?: number
}

export interface RefWorld {
  /** существует ли файл по этому пути (абсолютному или относительному к корням сессии) и где */
  resolve: (path: string) => string | null
  /** число строк файла по разрешённому пути; null — не читается или судить нельзя */
  lines: (resolved: string) => number | null
  /** встречался ли путь (приведённый `normalizePath`) в сессии */
  seen: (path: string) => boolean
}

export interface ExtractOptions {
  /**
   * Считать ли путём запись от корня файловой системы (`/etc/hosts`). На Windows
   * так пишут адрес страницы или API (`/products/x.js`), а не файл; путь диска в
   * записи Git Bash (`/d/…`) распознаётся и там.
   */
  posixRoots?: boolean
}

// Буквы любого алфавита: каталог «Рабочий стол» — обычное дело, и путь, сверяемый
// только латиницей, не находился бы в виденном никогда.
const SEGMENT = String.raw`[\p{L}\p{N}_.@+~-]+`
/** Имя файла: в нём есть точка, за которой буква (расширение), а дальше — что угодно из имени (`config.bak-2026`). */
const FILE = String.raw`[\p{L}\p{N}_.@+~-]*\.[A-Za-z][\p{L}\p{N}_.@+~-]*`
const LINE = String.raw`(?::(\d+)(?:[-:]\d+)?|#L(\d+))`
const BEFORE = String.raw`(?<![\p{L}\p{N}_/\\.:@~+-])`
const ROOT = String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?`
const SEP = String.raw`[\\/]`
/** Путь с каталогом и расширением; номер строки — необязательным хвостом. */
const PATH_RE = new RegExp(`${BEFORE}(${ROOT}(?:${SEGMENT}${SEP})+${FILE})${LINE}?`, 'gu')
/** Имя файла без каталога — только вместе с номером строки. */
const NAME_LINE_RE = new RegExp(`${BEFORE}(${FILE})${LINE}`, 'gu')

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const DOMAIN_HEAD = /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|ai|dev|app|ru|sh|co|me|it|uk|de|cn|ch|eu|info|xyz|cloud)$/i
const FENCE_RE = /(^|\n)[ \t]*(```|~~~)[\s\S]*?(\n[ \t]*\2[ \t]*(?=\n|$)|$)/g
/** Каталог с расширением файла — это два имени через косую (`package.json/tsconfig.json`), а не путь. */
const FILE_LIKE_DIR = /\.(json|jsonl|js|mjs|cjs|ts|tsx|jsx|vue|md|py|css|scss|html|yml|yaml|toml|txt|lock|sh|ps1|php|go|rs|java|rb|sql|xml|csv|exports|prototype)$/i

/** Единый вид пути для сравнения: прямые слэши, без `./`, без регистра (диск Windows его не различает). */
export function normalizePath(path: string): string {
  return path
    .replace(/\\+/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase()
}

/** Текст ответа без блоков кода и адресов сети — то, в чём ссылки ищутся. */
function prose(text: string): string {
  return text.replace(FENCE_RE, '\n').replace(URL_RE, ' ')
}

function refOf(matched: string, line: string | undefined, options: ExtractOptions): AnswerRef | null {
  // Точка и тире в конце — знаки предложения, а не имени («см. src/a.ts.»)
  const pathText = matched.replace(/[.+~-]+$/, '')
  const path = pathText.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  const segments = path.split('/')
  if (!/\.[A-Za-z]/.test(segments[segments.length - 1])) return null // после обрезки знаков расширения не осталось
  const head = segments[0]
  // `github.com/owner/repo.git` — адрес без схемы, не путь
  if (DOMAIN_HEAD.test(head)) return null
  // Версия и дробь с буквенным хвостом (`2.1.322/x.y`) путём не являются: каталог из одних цифр и точек
  if (/^[\d.]+$/.test(head) && !/^\.{1,2}$/.test(head)) return null
  if (segments.slice(0, -1).some((s) => FILE_LIKE_DIR.test(s))) return null
  if (path.startsWith('/') && !/^\/[A-Za-z]\//.test(path) && !(options.posixRoots ?? process.platform !== 'win32')) return null
  return { raw: line ? `${pathText}:${line}` : pathText, path, line: line ? Number(line) : null }
}

/**
 * Ссылки на файлы в тексте ответа, без повторов. Ответ, который целиком —
 * данные (JSON служебного вызова), ссылок владельцу не содержит.
 */
export function extractRefs(text: string, options: ExtractOptions = {}): AnswerRef[] {
  if (/^\s*[[{]/.test(text)) return []
  const body = prose(text)
  const out = new Map<string, AnswerRef>()
  const taken: Array<[number, number]> = []
  const keep = (ref: AnswerRef | null): void => {
    if (ref) out.set(`${normalizePath(ref.path)}:${ref.line ?? ''}`, ref)
  }
  for (const m of body.matchAll(PATH_RE)) {
    taken.push([m.index, m.index + m[0].length])
    keep(refOf(m[1], m[2] ?? m[3], options))
  }
  for (const m of body.matchAll(NAME_LINE_RE)) {
    if (taken.some(([from, to]) => m.index >= from && m.index < to)) continue // хвост уже разобранного пути
    keep(refOf(m[1], m[2] ?? m[3], options))
  }
  return [...out.values()]
}

const WORD = /[\p{L}\p{N}_]/u

/**
 * Встречается ли путь в тексте сессии отдельным путём, а не куском другого:
 * перед ним не буква и не точка (`tests/a.ts` внутри `contests/a.ts` — не он),
 * после — не буква. Текст и путь — приведённые `normalizePath`. Имя без
 * каталога ищется так же: каталог перед ним — законная граница.
 */
export function occursAsPath(haystack: string, path: string): boolean {
  for (let at = haystack.indexOf(path); at !== -1; at = haystack.indexOf(path, at + 1)) {
    const before = at === 0 ? '' : haystack[at - 1]
    const after = haystack[at + path.length] ?? ''
    if (before !== '' && (WORD.test(before) || before === '.' || before === '-')) continue
    if (after !== '' && WORD.test(after)) continue
    return true
  }
  return false
}

/**
 * Находки по ссылкам ответа. Пусто — норма. Ссылка за концом файла судится,
 * только если файл разрешился на диске и его длина известна.
 */
export function judgeRefs(refs: AnswerRef[], world: RefWorld): RefFinding[] {
  const out: RefFinding[] = []
  for (const ref of refs) {
    const resolved = world.resolve(ref.path)
    if (resolved === null) {
      if (!world.seen(normalizePath(ref.path))) out.push({ ref, problem: 'missing' })
      continue
    }
    if (ref.line === null) continue
    const lines = world.lines(resolved)
    if (lines !== null && ref.line > lines) out.push({ ref, problem: 'line', lines })
  }
  return out
}
