/**
 * Слой 1: символьный анализ через tree-sitter WASM.
 *
 * Добывает то, что регэкспам слоя 0 не видно: семантику обработки ошибок
 * (пустые catch, возврат из catch, throw-стиль), долю async, классы.
 * ~40 языков одним механизмом; грамматики — пребилды tree-sitter-wasms.
 *
 * Потолок версии — 0.25.x, и упирается он не в ABI грамматик, а в формат
 * динамической линковки emscripten: пребилды 0.1.13 несут ЛЕГАСИ-секцию
 * `dylink`, а рантайм 0.26.0 принимает только `dylink.0` и падает в
 * getDylinkMetadata на первой же грамматике. Проверено 2026-07-30 побайтовым
 * разбором секций wasm и прогоном всех 16 грамматик: на 0.25.10 — 16/16,
 * на 0.26.0 — 0/16. Отпустить пин можно только вслед за пересобранными
 * грамматиками (tree-sitter-wasms не обновлялся с 0.1.13).
 *
 * Живучесть: нет пакета/грамматики → слой молча выключен (деградация),
 * ни один канал не падает.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Language, Parser } from 'web-tree-sitter'

export interface AstMetrics {
  tryCount: number
  catchCount: number
  emptyCatch: number
  catchWithReturn: number
  catchWithRethrow: number
  throwCount: number
  fnTotal: number
  fnAsync: number
  classCount: number
}

export const zeroMetrics = (): AstMetrics => ({
  tryCount: 0,
  catchCount: 0,
  emptyCatch: 0,
  catchWithReturn: 0,
  catchWithRethrow: 0,
  throwCount: 0,
  fnTotal: 0,
  fnAsync: 0,
  classCount: 0,
})

export function addMetrics(a: AstMetrics, b: AstMetrics): AstMetrics {
  const out = { ...a }
  for (const k of Object.keys(out) as Array<keyof AstMetrics>) out[k] += b[k]
  return out
}

/** Расширение → имя грамматики tree-sitter-wasms. */
export const EXT_LANG: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx', '.jsx': 'tsx', '.vue': 'typescript',
  '.py': 'python', '.php': 'php', '.go': 'go', '.rb': 'ruby', '.java': 'java',
  '.cs': 'c_sharp', '.rs': 'rust', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
  '.kt': 'kotlin', '.swift': 'swift', '.scala': 'scala', '.lua': 'lua',
}

export const astSupported = (ext: string): boolean => ext in EXT_LANG

/** Уникальные имена грамматик слоя — единый источник для бандла (что шипить). */
export const grammarNames = (): string[] => [...new Set(Object.values(EXT_LANG))]

// Нормализация типов узлов между языками (js/py/php/ruby/java/...)
const IS_TRY = /^try/
const IS_CATCH = /catch|except_clause|rescue/
const IS_THROW = /^(throw|raise)/
const IS_FN = /^(arrow_function|function_declaration|function_definition|function_expression|method_definition|method_declaration|func_literal|function_item)$/
const IS_CLASS = /^class_(declaration|definition|specifier)/
const IS_RETURN = /^return/

let initDone = false
// null в кэше — «язык выключен», такой же полноценный ответ, как грамматика:
// повторные файлы того же расширения не бьются в отсутствующий wasm заново.
const languages = new Map<string, Language | null>()

// Бандл кладёт грамматики в plugin/wasm рядом с dist (import.meta.dirname = dist);
// dev-режим берёт пребилды из node_modules. Кандидаты, не конфиг: первый живой.
function wasmDir(): string {
  const bundled = join(import.meta.dirname, '..', 'wasm')
  if (existsSync(bundled)) return bundled
  return join(import.meta.dirname, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out')
}

// Ядро web-tree-sitter (tree-sitter.wasm) в бандле лежит там же, где грамматики;
// в dev — внутри пакета. Явный locateFile вместо emscripten-магии __dirname,
// которая после сборки в один файл указывает в никуда.
function coreWasmPath(): string | null {
  const candidates = [
    join(import.meta.dirname, '..', 'wasm', 'tree-sitter.wasm'),
    join(import.meta.dirname, '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

async function loadLanguage(name: string): Promise<Language | null> {
  if (languages.has(name)) return languages.get(name)!
  const path = join(wasmDir(), `tree-sitter-${name}.wasm`)
  if (!existsSync(path)) {
    languages.set(name, null)
    return null
  }
  try {
    if (!initDone) {
      const core = coreWasmPath()
      await (core ? Parser.init({ locateFile: () => core }) : Parser.init())
      initDone = true
    }
    const lang = await Language.load(path)
    languages.set(name, lang)
    return lang
  } catch {
    languages.set(name, null)
    return null // грамматика битая/несовместимая — язык выключен, не слой
  }
}

export interface TSNode {
  type: string
  text: string
  namedChildCount: number
  namedChild(i: number): TSNode
}

/**
 * Разбор файла грамматикой слоя 1 с доступом к дереву на время вызова.
 * Узлы живут ровно столько, сколько живёт дерево, поэтому наружу отдаётся не
 * корень, а результат обхода — иначе вызывающий получил бы указатели в
 * освобождённую память.
 *
 * Нужен ПРОВЕРЯЮЩИМ: граф импортов строится регэкспами (синхронно, без WASM), и
 * согласие двух путей не должно держаться на честном слове — тест разбирает те
 * же файлы грамматикой и сверяет множества. null = язык недоступен.
 */
export async function withRoot<T>(ext: string, content: string, visit: (root: TSNode) => T): Promise<T | null> {
  const langName = EXT_LANG[ext]
  if (!langName) return null
  const lang = await loadLanguage(langName)
  if (!lang) return null
  try {
    const parser = new Parser()
    parser.setLanguage(lang)
    const tree = parser.parse(content)
    if (!tree) {
      parser.delete()
      return null
    }
    const out = visit(tree.rootNode as unknown as TSNode)
    tree.delete()
    parser.delete()
    return out
  } catch {
    return null // единичный файл сломал парсер — пропускаем файл, не слой
  }
}

function collect(node: TSNode, m: AstMetrics): void {
  const t = node.type
  if (IS_TRY.test(t)) m.tryCount++
  else if (IS_CATCH.test(t)) {
    m.catchCount++
    // тело catch: последний именованный ребёнок-блок
    let body: TSNode | null = null
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (/block|body|statement_block|compound_statement/.test(c.type)) {
        body = c
        break
      }
    }
    if (body && body.namedChildCount === 0) m.emptyCatch++
    if (hasDescendant(node, IS_RETURN)) m.catchWithReturn++
    if (hasDescendant(node, IS_THROW)) m.catchWithRethrow++
  } else if (IS_THROW.test(t)) m.throwCount++
  else if (IS_FN.test(t)) {
    m.fnTotal++
    if (node.text.startsWith('async')) m.fnAsync++
  } else if (IS_CLASS.test(t)) m.classCount++

  for (let i = 0; i < node.namedChildCount; i++) collect(node.namedChild(i), m)
}

function hasDescendant(node: TSNode, re: RegExp): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (re.test(c.type)) return true
    if (hasDescendant(c, re)) return true
  }
  return false
}

/** Метрики одного файла; null = язык недоступен (деградация, не ошибка). */
export async function fileMetrics(ext: string, content: string): Promise<AstMetrics | null> {
  const langName = EXT_LANG[ext]
  if (!langName) return null
  const lang = await loadLanguage(langName)
  if (!lang) return null

  let source = content
  if (ext === '.vue') {
    const m = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    if (!m) return zeroMetrics()
    source = m[1]
  }

  try {
    const parser = new Parser()
    parser.setLanguage(lang)
    const tree = parser.parse(source)
    if (!tree) {
      parser.delete()
      return null // с 0.25 parse отдаёт null на отменённом/непереваренном входе
    }
    const metrics = zeroMetrics()
    collect(tree.rootNode as unknown as TSNode, metrics)
    tree.delete()
    parser.delete()
    return metrics
  } catch {
    return null // единичный файл сломал парсер — пропускаем файл, не слой
  }
}
