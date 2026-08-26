/**
 * Фантомные ссылки: импорт имени, которого в файле-источнике нет.
 *
 * Самая частая ошибка модели в коде — выдуманный экспорт: `import { fooBar }
 * from './db'`, когда db.ts экспортирует open/prepare/run. Ловится обычно
 * только упавшим тестом или тайпчеком — круг «запустить → перечитать →
 * починить» стоимостью в тысячи токенов. Здесь она ловится сразу после правки
 * и детерминированно: индекс структуры (слой 1) знает символы каждого файла.
 *
 * Принцип — негативная селекция: «своё» проекта задано индексом, всё, что в
 * него не попадает, помечается. Проверка нарочно ОДНОСТОРОННЯЯ:
 *   - судится только файл-источник, который ЭТА сессия не писала (свою
 *     правку модель ещё дописывает, её индекс заведомо отстал);
 *   - только при свежем индексе источника (хэш содержимого совпал);
 *   - только имена, объявленные статически (что даёт грамматика).
 * Иначе — молчание: ложный «фантом» дороже пропущенного.
 *
 * Извлечение имён — регэкспами на язык, как и спецификаторы в graph/imports.ts,
 * и по той же причине: грамматика тут улучшила бы извлечение, а не резолв.
 */
import { extname } from 'node:path'
import type { Database } from '../core/db'
import { resolveImport } from '../graph/imports'
import { readOutline, indexedHash } from '../layer1/symbols'
import { sha1 } from '../core/salsa'
import { t } from '../core/i18n'

/** Именованный импорт: откуда и какие имена. */
export interface NamedImport {
  spec: string
  names: string[]
}

/** Форма именованного импорта — строка таблицы на язык (данные, не логика). */
const NAMED_IMPORT: Array<{ exts: Set<string>; re: RegExp; split: (names: string) => string[] }> = [
  {
    // import { a, b as c, type D } from './x'  (type-импорты — тоже символы)
    exts: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']),
    re: /^[ \t]*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm,
    split: (names) =>
      names
        .split(',')
        .map((n) => n.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)),
  },
  {
    // from .x import a, b as c   |   from .x import (a, b)
    exts: new Set(['.py', '.pyi']),
    re: /^[ \t]*from\s+([\w.]+)\s+import\s+\(?([^)\n]+)\)?/gm,
    split: (names) =>
      names
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => /^[A-Za-z_]\w*$/.test(n) && n !== '*'),
  },
]

export function extractNamedImports(content: string, rel: string): NamedImport[] {
  const ext = extname(rel).toLowerCase()
  const pack = NAMED_IMPORT.find((p) => p.exts.has(ext))
  if (!pack) return []
  const out: NamedImport[] = []
  for (const m of content.matchAll(pack.re)) {
    // Порядок групп разный: у JS сначала имена, у Python сначала модуль
    const [names, spec] = ext === '.py' || ext === '.pyi' ? [m[2], m[1]] : [m[1], m[2]]
    const list = pack.split(names)
    if (list.length > 0) out.push({ spec, names: list })
  }
  return out
}

export interface Phantom {
  /** имя, которого нет */
  name: string
  /** файл-источник по индексу */
  source: string
  /** что там есть на самом деле (верхний уровень) */
  available: string[]
}

/** Верхнеуровневые имена файла по индексу: без методов (Class.method) и без случаев тестов. */
function topLevelNames(db: Database, file: string): string[] {
  return readOutline(db, file)
    .filter((r) => r.kind !== 'case' && !r.name.includes('.') && !r.name.includes('('))
    .map((r) => r.name)
}

/**
 * Объявлено ли имя в исходнике — по тексту, не по индексу. Оглавление снимает
 * функции, классы и типы, а экспортированную константу (`export const CODE_EXT
 * = new Set(…)`) — нет: она не символ навигации. Первый же прогон детектора на
 * собственном коде назвал фантомами шесть таких констант. Поэтому индекс даёт
 * список «что есть» для подсказки, а приговор выносится только если имени нет
 * и в тексте объявлений: ложный фантом дороже пропущенного.
 */
export function declaredInSource(source: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const decl = new RegExp(
    `(^|\\n)\\s*(export\\s+)?(default\\s+)?(async\\s+)?(const|let|var|function\\*?|class|interface|type|enum|namespace|abstract\\s+class|declare\\s+\\w+|def)\\s+${n}\\b` +
      `|(^|\\n)\\s*${n}\\s*[:=]` + // Python-переменная / объект в модуле
      `|export\\s*\\{[^}]*\\b${n}\\b` + // export { a, b as c }
      `|export\\s+\\*\\s+from` + // re-export barrel — имя может быть транзитивным
      `|(module\\.exports|exports)\\s*(\\.${n}\\b|=\\s*\\{[^}]*\\b${n}\\b)` + // CommonJS
      `|__all__\\s*=\\s*[\\[(][^\\])]*['"]${n}['"]`, // Python __all__
  )
  return decl.test(source)
}

/**
 * Фантомы в записанном файле. `readSource(file)` — содержимое источника с диска
 * (его хэш сверяется с индексом); `writtenBySession` — файлы этой сессии, не судятся.
 */
export function findPhantoms(
  db: Database,
  rel: string,
  content: string,
  projectFiles: Set<string>,
  readSource: (file: string) => string | null,
  writtenBySession: Set<string>,
): Phantom[] {
  const out: Phantom[] = []
  for (const imp of extractNamedImports(content, rel)) {
    let source: string | null = null
    try {
      source = resolveImport(rel, imp.spec, projectFiles)
    } catch {
      source = null // резолв — обогащение; не разрешилось — не судим
    }
    if (!source || source === rel || writtenBySession.has(source)) continue
    const text = readSource(source)
    if (text === null) continue
    const indexed = indexedHash(db, source)
    if (indexed === null || indexed !== sha1(text)) continue // индекс отстал — молчим
    const names = topLevelNames(db, source)
    if (names.length === 0) continue // файл без символов (re-export barrel) — судить нечем
    const have = new Set(names)
    for (const name of imp.names) {
      if (have.has(name) || declaredInSource(text, name)) continue
      out.push({ name, source, available: names.slice(0, 8) })
    }
  }
  return out
}

export function renderPhantom(p: Phantom): string {
  const list = p.available.join(', ')
  return t(
    `- фантом: «${p.name}» импортируется из ${p.source}, но там его нет (есть: ${list})`,
    `- phantom: “${p.name}” is imported from ${p.source}, which does not declare it (it has: ${list})`,
  )
}
