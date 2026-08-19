/**
 * Непокрытый материал: то, чего система ещё не умеет понимать.
 *
 * ГЛАВНЫЙ ПРИНЦИП, который здесь защищается: проект может быть каким угодно —
 * Unity, движок на C++, презентации, тексты, чертежи, свой формат данных. Ядро
 * не вправе требовать, чтобы материал был кодом на знакомом языке.
 *
 * До этого модуля незнакомый материал просто выпадал из паспорта: анализаторы
 * его не брали, и система молчала. Молчание читается как «здесь нечего
 * понимать» — самая дорогая из возможных ошибок, потому что она невидима.
 *
 * Решение симметрично остальной системе: незнакомое становится ПОВОДОМ
 * НАУЧИТЬСЯ. Модуль не знает ни одного формата заранее — он считает, чего в
 * проекте много и что при этом не покрыто ни одним анализатором. Дальше за дело
 * берётся тот же механизм, что и везде: дорогой проход по образцам выводит
 * наблюдаемые правила, они ложатся в журнал фактами и живут по общим законам —
 * стареют, подтверждаются, умирают.
 */
import { documentsBlock, jsonOnly } from '../layer2/prompt'
import { isOpaqueMaterial } from './noncode'

export interface MaterialShare {
  /** расширение как маркер вида материала (без точки — «(без расширения)») */
  ext: string
  files: number
  /** доля от всех файлов проекта */
  share: number
}

export interface UnknownMaterial {
  /** непокрытые виды материала по убыванию значимости */
  kinds: MaterialShare[]
  /** доля непокрытого во всём проекте */
  totalShare: number
}

/**
 * Значимость: единичный экзотический файл не повод для дорогого прохода, а
 * пятая часть проекта — повод. Порог намеренно высок: обещание «понимаю всё»
 * дешевле не выполнять, чем выполнять плохо.
 */
const MIN_FILES = 5
const MIN_SHARE = 0.04

/**
 * Что осталось непокрытым. Списки покрытого передаются снаружи — модуль не
 * знает ни одного формата сам и не устареет вместе с ними.
 */
export function findUnknownMaterial(
  extensions: string[],
  covered: { code: Set<string>; entity: Set<string>; office: Set<string> },
): UnknownMaterial {
  const total = extensions.length
  if (total === 0) return { kinds: [], totalShare: 0 }

  const counts = new Map<string, number>()
  for (const raw of extensions) {
    const ext = (raw || '').toLowerCase()
    if (covered.code.has(ext) || covered.entity.has(ext) || covered.office.has(ext)) continue
    // Служебное и бинарное не считается материалом: его не «понимают», им пользуются
    if (isOpaqueMaterial(ext)) continue
    const key = ext || '(без расширения)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const kinds: MaterialShare[] = [...counts.entries()]
    .map((e) => ({ ext: e[0], files: e[1], share: e[1] / total }))
    .filter((k) => k.files >= MIN_FILES && k.share >= MIN_SHARE)
    .sort((a, b) => b.files - a.files)
    .slice(0, 5)

  const totalShare = kinds.reduce((s, k) => s + k.share, 0)
  return { kinds, totalShare }
}

/**
 * Промпт вывода правил для незнакомого материала. Мы НЕ подсказываем модели, что
 * это за формат: назвать его — значит навязать ожидания и получить пересказ
 * общих знаний вместо наблюдений. Спрашиваем только то, что видно в образцах.
 */
export function buildUnknownPrompt(kind: string, samples: Array<{ file: string; content: string }>): string {
  return [
    `В проекте есть ${samples.length} файлов вида «${kind}», и они составляют заметную часть работы.`,
    '',
    'Задача: определить, КАК В ЭТОМ ПРОЕКТЕ принято работать с такими файлами. Нужны наблюдения по образцам, а не общие сведения о формате.',
    '',
    'Что интересует: устойчивая структура (обязательные части, порядок), соглашения об именовании, единицы измерения и форматы значений, что здесь считается полным и законченным файлом, что повторяется из файла в файл.',
    '',
    'Образцы:',
    documentsBlock(samples),
    '',
    jsonOnly('[{"area": "область наблюдения", "statement": "предмет — вердикт", "evidence": ["файл1", "файл2"], "confidence": 0.8}]'),
    '',
    'Правила: только то, что подтверждается минимум двумя образцами; формулировка фактом («имена файлов — дата в начале»), а не советом; если устойчивых правил не видно — верни пустой массив, это честный ответ.',
  ].join('\n')
}

/** Факт о непокрытом материале: система обязана признавать границы своего знания. */
export function unknownFact(u: UnknownMaterial): {
  area: string
  statement: string
  positive: number
  total: number
  prevalence: number
  tier: 'привычка'
} | null {
  if (u.kinds.length === 0) return null
  const list = u.kinds.map((k) => `${k.ext} (${k.files})`).join(', ')
  return {
    area: 'состав проекта',
    statement: `материал без готового анализатора — ${list}: правила по нему выводятся из образцов, а не из знания формата`,
    positive: u.kinds.reduce((s, k) => s + k.files, 0),
    total: u.kinds.reduce((s, k) => s + k.files, 0),
    prevalence: 1,
    tier: 'привычка',
  }
}
