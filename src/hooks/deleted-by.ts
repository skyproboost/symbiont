/**
 * Удаляла ли эта команда оболочки этот файл проекта.
 *
 * Авторство удаления у стража тестов подтверждает только команда из транскрипта
 * сессии: удаление идёт мимо инструментов правки. Прежде хватало того, что
 * команда где-нибудь содержит имя файла или каталога, — и `rm -f /tmp/x.ts; …
 * bun run scripts/sim.ts` «удаляла в scripts/», потому что из `scripts/`
 * запускала скрипт. Две попытки сузить сравнением текста оказались не лучше
 * (ревью 22.11.2026): хвосты путей и масок — `cd tests && rm other.tmp` называл
 * каталог самим переходом, `rm -rf /tmp/*` — хвостом `*`; слово `rm` где угодно
 * в части команды — `rg 'rm' tests` «удалял» всё в `tests/`.
 *
 * Поэтому команда РАЗБИРАЕТСЯ, как её разбирает оболочка:
 * - удаляет только звено, во главе которого стоит удаляющая команда (`rm`,
 *   `del`, `Remove-Item`, `git rm`…); слово `rm` в аргументах чужой команды
 *   ничего не значит;
 * - операнд разрешается в путь внутри проекта: абсолютный обязан начинаться с
 *   корня проекта, относительный отсчитывается от каталога, куда команда перешла
 *   сама (`cd` раньше в ней же), а без перехода — от корня. Путь вне проекта,
 *   через переменную или `~` не разрешается и ничего не называет;
 * - разрешённый операнд называет файл, если совпадает по сегментам (с масками
 *   `*` и `?`) с самим файлом или с любым его каталогом.
 *
 * Чего страж так не увидит — осознанная цена точности: цели, пришедшие по
 * конвейеру (`find … | xargs rm`: что именно дошло до `rm`, из команды не
 * видно), `find -delete`, циклы и переменные (`for f in …; do rm "$f"`),
 * раскрытие скобок, удаление патчем, имя без каталога после перехода,
 * сделанного ПРОШЛОЙ командой. Предпросмотр (`-WhatIf`, `--dry-run`) и снятие
 * с индекса (`git rm --cached`) удалением не считаются. Пропуск здесь дешевле
 * ложного «вы удалили тест».
 */

const CHANGES_DIR = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl'])
const DELETERS = new Set(['rm', 'unlink', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri'])
/** Обёртки перед командой: сама команда — следующее слово. */
const WRAPPERS = new Set(['sudo', 'command', 'time', 'nohup', 'env'])
const UNRESOLVABLE = /[$`~]|^-$/
const PREVIEW = /^(-whatif|--dry-run)$/i

/** Звено конвейера: слова без кавычек; `piped` — получает ли оно вход от предыдущего звена. */
interface Stage {
  words: string[]
  piped: boolean
  /** звено стоит отдельной командой, а не внутри конвейера: только такой `cd` меняет каталог дальше */
  alone: boolean
}

/** Команда → звенья по порядку. Разделители внутри кавычек — часть аргумента (`grep -E "a|b"`), а не граница. */
function stages(command: string): Stage[] {
  const spaced = command.replace(/"[^"]*"|'[^']*'|(&&|\|\||[;|\n])/g, (whole, sep: string | undefined) => (sep ? ` ${sep === '\n' ? ';' : sep} ` : whole))
  const out: Stage[] = []
  let words: string[] = []
  let piped = false
  const close = (pipeNext: boolean): void => {
    if (words.length > 0) out.push({ words, piped, alone: !piped && !pipeNext })
    words = []
    piped = pipeNext
  }
  for (const m of spaced.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const bare = m[3]
    if (bare === '|') close(true)
    else if (bare === ';' || bare === '&&' || bare === '||') close(false)
    // Скобки подоболочки — не часть слова: `(cd pkg && rm a.ts)`
    else words.push(m[1] ?? m[2] ?? bare.replace(/^\(+|\)+$/g, ''))
  }
  close(false)
  return out
}

/** Единый вид абсолютного пути: прямые слэши, диск в записи `d:/…` (Git Bash пишет его как `/d/…`). */
function canonical(path: string, fold: boolean): string {
  const slashed = path.replaceAll('\\', '/').replace(/^\/([A-Za-z])\//, '$1:/').replace(/\/+$/, '')
  return fold ? slashed.toLowerCase() : slashed
}

const isAbsolute = (path: string): boolean => /^([A-Za-z]:)?\//.test(path)

/**
 * Путь из команды → сегменты относительно корня проекта; null — вне проекта или
 * не разрешается. `cwd` — где сейчас оболочка в тех же сегментах (null — неизвестно).
 */
function resolve(word: string, cwd: string[] | null, root: string, fold: boolean): string[] | null {
  if (UNRESOLVABLE.test(word)) return null
  const path = canonical(word, fold)
  if (isAbsolute(path)) {
    if (path !== root && !path.startsWith(root + '/')) return null
    return path.slice(root.length).split('/').filter(Boolean)
  }
  if (cwd === null) return null
  const segments = [...cwd]
  for (const s of path.split('/')) {
    if (!s || s === '.') continue
    if (s === '..') {
      if (segments.length === 0) return null // вышли выше корня проекта
      segments.pop()
    } else segments.push(s)
  }
  return segments
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Сегмент команды против сегмента пути: `*` и `?` — маски оболочки, остальное буквально. */
function segmentMatches(pattern: string, name: string): boolean {
  if (!/[*?]/.test(pattern)) return pattern === name
  return new RegExp(`^${pattern.split('*').map((p) => p.split('?').map(escapeRe).join('.')).join('.*')}$`).test(name)
}

/**
 * Операнды удаляющего звена; null — звено ничего не удаляет (не та команда,
 * предпросмотр, снятие с индекса) либо его цели из текста не видны.
 */
function deletionOperands(stage: Stage): string[] | null {
  let words = stage.words
  while (words.length > 0 && (WRAPPERS.has(words[0].toLowerCase()) || /^\w+=/.test(words[0]))) words = words.slice(1)
  if (words.length === 0 || words.some((w) => PREVIEW.test(w))) return null
  const head = words[0].toLowerCase()
  if (head === 'git') {
    // `git -C dir rm …` меняет каталог сам — где удаляли, из звена уже не понять
    if (words[1] !== 'rm' || words.some((w) => w === '--cached' || w === '-n')) return null
    return words.slice(2)
  }
  if (!DELETERS.has(head)) return null
  const rest = words.slice(1)
  // PowerShell перечисляет цели через запятую: `Remove-Item a.ts,b.ts`
  return head === 'remove-item' || head === 'ri' ? rest.flatMap((w) => w.split(',')) : rest
}

/**
 * Удаляла ли команда файл `file` (путь относительно корня, прямые слэши).
 * `caseInsensitive` — как сравнивает имена диск: на Windows `del Tests\A.ts`
 * удаляет `tests/a.ts`.
 */
export function commandDeletes(command: string, root: string, file: string, caseInsensitive = process.platform === 'win32'): boolean {
  const fold = (s: string): string => (caseInsensitive ? s.toLowerCase() : s)
  const rootPath = canonical(root, caseInsensitive)
  const target = fold(file).split('/')
  /** Операнд называет файл: сам файл или любой его каталог, сегмент в сегмент. Пустой операнд — корень проекта. */
  const names = (operand: string[]): boolean => operand.length <= target.length && operand.every((s, i) => segmentMatches(fold(s), target[i]))

  let cwd: string[] | null = []
  for (const stage of stages(command)) {
    if (CHANGES_DIR.has(stage.words[0].toLowerCase())) {
      if (stage.alone) cwd = stage.words[1] === undefined ? null : resolve(stage.words[1], cwd, rootPath, caseInsensitive)
      continue
    }
    for (const word of deletionOperands(stage) ?? []) {
      if (!word || word.startsWith('-')) continue
      const operand = resolve(word, cwd, rootPath, caseInsensitive)
      if (operand !== null && names(operand)) return true
    }
  }
  return false
}
