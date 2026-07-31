/**
 * Измеримые бюджеты профиля: храповик качества в момент правки, а не задним
 * числом.
 *
 * Чего не хватало. Слой дрейфа замечает ухудшение по суточным снимкам — это
 * верно для медленной эрозии, но поздно для конкретной правки: регрессия уже
 * в коммите. Гейт формы, наоборот, работает мгновенно, но проверяет ФОРМУ
 * (кавычки, отступы), а не ВЕЛИЧИНЫ.
 *
 * ОТКУДА БЕРУТСЯ ПОРОГИ — главный вопрос, и ответ определяет всю ценность.
 * Абсолютные числа («бандл не больше 500 КБ», «покрытие от 80%») были бы
 * хардкодом и враньём: для одного проекта это недостижимо, для другого смешно.
 * Поэтому бюджет здесь — «НЕ ХУЖЕ, ЧЕМ БЫЛО У ЭТОГО ПРОЕКТА». Опорная точка
 * берётся из его собственной истории, и потому механизм одинаково работает на
 * библиотеке, игре и репозитории статей.
 *
 * Что охраняется, выбрано по одному признаку: величина, рост которой НИКОГДА не
 * является целью работы. Код растёт при добавлении функций — это нормально, и
 * гейт молчит. А вот исчезновение проверок, разбухание отдельного файла и
 * падение соблюдаемости конвенций целью не бывают ни при какой задаче.
 */

export interface Measurement {
  /** что измеряем — человеческое имя, оно же попадает в вывод */
  metric: string
  value: number
  /** ниже — лучше (размер файла) или выше — лучше (число проверок) */
  direction: 'меньше лучше' | 'больше лучше'
}

export interface BudgetBreach {
  metric: string
  was: number
  now: number
  /** во сколько раз хуже — для сортировки и формулировки */
  ratio: number
  detail: string
}

/**
 * Допуск. Величины шумят: один файл вырос на строку, один тест переименован.
 * Порог в 15% отсеивает дыхание проекта и оставляет настоящие сдвиги; для
 * счётных величин дополнительно требуется абсолютная разница, иначе на малых
 * числах любое движение выглядит катастрофой (было 2 теста, стал 1 — это −50%).
 */
const RELATIVE_TOLERANCE = 0.15
const MIN_ABSOLUTE_DIFF = 2

export function compareBudgets(before: Measurement[], after: Measurement[]): BudgetBreach[] {
  const byMetric = new Map(before.map((m) => [m.metric, m]))
  const out: BudgetBreach[] = []

  for (const now of after) {
    const was = byMetric.get(now.metric)
    if (!was || was.value <= 0) continue // не с чем сравнивать — молчим, а не гадаем

    const worse = now.direction === 'меньше лучше' ? now.value > was.value : now.value < was.value
    if (!worse) continue

    const diff = Math.abs(now.value - was.value)
    const ratio = now.direction === 'меньше лучше' ? now.value / was.value : was.value / now.value
    if (ratio - 1 < RELATIVE_TOLERANCE) continue
    if (diff < MIN_ABSOLUTE_DIFF) continue

    out.push({
      metric: now.metric,
      was: was.value,
      now: now.value,
      ratio,
      detail:
        now.direction === 'меньше лучше'
          ? `выросло с ${was.value} до ${now.value} (в ${ratio.toFixed(1)} раза)`
          : `упало с ${was.value} до ${now.value}`,
    })
  }

  return out.sort((a, b) => b.ratio - a.ratio)
}

const TEST_PATH = /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i
/** Проверка внутри файла — по вызову, а не по имени: языки разные, форма одна. */
const ASSERTION = /\b(expect|assert|should|require\.that|Assert\.|XCTAssert)\s*\(/g

/**
 * Замер по содержимому файлов. Считается по тем же данным, что уже читает гейт,
 * — ни одного лишнего обхода.
 */
export function measure(files: Array<{ rel: string; content: string }>): Measurement[] {
  let assertions = 0
  let testFiles = 0
  let biggest = 0
  let totalLines = 0

  for (const f of files) {
    const lines = f.content.split('\n').length
    totalLines += lines
    if (lines > biggest) biggest = lines
    if (TEST_PATH.test(f.rel)) testFiles++
    assertions += (f.content.match(ASSERTION) ?? []).length
  }

  return [
    { metric: 'проверок в коде', value: assertions, direction: 'больше лучше' },
    { metric: 'файлов с тестами', value: testFiles, direction: 'больше лучше' },
    { metric: 'строк в самом большом файле', value: biggest, direction: 'меньше лучше' },
    { metric: 'строк всего в затронутых файлах', value: totalLines, direction: 'меньше лучше' },
  ]
}

/**
 * Что показывать владельцу. Рост общего объёма НЕ показывается: код растёт при
 * добавлении функций, и жаловаться на это значит спорить с самой работой. Из
 * величин остаются те, ухудшение которых не бывает целью.
 */
const REPORTED = new Set(['проверок в коде', 'файлов с тестами', 'строк в самом большом файле'])

export function renderBudgets(breaches: BudgetBreach[]): string[] {
  return breaches
    .filter((b) => REPORTED.has(b.metric))
    .map((b) => `- бюджет качества: ${b.metric} — ${b.detail} (опорная точка — прошлое состояние этого же проекта)`)
}

/**
 * Замер «как было» — из уже полученного диффа, без единого лишнего вызова git.
 * Восстановление точное: текущее значение минус добавленное плюс удалённое.
 * Читать прошлую версию файла отдельной командой было бы вдвое дороже ради того
 * же ответа, а гейт обязан оставаться дешёвым — он бежит после каждого хода.
 */
export function measureBefore(
  files: Array<{ rel: string; content: string; diff: string }>,
): Measurement[] {
  let assertions = 0
  let testFiles = 0
  let biggest = 0
  let totalLines = 0

  for (const f of files) {
    const added = f.diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = f.diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    const countIn = (lines: string[]): number =>
      lines.reduce((s, l) => s + (l.slice(1).match(ASSERTION) ?? []).length, 0)

    const nowLines = f.content.split('\n').length
    const wasLines = Math.max(0, nowLines - added.length + removed.length)
    totalLines += wasLines
    if (wasLines > biggest) biggest = wasLines

    const nowAssertions = (f.content.match(ASSERTION) ?? []).length
    assertions += Math.max(0, nowAssertions - countIn(added) + countIn(removed))

    // Файл, созданный в этой сессии, раньше не существовал: считать его тестом
    // «до» нельзя, иначе появление нового теста выглядело бы как отсутствие роста
    const isNew = removed.length === 0 && added.length >= nowLines
    if (TEST_PATH.test(f.rel) && !isNew) testFiles++
  }

  return [
    { metric: 'проверок в коде', value: assertions, direction: 'больше лучше' },
    { metric: 'файлов с тестами', value: testFiles, direction: 'больше лучше' },
    { metric: 'строк в самом большом файле', value: biggest, direction: 'меньше лучше' },
    { metric: 'строк всего в затронутых файлах', value: totalLines, direction: 'меньше лучше' },
  ]
}
