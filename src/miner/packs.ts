/**
 * Языковые пакеты слоя 0: оси конвенций как ДАННЫЕ.
 *
 * Полноценный набор наблюдений долго был только у JS (var/let/const, стрелки,
 * filter/map/reduce, венгерская нотация), а остальным языкам доставалось
 * универсальное ядро — отступы, кавычки, именование. Снаружи это читалось как
 * неравенство: на Python- или Go-проекте паспорт выводил заметно меньше правил,
 * хотя обещал независимость от языка.
 *
 * Ось описывает НЕ вердикт, а ВЫБОР, который язык предлагает делать: f-строки
 * или .format, `[]` или `array()`, `:=` или `var`, метод на указателе или на
 * значении. Что здесь принято — решают числа проекта, а не эта таблица; ядро
 * по-прежнему не имеет мнения. Поэтому строка таблицы — данные: новый язык или
 * новая ось добавляется одной записью и нигде больше.
 *
 * Форма записи: `all` ловит ВСЮ популяцию наблюдений оси, `isA` отделяет внутри
 * неё первую форму от второй. Два независимых счётчика-регэкспа расходились бы
 * на перекрытиях (`==` внутри `===`), и знаменатель переставал бы быть суммой.
 */

import { pair } from '../core/i18n'

export interface Axis {
  /** ключ агрегата; попадает в базу как часть идентичности факта */
  id: string
  exts: string[]
  area: string
  /** вся популяция наблюдений оси */
  all: RegExp
  /** признак первой формы внутри наблюдения */
  isA: RegExp
  labelA: string
  labelB: string
  /** ниже этого числа наблюдений ось молчит (выборка не о чём) */
  min: number
  /**
   * Ось смотрит ВНУТРЬ строковых литералов. По умолчанию нет, и это не мелочь:
   * `[0-9]` в регулярке — не короткий массив, `:=` в сообщении — не объявление.
   * На WordPress именно классы символов в preg_match давали 60 тысяч ложных
   * «коротких массивов» против 17 тысяч настоящих `array(`, то есть переворачивали
   * вердикт. Ставят true только оси, чей предмет — сама строка (f-строки Python).
   */
  inStrings?: boolean
}

export const AXES: Axis[] = [
  {
    id: 'py-strings',
    exts: ['.py', '.pyi'],
    area: 'строки',
    all: /\bf["'][^"'\n]*["']|\.format\s*\(|["'][^"'\n]*%[sdrf]\b/g,
    isA: /^f["']/,
    labelA: pair('подстановка в строки — f-строки', 'string interpolation — f-strings'),
    labelB: pair('подстановка в строки — .format() и %', 'string interpolation — .format() and %'),
    min: 10,
    inStrings: true,
  },
  {
    id: 'py-typing',
    exts: ['.py', '.pyi'],
    area: 'сигнатуры',
    all: /^[ \t]*(?:async\s+)?def\s+\w+\s*\([^)]*\)[^\n:]*:/gm,
    isA: /->|\([^)]*\w\s*:\s*[A-Za-z]/,
    labelA: pair('сигнатуры функций — с аннотациями типов', 'function signatures — with type annotations'),
    labelB: pair('сигнатуры функций — без аннотаций типов', 'function signatures — without type annotations'),
    min: 10,
  },
  {
    id: 'php-array',
    exts: ['.php', '.phtml', '.inc'],
    area: 'массивы',
    // Скобка считается ЛИТЕРАЛОМ только там, где слева не выражение: `$row['x']`
    // и `foo()['x']` — это ДОСТУП к массиву, а не его создание. Первая версия
    // оси их не различала, и на WordPress выходило «короткий синтаксис 86%» при
    // 4182 настоящих `array(` против 11871 обращений вида `$x['…']`.
    all: /\barray\s*\(|(?<![\w\])'"$])\[\s*(?:['"\d]|\]|\[)/g,
    isA: /^\[/,
    labelA: pair('массивы — короткий синтаксис []', 'arrays — short syntax []'),
    labelB: pair('массивы — array()', 'arrays — array()'),
    min: 15,
  },
  {
    id: 'php-eq',
    exts: ['.php', '.phtml', '.inc'],
    area: 'сравнения',
    all: /(?<![=!<>])(?:===|!==|==(?!=)|!=(?!=))/g,
    isA: /===|!==/,
    labelA: pair('сравнение — строгое (=== / !==)', 'comparison — strict (=== / !==)'),
    labelB: pair('сравнение — нестрогое (== / !=)', 'comparison — loose (== / !=)'),
    min: 20,
  },
  {
    id: 'go-decl',
    exts: ['.go'],
    area: 'объявления',
    all: /:=|\bvar\s+\w+\s*(?:=|\w)/g,
    isA: /:=/,
    labelA: pair('объявления — короткая форма :=', 'declarations — short form :='),
    labelB: pair('объявления — var', 'declarations — var'),
    min: 15,
  },
  {
    id: 'go-receiver',
    exts: ['.go'],
    area: 'методы',
    all: /\bfunc\s*\(\s*\w+\s+\*?\w+\s*\)/g,
    isA: /\*/,
    labelA: pair('методы — на указателе (*T)', 'methods — on pointer receiver (*T)'),
    labelB: pair('методы — на значении (T)', 'methods — on value receiver (T)'),
    min: 10,
  },
  {
    id: 'kt-binding',
    exts: ['.kt', '.kts'],
    area: 'объявления',
    all: /\b(?:val|var)\s+\w+/g,
    isA: /\bval\b/,
    labelA: pair('привязки — неизменяемые (val)', 'bindings — immutable (val)'),
    labelB: pair('привязки — изменяемые (var)', 'bindings — mutable (var)'),
    min: 15,
  },
  {
    id: 'rs-binding',
    exts: ['.rs'],
    area: 'объявления',
    all: /\blet\s+(?:mut\s+)?\w+/g,
    isA: /\bmut\b/,
    labelA: pair('привязки — изменяемые (let mut)', 'bindings — mutable (let mut)'),
    labelB: pair('привязки — неизменяемые (let)', 'bindings — immutable (let)'),
    min: 15,
  },
  {
    id: 'clike-local-type',
    exts: ['.cs', '.java'],
    area: 'объявления',
    all: /^[ \t]*(?:var\s+\w+\s*=|(?:[A-Z]\w*(?:<[^>\n]*>)?|int|long|double|float|bool|boolean|string|char)(?:\[\])?\s+\w+\s*=)/gm,
    isA: /^[ \t]*var\b/,
    labelA: pair('локальные переменные — var (тип выводится)', 'local variables — var (type inferred)'),
    labelB: pair('локальные переменные — с явным типом', 'local variables — explicit type'),
    min: 15,
  },
]

const BY_EXT = new Map<string, Axis[]>()
for (const a of AXES) {
  for (const e of a.exts) {
    const list = BY_EXT.get(e)
    if (list) list.push(a)
    else BY_EXT.set(e, [a])
  }
}

/** Есть ли для расширения языковой пакет осей (иначе работает только ядро). */
export const hasAxes = (ext: string): boolean => BY_EXT.has(ext)

export type AxisCounts = Record<string, { a: number; b: number }>

/** Языки, где решётка начинает комментарий (в C#/JS она значит другое). */
const HASH_COMMENT = new Set(['.py', '.pyi', '.php', '.phtml', '.inc', '.rb', '.rake', '.pl', '.r', '.sh', '.yml', '.yaml'])
const PHP_EXT = new Set(['.php', '.phtml', '.inc'])

/**
 * Только код: содержимое строк и комментариев выброшено, структура сохранена.
 *
 * Почему один проход, а не две замены подряд. Любой порядок двух регэкспов
 * ошибается, потому что вырезаемые области ВЛОЖЕНЫ друг в друга: решётка живёт
 * внутри строк (`'#fff'`, `'/#(\d+)/'`), а апостроф — внутри комментариев
 * («don't»). Чистка комментариев первой рвёт строку пополам и оставляет в коде
 * её содержимое; чистка строк первой ловит апостроф из комментария и съедает
 * настоящий код до следующей кавычки. Обе ошибки наблюдались на WordPress:
 * классы символов `[0-9]` из preg_match приходили в ось массивов и переворачивали
 * её вердикт (60 тысяч ложных «коротких массивов» против 17 тысяч настоящих
 * `array(`). Состояние читается за один проход — и вложенность перестаёт быть
 * вопросом порядка.
 *
 * PHP-файл вдобавок начинается ВНЕ кода: всё до `<?php` — разметка, и апострофы
 * в человеческом тексте («Don't») там обычны.
 */
export function codeOnly(source: string, ext: string): string {
  return splitCode(source, ext).code
}

/**
 * Тот же проход, но с обеими половинами. Комментарии нужны отдельно: их язык —
 * самый честный признак языка ВЛАДЕЛЬЦА (комментарий пишут для себя), и на нём
 * держится выбор языка подачи до первого обращения к модели (core/i18n.ts).
 */
export function splitCode(source: string, ext: string): { code: string; comments: string } {
  const php = PHP_EXT.has(ext)
  const hash = HASH_COMMENT.has(ext)
  const out: string[] = []
  const notes: string[] = []
  let i = 0
  let inHtml = php
  while (i < source.length) {
    const c = source[i]
    if (inHtml) {
      const open = source.indexOf('<?', i)
      if (open === -1) break
      i = source.startsWith('<?php', open) ? open + 5 : open + 2
      inHtml = false
      continue
    }
    if (php && c === '?' && source[i + 1] === '>') {
      inHtml = true
      i += 2
      continue
    }
    if ((c === '/' && source[i + 1] === '/') || (hash && c === '#')) {
      const nl = source.indexOf('\n', i)
      notes.push(source.slice(i, nl === -1 ? source.length : nl), '\n')
      i = nl === -1 ? source.length : nl
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      notes.push(source.slice(i, end === -1 ? source.length : end + 2), '\n')
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      out.push(c, c) // пустой литерал: форма сохраняется, содержимое нет
      i++
      while (i < source.length) {
        const s = source[i]
        if (s === '\\') {
          i += 2
          continue
        }
        // Одинарная и двойная кавычки не переносятся на новую строку ни в одном
        // из наших языков: незакрытая кавычка иначе съела бы остаток файла
        if (s === '\n' && c !== '`') break
        i++
        if (s === c) break
      }
      continue
    }
    out.push(c)
    i++
  }
  return { code: out.join(''), comments: notes.join('') }
}

/** Счёт осей одного файла: сколько раз встретилась каждая из двух форм. */
export function countAxes(ext: string, content: string): AxisCounts {
  const out: AxisCounts = {}
  const axes = BY_EXT.get(ext) ?? []
  // Чистка нужна почти всем осям, поэтому делается один раз на файл — и только
  // если в пакете есть хоть одна ось, которой она нужна
  const code = axes.some((a) => !a.inStrings) ? codeOnly(content, ext) : content
  for (const axis of axes) {
    let a = 0
    let b = 0
    for (const m of (axis.inStrings ? content : code).matchAll(axis.all)) {
      if (axis.isA.test(m[0])) a++
      else b++
    }
    if (a + b > 0) out[axis.id] = { a, b }
  }
  return out
}

/** Сложение счётчиков осей (файл → проект). */
export function addAxes(into: AxisCounts, from: AxisCounts): void {
  for (const [id, c] of Object.entries(from)) {
    const acc = into[id]
    if (acc) {
      acc.a += c.a
      acc.b += c.b
    } else into[id] = { a: c.a, b: c.b }
  }
}
