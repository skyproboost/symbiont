/**
 * Конфигурационный слой графа: сущности среды и их связи с кодом.
 *
 * ЗАЧЕМ ЭТО УСТРОЕНО ИМЕННО ТАК. Кейсов бесконечно: CSP, CORS, вебсокеты,
 * Redis, DNS, пиксели, лимиты тела запроса, права, фича-флаги — перечислить их
 * нельзя, и любой перечень устареет раньше, чем будет дописан. Поэтому здесь
 * НЕ каталог технологий, а механизм ОТКРЫТИЯ связей, работающий одинаково для
 * того, чего мы не предвидели.
 *
 * Ключевое наблюдение: конфигурация — это пары «ключ → значение», записанные в
 * ограниченном числе форматов (json/yaml/toml/ini/conf/env). Понимать смысл
 * ключа не нужно, чтобы увидеть, что он СУЩЕСТВУЕТ и что его значение
 * встречается в коде. Смысл появляется позже — из трёх источников, ни один из
 * которых мы не пишем руками:
 *
 *   1) ЛЕКСИЧЕСКИЙ  — редкое значение из конфига встречается в коде (порт 6379,
 *      домен, имя переменной, строка политики). Связь видна без семантики.
 *   2) ИСТОРИЧЕСКИЙ — файлы правились вместе (co-change). Если конфиг чинили
 *      одним коммитом с кодом, между ними есть связь, даже если она не выражена
 *      ни одним символом. Это буквально след прошлого инцидента.
 *   3) ВЫВЕДЕННЫЙ   — модель, глядя на найденные конфиги проекта, формулирует
 *      правило «такой код требует такого разрешения». Правило становится
 *      фактом журнала: стареет, подтверждается, умирает — как всё остальное.
 *
 * Отвергнуто (и почему): policy-as-code с правилами, которые пишет человек.
 * Исследование ниши показывает, что именно на этом класс инструментов и умер —
 * 53% практиков отказываются писать правила. Правило, которое надо написать,
 * никогда не будет написано для случая, о котором никто не подумал.
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

/** Форматы, в которых живёт конфигурация. Расширение — лишь подсказка. */
const CONFIG_EXT = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.env', '.cfg', '.properties'])
const CONFIG_NAME = /(^|\/)(\.env[\w.-]*|[\w.-]*\.?config\.[tj]s|nginx[\w.-]*\.conf|docker-compose[\w.-]*\.ya?ml|Dockerfile|\.htaccess|[\w-]*\.tf|Caddyfile|\.npmrc|Procfile)$/i

/** Является ли файл носителем конфигурации — по расширению или по имени. */
export function isConfigFile(rel: string): boolean {
  if (CONFIG_EXT.has(extname(rel).toLowerCase())) return true
  return CONFIG_NAME.test(rel.replaceAll('\\', '/'))
}

export interface ConfigEntry {
  /** файл, в котором объявлено */
  file: string
  /** ключ настройки как он записан (media-src, REDIS_URL, client_max_body_size) */
  key: string
  /** значение как строка; пусто, если ключ без значения */
  value: string
  /** «редкие» токены значения и ключа — материал для лексических связей */
  tokens: string[]
}

// Пары ключ-значение в любом из форматов. Намеренно грубо: точный парсер на
// каждый формат дал бы немного, а сломался бы на первом же нестандартном файле.
const KV_PATTERNS: RegExp[] = [
  /^\s*["']?([\w.-]{2,60})["']?\s*[:=]\s*["']?([^\n"',;{}]{1,300})/gm, // json/yaml/toml/ini/env
  /^\s*(?:add_header|set|proxy_set_header)\s+([\w-]{2,60})\s+["']?([^;\n]{1,300})/gim, // nginx
  /^\s*([A-Z][A-Z0-9_]{2,60})\s+(.{1,300})$/gm, // Dockerfile-директивы
  // Однострочный JSON: весь объект в одной строке, ключи не в её начале
  /"([\w.-]{2,60})"\s*:\s*"?([^",}\n]{1,300})/g,
  // Образец окружения: значение ПУСТОЕ по определению («API_KEY=»), и уликой
  // служит само имя переменной — его и ищем в коде. Остальные паттерны требуют
  // непустого значения и такую строку теряли целиком.
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,60})\s*=\s*(.{0,300})$/gm,
]

/** Слишком общие слова: связь по ним была бы шумом, а не находкой. */
const STOP_TOKENS = new Set([
  'true', 'false', 'null', 'none', 'self', 'default', 'name', 'type', 'value', 'version', 'path',
  'url', 'host', 'port', 'image', 'build', 'test', 'main', 'index', 'src', 'dist', 'public', 'app',
  'http', 'https', 'localhost', 'latest', 'production', 'development', 'string', 'number', 'object',
])

/**
 * Токены, по которым имеет смысл искать связь с кодом: достаточно длинные,
 * не общеупотребительные, несущие опознаваемую форму (домен, схема, ИМЯ_ПЕРЕМЕННОЙ,
 * директива-через-дефис, число-порт).
 */
export function significantTokens(key: string, value: string, strict = false): string[] {
  const out = new Set<string>()
  const consider = (raw: string): void => {
    const t = raw.trim().replace(/^['"`]|['"`]$/g, '')
    if (t.length < 3 || t.length > 60) return
    const low = t.toLowerCase()
    if (STOP_TOKENS.has(low)) return
    // СИЛЬНЫЕ формы: их совпадение в коде — почти наверняка та же сущность
    const strongForm =
      /^[A-Z][A-Z0-9_]{2,}$/.test(t) || // ИМЯ_ПЕРЕМЕННОЙ
      /^[a-z]+-[a-z-]+$/.test(low) || // директива-через-дефис (media-src, worker-src)
      /^[a-z][\w.-]*\.[a-z]{2,}$/.test(low) || // домен
      /^[a-z]+:$/.test(low) || // схема (blob:, data:, wss:)
      /^\d{2,5}$/.test(t) // порт
    // СЛАБАЯ форма: просто длинное слово. Годится как материал для выведенных
    // правил, но НЕ как улика связи: «generate», «always», «description»
    // встречаются в любом проекте и связывают всё со всем (живая находка).
    const weakForm = /^[a-z][\w-]{4,}$/.test(low)
    if (strongForm || (!strict && weakForm)) out.add(t)
  }
  consider(key)
  for (const part of value.split(/[\s,;|]+/)) consider(part)
  return [...out]
}

/** Разбор одного конфигурационного файла в записи «ключ-значение-токены». */
export function parseConfigFile(rel: string, content: string): ConfigEntry[] {
  const out: ConfigEntry[] = []
  const seen = new Set<string>()
  for (const re of KV_PATTERNS) {
    for (const m of content.matchAll(re)) {
      const key = m[1].trim()
      const value = (m[2] ?? '').trim()
      const id = `${key}=${value}`
      if (seen.has(id)) continue
      seen.add(id)
      const tokens = significantTokens(key, value)
      if (tokens.length === 0) continue
      // Ключ тоже улика, но только сильной формы: в .env имя переменной И ЕСТЬ
      // сущность, которую ищем в коде, а «paths»/«exclude» отсеются как слабые
      const valueTokens = significantTokens(key, value, true)
      out.push({ file: rel, key, value: value.slice(0, 300), tokens, valueTokens })
      if (out.length >= 400) return out // конфиг-гигант: смысла в хвосте нет
    }
  }
  return out
}

export interface ConfigLink {
  /** конфигурационный файл */
  configFile: string
  /** ключ, через который обнаружена связь */
  key: string
  /** файл кода */
  codeFile: string
  /** как обнаружено — влияет на доверие и на формулировку */
  via: 'лексика' | 'история'
  /** токен-улика для лексической связи */
  token: string | null
}

/**
 * Лексические связи: значение из конфига дословно встречается в коде.
 * Односторонняя проверка «конфиг → код» намеренна: обратное направление
 * (любое слово кода ищем в конфиге) даёт лавину совпадений.
 */
export function lexicalLinks(entries: ConfigEntry[], codeFiles: Array<{ rel: string; content: string }>): ConfigLink[] {
  const out: ConfigLink[] = []
  const byToken = new Map<string, ConfigEntry[]>()
  for (const e of entries) {
    for (const t of e.valueTokens) {
      const list = byToken.get(t) ?? []
      list.push(e)
      byToken.set(t, list)
    }
  }
  // Токен, встречающийся в половине конфигов, ничего не различает
  const tooCommon = new Set([...byToken.entries()].filter((p) => p[1].length > 8).map((p) => p[0]))

  // Второй фильтр, по КОДУ: имя проекта или расхожее слово встречается в сотне
  // файлов и связывает всё со всем. Улика обязана быть редкой с обеих сторон —
  // иначе карта превращается в кашу (поймано живым прогоном: токен «Symbiont»
  // связал конфиг со всеми тестами разом).
  const CODE_SHARE_LIMIT = 0.12
  const maxFiles = Math.max(3, Math.floor(codeFiles.length * CODE_SHARE_LIMIT))
  const hitCount = new Map<string, number>()
  for (const f of codeFiles) {
    const lower = f.content.toLowerCase()
    for (const token of byToken.keys()) {
      if (lower.includes(token.toLowerCase())) hitCount.set(token, (hitCount.get(token) ?? 0) + 1)
    }
  }

  const seen = new Set<string>()
  for (const f of codeFiles) {
    const lower = f.content.toLowerCase()
    for (const entry of byToken) {
      const token = entry[0]
      if (tooCommon.has(token) || (hitCount.get(token) ?? 0) > maxFiles) continue
      if (!lower.includes(token.toLowerCase())) continue
      for (const e of entry[1]) {
        if (e.file === f.rel) continue
        // Одна и та же пара по одному токену — одна связь, а не столько, сколько
        // раз токен встретился в разных ключах конфига
        const id = `${e.file}|${f.rel}|${token}`
        if (seen.has(id)) continue
        seen.add(id)
        out.push({ configFile: e.file, key: e.key, codeFile: f.rel, via: 'лексика', token })
      }
    }
  }
  return out
}

/**
 * Исторические связи: конфиг и код правились одним коммитом. Самый ценный
 * источник — это след реального инцидента («видео не работало → починили и код,
 * и политику»), и он не требует понимать ни одну технологию.
 */
export function historicalLinks(cochange: Array<{ a: string; b: string; n: number }>, minPairs = 2): ConfigLink[] {
  const out: ConfigLink[] = []
  for (const c of cochange) {
    if (c.n < minPairs) continue
    const aIsConfig = isConfigFile(c.a)
    const bIsConfig = isConfigFile(c.b)
    if (aIsConfig === bIsConfig) continue // оба конфига или оба код — не наш случай
    out.push({
      configFile: aIsConfig ? c.a : c.b,
      key: '(файл целиком)',
      codeFile: aIsConfig ? c.b : c.a,
      via: 'история',
      token: null,
    })
  }
  return out
}

/** Читатель содержимого — инъекция ради тестируемости без файловой системы. */
export function readConfigEntries(root: string, relPaths: string[], read = (p: string): string => readFileSync(p, 'utf8')): ConfigEntry[] {
  const out: ConfigEntry[] = []
  for (const rel of relPaths) {
    if (!isConfigFile(rel)) continue
    try {
      out.push(...parseConfigFile(rel, read(`${root}/${rel}`)))
    } catch {
      /* нечитаемый конфиг — пропускаем, слой обогащающий */
    }
  }
  return out
}
