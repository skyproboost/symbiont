/**
 * Каскад осей профиля (CONCEPT §4.1): оси наследуются по дереву проекта, как
 * CSS по DOM. Заданное на корне («топ-1 по производительности») действует всюду,
 * пока не переопределено локально («этот модуль legacy — только не сломать»);
 * конфликт решает специфичность — более локальное побеждает.
 *
 * Зачем: без каскада профиль качества один на весь проект, и агент, спускаясь в
 * зону миграций или в legacy-модуль, получает ту же общую планку. Каскад даёт
 * зоне её ЭФФЕКТИВНЫЙ набор условий без перечисления зон в ядре — они выводятся
 * теми же сигналами (signals.ts), что и корневой профиль.
 *
 * Ключевое решение подачи — ДЕЛЬТА, а не полный набор: корневые оси уже пришли
 * в стартовой сводке, повторять их на каждое касание файла — платить токенами за
 * известное (аксиома «пассивная цена ≈ 0»). Подаётся только то, что зона
 * добавляет или чем ограничивает.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import { SIGNALS, matchSignal } from './signals'

/** Ось качества ← сигнал (тот же каталог, что у корневого профиля). */
const ZONE_AXES: Array<{ axis: string; signal: keyof typeof SIGNALS }> = [
  { axis: 'корректность', signal: 'testing' },
  { axis: 'целостность данных', signal: 'db' },
  { axis: 'SEO', signal: 'seo' },
  { axis: 'поставляемость', signal: 'deploy' },
  { axis: 'доступность', signal: 'a11y' },
  { axis: 'безопасность', signal: 'security' },
  { axis: 'фронтенд', signal: 'frontend' },
]

/** Зона считается хрупкой от стольких fix-коммитов (как в авто-конституции). */
const FRAGILE_MIN_FIXES = 4
const ZONE_MIN_FILES = 2
// Заявление зоны о своём статусе живёт в ШАПКЕ файла, а не в середине текста:
// слово «устаревш» встречается в любых рассуждениях об устаревании, и без этого
// ограничения каталог docs объявлял сам себя legacy (живая находка).
const LOCAL_DOC_LIMIT = 400

export interface ZoneProfile {
  zone: string
  /** оси, обнаруженные ЛОКАЛЬНО по содержимому зоны */
  axes: string[]
  /** локальные ограничения (побеждают амбицию корня) */
  constraints: string[]
}

export interface EffectiveProfile {
  zone: string
  /** оси зоны, которых нет в корневом профиле (то, что каскад добавил) */
  addedAxes: string[]
  constraints: string[]
}

/**
 * Цепочка зон файла от общей к частной — порядок = возрастание специфичности.
 * 'src/core/store.ts' → ['src', 'src/core']. Файл в корне зон не имеет.
 */
export function zoneAncestors(file: string): string[] {
  const parts = file.replaceAll('\\', '/').split('/')
  if (parts.length <= 1) return []
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/** Локальный текст зоны: её собственные README/доки (сигналы docs без корня). */
function localDocs(root: string, zone: string, zonePaths: string[]): string {
  const docs = zonePaths.filter((p) => /\.(md|mdx|rst|txt)$/i.test(p)).slice(0, 6)
  const parts: string[] = []
  for (const rel of docs) {
    try {
      parts.push(readFileSync(join(root, rel), 'utf8').slice(0, LOCAL_DOC_LIMIT))
    } catch {
      /* исчез — пропускаем */
    }
  }
  return parts.join('\n')
}

/**
 * Профили всех зон проекта. fixZones — плотность fix-коммитов по зонам
 * (тот же сигнал хрупкости, что у авто-конституции, чтобы «осторожно» здесь и
 * там значило одно и то же).
 */
export function computeZoneProfiles(
  root: string,
  relPaths: string[],
  fixZones: Record<string, number> = {},
): ZoneProfile[] {
  const byZone = new Map<string, string[]>()
  for (const p of relPaths) {
    for (const z of zoneAncestors(p)) {
      const list = byZone.get(z)
      if (list) list.push(p)
      else byZone.set(z, [p])
    }
  }

  const out: ZoneProfile[] = []
  for (const entry of byZone) {
    const zone = entry[0]
    const paths = entry[1]
    if (paths.length < ZONE_MIN_FILES) continue // одиночный файл — не зона
    const docs = localDocs(root, zone, paths)
    const axes: string[] = []
    for (const d of ZONE_AXES) {
      if (matchSignal(SIGNALS[d.signal], { paths, docs })) axes.push(d.axis)
    }
    const constraints: string[] = []
    // Локальное переопределение амбиции: устаревшая зона (по путям или своим докам)
    if (matchSignal(SIGNALS.legacy, { paths, docs })) {
      constraints.push('зона объявлена устаревшей — менять минимально, улучшения сверх задачи не вносить')
    }
    // Хрупкость из git-истории: правки здесь исторически требовали починок
    const fixes = fixZones[zone] ?? 0
    if (fixes >= FRAGILE_MIN_FIXES) {
      constraints.push(`зона хрупкая (${fixes} правок-починок в истории) — менять осторожно и с проверкой`)
    }
    if (axes.length > 0 || constraints.length > 0) out.push({ zone, axes, constraints })
  }
  out.sort((a, b) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0))
  return out
}

/**
 * Эффективный набор для файла: проход по предкам от общего к частному,
 * более локальное побеждает (ограничения накапливаются, ближайшая зона —
 * источник имени). Оси корня вычитаются: подаём только каскадную дельту.
 */
export function effectiveProfile(
  file: string,
  rootAxes: string[],
  profiles: ZoneProfile[],
): EffectiveProfile | null {
  const byZone = new Map(profiles.map((p) => [p.zone, p]))
  const rootSet = new Set(rootAxes)
  const added: string[] = []
  const constraints: string[] = []
  let deepest: string | null = null

  for (const z of zoneAncestors(file)) {
    const p = byZone.get(z)
    if (!p) continue
    deepest = z
    for (const a of p.axes) {
      if (!rootSet.has(a) && !added.includes(a)) added.push(a)
    }
    for (const c of p.constraints) {
      if (!constraints.includes(c)) constraints.push(c)
    }
  }
  if (!deepest || (added.length === 0 && constraints.length === 0)) return null
  return { zone: deepest, addedAxes: added, constraints }
}

/**
 * Оси корневого профиля из журнала: «корректность — ось качества здесь (…)»
 * → «корректность». Нужны, чтобы вычесть их из подачи зоны (не повторять сводку).
 */
export function rootAxesFromFacts(statements: string[]): string[] {
  const out: string[] = []
  for (const s of statements) {
    const axis = s.split('—')[0].trim()
    if (axis.length > 0 && !out.includes(axis)) out.push(axis)
  }
  return out
}

/** Строка подачи: факты об эффективных условиях зоны, без императивов. */
export function renderEffective(eff: EffectiveProfile): string {
  const parts: string[] = []
  if (eff.addedAxes.length > 0) parts.push(`дополнительно важно здесь: ${eff.addedAxes.join(', ')}`)
  for (const c of eff.constraints) parts.push(c)
  // «Каскад профиля» — внутреннее имя механизма наследования. Читателю строки
  // важно не как это устроено, а откуда взялось условие: из родительских
  // каталогов. Формулировка правится по замечанию владельца о жаргоне.
  return `Symbiont · условия каталога ${eff.zone} (унаследованы от родительских): ${parts.join(' · ')}`
}

// ── хранение (проекция, пересобирается вместе с паспортом) ────────────────────

export function ensureZoneTable(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS zone_profile(zone TEXT PRIMARY KEY, axes TEXT NOT NULL, constraints TEXT NOT NULL)')
}

export function storeZoneProfiles(db: Database, profiles: ZoneProfile[]): void {
  ensureZoneTable(db)
  db.run('DELETE FROM zone_profile') // проекция целиком перезаписывается из истины
  const ins = db.query('INSERT INTO zone_profile(zone, axes, constraints) VALUES(?,?,?)')
  for (const p of profiles) ins.run(p.zone, JSON.stringify(p.axes), JSON.stringify(p.constraints))
}

export function readZoneProfiles(db: Database): ZoneProfile[] {
  try {
    ensureZoneTable(db)
    return (db.query('SELECT zone, axes, constraints FROM zone_profile').all() as Array<{ zone: string; axes: string; constraints: string }>).map(
      (r) => ({ zone: r.zone, axes: JSON.parse(r.axes) as string[], constraints: JSON.parse(r.constraints) as string[] }),
    )
  } catch {
    return [] // нет проекции — каскад молчит (fail-open)
  }
}
