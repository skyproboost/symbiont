/**
 * Сухой прогон стража ссылок на собственных транскриптах: что он сказал бы об
 * ответах уже прошедших сессий. Тот же довод, что у `test-guard-sim.ts`: канал
 * без замера не появляется, а ложное «такого файла нет» дороже пропуска —
 * точность смотрится глазами на своих же сессиях ДО выката.
 *
 * По умолчанию судится последний текст ассистента перед каждым сообщением
 * владельца (то, что на Stop приходит как `last_assistant_message`); с `--all` —
 * каждый текст ассистента: срабатываний на итоговых ответах слишком мало для
 * разметки, а верность разбора ссылки от места текста в ходе не зависит.
 * «Виденное сессией» копится по ходу транскрипта: вызовы инструментов, их вывод,
 * слова владельца, подача хуков.
 *
 * Диска прошлых сессий уже нет, отсюда две оговорки. Файл, существовавший тогда
 * и удалённый после, находится только через «виденное». Номер строки сверяется,
 * лишь если файл не менялся с момента ответа (mtime раньше ответа) — иначе его
 * тогдашняя длина неизвестна.
 *
 * Запуск: bun run scripts/ref-guard-sim.ts [каталог транскриптов] [--all] [--out файл.jsonl]
 * Пишет только в --out; никуда не отправляет.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { transcriptLines } from '../src/core/transcript'
import { isSecretCarrier } from '../src/env/config-graph'
import { extractRefs, judgeRefs, normalizePath, occursAsPath, type RefWorld } from '../src/verifiers/answer-refs'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const OUT = outAt >= 0 ? args[outAt + 1] : null
const ALL = args.includes('--all')
// Значение `--out` каталогом не считается; без `--out` пропускать нечего (иначе выпадал бы первый аргумент)
const ROOT = args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? join(homedir(), '.claude', 'projects')
const MIN_BYTES = 20_000

interface Flag {
  session: string
  at: string
  final: boolean
  problem: string
  raw: string
  lines?: number
  context: string
}

/** Все строки значения рекурсивно: путь лежит и в file_path, и в command, и в глубине вывода. */
function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
}

const tally = { sessions: 0, answers: 0, answersWithRefs: 0, refs: 0, missing: 0, line: 0, lineRefs: 0, lineChecked: 0, bare: 0, bareUnseen: 0 }
const BARE = args.includes('--bare')
/** Строгий режим: свои же вызовы инструментов «виденным» не считаются — только их вывод, слова владельца и подача. */
const STRICT = args.includes('--strict')
/** Имя файла без каталога в обратных кавычках — пробный класс: в страж не входит, пока не измерен. */
const BARE_RE = /`([\p{L}\p{N}_.@+~-]+\.[A-Za-z][A-Za-z0-9]{1,5})`/gu
const flags: Flag[] = []

for (const proj of readdirSync(ROOT)) {
  const dir = join(ROOT, proj)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(dir, name)
    if (statSync(path).size < MIN_BYTES) continue
    tally.sessions++
    /** Всё, что сессия видела к этому моменту, — приведённым текстом, кусками по мере чтения. */
    const seenText: string[] = []
    let cwd = ''
    let last: { text: string; at: string } | null = null

    const world = (answeredAt: number): RefWorld => ({
      seen: (ref) => seenText.some((chunk) => occursAsPath(chunk, ref)),
      resolve: (ref) => {
        const rel = ref.replace(/^~\//, homedir().replaceAll('\\', '/') + '/')
        if (isAbsolute(rel) || /^[A-Za-z]:\//.test(rel)) return existsSync(rel) ? rel : null
        // Git Bash пишет диск как /d/…: это тот же абсолютный путь
        const drive = /^\/([A-Za-z])\/(.*)$/.exec(rel)
        if (drive) return existsSync(`${drive[1]}:/${drive[2]}`) ? `${drive[1]}:/${drive[2]}` : null
        for (const root of cwd ? [cwd, dirname(cwd)] : []) if (existsSync(join(root, rel))) return join(root, rel)
        return null
      },
      lines: (resolved) => {
        try {
          // «Не открывается ни одним проходом» — значит и замером: ссылка на файл ключа не повод его читать
          if (isSecretCarrier(resolved.replaceAll('\\', '/'))) return null
          const st = statSync(resolved)
          if (!st.isFile() || st.size > 2_000_000 || st.mtimeMs >= answeredAt) return null
          return readFileSync(resolved, 'utf8').split('\n').length
        } catch {
          return null
        }
      },
    })

    const judge = (answer: { text: string; at: string }, final: boolean): void => {
      tally.answers++
      const refs = extractRefs(answer.text)
      if (refs.length > 0) tally.answersWithRefs++
      tally.refs += refs.length
      const w = world(Date.parse(answer.at) || Date.now())
      for (const r of refs) {
        if (r.line === null) continue
        tally.lineRefs++
        const at = w.resolve(r.path)
        if (at !== null && w.lines(at) !== null) tally.lineChecked++
      }
      if (BARE && !/^\s*[[{]/.test(answer.text)) {
        for (const m of answer.text.matchAll(BARE_RE)) {
          tally.bare++
          if (w.seen(normalizePath(m[1])) || w.resolve(m[1]) !== null) continue
          tally.bareUnseen++
          flags.push({ session: `${proj}/${name}`, at: answer.at, final, problem: 'bare', raw: m[1], context: answer.text.slice(Math.max(0, m.index - 160), m.index + m[1].length + 120).replace(/\s+/g, ' ') })
        }
      }
      for (const f of judgeRefs(refs, w)) {
        tally[f.problem]++
        const i = answer.text.indexOf(f.ref.raw)
        flags.push({
          session: `${proj}/${name}`,
          at: answer.at,
          final,
          problem: f.problem,
          raw: f.ref.raw,
          lines: f.lines,
          context: answer.text.slice(Math.max(0, i - 160), i + f.ref.raw.length + 120).replace(/\s+/g, ' '),
        })
      }
    }

    for (const line of transcriptLines(readFileSync(path, 'utf8'))) {
      let obj: { type?: string; cwd?: string; isSidechain?: boolean; isMeta?: boolean; timestamp?: string; message?: { content?: unknown }; attachment?: unknown; content?: unknown }
      try {
        obj = JSON.parse(line)
      } catch {
        continue // обрезанная строка
      }
      if (obj.isSidechain) continue
      if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd.replaceAll('\\', '/')
      const content = obj.message?.content
      const texts: string[] = []

      if (obj.type === 'assistant' && Array.isArray(content)) {
        for (const c of content as Array<{ type?: string; text?: string; input?: unknown }>) {
          if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            if (ALL && last) judge(last, false)
            last = { text: c.text, at: obj.timestamp ?? '' }
          } else if (c.type === 'tool_use' && !STRICT) strings(c.input, texts)
        }
      } else if (obj.type === 'user') {
        const blocks = Array.isArray(content) ? (content as Array<{ type?: string }>) : []
        const typed = typeof content === 'string' || (blocks.some((c) => c.type === 'text') && !blocks.some((c) => c.type === 'tool_result'))
        // Сообщение владельца закрывает ход: ответ судится по тому, что сессия видела ДО него
        if (typed && !obj.isMeta && last) {
          judge(last, true)
          last = null
        }
        strings(content, texts)
      } else {
        strings(obj.attachment ?? obj.content ?? null, texts)
      }
      for (const t of texts) if (t.length > 3) seenText.push(normalizePath(t))
    }
    if (last) judge(last, true)
  }
}

console.log(`сессий ${tally.sessions} · ответов ${tally.answers}${ALL ? ' (все тексты)' : ' (итоговые)'} · из них со ссылками ${tally.answersWithRefs} · ссылок ${tally.refs}`)
console.log(`ссылок со строкой ${tally.lineRefs} · из них удалось сверить ${tally.lineChecked}${BARE ? ` · имён без каталога ${tally.bare}, не встречались ${tally.bareUnseen}` : ''}`)
console.log(`срабатываний: нет такого пути ${tally.missing} · строка за концом файла ${tally.line} · доля ссылок с находкой ${tally.refs ? (((tally.missing + tally.line) / tally.refs) * 100).toFixed(2) : 0}%`)
if (OUT) {
  writeFileSync(OUT, flags.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8')
  console.log(`находки записаны: ${OUT} (${flags.length})`)
}
