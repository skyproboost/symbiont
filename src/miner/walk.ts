import { readdirSync, statSync } from 'node:fs'
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

/** Обходит дерево проекта; скрытые и служебные каталоги пропускаются. */
export function walkFiles(root: string): WalkedFile[] {
  const out: WalkedFile[] = []
  const stack = [root]
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(join(dir, e.name))
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
