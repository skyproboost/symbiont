/**
 * Симуляция стража тестов на собственных транскриптах: что он сказал бы в уже
 * прошедших сессиях. Тот же довод, что у `prompt-sim.ts`: канал без замера не
 * появляется, а ложное обвинение в подгонке теста дороже пропуска — значит,
 * точность надо смотреть глазами на своих же сессиях ДО выката, а не после.
 *
 * Git-состояния прошлых сессий уже нет, поэтому дифф восстанавливается из самих
 * вызовов правки: `old_string` — удалённые строки, `new_string` — добавленные.
 * Это нижняя граница: правки через Write и оболочку сюда не попадают.
 *
 * Запуск: bun run scripts/test-guard-sim.ts [каталог транскриптов] [--show N]
 * Ничего не пишет и никуда не отправляет.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runHistory } from '../src/gates/evidence'
import { guardTests, type TestFinding } from '../src/verifiers/test-guard'
import { isTestPath } from '../src/passport/signals'

const args = process.argv.slice(2)
const showAt = args.indexOf('--show')
const SHOW = showAt >= 0 ? Number(args[showAt + 1]) : 12
const ROOT = args.find((a, i) => !a.startsWith('--') && i !== showAt + 1) ?? join(homedir(), '.claude', 'projects')
const MIN_BYTES = 20_000

const norm = (p: string): string => p.replaceAll('\\', '/')

/**
 * Псевдо-диффы тест-файлов сессии из вызовов Edit/MultiEdit — приближение диффа
 * против базы сессии. Строка, которую сессия сама добавила, а следующей правкой
 * сняла, в базе не существовала: она гасится, а не выходит удалённой, — иначе
 * доводка своего нового случая выглядела бы правкой старого теста.
 */
function pseudoDiffs(path: string, toRel: (abs: string) => string | null): Map<string, string> {
  const out = new Map<string, string>()
  const addedHere = new Map<string, Map<string, number>>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"tool_use"')) continue
    let obj: { message?: { content?: unknown } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue // обрезанная строка
    }
    if (!Array.isArray(obj.message?.content)) continue
    for (const c of obj.message?.content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
      if (c.type !== 'tool_use' || (c.name !== 'Edit' && c.name !== 'MultiEdit')) continue
      const rel = toRel(String(c.input?.file_path ?? ''))
      if (!rel || !isTestPath(rel)) continue
      const edits = c.name === 'MultiEdit' && Array.isArray(c.input?.edits) ? (c.input?.edits as Array<Record<string, unknown>>) : [c.input ?? {}]
      const mine = addedHere.get(rel) ?? new Map<string, number>()
      addedHere.set(rel, mine)
      for (const e of edits) {
        const oldLines = String(e.old_string ?? '').split('\n')
        const newLines = String(e.new_string ?? '').split('\n')
        // Контекст правки (строки, общие для старого и нового текста) — не изменение
        const kept = new Map<string, number>()
        for (const l of newLines) kept.set(l.trim(), (kept.get(l.trim()) ?? 0) + 1)
        const minus: string[] = []
        for (const l of oldLines) {
          const k = l.trim()
          if ((kept.get(k) ?? 0) > 0) kept.set(k, kept.get(k)! - 1)
          else if ((mine.get(k) ?? 0) > 0) mine.set(k, mine.get(k)! - 1)
          else minus.push('-' + l)
        }
        const stays = new Map<string, number>()
        for (const l of oldLines) stays.set(l.trim(), (stays.get(l.trim()) ?? 0) + 1)
        const plus: string[] = []
        for (const l of newLines) {
          const k = l.trim()
          if ((stays.get(k) ?? 0) > 0) stays.set(k, stays.get(k)! - 1)
          else {
            mine.set(k, (mine.get(k) ?? 0) + 1)
            plus.push('+' + l)
          }
        }
        out.set(rel, [out.get(rel) ?? '', ...minus, ...plus].join('\n'))
      }
    }
  }
  return out
}

let sessions = 0
let fired = 0
const byKind = new Map<string, number>()
const samples: Array<{ where: string; f: TestFinding }> = []

for (const proj of readdirSync(ROOT)) {
  const dir = join(ROOT, proj)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(dir, name)
    if (statSync(path).size < MIN_BYTES) continue
    let cwd = ''
    for (const line of readFileSync(path, 'utf8').split('\n', 40)) {
      const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
      if (m) {
        cwd = norm(JSON.parse(`"${m[1]}"`) as string).replace(/\/$/, '')
        break
      }
    }
    if (!cwd) continue
    const toRel = (abs: string): string | null => {
      const a = norm(abs)
      return a.toLowerCase().startsWith(cwd.toLowerCase() + '/') ? a.slice(cwd.length + 1) : null
    }
    const history = runHistory(path, toRel)
    const diffs = pseudoDiffs(path, toRel)
    if (diffs.size === 0) continue
    sessions++
    const existing = new Map<string, string>()
    const fresh = new Map<string, string>()
    for (const [rel, diff] of diffs) (history.created.has(rel) ? fresh : existing).set(rel, diff)
    const findings = guardTests({ existing, fresh, deleted: [], history })
    if (findings.length > 0) fired++
    for (const f of findings) {
      byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
      samples.push({ where: `${proj.slice(-24)}/${name.slice(0, 8)}`, f })
    }
  }
}

console.log(`сессий с правкой тестов: ${sessions} · страж сказал бы слово в ${fired} (${sessions > 0 ? Math.round((fired / sessions) * 100) : 0}%)`)
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${kind.padEnd(12)} ${n}`)
console.log(`\nвыборка (${Math.min(SHOW, samples.length)} из ${samples.length}) — смотреть глазами на ложные срабатывания:`)
for (const s of samples.slice(0, SHOW)) console.log(`  ${s.where} · ${s.f.kind} · ${s.f.file} · ${s.f.detail}`)
