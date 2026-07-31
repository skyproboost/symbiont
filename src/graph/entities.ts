/**
 * Доменный граф сущностей: контент (md/html/yaml) как узлы, перелинковки как рёбра.
 *
 * Граф — не только код (CONCEPT §4.1): статьи, хабы, FAQ, YAML-сущности — точки;
 * ссылки — рёбра. «Каскадно-транзитивная перелинковка» из магии становится
 * графовой задачей с точным ответом: достижимость из хабов, сироты, дубли
 * анкоров, глубина, распределение обратных ссылок — детерминированно.
 *
 * Резолв — только против реально существующих сущностей (нет матча = нет ребра),
 * поэтому ложных рёбер не бывает; цена ошибки резолва — пропуск, не выдумка.
 * Битым считается только таргет с контентным расширением: бесхвостый роут
 * (/pricing) может генерироваться кодом — молчим, а не шумим (анти-шум рубрики).
 */
import { dirname, join, normalize } from 'node:path/posix'

/** Сущности контента; расширения-артефакты (png/js) сущностями не являются. */
export const ENTITY_EXT = new Set(['.md', '.mdx', '.markdown', '.html', '.htm', '.yaml', '.yml'])

export interface ContentLink {
  anchor: string
  target: string
  /** true = синтаксис навигации (md/wiki/href) — заявка на ссылку; false = yaml-скаляр (данные) */
  explicit: boolean
}

export interface EntityEdge {
  from: string
  to: string
  anchor: string
}

export interface EntityNode {
  file: string
  kind: string
  inDeg: number
  outDeg: number
  /** BFS-глубина от ближайшего хаба; null = недостижима (или хабов нет) */
  depth: number | null
  isHub: boolean
}

export interface DupAnchor {
  anchor: string
  targets: string[]
}

export interface EntityGraph {
  nodes: EntityNode[]
  edges: EntityEdge[]
  /** ссылки на контентные файлы, которых не существует */
  broken: Array<{ from: string; target: string }>
  /** бесхвостые внутренние таргеты без матча — возможно кодовые роуты, не шумим */
  unresolved: number
  hubs: string[]
  /** сущности вне достижимости из хабов (сироты в это множество не входят дважды) */
  unreachable: string[]
  orphans: string[]
  dupAnchors: DupAnchor[]
}

const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
// [text](target) без предшествующего ! (картинка — ссылка на ассет, не на сущность)
const MD_LINK_RE = /(^|[^!])\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
// [ref]: target — reference-style определения
const MD_DEF_RE = /^\[([^\]^]+)\]:\s+(\S+)/gm
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
const HREF_RE = /href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([^<]*)/gi
// key: value и - value в YAML; берём только пути-кандидаты (есть «/» или контентный хвост)
const YAML_VALUE_RE = /^[ \t]*(?:-[ \t]+)?(?:([\w.-]+):[ \t]+)?["']?([^"'\n#]+?)["']?[ \t]*$/gm

const hasEntityExt = (target: string): boolean => {
  const dot = target.lastIndexOf('.')
  return dot !== -1 && ENTITY_EXT.has(target.slice(dot).toLowerCase())
}

const looksPathish = (v: string): boolean => v.includes('/') || hasEntityExt(v)

/**
 * Извлечение ссылок из контента. Ключевое наблюдение: ссылка — это ссылка
 * независимо от контейнера. Синтаксис навигации ([text](t), [[wiki]], href=)
 * встречается и в markdown, и внутри YAML-полей `content:`/`summary:`
 * (frontmatter-CMS: Nuxt Content, Astro, Hugo хранят прозу в YAML) — поэтому
 * эти паттерны прогоняются по ЛЮБОМУ контент-файлу. YAML-скаляры-пути — сверх
 * того, но помечаются мягкими (данные, а не заявка на навигацию).
 */
export function extractContentLinks(ext: string, content: string): ContentLink[] {
  const out: ContentLink[] = []
  const push = (anchor: string, target: string, explicit: boolean): void => {
    const t = target.trim()
    if (t.length === 0 || t.startsWith('#')) return // пустое и самостраничные якоря
    out.push({ anchor: anchor.trim().toLowerCase().replace(/\s+/g, ' '), target: t, explicit })
  }
  // Явные ссылки — во всех контент-форматах (markdown внутри YAML-строк тоже).
  for (const m of content.matchAll(MD_LINK_RE)) push(m[2], m[3], true)
  for (const m of content.matchAll(MD_DEF_RE)) push(m[1], m[2], true)
  for (const m of content.matchAll(WIKI_LINK_RE)) push(m[2] ?? m[1], m[1].trim(), true)
  for (const m of content.matchAll(HREF_RE)) push(m[2], m[1], true)
  // YAML-скаляры-пути — мягкие ссылки (структурные ссылки на файлы: pages: - a.md).
  if (ext === '.yaml' || ext === '.yml') {
    for (const m of content.matchAll(YAML_VALUE_RE)) {
      const value = (m[2] ?? '').trim()
      if (looksPathish(value) && !value.includes(' ') && !value.includes('](')) push(m[1] ?? '', value, false)
    }
  }
  return out
}

const stripExt = (rel: string): string => {
  const dot = rel.lastIndexOf('.')
  const slash = rel.lastIndexOf('/')
  return dot > slash ? rel.slice(0, dot) : rel
}

/**
 * Индекс резолва: lower-case ключи → rel-путь (Windows-first: регистр ссылок
 * в контенте гуляет, файловая система его прощает — прощаем и мы).
 */
interface ResolveIndex {
  byPath: Map<string, string>
  noExt: Map<string, string[]>
}

export function buildResolveIndex(rels: string[]): ResolveIndex {
  const byPath = new Map<string, string>()
  const noExt = new Map<string, string[]>()
  const add = (key: string, rel: string): void => {
    const list = noExt.get(key)
    if (list) list.push(rel)
    else noExt.set(key, [rel])
  }
  for (const rel of rels) {
    byPath.set(rel.toLowerCase(), rel)
    const bare = stripExt(rel).toLowerCase()
    add(bare, rel)
    // content/hpv/faq/index → и content/hpv/faq (роут каталога)
    if (bare.endsWith('/index')) add(bare.slice(0, -'/index'.length), rel)
  }
  return { byPath, noExt }
}

/** Матч по суффиксу пути с границей на «/»: /hpv/faq → content/hpv/faq.md. */
function suffixMatch(index: ResolveIndex, key: string): string | null {
  const exact = index.noExt.get(key)
  if (exact) return best(exact)
  const candidates: string[] = []
  for (const [k, rels] of index.noExt) {
    if (k.endsWith('/' + key)) candidates.push(...rels)
  }
  return candidates.length > 0 ? best(candidates) : null
}

/** Детерминированный выбор при неоднозначности: ближе к корню, затем алфавит. */
const best = (rels: string[]): string =>
  [...rels].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0]

export type Resolution = { kind: 'entity'; rel: string } | { kind: 'external' } | { kind: 'broken' } | { kind: 'unresolved' }

export function resolveContentTarget(fromRel: string, rawTarget: string, index: ResolveIndex): Resolution {
  if (EXTERNAL_RE.test(rawTarget)) return { kind: 'external' }
  let t = rawTarget.split('#')[0].split('?')[0].trim().replaceAll('\\', '/')
  if (t.endsWith('/')) t = t.slice(0, -1)
  if (t.length === 0) return { kind: 'external' } // остался чистый якорь/query
  const lower = t.toLowerCase()

  const tryKeys = (base: string): string | null => {
    const direct = index.byPath.get(base)
    if (direct) return direct
    const bare = index.noExt.get(hasEntityExt(base) ? stripExt(base) : base)
    return bare ? best(bare) : null
  }

  if (lower.startsWith('/')) {
    const hit = tryKeys(lower.slice(1)) ?? suffixMatch(index, hasEntityExt(lower) ? stripExt(lower.slice(1)) : lower.slice(1))
    if (hit) return { kind: 'entity', rel: hit }
    return hasEntityExt(lower) ? { kind: 'broken' } : { kind: 'unresolved' }
  }
  // относительный (в md «faq.md» и «./faq.md» равнозначны)
  const joined = normalize(join(dirname(fromRel.toLowerCase()), lower))
  if (!joined.startsWith('..')) {
    const hit = tryKeys(joined)
    if (hit) return { kind: 'entity', rel: hit }
  }
  // слаг без пути от корня (yaml-ссылки, абсолютные слаги без «/»)
  const slug = suffixMatch(index, hasEntityExt(lower) ? stripExt(lower) : lower)
  if (slug) return { kind: 'entity', rel: slug }
  return hasEntityExt(lower) ? { kind: 'broken' } : { kind: 'unresolved' }
}

const kindOf = (ext: string): string =>
  ext === '.yaml' || ext === '.yml' ? 'yaml' : ext === '.html' || ext === '.htm' ? 'html' : 'md'

/** Хаб: страница, ссылающаяся на ≥5 сущностей, либо index/readme хотя бы с одной ссылкой. */
const HUB_MIN_OUT = 5
const HUB_NAMES = new Set(['index', 'readme', 'home'])

export function buildEntityGraph(files: Array<{ rel: string; ext: string; content: string }>): EntityGraph {
  const rels = files.map((f) => f.rel)
  const index = buildResolveIndex(rels)
  const edges: EntityEdge[] = []
  const edgeSeen = new Set<string>()
  const broken: Array<{ from: string; target: string }> = []
  const brokenSeen = new Set<string>()
  let unresolved = 0
  const anchorTargets = new Map<string, Set<string>>()

  for (const f of files) {
    for (const link of extractContentLinks(f.ext, f.content)) {
      const res = resolveContentTarget(f.rel, link.target, index)
      if (res.kind === 'external') continue
      if (res.kind === 'unresolved') {
        unresolved++
        continue
      }
      if (res.kind === 'broken') {
        // Битое = только ЯВНАЯ ссылка (навигация) на несуществующий файл с
        // контентным расширением. Мягкие yaml-значения — данные, не заявка;
        // бесхвостые роуты (unresolved выше) — возможно кодовые, молчим.
        if (!link.explicit) continue
        const key = `${f.rel}|${link.target}`
        if (!brokenSeen.has(key)) {
          brokenSeen.add(key)
          broken.push({ from: f.rel, target: link.target })
        }
        continue
      }
      if (res.rel === f.rel) continue // самоссылка — не перелинковка
      const key = `${f.rel}|${res.rel}|${link.anchor}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      edges.push({ from: f.rel, to: res.rel, anchor: link.anchor })
      if (link.anchor.length > 0) {
        const set = anchorTargets.get(link.anchor) ?? new Set<string>()
        set.add(res.rel)
        anchorTargets.set(link.anchor, set)
      }
    }
  }

  // Степени — по различным партнёрам (два разных анкора в ту же цель = одна связь)
  const inSets = new Map<string, Set<string>>()
  const outSets = new Map<string, Set<string>>()
  for (const e of edges) {
    let out = outSets.get(e.from)
    if (!out) {
      out = new Set()
      outSets.set(e.from, out)
    }
    out.add(e.to)
    let into = inSets.get(e.to)
    if (!into) {
      into = new Set()
      inSets.set(e.to, into)
    }
    into.add(e.from)
  }

  const hubs = rels.filter((rel) => {
    const out = outSets.get(rel)?.size ?? 0
    const base = stripExt(rel).split('/').pop() ?? ''
    return out >= HUB_MIN_OUT || (HUB_NAMES.has(base.toLowerCase()) && out > 0)
  })

  // BFS от всех хабов разом: depth 0 = хаб, дальше по исходящим ссылкам
  const depth = new Map<string, number>()
  let frontier = hubs
  for (const h of hubs) depth.set(h, 0)
  let d = 0
  while (frontier.length > 0) {
    d++
    const next: string[] = []
    for (const node of frontier) {
      for (const to of outSets.get(node) ?? []) {
        if (depth.has(to)) continue
        depth.set(to, d)
        next.push(to)
      }
    }
    frontier = next
  }

  const nodes: EntityNode[] = files
    .map((f) => ({
      file: f.rel,
      kind: kindOf(f.ext),
      inDeg: inSets.get(f.rel)?.size ?? 0,
      outDeg: outSets.get(f.rel)?.size ?? 0,
      depth: depth.get(f.rel) ?? null,
      isHub: false,
    }))
    .sort((a, b) => b.inDeg - a.inDeg || (a.file < b.file ? -1 : 1))
  const hubSet = new Set(hubs)
  for (const n of nodes) n.isHub = hubSet.has(n.file)

  const orphans = nodes.filter((n) => n.inDeg === 0 && !n.isHub).map((n) => n.file)
  const orphanSet = new Set(orphans)
  const unreachable =
    hubs.length === 0 ? [] : nodes.filter((n) => n.depth === null && !orphanSet.has(n.file)).map((n) => n.file)

  const dupAnchors: DupAnchor[] = [...anchorTargets.entries()]
    .filter((pair) => pair[1].size >= 2)
    .map((pair) => ({ anchor: pair[0], targets: [...pair[1]].sort() }))
    .sort((a, b) => b.targets.length - a.targets.length)

  return { nodes, edges, broken, unresolved, hubs, unreachable, orphans, dupAnchors }
}

/** Блок сводки: только когда контент-граф реально существует (иначе молчание). */
export function renderEntityBlock(g: EntityGraph): string {
  if (g.nodes.length < 5 || g.edges.length < 3) return ''
  const lines = [
    '## Контент-граф (сущности и перелинковка; детали: passport_orphans / passport_reach)',
    '',
    `- сущностей: ${g.nodes.length} · перелинковок: ${g.edges.length} · хабов: ${g.hubs.length}`,
  ]
  const issues: string[] = []
  if (g.orphans.length > 0) issues.push(`сироты (0 входящих): ${g.orphans.length}`)
  if (g.unreachable.length > 0) issues.push(`недостижимы из хабов: ${g.unreachable.length}`)
  if (g.broken.length > 0) issues.push(`битые внутренние ссылки: ${g.broken.length}`)
  if (g.dupAnchors.length > 0) issues.push(`анкоры на разные цели: ${g.dupAnchors.length}`)
  if (issues.length > 0) lines.push(`- ⚠ ${issues.join(' · ')}`)
  lines.push('')
  return lines.join('\n')
}
