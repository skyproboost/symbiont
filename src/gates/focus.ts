/**
 * Страж фокуса (CONCEPT §4.3, последний из крупных долгов): «не разъехались с
 * задачей? не начался непрошеный рефакторинг?».
 *
 * Почему детерминированно, а не агентом. Концепт называет стража мини-агентом на
 * Stop, но агент на КАЖДЫЙ ход — это налог на каждый ход, а «дорогое — по
 * триггеру» (аксиома §3.7). Оказалось, что самые надёжные признаки расфокуса
 * видны из графа и диффа без единого токена: работа расползлась по зонам,
 * правки ушли за пределы графового окружения задачи, из диффа исчезли проверки.
 * LLM здесь добавил бы не точность, а стоимость и недетерминизм.
 *
 * Дисциплина шума важнее полноты (урок официального /code-review: «ревьюер,
 * обязанный найти проблемы, найдёт их и в здоровом коде»): мелкие сессии не
 * судятся вовсе, сигнал требует явного превышения порога, вывод — ФАКТ, а не
 * блокировка. Владелец мог расширить задачу осознанно, и система не вправе
 * называть это ошибкой — только показать.
 */
import { reachableUndirected, type Edge } from '../graph/graph'

export interface FocusSignal {
  kind: string
  detail: string
  files: string[]
}

/** Мельче — не судим: «если дифф описывается одним предложением, без церемоний». */
const MIN_FILES = 6
/** Зон больше этого при достаточном размере — работа расползлась. */
const MAX_ZONES = 3
/** Файлов сида: чем владелец занялся сначала, то и есть задача. */
const SEED_FILES = 3
const NEIGHBOR_HOPS = 2
/** Доля «чужих» файлов, ниже которой это шум, а не расфокус. */
const OUTSIDE_RATIO = 0.4

/** Зона файла — первый значимый сегмент (как в авто-конституции и уроках). */
const zoneOf = (file: string): string => {
  const parts = file.split('/')
  return parts.length <= 1 ? '(корень)' : parts[0]
}

// Отрицательный просмотр назад на точку — анти-шум того же рода, что у стража
// защитных слоёв. Без него `\btest(` совпадает с ВЫЗОВОМ МЕТОДА `.test(` у
// регэкспа, и правка вида «расширить регулярку» читалась как «удалён тест»:
// поймано вживую на src/cli/elevate.ts, где ни одной проверки не убрали.
// Настоящие проверки так не пишут: `expect(`, `it(`, `describe(` вызываются
// именами, а не методами объекта, — поэтому точка их не прячет.
const TEST_LINE = /^-.*(?<!\.)\b(it|test|describe|expect|assert|should)\s*\(/m
const TEST_FILE = /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i

export interface FocusInput {
  /** файлы сессии в порядке появления: первые — то, ради чего сессия начата */
  sessionFiles: string[]
  edges: Edge[]
  /** rel → git diff файла (для признаков, видимых только в диффе) */
  diffs?: Map<string, string>
}

/**
 * Признаки расфокуса. Пустой список — норма (молчание по умолчанию).
 */
export function detectFocusDrift(input: FocusInput): FocusSignal[] {
  const files = input.sessionFiles
  const out: FocusSignal[] = []
  if (files.length < MIN_FILES) return out

  // 1) Расползание по зонам: одна задача редко живёт в четырёх углах проекта
  const zones = [...new Set(files.map(zoneOf))]
  if (zones.length > MAX_ZONES) {
    out.push({
      kind: 'работа расползлась по зонам',
      detail: `${files.length} файлов в ${zones.length} зонах: ${zones.slice(0, 5).join(', ')}`,
      files: [],
    })
  }

  // 2) Правки за пределами графового окружения задачи. Сид — первые тронутые
  // файлы; всё, что не связано с ними даже через два хопа, к задаче отношения
  // не имеет. Требуем и абсолютного числа, и доли: в большой сессии два
  // случайных файла — шум, а половина диффа мимо задачи — уже расфокус.
  if (input.edges.length > 0) {
    // Сид = первый тронутый файл И связанные с ним из первых касаний. Отвергнут
    // вариант «первые N файлов»: если работа разъехалась сразу, третий файл уже
    // мимо задачи, и включение его в сид делало бы стража слепым к собственному
    // предмету. Граф решает, что относится к задаче, а порядок — что её начало.
    const first = files[0]
    const nearFirst = reachableUndirected(input.edges, new Set([first]), NEIGHBOR_HOPS)
    const seed = new Set(files.slice(0, SEED_FILES).filter((f) => f === first || nearFirst.has(f)))
    const near = reachableUndirected(input.edges, seed, NEIGHBOR_HOPS)
    const outside = files.filter((f) => !seed.has(f) && !near.has(f))
    if (outside.length >= 3 && outside.length / files.length >= OUTSIDE_RATIO) {
      out.push({
        kind: 'правки вне окружения задачи',
        detail: `${outside.length} из ${files.length} файлов не связаны с начатым (${[...seed].slice(0, 2).join(', ')}) даже через ${NEIGHBOR_HOPS} хопа`,
        files: outside.slice(0, 5),
      })
    }
  }

  // 3) Исчезнувшие проверки: удаление тестов посреди работы над кодом — самый
  // дорогой из тихих регрессов (храповик качества движется только вверх)
  if (input.diffs) {
    const stripped: string[] = []
    for (const entry of input.diffs) {
      const rel = entry[0]
      const diff = entry[1]
      if (!TEST_FILE.test(rel) && !TEST_LINE.test(diff)) continue
      if (TEST_LINE.test(diff)) stripped.push(rel)
    }
    if (stripped.length > 0) {
      out.push({
        kind: 'из диффа исчезли проверки',
        detail: `удалены строки с проверками: ${stripped.slice(0, 3).join(', ')}`,
        files: stripped.slice(0, 5),
      })
    }
  }

  return out
}

/** Факты для гейт-потока: сообщаем, но не блокируем — намерение решает владелец. */
export function renderFocus(signals: FocusSignal[]): string[] {
  return signals.map((s) => `- страж фокуса: ${s.kind} · ${s.detail}${s.files.length > 0 ? ` (${s.files.join(', ')})` : ''}`)
}
