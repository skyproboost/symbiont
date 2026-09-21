/**
 * Страж тестов: «ни одна правка не ослабит проверку молча». Близнец стража
 * защитных слоёв — тот сторожит защиту продукта, этот сторожит то, чем
 * проверяется сам код.
 *
 * Зачем отдельный страж, когда есть бюджеты качества и гейт доказательств.
 * Бюджет считает утверждения СУММОЙ по ходу и с допуском 15% — убыль двух
 * проверок в большом тесте он не видит по построению. Гейт доказательств знает,
 * ЗАПУСКАЛАСЬ ли проверка, но не знает, чем её сделали зелёной. Между ними
 * оставалась ровно та дыра, которую внешние замеры называют главной формой
 * жульничества кодовых агентов: упавший тест чинят правкой теста, а не кода
 * (ImpossibleBench: у Claude-моделей так сделано больше 79% обходов). Замер на
 * собственных транскриптах: из 84 эпизодов «упало → правки → прошло» в 13
 * правился только существовавший тест, код не менялся.
 *
 * Это НЕ обязательно подгонка: так же выглядит осознанная смена контракта.
 * Поэтому страж сообщает фактом и не блокирует НИКОГДА, даже в режиме
 * блокировки: «нарушение» здесь нечем исправить, кроме отката теста, и гейт,
 * требующий отката законной правки, учит модель не трогать тесты вовсе.
 * Отвергнуто и «облагать новые тесты»: тест, рождённый этой же сессией, правят
 * до зелёного по определению TDD — судятся только существовавшие.
 *
 * Анти-шум того же рода, что у стража защиты: перемещение — не снятие. Строка
 * утверждения, исчезнувшая из одного теста и появившаяся в другом тем же
 * текстом, убылью не считается (разбиение файла на два — обычный рефактор).
 * Закомментированная проверка, наоборот, считается снятой: строки-комментарии
 * не участвуют в счёте ни с одной стороны.
 */
import { extname } from 'node:path'
import { pair, t } from '../core/i18n'
import { codeOnlyLine } from '../miner/packs'
import { isTestPath } from '../passport/signals'
import type { RunHistory } from '../gates/evidence'

export type TestFindingKind = 'bent' | 'assertions' | 'cases' | 'skipped' | 'narrowed' | 'deleted'

/** Ключи гейт-потока: по ним считаются поимки в /sym-status; в журнале русские, английская пара — на показе. */
export const TEST_LAWS: Record<TestFindingKind, string> = {
  bent: pair(
    'страж тестов: тест правился между упавшим и прошедшим прогоном, код не менялся',
    'test guard: a test was edited between a failing and a passing run while the code stayed untouched',
  ),
  assertions: pair('страж тестов: в существовавшем тесте стало меньше утверждений', 'test guard: an existing test lost assertions'),
  cases: pair('страж тестов: из существовавшего теста убраны случаи', 'test guard: test cases were removed from an existing test'),
  skipped: pair('страж тестов: в существовавший тест добавлен пропуск', 'test guard: a skip marker was added to an existing test'),
  narrowed: pair('страж тестов: набор сужен до избранных тестов', 'test guard: the suite was narrowed to selected tests'),
  deleted: pair('страж тестов: тест-файл удалён', 'test guard: a test file was deleted'),
}

export interface TestFinding {
  kind: TestFindingKind
  file: string
  law: string
  detail: string
}

// Продолжение блочного комментария и комментарии, которых общий вырезатель не
// знает. Строчные `//` и `#` снимает он сам, с учётом языка: закомментированная
// проверка — снятая проверка, и такие строки не считаются ни с одной стороны.
const COMMENT_LINE = /^\s*(\/\*|\*|--\s|<!--)/

// Утверждение — по ФОРМЕ вызова, кросс-язык. Просмотр назад на точку отсекает
// `.test(` у регэкспа и методы объектов; формы с получателем перечислены явно,
// потому что `self.` и `$this->` зовут не только проверки.
const ASSERT_FORMS = [
  /(?<![.\w$])(expect|should|assertThat|verify|assert\w*!?|XCTAssert\w*)\s*\(/,
  /(\$this->|self\.|self::|static::)assert\w*\s*\(/,
  /\b(Assert|Assertions|assert)\.\w+\s*\(/,
  /^\s*assert\s+[^\s(]/,
  /\bt\.(Error|Errorf|Fatal|Fatalf)\s*\(/,
  /\.should\b/,
]

// Тестовый случай: вызов по имени (JS-семейство), объявление функции (Python,
// Go, PHP), атрибут (Java/C#/Rust) и безскобочная форма rspec. Модификатор
// случая не отменяет: `it.skip(`, `xit(` и `test.each(` — всё ещё случаи, иначе
// пропуск считался бы дважды — и пропуском, и убылью.
const CASE_FORMS = [
  /(?<![.\w$])(it|test|describe|context|specify|scenario|xit|xtest|xdescribe|xcontext|fit|fdescribe|fcontext)(\.\w+)*\s*\(/,
  /^\s*(async\s+)?def\s+test\w*\s*\(/,
  /^\s*func\s+(Test|Benchmark|Fuzz)\w*\s*\(/,
  /\bfunction\s+test\w*\s*\(/,
  /@(Test|ParameterizedTest)\b|\[(Test|Fact|Theory|TestMethod|TestCase)\b|#\[(tokio::)?test\]/,
  /^\s*(it|describe|context|specify|scenario)\s+['"]/,
]

const SKIP_FORMS = [
  /\b(it|test|describe|context|suite)\.(skip|todo|skipIf|failing|fixme)\b/,
  /(?<![.\w$])(xit|xtest|xdescribe|xcontext|xspecify)\b/,
  /@pytest\.mark\.(skip|skipif|xfail)\b|@unittest\.(skip\w*|expectedFailure)\b|\bpytest\.(skip|xfail)\s*\(|\.skipTest\s*\(/,
  /\bmarkTest(Skipped|Incomplete)\s*\(/,
  /@(Ignore|Disabled)\b|\[Ignore\b|\bSkip\s*=\s*"/,
  /\bt\.Skip(f|Now)?\s*\(/,
  /#\[ignore\b/,
  /^\s*(skip|pending)\s+['"(]/,
]

// Сужение набора: `.only` оставляет зелёным всё, что перестало запускаться.
const ONLY_FORMS = [/\b(it|test|describe|context|suite)\.only\b/, /(?<![.\w$])(fit|fdescribe|fcontext)\s*\(/, /^\s*(fit|fdescribe|fcontext)\s+['"]/]

const matchesAny = (forms: RegExp[], line: DiffLine): boolean => forms.some((re) => re.test(line.code))

/**
 * Строка диффа в двух видах. `code` — без содержимого строк и комментариев: по
 * нему ищутся формы, иначе `it.only(` внутри строкового литерала (фикстура
 * теста, пример в сообщении) читалось бы сужением набора — поймано на тестах
 * самого стража. `text` — как написано: по нему сверяются переносы между
 * файлами, и там `toBe('a')` обязано отличаться от `toBe('b')`.
 */
interface DiffLine {
  text: string
  code: string
}

interface DiffSides {
  added: DiffLine[]
  removed: DiffLine[]
}

/** Значимые строки диффа по сторонам: без заголовков, комментариев и пустых после вырезания. */
function sides(diff: string, ext: string): DiffSides {
  const added: DiffLine[] = []
  const removed: DiffLine[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    const body = line.slice(1)
    if (COMMENT_LINE.test(body)) continue
    const code = codeOnlyLine(body, ext).trim()
    if (!code) continue
    const entry = { text: body.trim(), code }
    if (line.startsWith('+')) added.push(entry)
    else removed.push(entry)
  }
  return { added, removed }
}

/** Сколько строк стороны подходит под формы; заодно первый образец — для узнавания. */
function count(lines: DiffLine[], forms: RegExp[]): { n: number; sample: string } {
  const hits = lines.filter((l) => matchesAny(forms, l))
  return { n: hits.length, sample: (hits[0]?.text ?? '').slice(0, 60) }
}

/**
 * Убыль строк данного вида в файле с поправкой на перемещение: удалённая
 * строка, появившаяся тем же текстом среди добавленных В ДРУГОМ тесте, не
 * потеряна, а перенесена. Свои добавленные строки возмещают убыль обычным
 * счётом — так изменённое ожидание (`toBe(1)` → `toBe(2)`) убылью не является.
 */
function lossOf(own: DiffSides, elsewhereAdded: Map<string, number>, forms: RegExp[]): number {
  const removed = own.removed.filter((l) => matchesAny(forms, l))
  let moved = 0
  for (const line of removed) {
    const left = elsewhereAdded.get(line.text) ?? 0
    if (left > 0) {
      elsewhereAdded.set(line.text, left - 1)
      moved++
    }
  }
  return Math.max(0, removed.length - moved - count(own.added, forms).n)
}

export interface GuardInput {
  /** существовавшие до сессии тесты, изменённые ею: rel → дифф против базы сессии */
  existing: Map<string, string>
  /** тесты, рождённые сессией: rel → дифф (все строки добавлены); нужны для учёта перемещений */
  fresh: Map<string, string>
  /** существовавшие тест-файлы, удалённые сессией */
  deleted: string[]
  history: RunHistory
}

/**
 * Находки стража. Пусто — норма. Порядок — по силе свидетельства: правка теста
 * между упавшим и прошедшим прогоном опирается на последовательность событий,
 * остальное — на форму диффа.
 */
export function guardTests(input: GuardInput): TestFinding[] {
  const out: TestFinding[] = []
  const push = (kind: TestFindingKind, file: string, detail: string): void => {
    if (out.some((f) => f.kind === kind && f.file === file)) return
    out.push({ kind, file, law: TEST_LAWS[kind], detail })
  }

  const existing = new Map<string, DiffSides>()
  for (const entry of input.existing) existing.set(entry[0], sides(entry[1], extname(entry[0]).toLowerCase()))
  const fresh = new Map<string, DiffSides>()
  for (const entry of input.fresh) fresh.set(entry[0], sides(entry[1], extname(entry[0]).toLowerCase()))

  // 1) Упало → правили только тесты → прошло. Эпизод, где между прогонами
  // менялось хоть что-то кроме тестов, сюда не попадает: там чинили код.
  for (const ep of input.history.episodes) {
    if (ep.edited.length === 0 || !ep.edited.every(isTestPath)) continue
    for (const file of ep.edited) {
      if (input.history.created.has(file) || fresh.has(file)) continue // свой свежий тест — обычный TDD
      // Нет диффа против базы сессии — правку вернули назад, и говорить не о чем
      const own = existing.get(file)
      if (!own) continue
      // Файл существовал — но чьи строки правили? Случай, дописанный этой же
      // сессией в старый файл и доведённый до зелёного, — тот же TDD, что и
      // свежий файл. Существовавший тест тронут, только если снятая правкой
      // строка есть среди исчезнувших относительно базы сессии: своих,
      // добавленных после базы, там быть не может. Файл переписан целиком —
      // построчно не узнать, судим по тому, исчезло ли из него хоть что-то.
      const lost = ep.removed.get(file) ?? null
      const hit = lost === null ? own.removed : own.removed.filter((l) => lost.includes(l.text))
      if (hit.length === 0) continue
      const touched = hit.some((l) => matchesAny(ASSERT_FORMS, l))
      push(
        'bent',
        file,
        t(
          `правился между упавшим и прошедшим прогоном, код при этом не менялся${touched ? ' · строки утверждений изменены' : ''}`,
          `edited between a failing and a passing run while the code stayed untouched${touched ? ' · assertion lines changed' : ''}`,
        ),
      )
    }
  }

  // 2) Форма диффа существовавших тестов
  for (const [file, own] of existing) {
    const elsewhere = new Map<string, number>()
    for (const [other, s] of [...existing, ...fresh]) {
      if (other === file) continue
      for (const line of s.added) elsewhere.set(line.text, (elsewhere.get(line.text) ?? 0) + 1)
    }
    const lostAsserts = lossOf(own, new Map(elsewhere), ASSERT_FORMS)
    if (lostAsserts > 0) push('assertions', file, t(`утверждений стало меньше на ${lostAsserts}`, `${lostAsserts} fewer assertions`))
    const lostCases = lossOf(own, new Map(elsewhere), CASE_FORMS)
    if (lostCases > 0) push('cases', file, t(`тестовых случаев стало меньше на ${lostCases}`, `${lostCases} fewer test cases`))

    const skipsAdded = count(own.added, SKIP_FORMS)
    if (skipsAdded.n > count(own.removed, SKIP_FORMS).n) push('skipped', file, t(`добавлен пропуск: ${skipsAdded.sample}`, `a skip was added: ${skipsAdded.sample}`))
  }

  // 3) Сужение набора — и в свежих тестах тоже: `.only` гасит соседей по запуску
  // независимо от того, в чьём файле стоит
  for (const [file, own] of [...existing, ...fresh]) {
    const onlyAdded = count(own.added, ONLY_FORMS)
    if (onlyAdded.n > count(own.removed, ONLY_FORMS).n) push('narrowed', file, t(`добавлено сужение набора: ${onlyAdded.sample}`, `the suite was narrowed: ${onlyAdded.sample}`))
  }

  // 4) Удалённые тесты. Перенос файла (то же имя среди рождённых сессией) — не удаление.
  const freshNames = new Set([...fresh.keys()].map((f) => f.split('/').pop()))
  for (const file of input.deleted) {
    if (freshNames.has(file.split('/').pop())) continue
    push('deleted', file, t('файл удалён', 'the file was deleted'))
  }

  return out
}

/**
 * Подача: строка на файл и одна общая развилка. Развилка — не императив: страж
 * не знает намерения, а владелец мог менять контракт осознанно; названы оба
 * законных исхода, выбор за тем, кто знает задачу.
 */
export function renderTestGuard(findings: TestFinding[]): string[] {
  if (findings.length === 0) return []
  const byFile = new Map<string, string[]>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f.detail])
  const lines = [...byFile].map((entry) => `- ${t('страж тестов', 'test guard')}: ${entry[0]} — ${entry[1].join(' · ')}`)
  lines.push(
    t(
      '  если контракт изменён намеренно — стоит назвать владельцу, что изменилось в поведении; если нет — вернуть проверку и чинить код',
      '  if the contract changed on purpose, tell the owner what changed in behaviour; if not, restore the check and fix the code',
    ),
  )
  return lines
}
