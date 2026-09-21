/**
 * Симуляция гейта момента коммита на собственных транскриптах: в каком
 * состоянии доказательств реально делались коммиты. Это и базовая линия ДО
 * выката, и способ увидеть сдвиг ПОСЛЕ: тот же скрипт на новых сессиях покажет,
 * стало ли коммитов «на красном» и «без прогона» меньше.
 *
 * Состояние считается теми же функциями, что у гейта (`isCheckCommand`,
 * `verdictOf`, `isCommitCommand`), только в одном проходе по всему транскрипту:
 * гейт видит состояние на момент коммита, а прошлые моменты надо восстановить.
 *
 * Запуск: bun run scripts/commit-gate-sim.ts [каталог транскриптов]
 * Ничего не пишет и никуда не отправляет.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isCheckCommand, verdictOf } from '../src/gates/evidence'
import { isCommitCommand } from '../src/hooks/commit-core'
import { isTestPath } from '../src/passport/signals'
import { CODE_EXT } from '../src/miner/walk'

const ROOT = process.argv[2] ?? join(homedir(), '.claude', 'projects')
const MIN_BYTES = 20_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

const isCode = (file: string): boolean => {
  const dot = file.lastIndexOf('.')
  return dot >= 0 && CODE_EXT.has(file.slice(dot).toLowerCase())
}

const tally = { commits: 0, withCode: 0, clean: 0, editedAfterCheck: 0, lastRed: 0, neverChecked: 0 }

for (const proj of readdirSync(ROOT)) {
  const dir = join(ROOT, proj)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(dir, name)
    if (statSync(path).size < MIN_BYTES) continue
    const pending = new Set<string>()
    let codeSinceCommit = false
    let codeSinceCheck = false
    let checkedSinceCommit = false
    let lastRun: 'red' | 'green' | null = null
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue
      let obj: { message?: { content?: unknown } }
      try {
        obj = JSON.parse(line)
      } catch {
        continue // обрезанная строка
      }
      if (!Array.isArray(obj.message?.content)) continue
      for (const c of obj.message?.content as Array<{ type?: string; id?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown>; content?: unknown }>) {
        if (c.type === 'tool_use' && c.name && SHELL_TOOLS.has(c.name)) {
          const cmd = String(c.input?.command ?? '')
          if (isCommitCommand(cmd)) {
            tally.commits++
            if (codeSinceCommit) {
              tally.withCode++
              // Порядок тот же, что у гейта: сначала «правка после проверки», затем «последняя красная»
              if (!checkedSinceCommit) tally.neverChecked++
              else if (codeSinceCheck) tally.editedAfterCheck++
              else if (lastRun === 'red') tally.lastRed++
              else tally.clean++
            }
            codeSinceCommit = false
            checkedSinceCommit = false
          } else if (isCheckCommand(cmd)) {
            if (c.id) pending.add(c.id)
            codeSinceCheck = false
            checkedSinceCommit = true
          }
        } else if (c.type === 'tool_use' && c.name && EDIT_TOOLS.has(c.name)) {
          const file = String(c.input?.file_path ?? '').replaceAll('\\', '/')
          if (!isCode(file) || isTestPath(file)) continue
          codeSinceCommit = true
          codeSinceCheck = true
        } else if (c.type === 'tool_result' && c.tool_use_id && pending.has(c.tool_use_id)) {
          const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '')
          const verdict = verdictOf(text)
          if (verdict !== 'unknown') lastRun = verdict
        }
      }
    }
  }
}

const pct = (n: number): string => (tally.withCode > 0 ? `${Math.round((n / tally.withCode) * 100)}%` : '—')
console.log(`коммитов в транскриптах: ${tally.commits} · из них с правкой кода этой сессией: ${tally.withCode}`)
console.log(`  проверка после последней правки, не красная   ${tally.clean} (${pct(tally.clean)}) — гейт молчит`)
console.log(`  правка кода после последней проверки           ${tally.editedAfterCheck} (${pct(tally.editedAfterCheck)}) — гейт называет`)
console.log(`  последняя проверка упала                       ${tally.lastRed} (${pct(tally.lastRed)}) — гейт называет`)
console.log(`  проверка между правкой и коммитом не запускалась ${tally.neverChecked} (${pct(tally.neverChecked)}) — гейт называет там, где в проекте есть тесты`)
