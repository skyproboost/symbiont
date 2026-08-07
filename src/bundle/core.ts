/**
 * Ядро бандла (долг №16): что и как превращается в устанавливаемый артефакт plugin/.
 *
 * Мотив: установка плагина копирует каталог source из marketplace.json ЦЕЛИКОМ —
 * при source "./" в кэш ехал весь репозиторий с node_modules (~300МБ на релиз);
 * официального механизма исключения файлов нет. Рычаг — source "./plugin":
 * отдельный подкаталог-артефакт: dist (bun build, все выходы плоско в одном
 * каталоге — рантайм-резолвы пляшут от import.meta.dirname) + wasm (только грамматики
 * слоя 1) + манифесты/скиллы с путями, переписанными на dist.
 *
 * Здесь — данные и чистые преобразования (тестируемо без процесса); сам процесс
 * сборки — scripts/bundle.ts; проверка свежести — scripts/selflint.ts. Оба берут
 * входы отсюда (единый источник, как signals.ts у направлений).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Точки входа сборки. Плоский dist: имя в dist = basename исходника + .js —
 * инвариант держат тесты (уникальность basename) и рантайм (detach.ts ищет
 * auto-learn.js соседом, ast.ts ищет ../wasm от каталога файла).
 */
export const ENTRY_SOURCES: string[] = [
  'src/hooks/session-start.ts',
  'src/hooks/user-prompt.ts',
  'src/hooks/pre-tool.ts',
  'src/hooks/post-tool.ts',
  'src/hooks/stop.ts',
  'src/hooks/pre-compact.ts',
  'src/hooks/session-end.ts',
  'src/mcp/server.ts',
  // auto-learn — детач-исполнитель садовника (единственная фоновая точка входа);
  // charter/constitution/elevate — то, что осталось интерактивным по природе
  // (воля владельца и дорогой аудит по требованию). Отчётные CLI (status/map/
  // drift/rebuild/learn) в поставку не входят: их работа ушла в фон.
  'src/cli/auto-learn.ts',
  'src/cli/symbiont.ts',
  'src/cli/init.ts',
  'src/cli/charter.ts',
  'src/cli/constitution.ts',
  'src/cli/elevate.ts',
  'src/cli/lang.ts',
  'src/bundle/smoke.ts',
]

/** Ссылка на исходник → ссылка на форму поставки: src/…/x.ts → dist/x.js. */
export const rewriteEntryPaths = (text: string): string =>
  text.replace(/src\/(?:hooks|cli|mcp|bundle)\/([\w-]+)\.ts/g, 'dist/$1.js')

/**
 * Рантайм поставки: манифесты репозитория зовут bun (он один умеет исполнять
 * .ts исходники), артефакт — node (он есть у всех, кто запускает Claude Code,
 * а собранный dist — обычный JS). Это и есть снятие обязательной предпосылки:
 * см. src/core/db.ts.
 *
 * Обход рекурсивный, а не по известным ключам: форма манифестов у Claude Code
 * менялась, и проверка «объект с command+args» переживёт следующую смену.
 * Подкоманда `run` уходит: её понимает только bun, node ждёт путь первым словом.
 */
/**
 * Тот же перевод рантайма, но для скиллов: они запускают свои точки входа
 * строкой прямо в markdown, а не манифестом. Забыть про них при переводе хуков
 * значило оставить половину плагина на прежней предпосылке — на машине без bun
 * хуки бы работали, а все шесть команд молча отвечали ошибкой запуска.
 * Поймано вопросом владельца, а не проверкой; поэтому проверка теперь есть
 * (селф-линт: ни один скилл поставки не зовёт bun).
 */
export const retargetSkillRuntime = (text: string): string => text.replace(/\bbun run\b/g, 'node')

export function retargetManifestRuntime(text: string): string {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (obj.command === 'bun' && Array.isArray(obj.args)) {
      obj.command = 'node'
      obj.args = (obj.args as unknown[]).filter((a) => a !== 'run')
    }
    for (const value of Object.values(obj)) walk(value)
  }
  const parsed = JSON.parse(text) as unknown
  walk(parsed)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export interface BundleInput {
  path: string
  content: string
}

/**
 * Все входы, от которых зависит содержимое артефакта: исходники, манифесты,
 * скиллы, сам код сборки. Порядок стабилен (сортировка) — хэш детерминирован.
 */
export function collectBundleInputs(root: string): BundleInput[] {
  const out: BundleInput[] = []
  const addFile = (rel: string): void => {
    try {
      out.push({ path: rel.replace(/\\/g, '/'), content: readFileSync(join(root, rel), 'utf8') })
    } catch {
      /* отсутствующий вход не хэшируем — его отсутствие видно другими проверками */
    }
  }
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel))) {
      const childRel = join(rel, name)
      if (statSync(join(root, childRel)).isDirectory()) walk(childRel)
      else if (/\.(ts|json|md)$/.test(name)) addFile(childRel)
    }
  }
  walk('src')
  walk('skills')
  addFile('hooks/hooks.json')
  addFile('.mcp.json')
  addFile('.claude-plugin/plugin.json')
  addFile('scripts/bundle.ts')
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

/** Хэш входов артефакта — валюта свежести бандла (пишется в .build.json). */
/** Разделитель полей в хэше: невидимый байт, которого не бывает в путях и коде. */
const SEP = String.fromCharCode(0)

export function bundleInputsHash(inputs: BundleInput[]): string {
  const h = createHash('sha1')
  for (const f of inputs) {
    // Переводы строк нормализуются ПЕРЕД хэшированием. Иначе хэш зависит от
    // операционной системы: в git всё лежит с LF (.gitattributes), а рабочая
    // копия на Windows получает CRLF — и артефакт, собранный на Windows,
    // считается несвежим в Linux-CI, хотя не менялся ни на байт. Первый же
    // прогон CI лёг ровно на этом.
    h.update(f.path).update(SEP).update(f.content.replace(/\r\n/g, '\n')).update('\u0000')
  }
  return h.digest('hex')
}
