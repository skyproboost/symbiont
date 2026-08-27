/**
 * Замер каналов подачи «промпт → файлы» на собственных транскриптах проекта.
 *
 * Вопрос, на который отвечает: если по тексту промпта предложить файлы, попадут
 * ли они в то, что модель ПОТОМ правила? Истина — правки той же сессии после
 * промпта (та же логика, что у markUsed). Бейзлайны честные: случайные файлы и
 * «три хаба» — последние уже стоят в сводке, и канал, который их не бьёт, не
 * нужен. Так был отклонён лексический канал по описаниям ролей модулей и по
 * похожим прошлым промптам (память сессий как у «шин памяти»): 2–11%
 * точности против 8% у хабов и 21% у канала «названный файл/символ».
 *
 * Транскрипты берутся из журнала сессий (sessions.transcript_path) — ничего не
 * выводится из путей Claude Code. Запуск: bun run scripts/prompt-sim.ts [--data <корень>]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Database } from '../src/core/db'
import { resolveDataRoot } from '../src/core/data-root'
import { slugOf } from '../src/hooks/session-start-core'
import { promptTokens } from '../src/hooks/user-prompt-core'

interface Sample {
  prompt: string
  later: Set<string>
  sid: string
}

const root = process.cwd()
const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '.data')).root, slugOf(root))
const dbPath = join(dataDir, 'passport.db')
if (!existsSync(dbPath)) {
  console.log(`паспорта нет: ${dbPath}`)
  process.exit(0)
}
const db: Database = openDb(dbPath, { readonly: true })
const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name))
for (const need of ['graph_nodes', 'symbols', 'sessions']) {
  if (!tables.has(need)) {
    console.log(`в паспорте нет таблицы ${need}: ${dbPath} — укажи корень данных плагина через --data`)
    process.exit(0)
  }
}
const nodes = db.query('SELECT file, in_deg FROM graph_nodes').all() as Array<{ file: string; in_deg: number }>
const nodeSet = new Set(nodes.map((n) => n.file))
const symIdx = new Map<string, Set<string>>()
for (const r of db.query('SELECT lower(name) lname, file FROM symbols').all() as Array<{ lname: string; file: string }>) {
  if (!symIdx.has(r.lname)) symIdx.set(r.lname, new Set())
  symIdx.get(r.lname)!.add(r.file)
}
let transcripts: Array<{ session_id: string; transcript_path: string }> = []
try {
  transcripts = (db.query('SELECT session_id, transcript_path FROM sessions WHERE transcript_path IS NOT NULL').all() as typeof transcripts).filter((s) => existsSync(s.transcript_path))
} catch {
  // журнал старой формы (без пути транскрипта) — мерить не на чем, и это не ошибка
  console.log(`журнал сессий без путей транскриптов: ${dbPath} — укажи корень данных плагина через --data`)
  process.exit(0)
}

/** Абсолютный путь → относительный узел графа; чужие пути — null. */
const norm = (p: string): string => p.replaceAll('\\', '/').toLowerCase()
const rootNorm = norm(root).replace(/\/$/, '') + '/'
const toRel = (abs: string): string | null => {
  const n = norm(abs)
  if (!n.startsWith(rootNorm)) return null
  const rel = abs.replaceAll('\\', '/').slice(rootNorm.length)
  return nodeSet.has(rel) ? rel : null
}

const samples: Sample[] = []
for (const s of transcripts) {
  let cur: Sample | null = null
  for (const line of readFileSync(s.transcript_path, 'utf8').split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('"tool_use"')) continue
    let o: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o.type === 'user') {
      const c = o.message?.content
      if (typeof c !== 'string' || o.isMeta || c.startsWith('<') || c.length < 20) continue
      cur = { prompt: c, later: new Set(), sid: s.session_id }
      samples.push(cur)
    } else if (o.type === 'assistant' && cur && Array.isArray(o.message?.content)) {
      for (const c of o.message.content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
        if (c.type !== 'tool_use' || !['Edit', 'Write', 'MultiEdit'].includes(c.name ?? '')) continue
        const rel = toRel(String(c.input?.file_path ?? ''))
        if (rel) cur.later.add(rel)
      }
    }
  }
}
const set = samples.filter((s) => s.later.size > 0)
console.log(`сессий с транскриптом: ${transcripts.length} · промптов владельца: ${samples.length} · с правками после: ${set.length}`)
if (set.length === 0) process.exit(0)

/** Канал «названный файл/символ» — тот же принцип, что в user-prompt-core. */
function current(prompt: string): string[] {
  const ts = new Set(promptTokens(prompt))
  const base = (f: string): string => f.slice(f.lastIndexOf('/') + 1).toLowerCase()
  const out = nodes.filter((n) => ts.has(base(n.file)) || ts.has(base(n.file).replace(/\.[a-z]+$/, ''))).map((n) => n.file).slice(0, 3)
  for (const tkn of ts) {
    const fs = symIdx.get(tkn)
    if (fs && fs.size <= 2) for (const f of fs) if (!out.includes(f) && out.length < 7) out.push(f)
  }
  return out
}
const hubs = [...nodes].sort((a, b) => b.in_deg - a.in_deg).slice(0, 3).map((n) => n.file)
const all = [...nodeSet]
const rnd = (): string[] => [0, 1, 2].map(() => all[Math.floor(Math.random() * all.length)])

function report(name: string, pick: (s: Sample) => string[]): void {
  let fired = 0
  let hit = 0
  let sugg = 0
  let right = 0
  for (const s of set) {
    const files = pick(s)
    if (files.length === 0) continue
    fired++
    sugg += files.length
    const r = files.filter((f) => s.later.has(f)).length
    right += r
    if (r > 0) hit++
  }
  const pct = (a: number, b: number): string => (b ? ((100 * a) / b).toFixed(0) : '0')
  console.log(`${name.padEnd(26)} сработал ${fired}/${set.length} (${pct(fired, set.length)}%) · попал ${hit}/${fired} (${pct(hit, fired)}%) · точность ${right}/${sugg} (${pct(right, sugg)}%)`)
}
report('случайные-3', rnd)
report('хабы-3', () => hubs)
report('файл/символ (текущий)', (s) => current(s.prompt))
db.close()
