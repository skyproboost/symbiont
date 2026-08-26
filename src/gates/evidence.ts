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

export const isCheckCommand = (command: string): boolean => CHECK_COMMAND.test(command)

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
      if (c.name === 'Bash') {
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
