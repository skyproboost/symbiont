/**
 * Политики среды — вторая половина «контракта среды».
 *
 * Политика это то, что среда РАЗРЕШАЕТ: директивы CSP, объявленные переменные
 * окружения, поднятые сервисы. Живут они не в коде, а в конфигурации, и потому
 * ни один граф импортов их не видит.
 *
 * Ключевое правило поиска: политика ищется там, где её кладут РЕАЛЬНЫЕ проекты,
 * а не там, где было бы логично. CSP встречается в конфиге фреймворка, в nginx,
 * в helmet, в meta-теге и в конфиге хостинга — и все эти написания равноправны.
 *
 * Если политики в проекте нет — это НЕ находка и не повод для предупреждения:
 * проект вправе не использовать CSP. Отсутствие политики означает лишь, что
 * проверять нечего (см. инвариант против шума в docs/environment-contract.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfigFile } from './config-graph'

export interface CspPolicy {
  /** директива → список разрешённых источников */
  directives: Map<string, string[]>
  /** где найдена — попадает в вывод, чтобы владелец знал, что править */
  source: string
}

export interface EnvironmentPolicies {
  csp: CspPolicy | null
  /** объявленные переменные окружения (.env.example и подобные) */
  declaredEnv: Set<string>
  /** сервисы, поднятые инфраструктурой (docker-compose и подобные) */
  services: Set<string>
  /**
   * ВСЕ настройки проекта как «ключ → значение» (и «файл::ключ → значение»).
   * Материал для ВЫВЕДЕННЫХ правил: они ссылаются на ключи, о которых ядро
   * ничего не знает, и значение надо уметь достать, не понимая семантики.
   */
  raw: Map<string, string>
}

/** Файлы, в которых реально живёт CSP. Порядок = приоритет находки. */
const CSP_FILES = [
  'nuxt.config.ts',
  'nuxt.config.js',
  'next.config.js',
  'next.config.mjs',
  'vercel.json',
  'netlify.toml',
  'nginx.conf',
  'docker/nginx.conf',
  'deploy/nginx.conf',
  '.htaccess',
  'public/index.html',
  'index.html',
  'app.html',
]

// Значение CSP почти всегда содержит кавычки ДРУГОГО типа ('self', 'unsafe-inline'),
// поэтому ловим по парной внешней кавычке, а не по «до первой кавычки».
const CSP_HEADER_DQ = /Content-Security-Policy['"\s:=]{0,6}"([^"]{5,800})"/i
const CSP_HEADER_SQ = /Content-Security-Policy["'\s:=]{0,6}'([^']{5,800})'/i
// content="..." — значение почти всегда содержит одинарные кавычки ('self'),
// поэтому класс исключает только двойную кавычку, иначе захват обрывается
// на первом же 'self' и директива приходит пустой.
const CSP_META = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content="([^"]+)"/i

/**
 * Разбор строки CSP в директивы. Формат стабилен и прост («dir src src; dir …»),
 * поэтому парсер детерминированный, без библиотеки.
 */
export function parseCspString(csp: string, source: string): CspPolicy | null {
  const directives = new Map<string, string[]>()
  for (const chunk of csp.split(';')) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue
    const name = parts[0].toLowerCase()
    if (!/^[a-z-]+$/.test(name)) continue
    directives.set(name, parts.slice(1))
  }
  return directives.size > 0 ? { directives, source } : null
}

/** Конфиг helmet: директивы заданы объектом, а не строкой. */
function parseHelmetStyle(text: string, source: string): CspPolicy | null {
  const block = text.match(/directives\s*:\s*\{([\s\S]{0,1200}?)\}/)
  if (!block) return null
  const directives = new Map<string, string[]>()
  for (const m of block[1].matchAll(/["']?([a-zA-Z-]+)["']?\s*:\s*\[([^\]]*)\]/g)) {
    const name = m[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
    const values = [...m[2].matchAll(/["'`]([^"'`]+)["'`]/g)].map((v) => v[1])
    if (values.length > 0) directives.set(name, values)
  }
  return directives.size > 0 ? { directives, source } : null
}

/** CSP проекта, если он вообще настроен. */
export function findCsp(root: string): CspPolicy | null {
  for (const rel of CSP_FILES) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const meta = text.match(CSP_META)
    if (meta) {
      const p = parseCspString(meta[1], rel)
      if (p) return p
    }
    for (const re of [CSP_HEADER_DQ, CSP_HEADER_SQ]) {
      const header = text.match(re)
      if (!header) continue
      const p = parseCspString(header[1], rel)
      if (p && p.directives.size > 0) return p
    }
    const helmet = parseHelmetStyle(text, rel)
    if (helmet) return helmet
  }
  return null
}

const ENV_FILES = ['.env.example', '.env.sample', '.env.template', '.env.dist']

/** Переменные, которые проект СЧИТАЕТ объявленными (образец окружения). */
export function findDeclaredEnv(root: string): Set<string> {
  const out = new Set<string>()
  for (const rel of ENV_FILES) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    try {
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/)
        if (m) out.add(m[1])
      }
    } catch {
      /* нечитаемый образец — не беда */
    }
  }
  return out
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

/** Сервисы, поднятые инфраструктурой проекта. */
export function findServices(root: string): Set<string> {
  const out = new Set<string>()
  for (const rel of COMPOSE_FILES) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    try {
      const text = readFileSync(abs, 'utf8')
      const block = text.split(/^services:\s*$/m)[1]
      if (!block) continue
      for (const m of block.matchAll(/^\s{2,4}([a-z][\w-]*)\s*:\s*$/gm)) out.add(m[1].toLowerCase())
      // образ тоже называет технологию: image: redis:7 → сервис redis доступен
      for (const m of text.matchAll(/image:\s*["']?([a-z][\w.-]*)/gi)) out.add(m[1].toLowerCase())
    } catch {
      /* нечитаемый compose */
    }
  }
  return out
}

export function readPolicies(root: string, configFiles: string[] = []): EnvironmentPolicies {
  const raw = new Map<string, string>()
  for (const rel of configFiles) {
    try {
      for (const e of parseConfigFile(rel, readFileSync(join(root, rel), 'utf8'))) {
        raw.set(`${e.file}::${e.key}`, e.value)
        if (!raw.has(e.key)) raw.set(e.key, e.value)
      }
    } catch {
      /* нечитаемый конфиг — остальные всё равно прочтутся */
    }
  }
  return { csp: findCsp(root), declaredEnv: findDeclaredEnv(root), services: findServices(root), raw }
}

/**
 * Разрешает ли CSP конкретный источник для директивы. Учитывается наследование
 * от default-src — без него half of CSP читался бы неверно: большинство политик
 * задают общий default-src и переопределяют лишь пару директив.
 */
export function cspAllows(policy: CspPolicy, directive: string, source: string): boolean {
  const values = policy.directives.get(directive) ?? policy.directives.get('default-src')
  if (!values) return true // директива не регулируется вовсе — запрета нет
  if (values.includes("'none'")) return false
  if (values.includes('*')) return true
  const wanted = source.toLowerCase()
  for (const v of values) {
    const val = v.toLowerCase()
    if (val === wanted) return true
    if (val === 'blob:' && wanted === 'blob:') return true
    if (val.startsWith('*.') && wanted.endsWith(val.slice(1))) return true
    // домен в политике может быть записан со схемой или без
    if (wanted.includes('.') && (val === wanted || val.endsWith('//' + wanted) || val === 'https:' || val === 'http:')) return true
  }
  return false
}
