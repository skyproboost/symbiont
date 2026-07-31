/**
 * Структурный граф проекта (файловый уровень) + PageRank.
 * Power iteration — на нашем масштабе (тысячи узлов) это миллисекунды;
 * аппроксимации сознательно не используются (фильтр «отлаживается глазами»).
 */
import { extractSpecs, resolveSpec, buildImportIndex } from './imports'

export interface Edge {
  from: string
  to: string
}

export interface GraphData {
  nodes: string[]
  edges: Edge[]
}

export function buildEdges(files: Array<{ rel: string; content: string }>): GraphData {
  const nodes = files.map((f) => f.rel)
  const edges: Edge[] = []
  const seen = new Set<string>()
  // Индекс строится один раз на весь проект: он же несёт объявленные файлами
  // пространства имён, по которым разрешаются импорты Java/C#/PHP — их не
  // достать из одного пути, только из содержимого
  const index = buildImportIndex(files)
  for (const f of files) {
    // Путь передаётся вместе с содержимым: по нему выбирается языковой пакет
    // импортов — без него граф видел бы только JS-семейство
    for (const spec of extractSpecs(f.content, f.rel)) {
      for (const to of resolveSpec(f.rel, spec, index)) {
        if (to === f.rel) continue
        const key = `${f.rel}\u0000${to}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ from: f.rel, to })
      }
    }
  }
  return { nodes, edges }
}

export function pagerank(
  nodes: string[],
  edges: Edge[],
  damping = 0.85,
  iterations = 40,
): Map<string, number> {
  const n = nodes.length
  if (n === 0) return new Map()
  const idx = new Map(nodes.map((node, i) => [node, i]))
  const out: number[][] = nodes.map(() => [])
  for (const e of edges) {
    const f = idx.get(e.from)
    const t = idx.get(e.to)
    if (f !== undefined && t !== undefined && f !== t) out[f].push(t)
  }

  let rank = new Array<number>(n).fill(1 / n)
  for (let it = 0; it < iterations; it++) {
    const next = new Array<number>(n).fill((1 - damping) / n)
    let danglingSum = 0
    for (let i = 0; i < n; i++) {
      if (out[i].length === 0) {
        danglingSum += rank[i]
        continue
      }
      const share = (rank[i] * damping) / out[i].length
      for (const t of out[i]) next[t] += share
    }
    const danglingShare = (danglingSum * damping) / n
    for (let i = 0; i < n; i++) next[i] += danglingShare
    rank = next
  }
  return new Map(nodes.map((node, i) => [node, rank[i]]))
}

export interface SeedWeight {
  file: string
  /** вес телепортации: файлы задачи ×50, упомянутые ×10, канон aider */
  weight: number
}

/**
 * Персонализированный PageRank от сида задачи (канон aider, CONCEPT §4.1/§7).
 *
 * Глобальный PageRank отвечает «что важно в проекте вообще»; персонализированный —
 * «что важно ДЛЯ ЭТОЙ задачи»: вектор телепортации концентрируется на сид-файлах
 * (упомянутые в промпте ×50, тронутые ×10), масса растекается по рёбрам и
 * подсвечивает многоходовое окружение задачи, а не глобальные хабы. Self-loop
 * 0.1 (aider): узел удерживает долю своего ранга — стабилизирует, не даёт рангу
 * полностью стечь в хабы. Power iteration — миллисекунды на нашем масштабе.
 *
 * Инварианты: сумма рангов = 1; каждый узел имеет исходящий вес ≥ selfLoop > 0,
 * поэтому висячих узлов нет (масса не теряется). Пустой сид → равномерный вектор
 * (вырождается в обычный PageRank со self-loop).
 */
export function personalizedPagerank(
  nodes: string[],
  edges: Edge[],
  seeds: SeedWeight[],
  damping = 0.85,
  iterations = 50,
  selfLoop = 0.1,
): Map<string, number> {
  const n = nodes.length
  if (n === 0) return new Map()
  const idx = new Map(nodes.map((node, i) => [node, i]))

  // Вектор персонализации: базовый вес 1 всем, сид переопределяет своим весом.
  const seedW = new Map(seeds.map((s) => [s.file, s.weight]))
  const pers = nodes.map((node) => seedW.get(node) ?? 1)
  const persSum = pers.reduce((a, b) => a + b, 0)
  const p = pers.map((w) => w / persSum)

  // Взвешенная исходящая смежность + self-loop (вес selfLoop у каждого узла).
  const outList: Array<Array<[number, number]>> = nodes.map(() => [])
  const outW = new Array<number>(n).fill(selfLoop)
  for (const e of edges) {
    const f = idx.get(e.from)
    const t = idx.get(e.to)
    if (f !== undefined && t !== undefined && f !== t) {
      outList[f].push([t, 1])
      outW[f] += 1
    }
  }

  let rank = p.slice()
  for (let it = 0; it < iterations; it++) {
    const next = p.map((pi) => (1 - damping) * pi)
    for (let i = 0; i < n; i++) {
      const flow = (rank[i] * damping) / outW[i]
      next[i] += flow * selfLoop // self-loop удерживает долю
      for (const [t, w] of outList[i]) next[t] += flow * w
    }
    rank = next
  }
  return new Map(nodes.map((node, i) => [node, rank[i]]))
}

/**
 * Соседи, релевантные ИМЕННО задаче — по ЛИФТУ (персонализированный ранг /
 * глобальный), а не по сырому персонализированному рангу.
 *
 * Зачем лифт: сырой PPR на плотно связанном коде всплывает глобальными хабами
 * (god-узлы — тесты-хелперы, ядровой store), потому что damping тянет массу в
 * центры (грабли «god-узлы/волосяные шары» из чек-листа приёмки CONCEPT §7).
 * Лифт = «насколько ЭТА задача ценит узел выше среднего»: god-узел централен для
 * всех → lift≈1 (не всплывает); узел, специфично притянутый сидом (прямой импорт
 * задачи), → высокий lift. Классический приём relative-PPR. globalRank — из
 * graph_nodes.rank (уже посчитан, второй прогон не нужен). Только из окружения,
 * lift выше порога (иначе связь несущественна — молчим).
 */
export function taskRelevantNeighbors(
  nodes: string[],
  edges: Edge[],
  seeds: SeedWeight[],
  neighborhood: Set<string>,
  k = 3,
  minLift = 1.3,
): Array<{ file: string; lift: number }> {
  // НАПРАВЛЕННЫЙ PPR: масса течёт по out-рёбрам сида к тому, что он импортирует —
  // именно эти файлы читаешь/правишь вместе с задачей. Импортёры сида (in-рёбра)
  // и так в списке зависимых nodeBrief; чистый сид-сток даёт пусто — приемлемо.
  // Окружение (neighborhood) ненаправленно как НАБОР кандидатов; лифт направленно
  // отбирает из них. Глобальный ранг на том же графе → консистентный лифт.
  const perso = personalizedPagerank(nodes, edges, seeds)
  const global = personalizedPagerank(nodes, edges, [])
  return [...neighborhood]
    .map((file) => ({ file, lift: (perso.get(file) ?? 0) / (global.get(file) || 1e-9) }))
    .filter((x) => x.lift >= minLift)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, k)
}

/**
 * Топ-K узлов, релевантных задаче (по персонализированному рангу), исключая сам
 * сид и заданные файлы. «Задача про X → вот её граф-окружение, а не только X».
 */
export function personalizedTop(
  nodes: string[],
  edges: Edge[],
  seeds: SeedWeight[],
  k: number,
  exclude: Set<string> = new Set(),
): Array<{ file: string; rank: number }> {
  const seedFiles = new Set(seeds.map((s) => s.file))
  const pr = personalizedPagerank(nodes, edges, seeds)
  return [...pr.entries()]
    .filter((pair) => !seedFiles.has(pair[0]) && !exclude.has(pair[0]))
    .map((pair) => ({ file: pair[0], rank: pair[1] }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, k)
}

/**
 * Множество узлов, достижимых от сида по рёбрам НЕнаправленно за ≤hops шагов
 * (сам сид исключён). «Окружение задачи»: гарантия, что подсвеченные соседи
 * реально связаны с упомянутым, а не всплыли на базовом телепорте (анти-шум).
 */
export function reachableUndirected(edges: Edge[], seedFiles: Set<string>, hops: number): Set<string> {
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    const list = adj.get(a)
    if (list) list.push(b)
    else adj.set(a, [b])
  }
  for (const e of edges) {
    link(e.from, e.to)
    link(e.to, e.from)
  }
  const visited = new Set(seedFiles)
  let frontier = [...seedFiles]
  for (let h = 0; h < hops && frontier.length > 0; h++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const nb of adj.get(node) ?? []) {
        if (visited.has(nb)) continue
        visited.add(nb)
        next.push(nb)
      }
    }
    frontier = next
  }
  for (const s of seedFiles) visited.delete(s)
  return visited
}

export interface NodeStat {
  file: string
  rank: number
  inDeg: number
  outDeg: number
}

export function nodeStats(g: GraphData): NodeStat[] {
  const pr = pagerank(g.nodes, g.edges)
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const e of g.edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1)
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
  }
  return g.nodes
    .map((file) => ({
      file,
      rank: pr.get(file) ?? 0,
      inDeg: inDeg.get(file) ?? 0,
      outDeg: outDeg.get(file) ?? 0,
    }))
    .sort((a, b) => b.rank - a.rank)
}
