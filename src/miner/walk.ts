import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

// Каталоги сборки и зависимостей: их содержимое — производное от исходников, и
// его попадание в паспорт даёт двойной счёт (найдено вживую: связи потянулись к
// собранному артефакту plugin/, будто это отдельная часть проекта).
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'coverage', 'vendor', 'tmp', 'temp',
  'plugin', 'build', 'out', '.output', '.nuxt', '.next', 'target',
  // Установленные зависимости остальных экосистем — то же самое, что
  // node_modules, только у Python, Ruby и CocoaPods. Пока граф импортов был
  // пуст вне JS, их присутствие было незаметным; с рабочим графом виртуальное
  // окружение вносит в паспорт проекта тысячи чужих файлов и связей между ними
  // (замер: 13 365 .py и 30 тысяч рёбер от одного venv рядом с Nuxt-приложением)
  'venv', 'site-packages', '__pycache__', '.tox', 'bower_components', 'Pods',
  // Множественное и «третьесторонние» написания того же самого: Yii 1.x кладёт
  // Composer в protected/vendors/ (боевой замер: 9613 чужих файлов и 9686 из
  // 9688 рёбер графа жили внутри), Chromium-подобные проекты — в third_party/.
  // Имя каталога здесь и есть объявление «это не наш код»
  'vendors', 'third_party', 'thirdparty',
])
/**
 * Лежит ли путь в производном каталоге (сборка, зависимости, артефакт поставки).
 *
 * Тот же список, что пропускает обход, — и это принципиально, а не удобно.
 * Паспорт объявляет: сгенерированное НЕ голосует о конвенциях, автор этих строк
 * их не писал. Значит судить его теми же конвенциями тем более нельзя: файл
 * держали бы перед планкой, которую ему не дали помогать устанавливать, а
 * исправить нарушение всё равно невозможно — следующая сборка перезапишет.
 * Поймано вживую: гейт выкатил 27 претензий к plugin/dist после релиза, где
 * каждая строка — вывод bun build. Детектор по содержимому (looksGenerated)
 * здесь бессилен: bun не минифицирует, средняя строка 39 символов при пороге 200.
 *
 * Зоны из .gitignore сюда сознательно НЕ входят: у этой функции нет корня
 * проекта (только rel), а её потребитель — гейт — судит правки владельца, где
 * игнорируемый git'ом файл встречается исключением, и цена недобора мала.
 * Обход же обязан их пропускать — там цена недобора — тысячи чужих узлов графа.
 */
export function inDerivedZone(rel: string): boolean {
  return rel.split('/').some((seg) => SKIP_DIRS.has(seg))
}

const MAX_FILE_SIZE = 1_000_000
const MAX_FILES = 20_000

/** JS-семейство — для него есть языковой пакет анализаторов слоя 0. */
export const JS_EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.vue'])

/** Все кодовые файлы — универсальные анализаторы (отступы, строки) работают на любом языке. */
export const CODE_EXT = new Set([
  ...JS_EXT,
  '.py', '.go', '.php', '.rb', '.java', '.cs', '.kt', '.rs',
  '.c', '.cpp', '.h', '.hpp', '.swift', '.scala', '.lua', '.pl', '.r', '.dart',
])

export interface WalkedFile {
  path: string
  ext: string
  size: number
  mtimeMs: number
}

/** Производные зоны, объявленные самим проектом: имена — на любой глубине, префиксы — от корня. */
interface DeclaredSkips {
  names: Set<string>
  prefixes: Set<string>
}

/**
 * Проектные производные зоны из корневого .gitignore.
 *
 * Жёсткий список имён не догонит все экосистемы (боевой случай: Yii 1.x с
 * Composer в protected/vendors/ — написание, которого в списке не было), а
 * просить у владельца конфиг — против устройства плагина: всё выводится из
 * данных проекта. Но проект УЖЕ объявляет свои производные зоны — в .gitignore:
 * установленные зависимости, сборка, локальное. Игнорируемое git'ом — не
 * источник истины проекта, значит и не свидетель его конвенций и связей.
 *
 * Разбор сознательно консервативен: только строки без wildcards и негаций
 * (имя — на любой глубине, путь с «/» — от корня), только корневой .gitignore.
 * Полная семантика gitignore (вложенные файлы, «!», глобы) отвергнута: её
 * честная реализация — это `git check-ignore`, то есть спавн процесса в бюджете
 * хука на каждый обход; недобор здесь безопасен (лишний каталог просто
 * пройдётся, как раньше), перебор — нет.
 */
function declaredSkips(root: string): DeclaredSkips {
  const names = new Set<string>()
  const prefixes = new Set<string>()
  let text = ''
  try {
    text = readFileSync(join(root, '.gitignore'), 'utf8')
  } catch {
    /* нет .gitignore — нет и объявленных зон; молчание безопасно */
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /[*?![\]]/.test(line)) continue
    const clean = line.replace(/\/+$/, '')
    if (!clean) continue
    if (clean.includes('/')) prefixes.add(clean.replace(/^\/+/, ''))
    else names.add(clean)
  }
  return { names, prefixes }
}

/** Обходит дерево проекта; скрытые, служебные и объявленные в .gitignore каталоги пропускаются. */
export function walkFiles(root: string): WalkedFile[] {
  const skips = declaredSkips(root)
  const out: WalkedFile[] = []
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }]
  while (stack.length > 0 && out.length < MAX_FILES) {
    const { abs: dir, rel } = stack.pop() as { abs: string; rel: string }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || skips.names.has(e.name)) continue
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (skips.prefixes.has(childRel)) continue
        stack.push({ abs: join(dir, e.name), rel: childRel })
        continue
      }
      const p = join(dir, e.name)
      const ext = extname(e.name).toLowerCase()
      let size = 0
      let mtimeMs = 0
      // stat — только кодовым файлам (нужны size/mtime для кэша);
      // остальным достаточно расширения для гистограммы — на репо с
      // тысячами логов/ассетов это убирает большинство syscall'ов.
      if (CODE_EXT.has(ext)) {
        try {
          const st = statSync(p)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          continue
        }
      }
      out.push({ path: p, ext, size, mtimeMs })
    }
  }
  return out
}

export function codeFiles(files: WalkedFile[]): WalkedFile[] {
  return files.filter((f) => CODE_EXT.has(f.ext) && f.size <= MAX_FILE_SIZE)
}
