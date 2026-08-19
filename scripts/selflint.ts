/**
 * Структурный само-линт: проверяет ВНУТРЕННЮЮ консистентность плагина (не
 * поведение — это канарейка, а структуру). Идея — validate.py из тулкита
 * тестировщика, приложенная к Symbiont: грех не поломка, а молчание, поэтому
 * структурная рассинхронизация должна падать красным, а не ждать первого сбоя.
 *
 * Ловит: битые ссылки hooks.json/.mcp.json/скиллов на файлы; скиллы без
 * frontmatter; MCP-инструменты без валидной схемы; рассинхрон единого источника
 * сигналов (stack/profile должны брать сигналы из signals.ts, а не своими
 * регэкспами — прошлая находка аудита). Запуск: bun run scripts/selflint.ts.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
// --after-build: прогон ПОСЛЕ пересборки артефакта в этом же процессе-конвейере
// (шаги CI). Меняет ровно одну проверку — доставку по git, см. её комментарий.
const AFTER_BUILD = process.argv.includes('--after-build')
const results: Array<{ check: string; ok: boolean; note: string }> = []
const check = (c: string, ok: boolean, note: string): void => {
  results.push({ check: c, ok, note })
}
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

// 1) hooks.json → все командные файлы существуют
try {
  const hooks = JSON.parse(read('hooks/hooks.json')) as { hooks: Record<string, Array<{ hooks: Array<{ args?: string[] }> }>> }
  const missing: string[] = []
  for (const arr of Object.values(hooks.hooks)) {
    for (const m of arr) {
      for (const h of m.hooks) {
        const scriptArg = (h.args ?? []).find((a) => a.includes('/src/') && a.endsWith('.ts'))
        if (!scriptArg) continue
        const rel = scriptArg.replace('${CLAUDE_PLUGIN_ROOT}/', '')
        if (!existsSync(join(ROOT, rel))) missing.push(rel)
      }
    }
  }
  check('hooks.json → файлы', missing.length === 0, missing.length ? `нет: ${missing.join(', ')}` : 'все хук-входы на месте')
} catch (e) {
  check('hooks.json → файлы', false, String(e).slice(0, 120))
}

// 2) .mcp.json → сервер существует
try {
  const mcp = JSON.parse(read('.mcp.json')) as { mcpServers: Record<string, { args?: string[] }> }
  const missing: string[] = []
  for (const srv of Object.values(mcp.mcpServers)) {
    const a = (srv.args ?? []).find((x) => x.endsWith('.ts'))
    if (a && !existsSync(join(ROOT, a.replace('${CLAUDE_PLUGIN_ROOT}/', '')))) missing.push(a)
  }
  check('.mcp.json → сервер', missing.length === 0, missing.length ? missing.join(', ') : 'MCP-сервер на месте')
} catch (e) {
  check('.mcp.json → сервер', false, String(e).slice(0, 120))
}

// 3) скиллы → frontmatter (name+description) + ссылка на существующий CLI
try {
  const skillsDir = join(ROOT, 'skills')
  const problems: string[] = []
  for (const name of readdirSync(skillsDir)) {
    const skillPath = join(skillsDir, name, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    const body = readFileSync(skillPath, 'utf8')
    if (!/^---[\s\S]*?\bname:\s*\S/.test(body) || !/\bdescription:\s*\S/.test(body)) problems.push(`${name}: нет frontmatter name/description`)
    // Двоеточие с пробелом внутри НЕзакавыченного скаляра — YAML видит там
    // вложенное отображение и роняет разбор ВСЕГО frontmatter. Рантайм сейчас
    // снисходителен, а официальный валидатор платформы — нет: он прямо пишет
    // «skill loads with empty metadata». Такой скилл теряет описание молча, то
    // есть перестаёт вызываться моделью, ничего об этом не сообщая. Проверка
    // добавлена после того, как валидатор нашёл это разом во ВСЕХ шести скиллах.
    // \r? — не педантизм: правка скилла редактором с виндовыми окончаниями строк
    // переводит файл в CRLF, и строгий шаблон перестаёт видеть frontmatter ЦЕЛИКОМ.
    // Проверка при этом не падает, а начинает врать: жалуется на отсутствие того,
    // что стоит в файле. Поймано ровно так — при добавлении allowed-tools.
    const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (front) {
      for (const line of front[1].split('\n')) {
        const kv = line.match(/^([\w-]+):\s*(.*)$/)
        if (!kv || /^['"]/.test(kv[2])) continue
        if (kv[2].includes(': ')) problems.push(`${name}: «${kv[1]}» ломает YAML (двоеточие с пробелом в незакавыченном значении)`)
      }
    }
    for (const m of body.matchAll(/src\/cli\/([\w-]+\.ts)/g)) {
      if (!existsSync(join(ROOT, 'src', 'cli', m[1]))) problems.push(`${name}: битая ссылка src/cli/${m[1]}`)
    }
    // Команда скилла — это запуск шелла, и Claude Code требует на него разрешения.
    // Без объявленного allowed-tools владелец получает «This command requires
    // approval» (в режиме auto — отказ классификатора) и не понимает ни почему,
    // ни что делать: наш собственный скрипт выглядит для проверки как чужой.
    // Объявление узкое — ровно свой файл через ${CLAUDE_SKILL_DIR}, — и потому
    // не просит доступа ни к чему сверх себя. Поймано на чужой установке.
    const frontBlock = front ? front[1] : ''
    const bodyOnly = front ? body.slice(front[0].length) : body
    for (const m of bodyOnly.matchAll(/src\/cli\/([\w-]+)\.ts/g)) {
      if (!/^allowed-tools:/m.test(frontBlock)) {
        problems.push(`${name}: команда запускается, но allowed-tools не объявлен — владельцу откажут в правах`)
        break
      }
      if (!frontBlock.includes(`src/cli/${m[1]}.ts`)) {
        problems.push(`${name}: allowed-tools не покрывает src/cli/${m[1]}.ts — правило не совпадёт с командой`)
      }
    }
  }
  check('скиллы → frontmatter+CLI', problems.length === 0, problems.length ? problems.join(' · ') : 'все скиллы валидны')
} catch (e) {
  check('скиллы → frontmatter+CLI', false, String(e).slice(0, 120))
}

// 4) MCP-инструменты → у каждого валидная object-схема + name/description
try {
  const src = read('src/mcp/handlers.ts')
  // грубо: число объявлений name: внутри TOOLS ≈ число inputSchema: type: 'object'
  const toolNames = [...src.matchAll(/name:\s*'(passport_\w+)'/g)].map((m) => m[1])
  const objectSchemas = (src.match(/type:\s*'object'/g) ?? []).length
  const descs = (src.match(/description:\s*\n?\s*'/g) ?? []).length + (src.match(/description:\s*'/g) ?? []).length
  const ok = toolNames.length > 0 && objectSchemas >= toolNames.length
  check('MCP-инструменты → схемы', ok, ok ? `${toolNames.length} инструментов, все с object-схемой` : `инструментов ${toolNames.length}, object-схем ${objectSchemas}`)
} catch (e) {
  check('MCP-инструменты → схемы', false, String(e).slice(0, 120))
}

// 5) единый источник сигналов: stack.ts и profile.ts берут SIGNALS из signals.ts
try {
  const stack = read('src/passport/stack.ts')
  const profile = read('src/passport/profile.ts')
  const importsSignals = (s: string): boolean => /from '\.\/signals'/.test(s) && /SIGNALS|matchSignal|Signal\b/.test(s)
  const ok = importsSignals(stack) && importsSignals(profile)
  check('единый источник сигналов', ok, ok ? 'stack+profile берут сигналы из signals.ts' : 'рассинхрон: не импортируют signals.ts')
} catch (e) {
  check('единый источник сигналов', false, String(e).slice(0, 120))
}

// 6) версия plugin.json — валидный semver
try {
  const v = (JSON.parse(read('.claude-plugin/plugin.json')) as { version: string }).version
  check('plugin.json версия', /^\d+\.\d+\.\d+$/.test(v), /^\d+\.\d+\.\d+$/.test(v) ? v : `невалидная: ${v}`)
} catch (e) {
  check('plugin.json версия', false, String(e).slice(0, 120))
}

// 6a) \b рядом с кириллицей в регэкспах — мёртвый шаблон. Граница слова в JS
// определена через [A-Za-z0-9_], кириллица в неё не входит: `/\bне могу/` не
// матчит НИКОГДА. Грабля поймана в проекте трижды (детекторы профиля, аудит
// сводки, маркеры отказа) — структурная проверка дешевле четвёртого раза.
try {
  const offenders: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const child = `${rel}/${name}`
      const abs = join(ROOT, child)
      if (existsSync(abs) && readdirSync(join(ROOT, rel), { withFileTypes: true }).find((d) => d.name === name)?.isDirectory()) {
        walk(child)
        continue
      }
      if (!name.endsWith('.ts')) continue
      const body = readFileSync(abs, 'utf8')
      for (const line of body.split('\n')) {
        // литерал регэкспа со \b и кириллицей в одном шаблоне
        for (const m of line.matchAll(/\/(?![/*])((?:[^/\\\n]|\\.)+)\/[gimsuy]*/g)) {
          const pattern = m[1]
          // Флагаем только там, где граница ПРИЛЕГАЕТ к кириллице: напрямую
          // (\bоткат) или через группу, чья альтернатива начинается кириллицей
          // (\b(seo|поисков…) — латинская ветка работает, русская мертва).
          // `\brollback\b` рядом с кириллицей в другой ветке — корректен.
          const adjacent = /\\b\(?[а-яё]/i.test(pattern) || /\\b\((?:[^)]*\|)*[а-яё]/i.test(pattern)
          if (adjacent && !pattern.includes('\\p{L}')) offenders.push(`${child}: ${pattern.slice(0, 50)}`)
        }
      }
    }
  }
  walk('src')
  check('\\b с кириллицей в регэкспах', offenders.length === 0, offenders.length ? offenders.slice(0, 3).join(' · ') : 'мёртвых шаблонов нет')
} catch (e) {
  check('\\b с кириллицей в регэкспах', false, String(e).slice(0, 120))
}

// 6b) CI не должен отставать от релиз-гейта: если проверка есть локально, но её
// нет в непрерывной интеграции, она рано или поздно перестанет выполняться —
// а поломка платформы обнаружится только у владельца в сессии.
try {
  const ciPath = join(ROOT, '.github', 'workflows', 'ci.yml')
  if (!existsSync(ciPath)) {
    check('CI повторяет релиз-гейт', false, 'нет .github/workflows/ci.yml')
  } else {
    // Судим ДЕЙСТВУЮЩИЙ workflow, а не файл целиком: закомментированный шаг —
    // это отсутствующий шаг, а подстрочный поиск по всему тексту находил его в
    // комментарии и давал зелень на проверку, которой в CI уже не было. Ровно
    // так и случилось со снятым расписанием: блок ушёл в комментарий, а линт
    // продолжал утверждать «ежедневная канарейка на месте».
    const ci = readFileSync(ciPath, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
    // Канарейка под node — не дубликат: артефакт поставляется под node, и
    // «зелено под bun» о поставляемом пути не говорит ничего.
    const required = ['bun test', 'scripts/bundle.ts', 'scripts/canary.ts --dist', 'scripts/canary.ts --dist --node', 'scripts/selflint.ts']
    const missing = required.filter((r) => !ci.includes(r))
    // Проверка платформы должна быть ЗАПУСКАЕМА без правки кода. Ежедневное
    // расписание снято владельцем осознанно (цена ложных писем «всё упало» на
    // неизменившемся коммите выше пользы), поэтому требуем не календарь, а
    // ручной повод: workflow_dispatch. Требовать здесь cron значило бы держать
    // линт красным ради решения, которое принято и записано.
    const triggerable = ci.includes('workflow_dispatch')
    // Порядок значит не меньше наличия. Канарейка ПОСЛЕ bundle.ts судит сборку
    // здешнего bun, а человеку по маркетплейсу уезжают байты из git — и пока
    // канарейки стояли только после сборки, поставляемая форма не исполнялась в
    // CI ни разу: её кросс-платформенность держалась на прогоне у владельца,
    // то есть на Windows. Требуем хотя бы один прогон до пересборки.
    const firstCanary = ci.indexOf('scripts/canary.ts --dist')
    const firstBundle = ci.indexOf('scripts/bundle.ts')
    const deliveredRun = firstCanary >= 0 && firstBundle >= 0 && firstCanary < firstBundle
    const ok = missing.length === 0 && triggerable && deliveredRun
    check(
      'CI повторяет релиз-гейт',
      ok,
      ok
        ? 'все проверки, ручной повод и прогон поставляемой формы на месте'
        : missing.length
          ? `в CI нет: ${missing.join(', ')}`
          : !triggerable
            ? 'нет ручного повода — проверку платформы нечем запустить'
            : 'канарейка бежит только после пересборки — поставляемый артефакт в CI не исполняется',
    )
  }
} catch (e) {
  check('CI повторяет релиз-гейт', false, String(e).slice(0, 120))
}

// 7) marketplace → source указывает на артефакт plugin/ (иначе в кэш установки
// снова поедет весь репозиторий с node_modules — корень долга №16)
try {
  const mkt = JSON.parse(read('.claude-plugin/marketplace.json')) as { plugins: Array<{ source: string }> }
  const ok = mkt.plugins.every((p) => p.source === './plugin')
  check('marketplace → ./plugin', ok, ok ? 'установка берёт артефакт, не репозиторий' : `source: ${mkt.plugins.map((p) => p.source).join(', ')}`)
} catch (e) {
  check('marketplace → ./plugin', false, String(e).slice(0, 120))
}

// 8) бандл: артефакт существует, полон и СВЕЖ (хэш входов == .build.json).
// Несвежий бандл = релиз повезёт старый код молча — падаем красным до релиза.
try {
  const { ENTRY_SOURCES, collectBundleInputs, bundleInputsHash } = await import('../src/bundle/core')
  const { grammarNames } = await import('../src/layer1/ast')
  if (!existsSync(join(ROOT, 'plugin', 'dist', '.build.json'))) {
    check('бандл plugin/', false, 'артефакта нет — bun run scripts/bundle.ts')
  } else {
    const manifest = JSON.parse(read('plugin/dist/.build.json')) as { hash: string }
    const missing: string[] = []
    for (const e of ENTRY_SOURCES) {
      const name = e.replace(/^.*\//, '').replace(/\.ts$/, '.js')
      if (!existsSync(join(ROOT, 'plugin', 'dist', name))) missing.push(`dist/${name}`)
    }
    for (const g of ['tree-sitter', ...grammarNames().map((n) => `tree-sitter-${n}`)]) {
      if (!existsSync(join(ROOT, 'plugin', 'wasm', `${g}.wasm`))) missing.push(`wasm/${g}.wasm`)
    }
    for (const f of ['hooks/hooks.json', '.mcp.json', '.claude-plugin/plugin.json']) {
      if (!existsSync(join(ROOT, 'plugin', f))) missing.push(f)
    }
    const fresh = bundleInputsHash(collectBundleInputs(ROOT)) === manifest.hash
    const ok = missing.length === 0 && fresh
    check('бандл plugin/', ok, ok ? 'артефакт полон и свеж' : missing.length ? `неполон: ${missing.slice(0, 4).join(', ')}` : 'НЕСВЕЖ — bun run scripts/bundle.ts')
  }
} catch (e) {
  check('бандл plugin/', false, String(e).slice(0, 120))
}

// 9) Рантайм-нейтральность ядра: знание о конкретном рантайме живёт в двух
// модулях (core/db.ts — форма API, core/runtime.ts — загрузка), и нигде больше.
// Прямой импорт драйвера или Bun-API в любом другом модуле возвращает плагину
// обязательную предпосылку к окружению — ту самую, которую снимали.
try {
  const offenders: string[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      // Комментарии вырезаются: назвать Bun.stdin в объяснении, ПОЧЕМУ его тут
      // больше нет, — не нарушение, а ровно то, чего требует стиль проекта
      const body = readFileSync(join(ROOT, child), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
      if (/'(?:bun|node):sqlite'/.test(body)) offenders.push(`${child}: прямой импорт драйвера`)
      if (/\bBun\.\w/.test(body)) offenders.push(`${child}: Bun-API`)
    }
  }
  walk('src')
  check('рантайм-нейтральность src', offenders.length === 0, offenders.length ? offenders.slice(0, 3).join(' · ') : 'драйвер знают только core/db.ts и core/runtime.ts')
} catch (e) {
  check('рантайм-нейтральность src', false, String(e).slice(0, 120))
}

// 10) Артефакт зовёт рантайм поставки. Манифесты репозитория остаются на bun
// (он один исполняет .ts), но в plugin/ обязан приехать node — иначе установка
// снова потребует bun, и порт окажется сделанным только на бумаге.
try {
  if (!existsSync(join(ROOT, 'plugin', 'hooks', 'hooks.json'))) {
    check('артефакт → рантайм node', false, 'артефакта нет — bun run scripts/bundle.ts')
  } else {
    const problems: string[] = []
    const commands: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item)
        return
      }
      if (!node || typeof node !== 'object') return
      const obj = node as Record<string, unknown>
      if (typeof obj.command === 'string' && Array.isArray(obj.args)) {
        commands.push(obj.command)
        if (obj.command !== 'node') problems.push(`command: ${obj.command}`)
        if ((obj.args as unknown[]).includes('run')) problems.push('в args осталась подкоманда run — node её не понимает')
      }
      for (const v of Object.values(obj)) walk(v)
    }
    walk(JSON.parse(read('plugin/hooks/hooks.json')))
    walk(JSON.parse(read('plugin/.mcp.json')))
    // Скиллы запускают свои входы строкой в markdown, мимо манифестов — и
    // ровно поэтому их забыли при переводе на node: хуки поехали, а команды
    // остались на прежней предпосылке. Проверка закрывает этот класс промаха
    const skillsOut = join(ROOT, 'plugin', 'skills')
    if (existsSync(skillsOut)) {
      for (const name of readdirSync(skillsOut)) {
        const md = join(skillsOut, name, 'SKILL.md')
        if (!existsSync(md)) continue
        if (/\bbun\b/.test(readFileSync(md, 'utf8'))) problems.push(`скилл ${name} зовёт bun`)
      }
    }
    const pkg = join(ROOT, 'plugin', 'dist', 'package.json')
    if (!existsSync(pkg)) problems.push('нет dist/package.json — node прочитает выходы как CommonJS и упадёт на import')
    else if ((JSON.parse(readFileSync(pkg, 'utf8')) as { type?: string }).type !== 'module') problems.push('dist/package.json без type: module')
    check('артефакт → рантайм node', problems.length === 0, problems.length ? problems.slice(0, 3).join(' · ') : `${commands.length} входов поставки зовут node`)
  }
} catch (e) {
  check('артефакт → рантайм node', false, String(e).slice(0, 120))
}

// 11) Основание факта формулируется в ОДНОМ месте (core/store.ts factBasis).
// Формулировок было две — в сводке и в MCP, — и их синхронность держалась
// напоминанием в CLAUDE.md, то есть памятью человека. Копии расходятся молча;
// проверка ловит попытку написать третью.
try {
  const offenders: string[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.name.endsWith('.ts') || child === 'src/core/store.ts') continue
      const body = readFileSync(join(ROOT, child), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
      // Ловим именно формулировку ОСНОВАНИЯ факта, а не слово «уверенность»:
      // у предложений elevate и правил слоя 2 своя шкала уверенности, и они
      // к подаче факта отношения не имеют (первая версия проверки их ложно винила)
      if (/не измерено|по \$\{[^}]+\} образцам/.test(body)) offenders.push(child)
    }
  }
  walk('src')
  check('единый формат основания факта', offenders.length === 0, offenders.length ? `своя формулировка: ${offenders.slice(0, 3).join(', ')}` : 'основание факта формулирует только core/store.ts')
} catch (e) {
  check('единый формат основания факта', false, String(e).slice(0, 120))
}

// 12) Артефакт доезжает ПО GIT, а не только лежит на диске.
// Проверки 8 и 10 смотрят файловую систему разработчика — и именно поэтому
// пропустили главный дефект доставки: правило `dist` в .gitignore накрывало и
// plugin/dist, так что клон репозитория приезжал с манифестами, скиллами и
// грамматиками, но без единой строки кода. Снаружи это выглядело нормально:
// игнорируемое не показывается в git status, а на диске всё было на месте.
// Здесь спрашиваем не диск, а git: что он реально отдаст чужому человеку.
try {
  const { spawnSync } = await import('node:child_process')
  const git = (args: string[]): { ok: boolean; out: string } => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true })
    return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim() }
  }
  const lines = (s: string): string[] => (s ? s.split('\n').filter(Boolean) : [])
  const probe = git(['rev-parse', '--is-inside-work-tree'])
  if (!probe.ok) {
    // Не репозиторий (распакованный архив, песочница) — проверять нечем, и это
    // не поломка плагина: молчать нельзя, врать про успех тоже
    check('артефакт доедет по git', true, 'вне git-репозитория — доставка не проверялась')
  } else if (AFTER_BUILD) {
    // Дерево ПЕРЕСОБРАНО в этом же прогоне. Имена общих чанков несут хэш
    // содержимого, а содержимое зависит от версии bun: у CI она своя, и после
    // пересборки half артефакта закономерно оказывается «не в индексе» — не
    // потому что владелец забыл `git add plugin`, а потому что судят уже не тот
    // артефакт, который лежит в git. Вопрос доставки решается ДО сборки
    // (первый шаг CI), поэтому здесь он не задаётся вовсе, а не отвечается «да».
    check('артефакт доедет по git', true, 'дерево пересобрано в этом прогоне — доставка проверена до сборки')
  } else {
    const ignored = lines(git(['ls-files', '--others', '--ignored', '--exclude-standard', 'plugin']).out)
    const untracked = lines(git(['ls-files', '--others', '--exclude-standard', 'plugin']).out)
    const tracked = lines(git(['ls-files', 'plugin']).out)
    const problems: string[] = []
    if (ignored.length > 0) problems.push(`игнорируются и НИКОГДА не доедут: ${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? ` (+${ignored.length - 3})` : ''}`)
    if (untracked.length > 0) problems.push(`не в индексе (git add plugin): ${untracked.slice(0, 3).join(', ')}${untracked.length > 3 ? ` (+${untracked.length - 3})` : ''}`)
    if (tracked.length === 0) problems.push('в git нет артефакта вовсе')
    check('артефакт доедет по git', problems.length === 0, problems.length ? problems.join(' · ') : `${tracked.length} файлов артефакта в git`)
  }
} catch (e) {
  check('артефакт доедет по git', false, String(e).slice(0, 120))
}

// 13) Ровность языков между слоями. Плагин заявлен независимым от языка, но
// знание о языках живёт в трёх местах: список кодовых расширений (walk), набор
// грамматик слоя 1 (ast) и пакеты импортов (graph). Разъезд этих таблиц не
// ломает ничего заметного — просто у части языков молча нет графа связей, ровно
// как было до этой проверки у Go, Java, C#, Rust. Забытый язык обязан отличаться
// от отвергнутого, поэтому исключение требует записи с причиной.
try {
  const { CODE_EXT } = await import('../src/miner/walk')
  const { EXT_LANG } = await import('../src/layer1/ast')
  const { importExts, NO_IMPORT_LANGS } = await import('../src/graph/imports')
  const covered = new Set(importExts())
  const known = new Set([...CODE_EXT, ...Object.keys(EXT_LANG)])
  const silent = [...known].filter((e) => !covered.has(e) && !(e in NO_IMPORT_LANGS))
  check(
    'ровность языков',
    silent.length === 0,
    silent.length ? `есть в коде/грамматиках, но графа связей нет и причина не названа: ${silent.join(', ')}` : `${covered.size} расширений с графом · ${Object.keys(NO_IMPORT_LANGS).length} исключены с причиной`,
  )
} catch (e) {
  check('ровность языков', false, String(e).slice(0, 120))
}

// 14) Сырой нулевой байт в исходнике. Он не виден глазом, но делает файл
// «бинарным» для grep — модуль молча выпадает из поиска по коду, и правка,
// которая должна была его затронуть, проходит мимо. Грабля срабатывала трижды
// (works.ts, bundle/core.ts, graph/imports.ts); писать надо escape-последовательность.
try {
  const offenders: string[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      if (readFileSync(join(ROOT, child), 'utf8').includes(String.fromCharCode(0))) offenders.push(child)
    }
  }
  walk('src')
  walk('scripts')
  check('нет сырого NUL в исходниках', offenders.length === 0, offenders.length ? `«бинарные» для grep: ${offenders.join(', ')}` : 'все файлы читаются поиском по коду')
} catch (e) {
  check('нет сырого NUL в исходниках', false, String(e).slice(0, 120))
}

for (const r of results) console.log(` ${r.ok ? '✓' : '✗'} ${r.check.padEnd(30)}${r.note}`)
const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  // В CI причина обязана быть видна СНАРУЖИ: логи прогона недоступны без токена,
  // и «шаг упал с кодом 1» — это ровно то молчание, против которого написан весь
  // плагин. Аннотация показывается на странице прогона всем, включая мимокрокодила.
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const f of failed) console.log(`::error::селф-линт: ${f.check} — ${f.note}`)
  }
  console.log(`\nСамо-линт: структурная рассинхронизация — ${failed.map((f) => f.check).join(', ')}`)
  process.exit(1)
}
console.log('\nСамо-линт: структура плагина консистентна.')
