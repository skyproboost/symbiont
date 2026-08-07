/**
 * Структура файла: какие символы в нём объявлены и где именно.
 *
 * Зачем это паспорту. Знание «что за файл» у нас уже есть (роль, связи,
 * прецеденты), а вот «что в нём лежит» до сих пор добывалось единственным
 * способом — прочитать файл целиком. Для большого модуля это десятки тысяч
 * токенов ради одной функции, и платится эта цена заново в каждой сессии.
 * Оглавление снимает её насовсем: список символов стоит сотни токенов, а по
 * нему берётся ровно один нужный кусок.
 *
 * Почему индекс, а не разбор по требованию. Грамматики живут в WASM, то есть
 * асинхронны, а вся подача у нас синхронна — разбор в момент подачи протянул бы
 * async через хук-каналы ради работы, которую всё равно приходится делать
 * повторно. Слой 1 и так обходит те же файлы с кэшем по содержимому: структура
 * снимается ТЕМ ЖЕ разбором и ложится рядом, а подача читает готовые строки.
 *
 * Свежесть не предполагается, а проверяется: рядом с оглавлением лежит хэш
 * содержимого, по которому оно снято. Разошёлся — выемка отказывается называть
 * границы символа вместо того, чтобы выдать чужие строки за нужные.
 */
import type { Database } from '../core/db'
import type { TSNode } from './ast'

export interface SymbolRow {
  name: string
  kind: string
  /** 1-based, как их видит человек и как их печатает Read */
  line: number
  endLine: number
  /** длина объявления в символах — из неё считается цена выемки, без чтения файла */
  chars: number
}

/**
 * Тип узла грамматики → вид символа. Таблица, а не разветвление в коде: новый
 * язык добавляется строкой, и видно, что именно про него утверждается.
 * Порядок значим — первое совпадение выигрывает.
 */
const KIND_OF: Array<[RegExp, string]> = [
  [/^(class_declaration|class_definition|class_specifier)$/, 'class'],
  [/^(interface_declaration|interface_type)$/, 'interface'],
  [/^(struct_item|struct_specifier)$/, 'struct'],
  [/^(enum_declaration|enum_item|enum_specifier)$/, 'enum'],
  [/^trait_item$/, 'trait'],
  [/^impl_item$/, 'impl'],
  [/^(module|object_definition|namespace_definition)$/, 'module'],
  [/^(method_definition|method_declaration|constructor_declaration)$/, 'method'],
  [/^(function_declaration|function_definition|function_item|func_literal|function_signature)$/, 'function'],
  // type_spec — тело `type X struct{…}` в Go: имя лежит на нём, а не на объявлении
  [/^(type_alias_declaration|type_declaration|type_spec|type_item)$/, 'type'],
]

/** Виды, чьё имя приписывается вложенным символам: `Store.put`, а не просто `put`. */
const CONTAINERS = new Set(['class', 'interface', 'struct', 'trait', 'impl', 'enum', 'module'])

/** Присваивания вида `const f = () => {}`: имя лежит на объявлении, а функция — в значении. */
const IS_DECLARATOR = /^(variable_declarator|assignment|short_var_declaration)$/
const IS_FN_VALUE = /^(arrow_function|function_expression|lambda|function|closure_expression)$/

/**
 * Потолок на файл. Не оптимизация: оглавление из тысячи строк перестаёт быть
 * оглавлением — его дешевле не читать, чем читать. Обрезка видна наружу
 * (`truncated`), потому что молчаливое усечение читается как «это всё».
 */
export const MAX_SYMBOLS = 300

const kindOf = (type: string): string | null => {
  for (const [re, kind] of KIND_OF) if (re.test(type)) return kind
  return null
}

/** Имя символа: сначала поле грамматики, потом первый идентификатор-ребёнок. */
function nameOf(node: TSNode): string | null {
  const field = node.childForFieldName?.('name')
  const direct = field?.text?.trim()
  if (direct) return direct.split('\n')[0].slice(0, 120)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (/identifier|^name$|^word$|constant/.test(c.type)) {
      const text = c.text.trim()
      if (text) return text.split('\n')[0].slice(0, 120)
    }
  }
  return null
}

const hasFnValue = (node: TSNode): boolean => {
  for (let i = 0; i < node.namedChildCount; i++) if (IS_FN_VALUE.test(node.namedChild(i).type)) return true
  return false
}

/**
 * Оглавление поддерева.
 *
 * В тела функций обход НЕ заходит. Это и есть разница между оглавлением и
 * списком всего подряд: замыкание внутри обработчика — деталь реализации, по
 * которой никто не навигируется, а в списке оно заслоняет то, ради чего список
 * открывали. Методы при этом не теряются: они лежат в классе, а не в функции.
 */
export function collectOutline(root: TSNode): SymbolRow[] {
  const out: SymbolRow[] = []

  const walk = (node: TSNode, prefix: string): void => {
    if (out.length >= MAX_SYMBOLS) return
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (out.length >= MAX_SYMBOLS) return

      let kind = kindOf(child.type)
      // `const f = () => {}` — тип узла ничего не говорит о функции, говорит значение
      if (!kind && IS_DECLARATOR.test(child.type) && hasFnValue(child)) kind = 'function'

      if (!kind) {
        walk(child, prefix) // обёртки (export, decorated, блок) — сквозные
        continue
      }

      const name = nameOf(child)
      const start = child.startPosition?.row
      const end = child.endPosition?.row
      if (name === null || start === undefined || end === undefined) {
        walk(child, prefix)
        continue
      }

      const full = prefix ? `${prefix}.${name}` : name
      const startIndex = child.startIndex ?? 0
      const endIndex = child.endIndex ?? 0
      out.push({ name: full, kind, line: start + 1, endLine: end + 1, chars: Math.max(0, endIndex - startIndex) })

      // Внутрь контейнера идём (там методы), внутрь функции — нет
      if (CONTAINERS.has(kind)) walk(child, full)
    }
  }

  walk(root, '')
  return out
}

// ── хранение ────────────────────────────────────────────────────────────────

export function ensureSymbols(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS symbols(file TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, chars INTEGER NOT NULL, PRIMARY KEY(file, ord))',
  )
  db.run('CREATE TABLE IF NOT EXISTS symbols_meta(file TEXT PRIMARY KEY, hash TEXT NOT NULL, n INTEGER NOT NULL)')
}

/** Оглавление файла в индексе снято по этому хэшу? (null — файла в индексе нет) */
export function indexedHash(db: Database, file: string): string | null {
  try {
    return (db.query('SELECT hash FROM symbols_meta WHERE file=?').get(file) as { hash: string } | null)?.hash ?? null
  } catch {
    return null // индекса ещё нет — это ответ, а не сбой
  }
}

export function storeOutline(db: Database, file: string, hash: string, rows: SymbolRow[]): void {
  ensureSymbols(db)
  db.query('DELETE FROM symbols WHERE file=?').run(file)
  const put = db.query('INSERT INTO symbols(file, ord, name, kind, line, end_line, chars) VALUES(?,?,?,?,?,?,?)')
  rows.forEach((r, i) => put.run(file, i, r.name, r.kind, r.line, r.endLine, r.chars))
  db.query('INSERT INTO symbols_meta(file, hash, n) VALUES(?,?,?) ON CONFLICT(file) DO UPDATE SET hash=excluded.hash, n=excluded.n').run(
    file,
    hash,
    rows.length,
  )
}

/** Убрать из индекса файлы, которых больше нет на диске. */
export function pruneSymbols(db: Database, present: Set<string>): void {
  try {
    const files = (db.query('SELECT file FROM symbols_meta').all() as Array<{ file: string }>).map((r) => r.file)
    const delRows = db.query('DELETE FROM symbols WHERE file=?')
    const delMeta = db.query('DELETE FROM symbols_meta WHERE file=?')
    for (const f of files) {
      if (present.has(f)) continue
      delRows.run(f)
      delMeta.run(f)
    }
  } catch {
    /* индекса ещё нет — убирать нечего */
  }
}

export function readOutline(db: Database, file: string): SymbolRow[] {
  try {
    return (
      db.query('SELECT name, kind, line, end_line, chars FROM symbols WHERE file=? ORDER BY ord').all(file) as Array<{
        name: string
        kind: string
        line: number
        end_line: number
        chars: number
      }>
    ).map((r) => ({ name: r.name, kind: r.kind, line: r.line, endLine: r.end_line, chars: r.chars }))
  } catch {
    return [] // индекса ещё нет — оглавления просто нет
  }
}

/** Сколько файлов и символов уже в индексе (для обзора). */
export function symbolStats(db: Database): { files: number; symbols: number } {
  try {
    const r = db.query('SELECT COUNT(*) files, COALESCE(SUM(n),0) symbols FROM symbols_meta').get() as {
      files: number
      symbols: number
    }
    return { files: r.files, symbols: r.symbols }
  } catch {
    return { files: 0, symbols: 0 }
  }
}

/**
 * Грубая цена в токенах. Оценка сознательно грубая (символы делим на 4): точная
 * потребовала бы токенизатора модели, а решение, которое она обслуживает, —
 * «брать кусок или файл целиком» — от третьего знака не меняется.
 */
export const tokensOf = (chars: number): number => Math.max(1, Math.round(chars / 4))

/**
 * Цена САМОГО оглавления — строка на символ, а не сумма объявлений.
 *
 * Различие поймано симуляцией: первая версия складывала длины объявлений и
 * выдавала «оглавление ≈3758t» при файле в 2483t. Такая подсказка спорит сама с
 * собой и делает ровно обратное тому, ради чего она есть, — уговаривает читать
 * файл целиком. Оглавление стоит своего СПИСКА: имя, вид, границы, цена.
 */
const OUTLINE_LINE_OVERHEAD = 24
export const outlineTokens = (rows: SymbolRow[]): number =>
  rows.length === 0 ? 0 : tokensOf(rows.reduce((s, r) => s + r.name.length + r.kind.length + OUTLINE_LINE_OVERHEAD, 0))

/** Самый дорогой символ файла: верхняя граница цены одной выемки. */
export const heaviestTokens = (rows: SymbolRow[]): number =>
  rows.length === 0 ? 0 : tokensOf(Math.max(...rows.map((r) => r.chars)))

// ── чтение оглавления вместе с проверкой, что оно ещё про этот файл ──────────

export interface OutlineView {
  /** путь узла, как он записан в индексе */
  file: string
  rows: SymbolRow[]
  /** содержимое на диске совпадает с тем, по которому снято оглавление */
  fresh: boolean
  /** цена чтения файла целиком, в токенах; 0 — файл не прочитался */
  wholeFileTokens: number
}

/** Путь из запроса → путь в индексе: точное совпадение либо единственный хвост. */
export function resolveIndexed(db: Database, needle: string): string | null {
  const wanted = needle.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (!wanted) return null
  try {
    const row = db
      .query("SELECT file FROM symbols_meta WHERE file = ? OR file LIKE '%/' || ? ORDER BY LENGTH(file) LIMIT 1")
      .get(wanted, wanted) as { file: string } | null
    return row?.file ?? null
  } catch {
    return null
  }
}

/**
 * Оглавление файла с вердиктом о свежести.
 *
 * Свежесть считается по содержимому НА ДИСКЕ, а не по времени: файл могли
 * править между заходами фона, и тогда сохранённые границы указывают в чужие
 * строки. Чтение файла здесь ничего не стоит владельцу — платит только контекст
 * модели, а он как раз и экономится.
 */
export function outlineView(
  db: Database,
  file: string,
  readFile: (path: string) => string | null,
  hashOf: (text: string) => string,
): OutlineView {
  const rows = readOutline(db, file)
  const content = readFile(file)
  const fresh = content !== null && indexedHash(db, file) === hashOf(content)
  return { file, rows, fresh, wholeFileTokens: content === null ? 0 : tokensOf(content.length) }
}
