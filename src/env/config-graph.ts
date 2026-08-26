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

/**
 * Образцы окружения: значения в них ПУСТЫЕ по определению, уликой служит имя.
 * Единственный список — его же берёт policies.ts для объявленных переменных.
 */
export const ENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template', '.env.dist']

/**
 * Носители секретов — файлы, которые плагин НЕ ЧИТАЕТ НИКОГДА.
 *
 * Боевой `.env` (и `.env.local`, `.env.production`…) отличается от образца
 * ровно тем, что значения в нём настоящие. Раньше `isConfigFile` принимал
 * `.env[\w.-]*` целиком: значения читались в ConfigEntry, попадали в промпт
 * вывода правил среды (`KEY = value` уходил в `claude -p`), а токены значений —
 * в config_edges и оттуда в подсказки сессии. Владелец файла не открывал —
 * плагин открыл за него. Это утечка, о которой сообщили снаружи.
 *
 * Отвергнуто «читать, но маскировать значения»: маска ловит то, что похоже на
 * секрет, а секрет не обязан быть похожим. У боевого env-файла нет ни одной
 * ценности для паспорта, которой не давал бы образец, — поэтому не читаем.
 * Сюда же — ключи, сертификаты, учётки пакетных менеджеров (`.npmrc` держит
 * auth-токен), htpasswd/netrc.
 */
const SECRET_CARRIER = /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.netrc|\.htpasswd|id_(rsa|dsa|ed25519|ecdsa)[\w.-]*|[\w.-]*(secret|credential)s?[\w.-]*\.(json|ya?ml|toml|ini|txt)|[\w.-]*\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|gpg|asc|kdbx|ovpn))$/i

export function isSecretCarrier(rel: string): boolean {
  const p = rel.replaceAll('\\', '/')
  const base = p.slice(p.lastIndexOf('/') + 1)
  if (ENV_TEMPLATES.includes(base)) return false
  return SECRET_CARRIER.test(p)
}

/** Является ли файл носителем конфигурации — по расширению или по имени. Носители секретов — нет. */
export function isConfigFile(rel: string): boolean {
  if (isSecretCarrier(rel)) return false
  if (CONFIG_EXT.has(extname(rel).toLowerCase())) return true
  return CONFIG_NAME.test(rel.replaceAll('\\', '/'))
}

/**
 * Значение, похожее на секрет, — по имени ключа ИЛИ по форме значения.
 * Вторая линия обороны для обычных конфигов (json/yaml с вписанным токеном):
 * имя ключа остаётся уликой, значение в запись не попадает.
 */
const SECRET_KEY = /(secret|token|passw(or)?d|passwd|pwd|api[_-]?key|private[_-]?key|credential|auth|signature|salt|dsn|access[_-]?key)/i
const SECRET_VALUE = /^(sk|pk|rk)[-_](live|test|prod)?[-_]?[A-Za-z0-9]{8,}|^(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}|^xox[abpors]-[A-Za-z0-9-]{10,}|^AKIA[0-9A-Z]{16}$|^AIza[0-9A-Za-z_-]{30,}|^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,}|^-----BEGIN /

export function looksSecret(key: string, value: string): boolean {
  if (!value) return false
  if (SECRET_KEY.test(key)) return true
  const v = value.trim().replace(/^['"`]|['"`]$/g, '')
  if (SECRET_VALUE.test(v)) return true
  // Длинная строка без пробелов, с буквами и цифрами вперемешку и без точек
  // (домены и версии — с точками, URL — со слэшами): по форме это токен
  return v.length >= 24 && !/[\s./]/.test(v) && /[0-9]/.test(v) && /[a-z]/i.test(v)
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
      const raw = (m[2] ?? '').trim()
      // Значение-секрет в запись не попадает: ключ — сущность, значение — нет
      const value = looksSecret(key, raw) ? '' : raw
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
