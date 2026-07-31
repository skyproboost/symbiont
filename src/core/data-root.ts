/**
 * Единый корень данных Symbiont + миграция из версионированных установок.
 *
 * Дыра, которую закрывает модуль: установка плагина ВЕРСИОНИРОВАНА
 * (~/.claude/plugins/cache/<маркет>/<плагин>/<версия>/), а данные писались в
 * .data внутри неё — каждый релиз молча обнулял журнал: Glicko-подтверждения,
 * LLM-правила, поправки владельца оставались в каталоге старой версии.
 * Храповик ломался дистрибуцией.
 *
 * Приоритет корня: явный --data (макрос ${CLAUDE_PLUGIN_DATA} в hooks/mcp) →
 * env CLAUDE_PLUGIN_DATA (хуки) → выведенный стабильный каталог установки
 * (plugins/data/<плагин>-<маркет> — для скиллов, где env недоступен) →
 * .data репозитория (dev-режим, каталог и так стабилен).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDb } from './db'
import { FactStore } from './store'

export interface DataRootResolution {
  root: string
  mode: 'argv' | 'env' | 'derived' | 'dev'
  /** .data текущей установки (кандидат в миграцию); null в dev-режиме */
  legacyRoot: string | null
}

const segments = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s.length > 0)

/** …/plugins/cache/<маркет>/<плагин>/<версия>/.data → …/plugins/data/<плагин>-<маркет> */
function deriveStableRoot(legacyDataDir: string): string | null {
  const segs = segments(legacyDataDir)
  const i = segs.findIndex((s, k) => s === 'plugins' && segs[k + 1] === 'cache')
  if (i === -1 || segs.length < i + 5) return null
  const market = segs[i + 2]
  const plugin = segs[i + 3]
  const prefix = rebuildPrefix(legacyDataDir, i)
  if (!prefix) return null
  return join(prefix, 'data', `${plugin}-${market}`)
}

/** Префикс пути до сегмента «plugins» включительно, в исходных разделителях. */
function rebuildPrefix(p: string, pluginsIdx: number): string | null {
  const parts = p.split(/([\\/]+)/) // сегменты вперемешку с разделителями
  let seg = -1
  let out = ''
  for (const part of parts) {
    out += part
    if (!/^[\\/]+$/.test(part) && part.length > 0) {
      seg++
      if (seg === pluginsIdx) return out
    }
  }
  return null
}

export function resolveDataRoot(
  legacyDataDir: string,
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): DataRootResolution {
  const flag = argv.indexOf('--data')
  // «${» в значении = макрос не был подставлен платформой — игнорируем, идём по цепочке ниже
  if (flag !== -1 && argv[flag + 1] && !argv[flag + 1].includes('${')) {
    return { root: argv[flag + 1], mode: 'argv', legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null }
  }
  const fromEnv = env.CLAUDE_PLUGIN_DATA?.trim()
  if (fromEnv) {
    return { root: fromEnv, mode: 'env', legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null }
  }
  const derived = deriveStableRoot(legacyDataDir)
  if (derived) {
    return { root: derived, mode: 'derived', legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null }
  }
  return { root: legacyDataDir, mode: 'dev', legacyRoot: null }
}

/**
 * argv без пары `--data <путь>`: флаг адресован резолверу корня, а не команде.
 *
 * Нужен потому, что скиллы теперь передают корень явно (как хуки), а разбор
 * аргументов у команд простой — `join(' ')` или поиск по списку. Без изъятия
 * пары путь к данным приезжал бы в текст воли владельца или в имя зоны.
 */
export function stripDataFlag(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data') {
      i++ // пропускаем и значение следом
      continue
    }
    out.push(args[i])
  }
  return out
}

/**
 * Строка о происхождении корня данных — только когда он ВЫВЕДЕН из пути файла.
 *
 * Живой случай, ради которого появилась. Скиллы не получали `--data` (в отличие
 * от хуков) и выводили корень из собственного расположения. Когда каталог
 * скиллов оказывался не там, где ждёт вывод, режим тихо сваливался в dev, и
 * дорогой аудит рассуждал о паспорте двухдневной давности, не сказав об этом ни
 * слова. Молчание о собственном решении — та же ошибка, что и молчание о сбое.
 */
export function renderRootNotice(res: DataRootResolution): string {
  if (res.mode !== 'dev') return ''
  return `  корень данных выведен из пути (режим dev): ${res.root}`
}

export interface MigrationReport {
  copiedSlugs: string[]
  mergedLlmFacts: number
}

/**
 * Одноразовый (идемпотентный) перенос накопленного из версионированных
 * установок в стабильный корень:
 * 1) для каждого проекта-слага берётся ЦЕЛИКОМ каталог самой свежей версии,
 *    если в стабильном корне проекта ещё нет;
 * 2) из более старых версий доливаются активные LLM-факты, чей key ещё не
 *    представлен активной записью (дораны /sym-learn прошлых версий не гибнут).
 * Обработанные версии помечаются в .migrated.json — повторный вызов дёшев.
 */
/**
 * Миграция осмысленна ТОЛЬКО для версионированной установки
 * (…/plugins/cache/<маркет>/<плагин>/<версия>/.data), где соседние каталоги —
 * действительно прошлые версии плагина.
 *
 * Догфудинг-находка: без этой проверки dev-режим (<репо>/.data) поднимался на
 * два уровня и объявлял «версиями» ВСЕ соседние проекты владельца — паспорта
 * чужих доменов (labreadai-v2 и др.) уезжали в чужой корень данных.
 */
function isVersionedInstall(legacyDataDir: string): boolean {
  const segs = segments(legacyDataDir)
  return segs.some((s, k) => s === 'plugins' && segs[k + 1] === 'cache')
}

export function migrateLegacyPassports(res: DataRootResolution): MigrationReport {
  const report: MigrationReport = { copiedSlugs: [], mergedLlmFacts: 0 }
  if (!res.legacyRoot || res.root === res.legacyRoot) return report
  if (!isVersionedInstall(res.legacyRoot)) return report

  // …/<плагин>/<версия>/.data → перечень всех версий соседних установок
  const versionDir = dirname(res.legacyRoot)
  const versionsRoot = dirname(versionDir)
  let versions: string[]
  try {
    versions = readdirSync(versionsRoot).filter((v) => existsSync(join(versionsRoot, v, '.data')))
  } catch {
    return report
  }
  versions.sort(compareVersionsDesc)

  mkdirSync(res.root, { recursive: true })
  const markerPath = join(res.root, '.migrated.json')
  let done: string[] = []
  try {
    done = JSON.parse(readFileSync(markerPath, 'utf8')).done ?? []
  } catch {
    /* маркера ещё нет */
  }
  const pending = versions.filter((v) => !done.includes(v))
  if (pending.length === 0) return report

  for (const v of versions) {
    // проходим все версии от свежей к старой: свежая даёт целые каталоги,
    // старые — доливку LLM-фактов
    const dataDir = join(versionsRoot, v, '.data')
    let slugs: string[]
    try {
      slugs = readdirSync(dataDir)
    } catch {
      continue
    }
    for (const slug of slugs) {
      const src = join(dataDir, slug)
      const dst = join(res.root, slug)
      if (!existsSync(join(src, 'passport.db'))) continue
      if (!existsSync(join(dst, 'passport.db'))) {
        try {
          cpSync(src, dst, { recursive: true })
          report.copiedSlugs.push(slug)
        } catch {
          continue
        }
      } else {
        report.mergedLlmFacts += mergeLlmFacts(join(src, 'passport.db'), join(dst, 'passport.db'))
      }
    }
  }

  try {
    writeFileSync(markerPath, JSON.stringify({ done: versions, at: new Date().toISOString() }, null, 1), 'utf8')
  } catch {
    /* маркер — оптимизация повторных заходов, не обязанность */
  }
  return report
}

/** Активные LLM-факты источника, отсутствующие в приёмнике, — перенос как есть. */
function mergeLlmFacts(srcDb: string, dstDb: string): number {
  let merged = 0
  try {
    const src = openDb(srcDb, { readonly: true })
    const dst = openDb(dstDb)
    try {
      new FactStore(dst) // приёмник из старой версии может не иметь колонок рейтинга — домигрировать схему
      const rows = src
        .query("SELECT * FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%'")
        .all() as Array<Record<string, unknown>>
      const exists = dst.query('SELECT 1 AS x FROM fact_journal WHERE key=? AND superseded_by IS NULL')
      const ins = dst.query(
        `INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by, rating, deviation, confirmations)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
      )
      for (const r of rows) {
        if (exists.get(r.key as string)) continue
        ins.run(
          r.key as string, r.area as string, r.statement as string, r.tier as string,
          r.prevalence as number, r.positive as number, r.total as number, r.source as string,
          r.asserted_at as string, r.seen_at as string,
          (r.rating as number | null) ?? null, (r.deviation as number | null) ?? null,
          (r.confirmations as number | null) ?? 0,
        )
        merged++
      }
    } finally {
      src.close()
      dst.close()
    }
  } catch {
    /* битая/старая база — миграция fail-open, остальное не валим */
  }
  return merged
}

/**
 * Semver-каталоги — от свежих к старым; НЕ-semver (установки по SHA коммита
 * до введения версий) — в самый хвост: они заведомо древнее любого релиза.
 * Урок живого прогона: parseInt('1313b62…')=1313 «побеждал» 0.14.0.
 */
function compareVersionsDesc(a: string, b: string): number {
  const sa = /^\d+\.\d+\.\d+$/.test(a)
  const sb = /^\d+\.\d+\.\d+$/.test(b)
  if (sa !== sb) return sa ? -1 : 1
  if (!sa) return b.localeCompare(a)
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d !== 0) return d
  }
  return 0
}
