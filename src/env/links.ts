/**
 * Связи конфигурации с кодом как РЁБРА ГРАФА, а не только материал проверок.
 *
 * До этого контракт среды умел находить противоречия, но карта их не видела:
 * nuxt.config висел одиноким узлом с нулевыми связями, хотя влияет на
 * видеоплеер сильнее многих импортов. Картина мира была неполной ровно там, где
 * ломаются продакшены.
 *
 * Рёбра здесь другого сорта, чем импорты, и это не деталь, а суть: импорт
 * говорит «этот код вызывает тот», а такое ребро — «эта настройка управляет
 * этим кодом». Поэтому они хранятся отдельно, помечены способом обнаружения и
 * несут улику: без улики связь недоказуема, а недоказуемая связь на карте хуже
 * её отсутствия.
 *
 * Порог существует по той же причине: лексическое совпадение по частому слову
 * связывает всё со всем и превращает карту в кашу. Улика обязана быть редкой.
 */
import type { Database } from '../core/db'
import { isConfigFile, isSecretCarrier, lexicalLinks, historicalLinks, type ConfigEntry, type ConfigLink } from './config-graph'
import { t } from '../core/i18n'

/** Больше — уже не связь, а общее место: настройка, влияющая на полпроекта. */
const MAX_CODE_PER_CONFIG = 12

export function ensureConfigEdgeTable(db: Database): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS config_edges(
       config_file TEXT NOT NULL, code_file TEXT NOT NULL, via TEXT NOT NULL,
       config_key TEXT NOT NULL, token TEXT,
       PRIMARY KEY(config_file, code_file, config_key))`,
  )
  purgeSecretCarrierEdges(db)
}

/**
 * Рёбра от носителей секретов вычищаются при каждом обращении: пока боевой
 * .env читался, его токены могли осесть здесь и всплывать в подсудных строках
 * подачи. Проверка стоит и на записи, и на чтении — как у непрозрачного
 * материала в майнере: уже накопленное чистится первым же обращением.
 */
function purgeSecretCarrierEdges(db: Database): void {
  try {
    const files = db.query('SELECT DISTINCT config_file FROM config_edges').all() as Array<{ config_file: string }>
    const del = db.query('DELETE FROM config_edges WHERE config_file=?')
    for (const f of files) if (isSecretCarrier(f.config_file)) del.run(f.config_file)
  } catch {
    /* таблица пуста или недоступна — чистить нечего */
  }
}

/**
 * Собрать связи из двух независимых источников и сохранить как проекцию.
 * Историческая связь ценнее лексической: совпадение слова можно объяснить
 * случайностью, а совместную правку — нет, это след реального инцидента.
 */
export function storeConfigEdges(db: Database, links: ConfigLink[]): number {
  ensureConfigEdgeTable(db)
  db.run('DELETE FROM config_edges')

  // Отсечка «настроек, связанных со всем»: они верны, но бесполезны на карте
  const perConfig = new Map<string, ConfigLink[]>()
  for (const l of links) {
    if (isSecretCarrier(l.configFile)) continue // носитель секретов не читается — и не связывается
    const list = perConfig.get(l.configFile) ?? []
    list.push(l)
    perConfig.set(l.configFile, list)
  }

  const ins = db.query('INSERT OR IGNORE INTO config_edges(config_file, code_file, via, config_key, token) VALUES(?,?,?,?,?)')
  let stored = 0
  for (const entry of perConfig) {
    const list = entry[1]
    // Историю вперёд: она доказательнее лексики
    list.sort((a, b) => (a.via === b.via ? 0 : a.via === 'история' ? -1 : 1))
    for (const l of list.slice(0, MAX_CODE_PER_CONFIG)) {
      ins.run(l.configFile, l.codeFile, l.via, l.key, l.token)
      stored++
    }
  }
  return stored
}

export interface ConfigEdgeRow {
  configFile: string
  codeFile: string
  via: string
  key: string
  token: string | null
}

export function readConfigEdges(db: Database, codeFile?: string): ConfigEdgeRow[] {
  try {
    ensureConfigEdgeTable(db)
    const rows = codeFile
      ? (db.query('SELECT config_file, code_file, via, config_key, token FROM config_edges WHERE code_file=?').all(codeFile) as Array<Record<string, string | null>>)
      : (db.query('SELECT config_file, code_file, via, config_key, token FROM config_edges').all() as Array<Record<string, string | null>>)
    return rows.map((r) => ({
      configFile: String(r.config_file),
      codeFile: String(r.code_file),
      via: String(r.via),
      key: String(r.config_key),
      token: r.token === null ? null : String(r.token),
    }))
  } catch {
    return []
  }
}

/**
 * Полный сбор: лексика по содержимому + история по co-change. Читатели передаются
 * снаружи — модуль остаётся чистым и тестируемым без файловой системы.
 */
export function collectConfigLinks(
  entries: ConfigEntry[],
  codeFiles: Array<{ rel: string; content: string }>,
  cochange: Array<{ a: string; b: string; n: number }>,
): ConfigLink[] {
  const lex = lexicalLinks(entries, codeFiles)
  const hist = historicalLinks(cochange)
  // Дедуп: одна и та же пара, найденная обоими способами, остаётся историей
  const seen = new Set<string>()
  const out: ConfigLink[] = []
  for (const l of [...hist, ...lex]) {
    const id = `${l.configFile}|${l.codeFile}|${l.key}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(l)
  }
  return out
}

/**
 * Строка подачи при касании файла: какая настройка им управляет. Важна
 * формулировка «управляет», а не «связан»: связь без направления не подсказывает,
 * куда смотреть, когда что-то не работает.
 */
export function renderConfigInfluence(rows: ConfigEdgeRow[]): string {
  if (rows.length === 0) return ''
  const parts = rows.slice(0, 3).map((r) => {
    const why =
      r.via === 'история'
        ? t('правились вместе', 'changed together')
        : r.token
          ? t(`упоминание «${r.token}»`, `mention of “${r.token}”`)
          : t('связь по содержимому', 'linked by content')
    const key = r.key !== '(файл целиком)' ? ` · ${r.key}` : ''
    return `${r.configFile}${key} (${why})`
  })
  return `Symbiont · ${t('этим кодом управляет конфигурация', 'this code is governed by configuration')}: ${parts.join(' · ')}`
}

/** Только конфигурационные файлы среди путей проекта — для сбора записей. */
export const configPathsOf = (relPaths: string[]): string[] => relPaths.filter(isConfigFile)
