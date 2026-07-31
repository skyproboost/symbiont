/**
 * A/B на РЕАЛЬНОЙ задаче: создать SEO-статью с перелинковкой — с плагином и без.
 *
 * Изоляция: каждая рука — свой git-worktree боевого репо (рабочая копия
 * владельца не трогается вообще), node_modules подключается junction'ом,
 * чтобы аудит-скрипты проекта запускались нативно.
 *
 * Плечо «с плагином»: в data-слаг worktree копируется накопленный паспорт
 * labreadai (конвенции + граф + co-change) — плагин несёт всё знание.
 * Плечо «без плагина»: claude --bare (хуки/плагины/память выключены).
 *
 * Качество — не на глаз: результат каждой руки прогоняется через
 * САМОСОЗДАННЫЙ верификатор проекта (audit-content.mjs, 470 записей) —
 * это редакционно-SEO-спека как код. exit=0 и число 🔴/🟡 = объективный балл.
 *
 * Запуск: bun run scripts/ab-article.ts
 */
import { mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

// Пути машины — аргументами, а не константами: репозиторий публичный, и путь
// вида C:/Users/<имя> в коде это одновременно утечка личного и поломка у всех
// остальных. Запуск: bun run scripts/ab-article.ts <путь-к-репозиторию> <слаг>
const REPO = process.argv[2] ?? process.cwd()
const PLUGIN_DATA =
  process.env.CLAUDE_PLUGIN_DATA ??
  join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.claude', 'plugins', 'data', 'symbiont-symbiont-market')
const SLUG = process.argv[3] ?? basename(REPO)
const OUT = join(import.meta.dirname, '..', '.data')
mkdirSync(OUT, { recursive: true })

const TASK = [
  `Создай новую статью для проекта labreadai: «анализ на ВПЧ», slug «${SLUG}», файл content/posts/${SLUG}.yaml.`,
  'Требования — топ-1 SEO именно для этого проекта:',
  '- ядро ключей из wordstat-исследования (.docs/_research/outbreak-infection-vaccine-research.md и .docs/_research/outbreak-wordstat.tsv), кластер «мост к анализам»;',
  '- keywords, title, description, summary, H2, FAQ, tags, related — строго по редакционно-SEO-спеке проекта (.docs/06-seo-and-content.md и scripts/audit-content.mjs);',
  '- ПОЛНАЯ перелинковка: осмысленные внутренние ссылки ИЗ статьи на релевантные indicators/posts, и добавь ссылки НА эту статью из соседних (content/posts/vpch-tipy-onkorisk.yaml, content/posts/privivka-ot-vpch.yaml);',
  '- следуй всем конвенциям репозитория (структура YAML, русский язык, формат ссылок).',
  'В конце обязательно прогони `node scripts/audit-content.mjs` и убедись, что статья проходит без critical (🔴).',
].join('\n')

interface Arm {
  name: 'без плагина' | 'с плагином'
  bare: boolean
}
const ARMS: Arm[] = [
  { name: 'без плагина', bare: true },
  { name: 'с плагином', bare: false },
]

function sh(cmd: string, args: string[], cwd: string, timeout = 1_200_000, input?: string) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 128 * 1024 * 1024, input })
}

function makeWorktree(tag: string): string {
  const wt = join(REPO, '..', `labreadai-ab-${tag}`)
  if (existsSync(wt)) sh('git', ['worktree', 'remove', '--force', wt], REPO)
  const r = sh('git', ['worktree', 'add', '--detach', wt, 'HEAD'], REPO, 120_000)
  if (r.status !== 0) throw new Error(`worktree ${tag}: ${r.stderr}`)
  // node_modules — junction на боевой (аудит-скрипты требуют пакеты)
  const link = join(wt, 'node_modules')
  if (!existsSync(link)) sh('cmd', ['/c', 'mklink', '/J', link, join(REPO, 'node_modules')], REPO, 60_000)
  return wt
}

function auditScore(wt: string): { exit: number; red: number; yellow: number; tail: string } {
  const r = sh('node', ['scripts/audit-content.mjs'], wt, 180_000)
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const red = (out.match(/🔴/g) ?? []).length
  const yellow = (out.match(/🟡/g) ?? []).length
  return { exit: r.status ?? -1, red, yellow, tail: out.trim().split('\n').slice(-12).join('\n') }
}

const rows: Array<Record<string, unknown>> = []
const created: Record<string, boolean> = {}

for (const arm of ARMS) {
  const tag = arm.bare ? 'bare' : 'plugin'
  console.log(`\n=== ${arm.name} (worktree labreadai-ab-${tag}) ===`)
  let wt = ''
  try {
    wt = makeWorktree(tag)
    // плечо с плагином — подложить паспорт в слаг worktree
    if (!arm.bare) {
      const slug = basename(wt).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      const dst = join(PLUGIN_DATA, slug)
      const src = join(PLUGIN_DATA, 'labreadai-v2')
      if (existsSync(src) && !existsSync(dst)) cpSync(src, dst, { recursive: true })
      // чистый замер: без фоновых LLM-проходов авто-петли в момент теста
      mkdirSync(dst, { recursive: true })
      writeFileSync(join(dst, 'learn.json'), '{"auto": false}', 'utf8')
    }

    // Промпт — через stdin, НЕ аргументом: многострочная строка в argv на
    // Windows рвётся по \n (claude видит только первую строку, остальное —
    // битые флаги → пустой stdout, $0.00). --dangerously-skip-permissions:
    // worktree — недоверенный каталог, нужны и доверие к папке, и запись.
    const args = ['-p', '--output-format', 'json', '--max-turns', '60', '--dangerously-skip-permissions']
    if (arm.bare) args.push('--bare')
    const t0 = Date.now()
    const r = sh('claude', args, wt, 1_800_000, TASK)
    const durationS = Math.round((Date.now() - t0) / 1000)

    let m: Record<string, unknown> = { arm: arm.name, ok: false, durationS }
    try {
      // устойчивый парс: claude может напечатать преамбулу до JSON-результата
      const raw = r.stdout ?? ''
      const s = raw.indexOf('{')
      const e = raw.lastIndexOf('}')
      const j = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : raw) as {
        num_turns?: number
        total_cost_usd?: number
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
      }
      m = {
        arm: arm.name,
        ok: true,
        durationS,
        turns: j.num_turns ?? 0,
        inputTokens: j.usage?.input_tokens ?? 0,
        cacheRead: j.usage?.cache_read_input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
        costUsd: j.total_cost_usd ?? 0,
      }
    } catch {
      m.note = (r.stderr ?? '').slice(0, 300)
    }

    const file = join(wt, 'content', 'posts', `${SLUG}.yaml`)
    created[arm.name] = existsSync(file)
    m.articleCreated = created[arm.name]
    if (created[arm.name]) cpSync(file, join(OUT, `article-${tag}.yaml`))

    const audit = auditScore(wt)
    m.auditExit = audit.exit
    m.auditRed = audit.red
    m.auditYellow = audit.yellow

    // ссылки на новую статью из соседей (перелинковка «на статью»)
    const back = sh('git', ['-C', wt, 'diff', '--name-only'], wt).stdout ?? ''
    m.filesTouched = back.trim().split('\n').filter(Boolean).length

    rows.push(m)
    writeFileSync(join(OUT, `audit-${tag}.txt`), audit.tail, 'utf8')
    console.log(`  создана: ${created[arm.name]} · аудит exit=${audit.exit} 🔴${audit.red} 🟡${audit.yellow} · ${durationS}с · $${(m.costUsd as number ?? 0).toFixed(2)}`)
  } catch (e) {
    console.log(`  сбой: ${String(e).slice(0, 200)}`)
    rows.push({ arm: arm.name, ok: false, note: String(e).slice(0, 200) })
  } finally {
    if (wt) sh('git', ['worktree', 'remove', '--force', wt], REPO, 120_000)
    if (!arm.bare) {
      const slug = basename(wt || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      try {
        if (slug) rmSync(join(PLUGIN_DATA, slug), { recursive: true, force: true })
      } catch {
        /* приберётся */
      }
    }
  }
}

console.log('\n плечо          создана  аудит        🔴  🟡   файлов  сек    $')
for (const r of rows) {
  console.log(
    ` ${String(r.arm).padEnd(14)}${String(r.articleCreated ?? '—').padEnd(9)}exit=${String(r.auditExit ?? '—').padEnd(7)}${String(r.auditRed ?? '—').padStart(2)}  ${String(r.auditYellow ?? '—').padStart(2)}   ${String(r.filesTouched ?? '—').padStart(5)}  ${String(r.durationS ?? '—').padStart(4)}  ${((r.costUsd as number) ?? 0).toFixed(2)}`,
  )
}
writeFileSync(join(OUT, 'ab-article.json'), JSON.stringify(rows, null, 1), 'utf8')
console.log(`\nСтатьи и аудиты: ${OUT} (article-bare.yaml / article-plugin.yaml + audit-*.txt)`)
