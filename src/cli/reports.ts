/**
 * Отчёты обсерватории: обзор состояния и карта проекта (/symbiont:status).
 * Визуальный язык — как у родных экранов Claude Code (/usage, /stats):
 * бары, композиционные полосы █▓▒░, выровненные колонки, воздух.
 * Чистые функции над passport.db — тестируются без процесса.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Database } from '../core/db'
import { t, tier as tierName, statement } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации
import { isDue } from '../core/schedule'
import { readGateMode } from '../gates/config'
import { readAvailability, renderAvailability, networkDownUntil } from '../core/models'
import { readHeatRows, effectiveHeat } from '../graph/heat'
import { summaryStats, summaryFor, contentHashOf } from '../graph/zsummary'
import { countLessons } from '../gardener/lessons'
import { computeDrift, renderDrift } from '../gardener/drift'

const ago = (iso: string): string => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins) || mins < 0) return iso
  if (mins < 1) return t('только что', 'just now')
  if (mins < 60) return t(`${mins}м назад`, `${mins}m ago`)
  if (mins < 48 * 60) return t(`${Math.round(mins / 60)}ч назад`, `${Math.round(mins / 60)}h ago`)
  return t(`${Math.round(mins / 1440)}д назад`, `${Math.round(mins / 1440)}d ago`)
}

const q = <T>(db: Database, sql: string, ...args: unknown[]): T[] =>
  db.query(sql).all(...(args as never[])) as T[]
const one = <T>(db: Database, sql: string, ...args: unknown[]): T | null =>
  db.query(sql).get(...(args as never[])) as T | null

const tableExists = (db: Database, name: string): boolean =>
  one<{ n: number }>(db, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?", name)!.n > 0

const bar = (n: number, max: number, width = 16): string =>
  n <= 0 ? '' : '█'.repeat(Math.max(1, Math.round((n / Math.max(max, 1)) * width)))

const pad = (s: string, w: number): string => (s.length >= w ? s.slice(0, w - 1) + '…' : s.padEnd(w))
const num = (n: number, w: number): string => String(n).padStart(w)

// ── обзор состояния ──────────────────────────────────────────────────────────

export function buildStatusReport(dataDir: string): string {
  const dbPath = join(dataDir, 'passport.db')
  if (!existsSync(dbPath)) return t('Symbiont: паспорт для этого проекта ещё не построен (строится при старте сессии).', 'Symbiont: no passport for this project yet — it is built when a session starts.')
  const db = openDb(dbPath, { readonly: true })
  try {
    const L: string[] = [t('Symbiont · статус паспорта', 'Symbiont · passport status'), '']

    // Петля фактов — бары по ярусам
    const tiers = q<{ tier: string; n: number }>(
      db,
      'SELECT tier, COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL GROUP BY tier ORDER BY n DESC',
    )
    const journal = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM fact_journal')!.n
    const superseded = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NOT NULL')!.n
    const lastSeen = one<{ t: string }>(db, 'SELECT MAX(seen_at) t FROM fact_journal')?.t
    const maxTier = Math.max(...tiers.map((t) => t.n), 1)
    // Факты от модели с истёкшим интервалом перепроверки — их возьмёт фон
    let due = 0
    try {
      const llm = q<{ stability: number | null; seen_at: string }>(
        db,
        "SELECT stability, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' AND stability IS NOT NULL",
      )
      due = llm.filter((r) => isDue(r.stability, r.seen_at)).length
    } catch {
      /* старая схема без stability (read-only база) — счётчика просто нет */
    }
    L.push(
      ` ${pad(t('Петля фактов', 'Fact loop'), 16)} ${t('журнал', 'journal')} ${journal} · ${t('заменено', 'superseded')} ${superseded}${lastSeen ? ` · ${t('замер', 'measured')} ${lastSeen.slice(0, 10)}` : ''}${due > 0 ? ` · ${t('к перепроверке', 'due for recheck')}: ${due} (${t('фон сделает сам', 'background will do it')})` : ''}`,
    )
    for (const row of tiers) L.push(`   ${pad(tierName(row.tier), 16)}${pad(bar(row.n, maxTier), 18)}${row.n}`)
    L.push('')

    // Граф
    if (tableExists(db, 'graph_nodes')) {
      const nodes = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM graph_nodes')!.n
      const edges = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM graph_edges')!.n
      L.push(` ${pad(t('Граф', 'Graph'), 16)} ${t('узлов', 'nodes')} ${nodes} · ${t('рёбер', 'edges')} ${edges}`, '')
    }

    // Дрейф: тренд качества против базового снимка (молчит, если ничего не уползло)
    const driftLine = renderDrift(computeDrift(db))
    if (driftLine) L.push(driftLine, '')

    // Сессии
    if (tableExists(db, 'sessions')) {
      const total = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM sessions')!.n
      const open = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM sessions WHERE closed_at IS NULL')!.n
      const dirty = one<{ n: number }>(db, "SELECT COUNT(*) n FROM sessions WHERE close_reason='reconciled-dirty'")!.n
      L.push(` ${pad(t('Сессии', 'Sessions'), 16)} ${t('всего', 'total')} ${total} · ${t('открытых', 'open')} ${open} · ${t('обрывов', 'interrupted')} ${dirty}`, '')
    }

    // Каналы
    const jit = tableExists(db, 'jit_log') ? one<{ n: number }>(db, 'SELECT COUNT(*) n FROM jit_log')!.n : 0
    const gates = tableExists(db, 'gate_log')
      ? q<{ law: string; n: number }>(db, 'SELECT law, COUNT(*) n FROM gate_log GROUP BY law ORDER BY n DESC LIMIT 5')
      : []
    const gateTotal = gates.reduce((s, g) => s + g.n, 0)
    const corrections = tableExists(db, 'corrections')
      ? one<{ n: number }>(db, 'SELECT COUNT(*) n FROM corrections')!.n
      : 0
    const lessons = countLessons(db)
    const gateMode = readGateMode(dataDir) === 'block' ? t('блокировка', 'blocking') : 'dry-run'
    L.push(
      ` ${pad(t('Каналы', 'Channels'), 16)} ${t('срезов по файлам', 'file briefs')} ${jit} · ${t('гейт', 'gate')} (${gateMode}): ${t('поимок', 'catches')} ${gateTotal}${gateTotal === 0 ? t(' — чисто', ' — clean') : ''} · ${t('поправок владельца', 'owner corrections')}: ${corrections}${lessons > 0 ? ` · ${t('уроков зон', 'zone lessons')}: ${lessons}` : ''}`,
    )
    // Утилизация подачи (телеметрия эффективности): подано файлов → сколько реально
    // тронуто. Отвечает на «а используется ли знание» (провал claude-mem: 95% сессий
    // память не запрошена). Синтетические ключи (#playbook/#lesson) — не файлы, вне метрики.
    try {
      const surfaced = one<{ n: number }>(db, "SELECT COUNT(*) n FROM jit_log WHERE file NOT LIKE '#%'")?.n ?? 0
      const used = one<{ n: number }>(db, "SELECT COUNT(*) n FROM jit_log WHERE file NOT LIKE '#%' AND used=1")?.n ?? 0
      if (surfaced > 0) L.push(`   ${pad(t('окупаемость', 'payback'), 15)} ${t('подано файлов', 'files surfaced')} ${surfaced} · ${t('пригодилось', 'used')} ${used} (${Math.round((used / surfaced) * 100)}%)`)
    } catch {
      /* старая схема без колонки used — метрики просто нет */
    }
    // Авто-петля: последний фоновый LLM-проход (запускается сам по сырью)
    try {
      const meta = one<{ value: string }>(db, "SELECT value FROM learn_meta WHERE key='auto_learn'")
      if (meta) {
        const j = JSON.parse(meta.value) as { at: string; ok: boolean; note: string }
        L.push(`   ${pad(t('авто-обучение', 'self-learning'), 15)} ${ago(j.at)} · ${j.note}`)
      } else {
        L.push(`   ${pad(t('авто-обучение', 'self-learning'), 15)} ${t('ещё не бегало (стартует само, когда появится сырьё)', 'has not run yet — starts on its own once there is material')}`)
      }
    } catch {
      /* меты нет — канал ещё не жил */
    }
    if (gates.length > 0) {
      const maxGate = Math.max(...gates.map((g) => g.n), 1)
      // statement() ДО обрезки по тире: в журнале формулировка русская всегда
      // (по ней считается ключ вытеснения), английская рождается на последней
      // миле. Обрежь сначала — и переводить будет уже нечего: ключ таблицы пар
      // это целая формулировка, а не её голова.
      for (const g of gates) L.push(`   ${pad(statement(g.law).split('—')[0].trim(), 20)}${pad(bar(g.n, maxGate, 12), 14)}${g.n}`)
    }
    L.push('')

    // Heartbeat: пульс всех каналов (молчащий канал — видимая проблема, не тайна)
    try {
      const beats = readdirSync(dataDir)
        .filter((f) => f.startsWith('heartbeat') && f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(dataDir, f), 'utf8')) as { channel: string; at: string }
          } catch {
            return null
          }
        })
        .filter((b): b is { channel: string; at: string } => b !== null && !!b.at)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      if (beats.length > 0) {
        L.push(t(' Пульс каналов', ' Channel pulse'))
        for (const b of beats) L.push(`   ${pad(b.channel, 18)}${ago(b.at)}`)
        L.push('')
      }
    } catch {
      /* нет пульса — нечего показывать */
    }

    // Вектор моделей: адаптивный порядок семейств + выученная доступность
    // (алиасы резолвятся CLI в последнюю версию — всегда актуально)
    try {
      const vec = renderAvailability(readAvailability(dataDir), Date.now())
      if (vec.length > 0) {
        L.push(t(' Модели (для глубоких задач — качество вперёд · для рутины — цена вперёд)', ' Models (deep tasks — quality first · routine — cost first)'))
        for (const line of vec) L.push(`   ${line}`)
        L.push('')
      }
    } catch {
      /* кэша нет — вектор идёт сид-порядком, показывать нечего */
    }

    // Сеть: если признак стоит, фон сейчас НЕ ходит к моделям — и владелец
    // должен видеть это как состояние машины, а не гадать, почему всё тихо
    try {
      const until = networkDownUntil(dataDir, Date.now())
      if (until !== null) {
        L.push(` ${pad(t('Сеть', 'Network'), 16)} ${t('недоступна — следующая проба после', 'unavailable — next attempt after')} ${new Date(until).toLocaleTimeString(t('ru-RU', 'en-GB'), { hour: '2-digit', minute: '2-digit' })}`, '')
      }
    } catch {
      /* признака нет — состояние обычное, показывать нечего */
    }

    // Ленивый зум: у скольких посещённых узлов уже выведена роль (z1) и сколько
    // ждёт фонового прохода — видно, что слой живой и не индексирует лишнее
    try {
      const z = summaryStats(db)
      if (z.have > 0 || z.pending > 0) {
        L.push(` ${pad(t('Роли файлов', 'File roles'), 16)} ${t('выведены у', 'derived for')} ${z.have} ${t('узлов', 'nodes')}${z.pending > 0 ? ` · ${t('в очереди', 'queued')} ${z.pending} (${t('доберёт фоновая работа', 'background work will finish')})` : ''}`)
        L.push('')
      }
    } catch {
      /* слоя ещё нет — молчим */
    }

    // Горячие узлы: недавно тронутое (тепло, остывает между сессиями) —
    // излучает релевантность в подаче; задел под hotspot слоя дрейфа
    try {
      const heat = effectiveHeat(readHeatRows(db), Date.now())
      const hot = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      if (hot.length > 0) {
        L.push(t(' Горячие узлы (недавняя работа, остывают)', ' Hot nodes (recent work, cooling down)'))
        const max = hot[0][1]
        for (const h of hot) L.push(`   ${pad(h[0], 34)}${bar(h[1], max, 10)} ${h[1].toFixed(1)}`)
      }
    } catch {
      /* тепла нет — нечего показывать */
    }
    return L.join('\n')
  } finally {
    db.close()
  }
}

// ── карта проекта ────────────────────────────────────────────────────────────

interface NodeRow {
  file: string
  rank: number
  in_deg: number
  out_deg: number
}

type Tier = 0 | 1 | 2 | 3 // 0=ядро … 3=рядовой
const TIER_STAR = ['✦', '●', '✧', '·'] as const
const TIER_HEAT = ['█', '▓', '▒', '░'] as const

/** Ярус узла по позиции в общем ранжировании проекта. */
function tierOfRank(pos: number, total: number): Tier {
  const pct = pos / Math.max(total, 1)
  if (pct <= 0.05) return 0
  if (pct <= 0.2) return 1
  if (pct <= 0.5) return 2
  return 3
}

const segmentOf = (file: string): string => {
  const i = file.indexOf('/')
  return i === -1 ? '(корень)' : file.slice(0, i) + '/'
}

/** Композиционная полоса созвездия: доли ярусов внутри группы, как теплокарта. */
function heatBar(tierCounts: number[], width = 24): string {
  const total = tierCounts.reduce((s, n) => s + n, 0)
  if (total === 0) return '░'.repeat(width)
  let out = ''
  for (let t = 0; t < 4; t++) {
    if (tierCounts[t] === 0) continue
    out += TIER_HEAT[t].repeat(Math.max(1, Math.round((tierCounts[t] / total) * width)))
  }
  return out.slice(0, width).padEnd(width, TIER_HEAT[3])
}

export function buildMapReport(dataDir: string, zone?: string): string {
  const dbPath = join(dataDir, 'passport.db')
  if (!existsSync(dbPath)) return t('Symbiont: паспорт не построен.', 'Symbiont: passport not built.')
  const db = openDb(dbPath, { readonly: true })
  try {
    if (!tableExists(db, 'graph_nodes')) return t('Symbiont: граф не построен.', 'Symbiont: graph not built.')
    const all = q<NodeRow>(db, 'SELECT file, rank, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC')
    if (all.length === 0) return t('Symbiont: в графе нет узлов (нет внутренних импортов).', 'Symbiont: the graph has no nodes (no internal imports).')
    const tierByFile = new Map(all.map((n, i) => [n.file, tierOfRank(i, all.length)]))

    if (zone) {
      const z = zone.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '')
      const nodes = all.filter((n) => n.file.toLowerCase().startsWith(z))
      if (nodes.length === 0) return t(`Symbiont: зона «${zone}» в графе не найдена. Список зон — /symbiont:status без аргумента.`, `Symbiont: area “${zone}” is not in the graph. Run /symbiont:status with no arguments to list areas.`)
      const L = [
        t(`Symbiont · зона ${zone} · ${nodes.length} узлов`, `Symbiont · area ${zone} · ${nodes.length} nodes`),
        '',
        `      ${pad(t('файл', 'file'), 42)}${t('вход', 'in').padStart(6)}${t('исход', 'out').padStart(7)}`,
        `      ${'─'.repeat(55)}`,
      ]
      for (const n of nodes.slice(0, 25)) {
        L.push(`   ${TIER_STAR[tierByFile.get(n.file)!]}  ${pad(n.file, 42)}${num(n.in_deg, 6)}${num(n.out_deg, 7)}`)
        // Спуск в зону — тот самый зум до z1 (CONCEPT §4.1): у посещённых узлов
        // роль уже выведена, остальные покажут её после фонового прохода
        const z1 = summaryFor(db, n.file, contentHashOf(db, n.file))
        if (z1) L.push(`      ${z1}`)
      }
      if (nodes.length > 25) L.push('', t(`   … и ещё ${nodes.length - 25} · полный радиус узла: passport_impact`, `   … and ${nodes.length - 25} more · full node radius: passport_impact`))
      return L.join('\n')
    }

    // Обзор: созвездия-каталоги с композиционной полосой
    const groups = new Map<string, NodeRow[]>()
    for (const n of all) {
      const seg = segmentOf(n.file)
      if (!groups.has(seg)) groups.set(seg, [])
      groups.get(seg)!.push(n)
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => b[1].reduce((s, n) => s + n.rank, 0) - a[1].reduce((s, n) => s + n.rank, 0),
    )
    const edgeCount = one<{ n: number }>(db, 'SELECT COUNT(*) n FROM graph_edges')!.n

    const L = [
      t(`Symbiont · карта проекта · ${all.length} узлов · ${edgeCount} рёбер`, `Symbiont · project map · ${all.length} nodes · ${edgeCount} edges`),
      t(' Состав созвездия:  █ ядро (топ-5%) · ▓ важный · ▒ заметный · ░ рядовой', ' Groups: █ core (top 5%) · ▓ important · ▒ notable · ░ ordinary'),
      '',
    ]
    for (const [seg, members] of ordered.slice(0, 10)) {
      const counts = [0, 0, 0, 0]
      for (const m of members) counts[tierByFile.get(m.file)!]++
      L.push(` ${pad(seg, 12)}${heatBar(counts)}  ${num(members.length, 5)}`)
      for (const m of members.slice(0, 3)) {
        const rank = tierByFile.get(m.file)!
        if (rank >= 2) continue // в обзоре — только ядро и важные
        const short = seg === '(корень)' ? m.file : m.file.slice(seg.length)
        L.push(`     ${TIER_STAR[rank]} ${pad(short, 34)}${t('вход', 'in')} ${num(m.in_deg, 4)}`)
      }
      L.push('')
    }
    if (ordered.length > 10) L.push(t(` … и ещё ${ordered.length - 10} групп`, ` … and ${ordered.length - 10} more groups`), '')
    L.push(t(' Зум в зону: /symbiont:status <каталог> · кто зависит от файла: passport_impact', ' Zoom into an area: /symbiont:status <directory> · who depends on a file: passport_impact'))
    return L.join('\n')
  } finally {
    db.close()
  }
}
