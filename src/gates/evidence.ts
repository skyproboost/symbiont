/**
 * Гейт доказательств: «готово» без запущенной проверки — не готово.
 *
 * Правило владельца («никаких “починено” без вывода реально запущенной
 * проверки») здесь становится механизмом. Источник истины — транскрипт
 * сессии: в нём видно, что модель правила код и запускала ли после
 * последней правки команду проверки. Ни одного нового процесса: Bash не
 * хукается (каждый хук — ~190 мс старта), транскрипт уже лежит на диске, а
 * его путь Claude Code передаёт каждому хуку.
 *
 * Формат транскрипта — JSONL Claude Code, строки `type:"assistant"` с
 * `message.content[]`, где `type:"tool_use"` несёт `name` и `input`. Формат
 * официально нестабилен — поэтому парс здесь терпимый: любая
 * неожиданность = «доказательств нет и требовать нечего» (fail-open).
 *
 * Что считается проверкой — распознаётся по форме команды, а не по имени
 * раннера проекта: слово test/spec в команде, либо известные раннеры. Это
 * не «правило про проект», а распознавание класса действия, как security.ts
 * распознаёт CORS — одинаково для любого стека.
 */
import { existsSync, readFileSync } from 'node:fs'

/** Команда проверки: по слову или по известному раннеру (форма, не имя проекта). */
const CHECK_COMMAND =
  /\b(test|tests|spec|specs|pytest|jest|vitest|mocha|phpunit|rspec|cargo\s+(test|check|clippy)|go\s+(test|vet)|dotnet\s+test|gradle\w*\s+test|mvn\w*\s+(test|verify)|tsc\b|eslint|ruff|mypy|flake8|pylint|golangci-lint|canary|selflint|lint)\b/i

/** Инструменты, чьи вызовы — правки файла. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Оболочек две: на Windows рядом с Bash живёт инструмент PowerShell с тем же
// полем `command`. Пока проверка искалась только у Bash, прогон тестов из
// PowerShell не засчитывался и гейт требовал доказательств, которые уже были.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

// Разведка — не проверка. `grep FAIL .data/vitest.log` и `cat tests/a.test.ts`
// несут слово раннера, но ничего не запускают; засчитанные проверкой, они и
// «сертифицировали» правки, и — хуже — делали состояние красным по СТАРОМУ логу
// упавшего прогона (замер: каждая десятая «проверка» в транскриптах — разведка).
// Поэтому слово проверки обязано стоять в подкоманде, чья голова — не читалка.
const RECON_HEAD =
  /^(grep|egrep|rg|ag|ls|dir|cat|bat|head|tail|less|more|find|fd|sed|awk|wc|echo|printf|cd|pushd|git|diff|stat|file|type|sort|uniq|cut|tr|tee|sls|gc|gci|Select-String|Get-Content|Get-ChildItem|Test-Path)$/i

/** Подкоманды составной команды. Разделители внутри кавычек — часть аргумента (`grep -E "a|b"`), а не граница. */
function subcommands(command: string): string[] {
  const flat = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q) => q.replace(/[|;&\n]/g, ' '))
  return flat.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean)
}

/** Голова подкоманды: первое слово после присваиваний окружения и открывающих скобок, без каталога. */
function headOf(segment: string): string {
  const words = segment.replace(/^[({\s]+/, '').split(/\s+/)
  const head = words.find((w) => !/^\w+=/.test(w)) ?? ''
  return head.replace(/^.*[\\/]/, '')
}

export const isCheckCommand = (command: string): boolean => subcommands(command).some((s) => CHECK_COMMAND.test(s) && !RECON_HEAD.test(headOf(s)))

export interface EvidenceState {
  /** файлы кода, правленные после последней проверки (по транскрипту) */
  uncheckedFiles: string[]
  /** была ли вообще проверка в транскрипте */
  checkedOnce: boolean
  /** транскрипт прочитан и разобран */
  readable: boolean
}

/** Хвост транскрипта: столько последних строк достаточно, чтобы увидеть ход. */
const TAIL_LINES = 4000

/**
 * Разбор транскрипта: какие файлы (из `own`, уже отфильтрованных как код этой
 * сессии) правлены ПОСЛЕ последней команды проверки. Порядок — порядок строк.
 */
export function evidenceFromTranscript(transcriptPath: string | null, own: Set<string>, toRel: (abs: string) => string | null): EvidenceState {
  const none: EvidenceState = { uncheckedFiles: [], checkedOnce: false, readable: false }
  if (!transcriptPath || !existsSync(transcriptPath)) return none
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return none // транскрипт занят другим процессом — не судим
  }
  if (lines.length > TAIL_LINES) lines = lines.slice(-TAIL_LINES)
  const unchecked = new Set<string>()
  let checkedOnce = false
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue
    let obj: { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue // обрезанная строка (сессия пишет прямо сейчас) — пропускаем
    }
    if (obj.type !== 'assistant' || !Array.isArray(obj.message?.content)) continue
    for (const c of obj.message?.content ?? []) {
      if (c.type !== 'tool_use' || !c.name) continue
      if (SHELL_TOOLS.has(c.name)) {
        const cmd = String(c.input?.command ?? '')
        if (isCheckCommand(cmd)) {
          unchecked.clear()
          checkedOnce = true
        }
        continue
      }
      if (EDIT_TOOLS.has(c.name)) {
        const abs = String(c.input?.file_path ?? c.input?.notebook_path ?? '')
        const rel = abs ? toRel(abs) : null
        if (rel && own.has(rel)) unchecked.add(rel)
      }
    }
  }
  return { uncheckedFiles: [...unchecked], checkedOnce, readable: true }
}

/** Исход прогона: упал, прошёл или по выводу не понять. */
export type RunVerdict = 'red' | 'green' | 'unknown'

// Вердикт читается по ФОРМЕ вывода раннера, а не по коду возврата. Признак
// ошибки у результата инструмента здесь бесполезен: команду проверки почти
// всегда пускают через конвейер (`bun test 2>&1 | tail -5`), и код возврата
// принадлежит `tail`. Замер на собственных транскриптах: из шести прогонов
// подряд, включая упавший («949 pass 1 fail»), признак ошибки не стоял ни у
// одного. Формы — кросс-раннер, и у них два сорта. СВОДКА прогона несёт счёт
// («12 pass», «1 failed», шапки phpunit/cargo) — она говорит об исходе набора.
// ПОШТУЧНАЯ строка называет один тест или пакет (`(fail) имя`, `--- FAIL:`,
// `ok  pkg`) — у Go, например, сводок нет вовсе. Число перед словом обязательно:
// иначе красным читалось бы имя теста «fail-open молчание» в списке ПРОШЕДШИХ.
const SUMMARY_RED = /\b[1-9]\d*\s+(fail|failed|failing|failures?)\b|\bFAILURES!|\bERRORS!|test result: FAILED|\bFailed:\s*[1-9]/
const SUMMARY_GREEN = /\b0\s+(fail|failed|failures)\b|\b\d+\s+(pass|passed|passing)\b|\bOK \(\d+ tests?|test result: ok|\bPassed!/
const ITEM_RED = /^\s*\(fail\)|^\s*(---\s+)?FAIL\b|^\s*FAILED\b|^not ok\b/
const ITEM_GREEN = /^ok\s+\S+|^\s*PASS\b/
// Ошибки линтера и компилятора: красное, но не упавшие тесты
const OTHER_RED = /\b[1-9]\d*\s+errors?\b|\berror TS\d+/
// Строка о ПРОШЕДШЕМ тесте: её хвост — имя теста, а в имени может стоять что
// угодно («отбивает 2 errors подряд») — счёт в ней не ищем
const PASSED_ITEM = /^\s*(\(pass\)|✓|✔|√|ok\b|PASS\b)/

/**
 * Исход тестов в выводе. Решает ПОСЛЕДНЯЯ сводка, а не «красное сильнее»:
 * мутационная проба — нарочно сломать код, увидеть упавший тест, вернуть,
 * увидеть зелёный — идёт одной командой, и её вывод несёт обе сводки. Читать
 * его красным значило бы объявлять упавшей проверку, которая как раз доказала,
 * что тест ловит дефект (найдено симуляцией на собственных коммитах). Внутри
 * одной строки ненулевой счёт провалов сильнее счёта прошедших («1 failed |
 * 295 passed»). Сводок нет — судим по поштучным строкам, и там красное сильнее:
 * у Go упавший пакет стоит выше прошедшего.
 */
function testVerdict(output: string): RunVerdict {
  let summary: RunVerdict = 'unknown'
  let itemRed = false
  let itemGreen = false
  for (const line of output.split('\n')) {
    if (ITEM_RED.test(line)) itemRed = true
    else if (ITEM_GREEN.test(line)) itemGreen = true
    if (PASSED_ITEM.test(line)) continue
    if (SUMMARY_RED.test(line)) summary = 'red'
    else if (SUMMARY_GREEN.test(line)) summary = 'green'
  }
  if (summary !== 'unknown') return summary
  return itemRed ? 'red' : itemGreen ? 'green' : 'unknown'
}

// Упали именно ТЕСТЫ — уже, чем «красное»: без ошибок линтера и компилятора.
// Линтер, ругнувшийся на сам тест-файл, законно чинится правкой теста, и
// считать такую правку подгонкой значило бы обвинять за уборку.
/** Упал ли в этом выводе хотя бы один тест (а не линтер и не тайпчек). */
export const testsFailed = (output: string): boolean => testVerdict(output) === 'red'

/**
 * Вердикт прогона по его выводу: упавшие тесты или ошибки линтера/компилятора —
 * красное. Молчаливый успех (`tsc` без вывода) честно остаётся неизвестным —
 * додумывать исход здесь нельзя, на нём стоит утверждение «тест подогнали под
 * код».
 */
export function verdictOf(output: string): RunVerdict {
  const tests = testVerdict(output)
  if (tests === 'red') return 'red'
  if (output.split('\n').some((l) => !PASSED_ITEM.test(l) && OTHER_RED.test(l))) return 'red'
  return tests
}

/** Текст результата инструмента: строка или массив блоков `{type:'text'}`. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((c) => String((c as { text?: unknown }).text ?? '')).join('\n')
}

// Команда оболочки, меняющая файлы мимо инструментов правки: подмена на месте,
// перенаправление в файл, откат из git, наложение патча. Правок через Bash
// PostToolUse не видит, и между прогонами они выглядели бы как «код не менялся».
const MUTATING_SHELL =
  /\bsed\s+(-\w+\s+)*-\w*i|\bperl\s+-\w*i|(^|[^<>&\d-])>{1,2}\s*[\w./"'$~-]|\btee\s|\bgit\s+(checkout|restore|stash|apply|revert|reset|merge|rebase|cherry-pick|pull)\b|\b(patch|mv|cp|rm)\s|\b(Set-Content|Add-Content|Out-File|Move-Item|Copy-Item|Remove-Item)\b/i

export interface RedGreenEpisode {
  /** файлы, правленные между упавшими тестами и следующим зелёным прогоном, в порядке правок */
  edited: string[]
  /**
   * Строки, которые эти правки СНЯЛИ, по файлам (без пробелов по краям); null —
   * файл переписан целиком, построчно сказать нельзя. Нужны, чтобы отличить
   * правку существовавшего теста от доводки своего же нового случая в старом
   * файле: файл один, а строки — чьи?
   */
  removed: Map<string, string[] | null>
}

/** Столько снятых строк на файл помнит эпизод: дальше — уже не точечная правка. */
const MAX_REMOVED_LINES = 400

/** Строки, которые правка сняла: были в старом тексте, нет в новом (с учётом повторов). */
function removedBy(oldText: string, newText: string): string[] {
  const kept = new Map<string, number>()
  for (const l of newText.split('\n')) {
    const k = l.trim()
    if (k) kept.set(k, (kept.get(k) ?? 0) + 1)
  }
  const out: string[] = []
  for (const l of oldText.split('\n')) {
    const k = l.trim()
    if (!k) continue
    const left = kept.get(k) ?? 0
    if (left > 0) kept.set(k, left - 1)
    else out.push(k)
  }
  return out
}

export interface RunHistory {
  /** эпизоды «упало → правки → прошло»; без правок между прогонами эпизода нет */
  episodes: RedGreenEpisode[]
  /** файлы, рождённые этой сессией: первое касание — Write без чтения до него */
  created: Set<string>
  /** команды оболочки, удалявшие файлы: удаление идёт мимо инструментов правки, авторство берётся отсюда */
  deletions: string[]
  /** исход последней проверки с распознанным выводом (тесты, линтер, тайпчек); null — таких не было */
  lastRun: 'red' | 'green' | null
  readable: boolean
}

/** Удаление файла из оболочки — по форме команды, для обеих оболочек. */
const DELETING_SHELL = /\b(rm|unlink|rmdir|del|Remove-Item|git\s+rm)\b/i

/**
 * История прогонов: что правилось между упавшей проверкой и следующей прошедшей.
 *
 * Отдельный проход, а не поле у `evidenceFromTranscript`: тому хватает вызовов
 * инструментов, этому нужны ещё и их РЕЗУЛЬТАТЫ — вторая половина строк
 * транскрипта. Читает тот же файл, ни одного процесса.
 *
 * Эпизод, внутри которого оболочка меняла файлы (см. MUTATING_SHELL), выбрасывается
 * целиком: о нём нельзя честно сказать «код не трогали», а ложное обвинение в
 * подгонке теста дороже пропуска. Серия красных прогонов подряд — один эпизод:
 * правки копятся до первого зелёного.
 *
 * Эпизод открывают только упавшие ТЕСТЫ (см. TEST_FAILURE), а сообщение
 * владельца внутри эпизода его снимает: решение о тесте прошло через человека —
 * он видел красное или сам велел поменять ожидание, и сообщать ему об этом
 * фактом значило бы пересказывать его же слова.
 */
export function runHistory(transcriptPath: string | null, toRel: (abs: string) => string | null): RunHistory {
  const none: RunHistory = { episodes: [], created: new Set(), deletions: [], lastRun: null, readable: false }
  if (!transcriptPath || !existsSync(transcriptPath)) return none
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return none // транскрипт занят другим процессом — не судим
  }
  if (lines.length > TAIL_LINES) lines = lines.slice(-TAIL_LINES)
  const episodes: RedGreenEpisode[] = []
  const created = new Set<string>()
  const touched = new Set<string>()
  const pendingChecks = new Set<string>()
  const deletions: string[] = []
  let afterRed = false
  let murky = false
  let gap: string[] = []
  let removed = new Map<string, string[] | null>()
  let lastRun: 'red' | 'green' | null = null
  const reset = (): void => {
    afterRed = false
    murky = false
    gap = []
    removed = new Map()
  }
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"') && !line.includes('"type":"user"')) continue
    let obj: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue // обрезанная строка (сессия пишет прямо сейчас) — пропускаем
    }
    // Набранное владельцем — тот же признак, что у сбора устных правил: строка
    // content, без isMeta, не служебная. Результаты инструментов приходят массивом.
    if (obj.type === 'user' && !obj.isMeta && typeof obj.message?.content === 'string') {
      const said = obj.message.content.trim()
      if (said && !said.startsWith('<')) reset()
      continue
    }
    if (!Array.isArray(obj.message?.content)) continue
    for (const c of obj.message?.content as Array<{ type?: string; id?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown>; content?: unknown }>) {
      if (c.type === 'tool_use' && c.name && SHELL_TOOLS.has(c.name)) {
        const cmd = String(c.input?.command ?? '')
        if (isCheckCommand(cmd) && c.id) pendingChecks.add(c.id)
        if (afterRed && MUTATING_SHELL.test(cmd)) murky = true
        if (DELETING_SHELL.test(cmd)) deletions.push(cmd)
        continue
      }
      if (c.type === 'tool_use' && c.name) {
        const abs = String(c.input?.file_path ?? c.input?.notebook_path ?? '')
        const rel = abs ? toRel(abs) : null
        if (!rel) continue
        if (EDIT_TOOLS.has(c.name)) {
          if (c.name === 'Write' && !touched.has(rel)) created.add(rel)
          if (afterRed) {
            if (!gap.includes(rel)) gap.push(rel)
            // Edit и MultiEdit несут старый и новый текст — снятые строки видны;
            // Write и правка ноутбука переписывают целиком — построчно неизвестно.
            // Нет поля old_string — тоже неизвестно, а не «ничего не снято»:
            // формат транскрипта нестабилен, и пропавшее поле не должно молча
            // превращаться в оправдание
            const edits = c.name === 'MultiEdit' && Array.isArray(c.input?.edits) ? (c.input?.edits as Array<Record<string, unknown>>) : c.name === 'Edit' ? [c.input ?? {}] : null
            const before = removed.get(rel)
            if (edits === null || before === null || edits.some((e) => typeof e.old_string !== 'string')) removed.set(rel, null)
            else {
              const lost = edits.flatMap((e) => removedBy(String(e.old_string ?? ''), String(e.new_string ?? '')))
              removed.set(rel, [...(before ?? []), ...lost].slice(0, MAX_REMOVED_LINES))
            }
          }
        }
        if (EDIT_TOOLS.has(c.name) || c.name === 'Read') touched.add(rel)
        continue
      }
      if (c.type !== 'tool_result' || !c.tool_use_id || !pendingChecks.has(c.tool_use_id)) continue
      pendingChecks.delete(c.tool_use_id)
      const output = resultText(c.content)
      const verdict = verdictOf(output)
      if (verdict !== 'unknown') lastRun = verdict
      if (verdict === 'red') {
        // Серия красных — один эпизод, правки копятся. Открывают его только
        // упавшие тесты; красный линтер внутри уже открытого эпизода его не рвёт
        if (testsFailed(output)) afterRed = true
      } else if (verdict === 'green') {
        if (afterRed && gap.length > 0 && !murky) episodes.push({ edited: gap, removed })
        reset()
      }
    }
  }
  return { episodes, created, deletions, lastRun, readable: true }
}

/** Инструменты разведки: чтение и поиск, без записи. */
const SEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
const SEARCH_BASH = /\b(grep|rg|find|ls|cat|head|tail|sed\s+-n|git\s+(log|show|grep|blame))\b/

export interface SearchChurn {
  /** шагов разведки подряд без правки и без новой задачи от владельца */
  steps: number
  /** файлы проекта, которые при этом читались (сид для делегирования) */
  files: string[]
}

/**
 * Разведка без правки: сколько подряд шагов модель ищет и читает, ничего не
 * меняя. Длинная серия — признак того, что задача шире одного окна: её дешевле
 * раздать сабагентам с готовым сидом, чем тянуть всё в один контекст. Серия
 * рвётся правкой (модель нашла, что искала) и новым сообщением владельца
 * (новая задача). Сигнал — из того же транскрипта, что и доказательства.
 */
export function searchChurn(transcriptPath: string | null, toRel: (abs: string) => string | null): SearchChurn {
  const none: SearchChurn = { steps: 0, files: [] }
  if (!transcriptPath || !existsSync(transcriptPath)) return none
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return none
  }
  if (lines.length > TAIL_LINES) lines = lines.slice(-TAIL_LINES)
  let steps = 0
  const files = new Set<string>()
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"type":"user"')) continue
    let obj: { type?: string; message?: { content?: unknown } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type === 'user') {
      // Текст владельца (не результат инструмента) — новая задача, серия обнуляется
      const c = obj.message?.content
      const isText = typeof c === 'string' || (Array.isArray(c) && c.some((x) => (x as { type?: string }).type === 'text'))
      if (isText) {
        steps = 0
        files.clear()
      }
      continue
    }
    if (obj.type !== 'assistant' || !Array.isArray(obj.message?.content)) continue
    for (const c of obj.message?.content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
      if (c.type !== 'tool_use' || !c.name) continue
      if (EDIT_TOOLS.has(c.name)) {
        steps = 0
        files.clear()
      } else if (SEARCH_TOOLS.has(c.name) || (c.name === 'Bash' && SEARCH_BASH.test(String(c.input?.command ?? '')))) {
        steps++
        const abs = String(c.input?.file_path ?? '')
        const rel = abs ? toRel(abs) : null
        if (rel) files.add(rel)
      }
    }
  }
  return { steps, files: [...files].slice(0, 8) }
}
