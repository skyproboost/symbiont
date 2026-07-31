/**
 * «Паспорт не врёт» — аудит само-образа (дрейф §6a, из разбора тулкита QA).
 *
 * Паспорт — это КАРТА, и худшая её болезнь не устаревание, а враньё: подать
 * узел удалённого файла, роль (z1) исчезнувшего модуля, урок про снесённую зону
 * или конвенцию, которую журнал уже вытеснил. Модель верит карте и уходит в
 * мёртвый путь — цена ошибки выше, чем у молчания (аксиома «факты, не догадки»).
 *
 * Инвариант, который здесь охраняется: ПОДАЁТСЯ ТОЛЬКО ЖИВОЕ.
 *
 * Разделение ответственности принципиально: проекции (граф, роли, тепло, уроки)
 * — производные, их мёртвые записи просто удаляются; журнал фактов — истина,
 * его записи НЕ удаляются никогда (Datomic), расхождение сводки с журналом
 * лишь сообщается и лечится пересборкой. Поэтому heal() трогает только проекции.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import { FactStore } from '../core/store'

export interface TruthIssue {
  kind: string
  detail: string
  count: number
  /** лечится ли автоматически (проекция) или требует пересборки (сводка) */
  healable: boolean
}

const tableExists = (db: Database, name: string): boolean => {
  try {
    return (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name) as { n: number }).n > 0
  } catch {
    return false
  }
}

const deadOf = (db: Database, table: string, column: string, root: string): string[] => {
  if (!tableExists(db, table)) return []
  try {
    const rows = db.query(`SELECT ${column} AS f FROM ${table}`).all() as Array<{ f: string }>
    return rows.filter((r) => typeof r.f === 'string' && !existsSync(join(root, r.f))).map((r) => r.f)
  } catch {
    return []
  }
}

/** Зоны уроков, которых больше нет на диске (урок про снесённый каталог). */
function deadLessonZones(db: Database, root: string): string[] {
  if (!tableExists(db, 'lessons')) return []
  try {
    const rows = db.query('SELECT DISTINCT zone FROM lessons').all() as Array<{ zone: string }>
    return rows.filter((r) => r.zone && r.zone !== '(корень)' && !existsSync(join(root, r.zone))).map((r) => r.zone)
  } catch {
    return []
  }
}

/**
 * Строки сводки, за которыми не стоит активный факт журнала. Направление важно:
 * «факт есть, но не подан» — норма (сводка урезана бюджетом), а «подано то,
 * чего в журнале нет» — враньё карты.
 */
export function staleSummaryLines(summary: string, activeStatements: string[]): string[] {
  const out: string[] = []
  let inFactSection = false
  for (const raw of summary.split('\n')) {
    const line = raw.trim()
    // Судим ТОЛЬКО секции, которые рендерятся из журнала. Отвергнут разбор по
    // форме строки: «- код — 138 файлов (86%)» (состав проекта) выглядит как
    // факт и давал бы ложное обвинение во вранье. Секция — надёжный якорь.
    if (line.startsWith('#')) {
      // «Смешанный стиль» сознательно исключён: он рендерится особым форматом
      // («filter/map/reduce: 53% / 47%»), а не из statement факта, и сверка по
      // префиксу давала ЛОЖНОЕ обвинение во вранье (поймано живым прогоном).
      inFactSection = /(Законы стиля|Преобладающий стиль|Профиль качества)/i.test(line)
      continue
    }
    if (!inFactSection || !line.startsWith('- ')) continue
    const body = line.slice(2).trim()
    if (!activeStatements.some((s) => body.startsWith(s))) out.push(body.slice(0, 120))
  }
  return out
}

/** Полный аудит само-образа; пустой список = паспорт честен. */
export function auditTruth(db: Database, root: string, dataDir: string): TruthIssue[] {
  const issues: TruthIssue[] = []
  const push = (kind: string, dead: string[], healable = true): void => {
    if (dead.length > 0) {
      issues.push({ kind, detail: dead.slice(0, 3).join(', ') + (dead.length > 3 ? ', …' : ''), count: dead.length, healable })
    }
  }

  push('узлы графа без файла', deadOf(db, 'graph_nodes', 'file', root))
  push('сущности контент-графа без файла', deadOf(db, 'entity_nodes', 'file', root))
  push('роли удалённых файлов', deadOf(db, 'node_summary', 'file', root))
  push('тепло удалённых файлов', deadOf(db, 'node_heat', 'file', root))
  push('уроки по несуществующим зонам', deadLessonZones(db, root))

  try {
    const summary = readFileSync(join(dataDir, 'SUMMARY.md'), 'utf8')
    const active = new FactStore(db).active().map((f) => f.statement)
    const stale = staleSummaryLines(summary, active)
    if (stale.length > 0) {
      issues.push({
        kind: 'строки сводки без активного факта',
        detail: stale.slice(0, 2).join(' · '),
        count: stale.length,
        healable: false, // журнал неприкосновенен — лечится пересборкой сводки
      })
    }
  } catch {
    /* сводки ещё нет — судить не о чем */
  }

  return issues
}

export interface HealReport {
  removed: number
  tables: string[]
}

/**
 * Вычистить мёртвое из ПРОЕКЦИЙ (журнал не трогается). Безопасно и
 * идемпотентно: то, что временно отсутствует (переключение ветки), вернётся
 * следующей пересборкой из истины — проекция на то и проекция.
 */
export function healProjections(db: Database, root: string): HealReport {
  const report: HealReport = { removed: 0, tables: [] }
  const clean = (table: string, column: string, dead: string[]): void => {
    if (dead.length === 0) return
    try {
      const del = db.query(`DELETE FROM ${table} WHERE ${column} = ?`)
      for (const f of dead) del.run(f)
      report.removed += dead.length
      report.tables.push(table)
    } catch {
      /* таблицы нет или занята — лечение best-effort */
    }
  }
  clean('graph_nodes', 'file', deadOf(db, 'graph_nodes', 'file', root))
  clean('entity_nodes', 'file', deadOf(db, 'entity_nodes', 'file', root))
  clean('node_summary', 'file', deadOf(db, 'node_summary', 'file', root))
  clean('node_heat', 'file', deadOf(db, 'node_heat', 'file', root))
  clean('lessons', 'zone', deadLessonZones(db, root))
  // Рёбра, повисшие после удаления узлов (обе стороны проверяются отдельно)
  if (tableExists(db, 'graph_edges') && tableExists(db, 'graph_nodes')) {
    try {
      const before = (db.query('SELECT COUNT(*) n FROM graph_edges').get() as { n: number }).n
      db.run('DELETE FROM graph_edges WHERE from_file NOT IN (SELECT file FROM graph_nodes) OR to_file NOT IN (SELECT file FROM graph_nodes)')
      const after = (db.query('SELECT COUNT(*) n FROM graph_edges').get() as { n: number }).n
      if (before > after) {
        report.removed += before - after
        report.tables.push('graph_edges')
      }
    } catch {
      /* best-effort */
    }
  }
  return report
}

/** Блок для /sym-drift: честный паспорт молчит. */
export function renderTruth(issues: TruthIssue[]): string {
  if (issues.length === 0) return ' Само-образ      паспорт честен: подаётся только живое'
  const lines = [' Само-образ — паспорт подаёт то, чего нет:']
  for (const i of issues) {
    lines.push(`   ${i.kind}: ${i.count} · ${i.detail}${i.healable ? '' : ' (пересборка уже назначена фоном)'}`)
  }
  return lines.join('\n')
}
