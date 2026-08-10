/**
 * Канарейка: сквозной смок всех каналов Symbiont реальными процессами.
 *
 * Разворачивает эталонный мир во временном каталоге и прогоняет каждый
 * хук-вход так, как его зовёт Claude Code (отдельный процесс, JSON в stdin) —
 * проверяя контракт: валидный JSON-ответ, ожидаемое содержимое, heartbeat.
 * Запуск: bun run scripts/canary.ts — руками после обновления Claude Code/bun
 * или по расписанию. Ненулевой exit = канал сломан (грех — молчание, не поломка).
 */
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '..')
// --dist: те же 9 проверок против СОБРАННОЙ формы (plugin/dist) — то, что реально
// устанавливается; без флага — против исходников (dev-цикл).
const DIST = process.argv.includes('--dist')
// --node: тот же прогон рантаймом поставки. Манифесты артефакта зовут node, и
// «работает под bun» ничего не говорит о том, что увидит владелец. Исходники
// под node не бегут (это .ts), поэтому флаг имеет смысл только с --dist.
const RUNNER = process.argv.includes('--node') ? 'node' : 'bun'
if (RUNNER === 'node' && !DIST) {
  console.error('✗ --node работает только вместе с --dist: node не исполняет .ts исходники')
  process.exit(1)
}
const entryPath = (kind: 'hooks' | 'mcp', entry: string): string =>
  DIST ? join(ROOT, 'plugin', 'dist', entry.replace(/\.ts$/, '.js')) : join(ROOT, 'src', kind, entry)
const results: Array<{ channel: string; ok: boolean; note: string }> = []
const check = (channel: string, ok: boolean, note: string) => results.push({ channel, ok, note })

// Эталонный мир: легаси-стиль + README с сигналами + git
const proj = mkdtempSync(join(tmpdir(), 'symbiont-canary-'))
const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-canary-data-'))
const LEGACY = 'function f(_oX) {\n\tvar sName = _oX.n;\n\tvar aList = [];\n\tfor (var i = 0; i < 3; i++) { aList.push(i); }\n\treturn aList;\n}\n'
for (let i = 0; i < 12; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
writeFileSync(join(proj, 'core.js'), LEGACY.repeat(12))
writeFileSync(join(proj, 'README.md'), 'Сервис: производительность важна.')
spawnSync('git', ['init', '-b', 'main'], { cwd: proj, encoding: 'utf8' })

/**
 * Язык подачи задаётся ЯВНО, а не наследуется от машины.
 *
 * Symbiont выводит язык из окружения (сообщения владельца, комментарии, доки,
 * локаль системы). У владельца она русская, у машины CI — английская, поэтому
 * проверка, прибитая к русской формулировке, красила канарейку в цвет локали
 * хоста, а не в состояние канала: локально зелено, в CI красно на том же коде.
 */
function hook(entry: string, input: unknown, lang: 'ru' | 'en' = 'ru', root: string = dataRoot): { out: Record<string, unknown> | null; raw: string } {
  const r = spawnSync(RUNNER, [entryPath('hooks', entry), '--data', root], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 60_000,
    cwd: proj,
    env: { ...process.env, SYMBIONT_LANG: lang },
  })
  const raw = (r.stdout ?? '').trim()
  if (r.status !== 0) return { out: null, raw: `exit=${r.status} stderr=${(r.stderr ?? '').slice(0, 300)}` }
  if (!raw) return { out: {}, raw: '' }
  try {
    return { out: JSON.parse(raw.split('\n')[0]) as Record<string, unknown>, raw }
  } catch {
    return { out: null, raw: `не-JSON: ${raw.slice(0, 200)}` }
  }
}

const slug = (await import(join(ROOT, 'src', 'hooks', 'session-start-core.ts'))).slugOf(proj)
const dataDir = join(dataRoot, slug)
const sid = 'canary-1'

// 1) SessionStart: сводка с законами и профилем — на обоих языках подачи
{
  const ctxOf = (r: { out: Record<string, unknown> | null }): string =>
    String((r.out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
  const ru = hook('session-start.ts', { cwd: proj, source: 'startup', session_id: sid }, 'ru')
  // Английская проба — в СВОЁМ корне данных: вход в сессию отцепляет фоновую
  // работу, и два таких входа на один корень дерутся за SQLite. Гонка убивала
  // не ту проверку, которая её создала (мигали PreCompact и MCP).
  const enRoot = mkdtempSync(join(tmpdir(), 'symbiont-canary-en-'))
  const en = hook('session-start.ts', { cwd: proj, source: 'startup', session_id: `${sid}-en` }, 'en', enRoot)
  const ctxRu = ctxOf(ru)
  const ctxEn = ctxOf(en)
  const okRu = !!ru.out && ctxRu.includes('только var') && ctxRu.includes('Профиль качества')
  // Английская подача проверяется не только по наличию английских формулировок,
  // но и по ОТСУТСТВИЮ кириллицы: полупереведённая сводка (заголовки английские,
  // строки русские) проходила бы проверку на подстроку и уезжала владельцу такой.
  // Мир канарейки синтетический — своего русского текста в нём нет.
  const leak = ctxEn.split('\n').filter((l) => /[а-яё]/i.test(l))
  const okEn = !!en.out && ctxEn.includes('var only') && ctxEn.includes('Quality profile') && leak.length === 0
  const note = !ru.out ? ru.raw : !en.out ? en.raw : okEn ? `сводка ${ctxRu.length} симв. · ru+en` : `английская подача течёт: ${leak[0]?.slice(0, 90)}`
  check('SessionStart', okRu && okEn, okRu ? note : `русская подача: ${ctxRu.slice(0, 90)}`)
  try {
    rmSync(enRoot, { recursive: true, force: true })
  } catch {
    /* временный каталог приберёт ОС */
  }
}

// 2) UserPromptSubmit: JIT-срез по упомянутому файлу
{
  const { out, raw } = hook('user-prompt.ts', { cwd: proj, session_id: sid, prompt: 'посмотри core.js' })
  const ctx = String((out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
  // В ноте — то, что канал ВЕРНУЛ: «срез подан» при провале ничего не объясняет,
  // а канарейка обязана называть причину, а не только факт смерти.
  check('UserPromptSubmit', !!out && ctx.includes('core.js'), out ? (ctx ? `срез подан: ${ctx.slice(0, 140)}` : 'канал промолчал (пустой ответ)') : raw)
}

// 3) PostToolUse: мгновенный гейт на правке с нарушением
{
  writeFileSync(join(proj, 'fresh.js'), 'const a = 1\nlet b = 2\n')
  const { out, raw } = hook('post-tool.ts', {
    cwd: proj,
    session_id: sid,
    tool_name: 'Write',
    tool_input: { file_path: join(proj, 'fresh.js') },
  })
  const ctx = String((out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
  check('PostToolUse', !!out && ctx.includes('только var'), out ? 'нарушение поймано на месте' : raw)
}

// 4) PreToolUse: подача до чтения. Канал условный (только Read, только файл
// заметного размера), поэтому контракт здесь — не текст, а чистый прогон и
// пульс: в синтетическом мире канарейки ни графа связей, ни разобранной
// структуры для этого файла ещё нет, и МОЛЧАНИЕ — правильный ответ.
{
  writeFileSync(join(proj, 'big.js'), LEGACY.repeat(60))
  const { out, raw } = hook('pre-tool.ts', {
    cwd: proj,
    session_id: sid,
    tool_name: 'Read',
    tool_input: { file_path: join(proj, 'big.js') },
  })
  const beat = existsSync(join(dataDir, 'heartbeat-pretooluse.json'))
  check('PreToolUse', out !== null && beat, out === null ? raw : beat ? 'канал прошёл и оставил пульс' : 'пульса нет')
}

// 5) Stop: dry-run гейт видит второе нарушение, дедуп не повторяет первое
{
  writeFileSync(join(proj, 'fresh.js'), 'const c = items.filter((x) => x)\n')
  const { out, raw } = hook('stop.ts', { cwd: proj, session_id: sid })
  const ctx = String((out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
  check('Stop', !!out && ctx.includes('filter/map/reduce'), out ? 'dry-run сообщает фактом' : raw)
}

// 6) PreCompact: перехват перед сжатием — пульс канала (вывода не даёт)
{
  const { raw } = hook('pre-compact.ts', { cwd: proj, session_id: sid, trigger: 'auto' })
  check('PreCompact', existsSync(join(dataDir, 'heartbeat-precompact.json')), raw || 'пульс перед сжатием оставлен')
}

// 7) PostToolUseFailure: упавшая правка — канал жив и оставил пульс
// (само предложение оглавления требует индекса символов, который в мире
// канарейки может не успеть родиться, — проверяется жизнь канала, не оффер)
{
  const { raw } = hook('post-tool-failure.ts', {
    cwd: proj,
    session_id: sid,
    tool_name: 'Edit',
    tool_input: { file_path: join(proj, 'big.js') },
  })
  check('PostToolUseFailure', existsSync(join(dataDir, 'heartbeat-posttoolusefailure.json')), raw || 'канал упавшей правки пульсирует')
}

// 8) SubagentStart: срез паспорта свежему сабагенту (законы/карта)
{
  const { out, raw } = hook('subagent-start.ts', { cwd: proj, session_id: sid, agent_type: 'Explore' })
  const ctx = String((out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? '')
  // Ассерт языконезависим: заголовок среза меняется с языком владельца, карта — нет
  check('SubagentStart', !!out && ctx.includes('core.js'), out ? `срез подан: ${ctx.slice(0, 90)}` : raw)
}

// 9) SessionEnd: прощание закрывает сессию
{
  const { out, raw } = hook('session-end.ts', { cwd: proj, session_id: sid, reason: 'exit' })
  check('SessionEnd', out !== null, out !== null ? 'финализатор отработал' : raw)
}

// 10) Heartbeat всех каналов на месте
{
  const channels = ['sessionstart', 'userpromptsubmit', 'pretooluse', 'posttooluse', 'posttoolusefailure', 'stop', 'precompact', 'subagentstart', 'sessionend']
  const missing = channels.filter((c) => !existsSync(join(dataDir, `heartbeat-${c}.json`)))
  check('Heartbeat', missing.length === 0, missing.length === 0 ? `все ${channels.length} каналов пульсируют` : `молчат: ${missing.join(', ')}`)
}

// 11) MCP-сервер: initialize + tools/list по stdio
{
  const msgs =
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) +
    '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) +
    '\n'
  const r = spawnSync(RUNNER, [entryPath('mcp', 'server.ts'), '--data', dataRoot], {
    input: msgs,
    encoding: 'utf8',
    timeout: 30_000,
    cwd: proj,
  })
  const ok = (r.stdout ?? '').includes('passport_conventions')
  check('MCP', ok, ok ? 'stdio отвечает, инструменты на месте' : `stdout: ${(r.stdout ?? '').slice(0, 120)}`)
}

for (const r of results) console.log(` ${r.ok ? '✓' : '✗'} ${r.channel.padEnd(18)}${r.note}`)
const failed = results.filter((r) => !r.ok)
try {
  rmSync(proj, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
} catch {
  /* временные каталоги приберёт ОС */
}
if (failed.length > 0) {
  console.log(`\nКанарейка мертва: ${failed.map((f) => f.channel).join(', ')}`)
  process.exit(1)
}
console.log(`\nКанарейка жива: все каналы Symbiont работают сквозняком под ${RUNNER}${DIST ? ' (собранная форма plugin/dist)' : ''}.`)
