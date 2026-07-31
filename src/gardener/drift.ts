/**
 * Слой дрейфа, инкремент 1 (docs/drift-layer.md): дрейф — ПРОИЗВОДНАЯ паспорта.
 *
 * Исходная боль тестировщика владельца: «периодически запускаю рефактор харнесса,
 * а то он сам потихоньку беспорядок наводит». Заземлено: SlopCodeBench (код
 * агентов деградирует монотонно — эрозия в 77% траекторий). Symbiont ловит разовое
 * нарушение (гейт), но не ТРЕНД. Здесь — снимок дешёвых метрик здоровья на коммит
 * и дельта против базового снимка: конвенции просели? сироты/битые растут? граф
 * оплотняется (god-узлы/волосяной шар)? гейт ловит чаще?
 *
 * Всё — из уже посчитанного паспорта (ноль нового обхода), детерминированно,
 * языко-агностично. Снимок keyed по коммиту (один на коммит, latest-wins).
 */
import type { Database } from '../core/db'
import { t } from '../core/i18n'
import type { CommitInfo } from '../passport/constitution-derive'

export interface HealthMetrics {
  lawCount: number
  /** средняя распространённость законов — падение = уползание от своей нормы */
  lawPrevalence: number
  activeFacts: number
  graphNodes: number
  graphEdges: number
  /** рёбер на узел — рост = оплотнение/god-узлы */
  density: number
  orphans: number
  broken: number
  gateCatches: number
}

const num = (db: Database, sql: string): number => {
  try {
    const r = db.query(sql).get() as { v: number | null } | null
    return r && r.v != null ? r.v : 0
  } catch {
    return 0
  }
}

const hasTable = (db: Database, name: string): boolean =>
  (db.query("SELECT COUNT(*) v FROM sqlite_master WHERE type='table' AND name=?").get(name) as { v: number }).v > 0

/** Снимок дешёвых метрик здоровья из уже построенного паспорта. */
export function computeHealth(db: Database): HealthMetrics {
  const lawCount = num(db, "SELECT COUNT(*) v FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'")
  const lawPrevalence = num(db, "SELECT AVG(prevalence) v FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'")
  const activeFacts = num(db, 'SELECT COUNT(*) v FROM fact_journal WHERE superseded_by IS NULL')
  const graphNodes = hasTable(db, 'graph_nodes') ? num(db, 'SELECT COUNT(*) v FROM graph_nodes') : 0
  const graphEdges = hasTable(db, 'graph_edges') ? num(db, 'SELECT COUNT(*) v FROM graph_edges') : 0
  const orphans = hasTable(db, 'entity_nodes') ? num(db, 'SELECT COUNT(*) v FROM entity_nodes WHERE in_deg=0 AND is_hub=0') : 0
  const broken = hasTable(db, 'entity_broken') ? num(db, 'SELECT COUNT(*) v FROM entity_broken') : 0
  const gateCatches = hasTable(db, 'gate_log') ? num(db, 'SELECT COUNT(*) v FROM gate_log') : 0
  return {
    lawCount,
    lawPrevalence,
    activeFacts,
    graphNodes,
    graphEdges,
    density: graphNodes > 0 ? graphEdges / graphNodes : 0,
    orphans,
    broken,
    gateCatches,
  }
}

export function ensureSnapshots(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS health_snapshot(commit_hash TEXT PRIMARY KEY, ts TEXT NOT NULL, metrics TEXT NOT NULL)')
}

/** Снять и записать снимок для коммита (latest-wins на коммит). no-git → пропуск. */
export function captureHealth(db: Database, commit: string, now: string): void {
  if (!commit || commit === 'no-git') return
  try {
    ensureSnapshots(db)
    const m = computeHealth(db)
    db.query(
      'INSERT INTO health_snapshot(commit_hash, ts, metrics) VALUES(?,?,?) ON CONFLICT(commit_hash) DO UPDATE SET ts=excluded.ts, metrics=excluded.metrics',
    ).run(commit, now, JSON.stringify(m))
  } catch {
    /* дрейф — обогащение, не обязанность */
  }
}

export interface DriftDelta {
  span: number // сколько снимков между базой и текущим
  latest: HealthMetrics
  base: HealthMetrics
}

/** Латест против базового снимка (baseWindow снимков назад или самый ранний). */
export function computeDrift(db: Database, baseWindow = 8): DriftDelta | null {
  try {
    if (!hasTable(db, 'health_snapshot')) return null
    const rows = db.query('SELECT metrics FROM health_snapshot ORDER BY ts DESC').all() as Array<{ metrics: string }>
    if (rows.length < 2) return null // нужен хотя бы один прошлый снимок
    const latest = JSON.parse(rows[0].metrics) as HealthMetrics
    const baseIdx = Math.min(baseWindow, rows.length - 1)
    const base = JSON.parse(rows[baseIdx].metrics) as HealthMetrics
    return { span: baseIdx, latest, base }
  } catch {
    return null
  }
}

/**
 * Строка дрейфа для /sym-status: только УХУДШЕНИЯ выше шума (конвенции просели,
 * сироты/битые/плотность/гейт выросли). Всё стабильно/лучше → пустая строка (молчим).
 */
export function renderDrift(d: DriftDelta | null): string {
  if (!d) return ''
  const worse: string[] = []
  const prevDrop = d.base.lawPrevalence - d.latest.lawPrevalence
  if (prevDrop >= 0.03) worse.push(t(`конвенции −${Math.round(prevDrop * 100)}% (уползание от своей нормы)`, `conventions −${Math.round(prevDrop * 100)}% (drifting from the project's own norm)`))
  if (d.latest.orphans - d.base.orphans >= 3) worse.push(t(`сироты +${d.latest.orphans - d.base.orphans}`, `orphans +${d.latest.orphans - d.base.orphans}`))
  if (d.latest.broken - d.base.broken >= 1) worse.push(t(`битые ссылки +${d.latest.broken - d.base.broken}`, `broken links +${d.latest.broken - d.base.broken}`))
  if (d.base.density > 0 && d.latest.density - d.base.density >= 0.5) worse.push(t(`плотность графа +${(d.latest.density - d.base.density).toFixed(1)}/узел (оплотнение)`, `graph density +${(d.latest.density - d.base.density).toFixed(1)}/node (tightening)`))
  if (d.latest.gateCatches - d.base.gateCatches >= 10) worse.push(t(`гейт-поимки +${d.latest.gateCatches - d.base.gateCatches}`, `gate catches +${d.latest.gateCatches - d.base.gateCatches}`))
  if (worse.length === 0) return ''
  return t(` Уползание (за ${d.span} замеров, только ухудшения): ${worse.join(' · ')}`, ` Drift (over ${d.span} snapshots, regressions only): ${worse.join(' · ')}`)
}

// ── Hotspot-зоны (CodeScene: частота изменений × сложность) ───────────────────

/** fix/revert-коммит = сигнал хрупкости (баг-фиксы копятся там, где болит). */
const FIX_SUBJECT = /^fix(\(|!|:)|^revert|откат/i

export interface Hotspot {
  file: string
  fixes: number
  size: number
  /** частота фиксов × размер — где беспорядок накапливается быстрее всего */
  score: number
}

/**
 * Hotspot-файлы: часто-чинимые И крупные (churn × complexity-прокси=размер).
 * Автоматизирует ручной «периодический рефактор» — указывает ГДЕ копится
 * беспорядок, вместо рефактора по расписанию вслепую. Только существующие файлы
 * (в sizeByFile), ≥2 фиксов (единичный — не тренд). Детерминированно из git.
 */
export function computeHotspots(commits: CommitInfo[], sizeByFile: Map<string, number>, k = 8): Hotspot[] {
  const fixFreq = new Map<string, number>()
  for (const c of commits) {
    if (!FIX_SUBJECT.test(c.subject.trim())) continue
    for (const f of new Set(c.files)) fixFreq.set(f, (fixFreq.get(f) ?? 0) + 1)
  }
  return [...fixFreq.entries()]
    .filter((e) => e[1] >= 2 && sizeByFile.has(e[0]))
    .map((e) => ({ file: e[0], fixes: e[1], size: sizeByFile.get(e[0]) as number, score: e[1] * (sizeByFile.get(e[0]) as number) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Полный отчёт /sym-drift: здоровье сейчас + тренд-дрейф + hotspot-зоны. */
export function renderDriftReport(health: HealthMetrics, drift: DriftDelta | null, hotspots: Hotspot[]): string {
  const L: string[] = [t('Symbiont · здоровье проекта и куда оно движется', 'Symbiont · project health and where it is heading'), '']
  L.push(t(' Здоровье сейчас', ' Health right now'))
  L.push(t(`   законов ${health.lawCount} · ср.распространённость ${Math.round(health.lawPrevalence * 100)}% · активных фактов ${health.activeFacts}`, `   laws ${health.lawCount} · avg prevalence ${Math.round(health.lawPrevalence * 100)}% · active facts ${health.activeFacts}`))
  L.push(t(`   граф ${health.graphNodes} узлов / ${health.graphEdges} рёбер (плотность ${health.density.toFixed(2)}/узел)`, `   graph ${health.graphNodes} nodes / ${health.graphEdges} edges (density ${health.density.toFixed(2)}/node)`))
  if (health.orphans > 0 || health.broken > 0) L.push(t(`   контент: сирот ${health.orphans} · битых ссылок ${health.broken}`, `   content: orphans ${health.orphans} · broken links ${health.broken}`))
  L.push('')

  const dl = renderDrift(drift)
  L.push(t(' Тренд (против прошлых замеров)', ' Trend (against previous snapshots)'))
  L.push(dl ? '  ' + dl.trim() : drift ? t('   стабильно или лучше — уползания нет', '   stable or better — no drift') : t('   снимков мало — тренд появится за несколько коммитов', '   too few snapshots — the trend appears after a few commits'))
  L.push('')

  L.push(t(' Где чаще всего чинят (частота починок × размер файла — там копится беспорядок; кандидаты на рефакторинг)', ' Most-repaired places (fix frequency × file size — where mess accumulates; refactoring candidates)'))
  if (hotspots.length === 0) L.push(t('   выраженных зон нет — история починок ровная', '   no pronounced areas — the repair history is even'))
  else for (const h of hotspots) L.push(t(`   ${h.file} · фиксов ${h.fixes} · ${h.size} строк`, `   ${h.file} · fixes ${h.fixes} · ${h.size} lines`))
  return L.join('\n')
}

/**
 * Hotspot-зоны прямо из git-истории проекта — ЕДИНСТВЕННЫЙ путь их получить.
 *
 * Заведена после реального расхождения: фоновая работа считала hotspot'ы сама,
 * а команда здоровья подставляла пустой список — и два канала об одном и том же
 * говорили разное («hotspot: data-root.ts» против «выраженных hotspot-ов нет»).
 * Когда расчёт один на всех, разойтись физически невозможно.
 */
export function hotspotsFromGit(projectRoot: string): Hotspot[] {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join, extname } = require('node:path') as typeof import('node:path')
  const { parseCommitLog } = require('../passport/constitution-derive') as typeof import('../passport/constitution-derive')
  const { CODE_EXT } = require('../miner/walk') as typeof import('../miner/walk')

  const r = spawnSync('git', ['log', '--name-only', '--pretty=format:@%H%x09%s', '-n', '400'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string' || !r.stdout) return []

  const commits = parseCommitLog(r.stdout)
  const touched = new Set<string>()
  for (const c of commits) if (FIX_SUBJECT.test(c.subject.trim())) for (const f of c.files) touched.add(f)
  const sizeByFile = new Map<string, number>()
  for (const rel of touched) {
    if (!CODE_EXT.has(extname(rel).toLowerCase())) continue // hotspot = код, не конфиг и не данные
    try {
      sizeByFile.set(rel, readFileSync(join(projectRoot, rel), 'utf8').split('\n').length)
    } catch {
      /* файл удалён — он уже не болит */
    }
  }
  return computeHotspots(commits, sizeByFile)
}
