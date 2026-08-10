/**
 * Сообщества модулей: кластеризация импорт-графа без единого LLM-токена.
 *
 * Зачем. Граф знает файлы и рёбра, но не знает «подсистем» — а ровно в их
 * терминах измеряется охват задачи: промпт, чьё граф-окружение размазано по
 * трём сообществам, стоит совсем других усилий (и другого способа работы —
 * см. делегационную подсказку в user-prompt-core), чем промпт внутри одного.
 *
 * Метод — label propagation, а не Louvain/Leiden: у тех выше качество
 * модульности, но им нужна оптимизация со случайными перестановками, а здесь
 * закон тот же, что у разведки подачи, — решение обязано воспроизводиться и
 * отлаживаться глазами. Детерминизм — фиксированный порядок обхода
 * (сортировка имён) и «при ничьей метка не меняется».
 *
 * Старт меток — от КАТАЛОГА файла, не от его имени. Отвергнутая альтернатива
 * (классический LPA, метка = свой узел) провалилась на первом же тесте:
 * лексикографическое разрешение ничьих систематически протаскивает
 * минимальную метку через мостики между кластерами, и весь граф затапливается
 * одним сообществом (в каноне это лечат случайностью ничьих — путь для нас
 * закрытый). Каталог — это модульность, заявленная самим владельцем; граф её
 * корректирует (каталог, чьи файлы вживлены в чужой кластер, поглощается),
 * а на проекте с плоским корнем все метки совпадают и сообщество одно —
 * консервативный отказ: широкие подсказки молчат, а не выдумываются.
 * Считается на лету при промпте (миллисекунды на тысячах рёбер), в схеме
 * ничего не хранится — сообщества выводимы из графа, дублировать их в БД
 * значило бы завести вторую истину.
 */
import type { Edge } from './graph'

/** Раундов распространения меток: на реальных графах сходится за 3–5, потолок страхует от осцилляций. */
const MAX_ROUNDS = 8

/**
 * Метка сообщества для каждого узла. Ненаправленно: «одна подсистема» — это
 * про совместность, а не про направление зависимости.
 */
export function communityLabels(nodes: string[], edges: Edge[]): Map<string, string> {
  const sorted = [...nodes].sort()
  const dirOf = (f: string): string => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.')
  const label = new Map<string, string>(sorted.map((n) => [n, dirOf(n)]))
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    const list = adj.get(a)
    if (list) list.push(b)
    else adj.set(a, [b])
  }
  for (const e of edges) {
    if (e.from === e.to) continue
    if (!label.has(e.from) || !label.has(e.to)) continue
    link(e.from, e.to)
    link(e.to, e.from)
  }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false
    // Асинхронное распространение в фиксированном порядке: свежие метки видны
    // сразу — это и ускоряет сходимость, и (с сортировкой) детерминирует итог
    for (const node of sorted) {
      const neighbors = adj.get(node) ?? []
      if (neighbors.length === 0) continue
      const counts = new Map<string, number>()
      for (const nb of neighbors) {
        const l = label.get(nb) as string
        counts.set(l, (counts.get(l) ?? 0) + 1)
      }
      // Смена метки — только при СТРОГОМ большинстве против текущей: ничья
      // сохраняет статус-кво (иначе мостик в один голос перетягивал бы метку).
      const current = label.get(node) as string
      let best = current
      let bestN = counts.get(current) ?? 0
      for (const [l, n] of counts) {
        if (n > bestN || (n === bestN && l !== current && best !== current && l < best)) {
          best = l
          bestN = n
        }
      }
      if (best !== current) {
        label.set(node, best)
        changed = true
      }
    }
    if (!changed) break
  }
  return label
}

/** Человекочитаемое имя сообщества: доминирующий каталог его участников (ничья — лексикографически). */
export function communityName(files: string[]): string {
  const counts = new Map<string, number>()
  for (const f of files) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  let best = '.'
  let bestN = 0
  for (const [dir, n] of counts) {
    if (n > bestN || (n === bestN && dir < best)) {
      best = dir
      bestN = n
    }
  }
  return best
}

export interface DelegationView {
  /** сколько сообществ накрывает множество (участием ≥2 файлов каждое) */
  communities: number
  /** имена накрытых сообществ (по убыванию числа файлов множества в них) */
  names: string[]
  /** во что обойдётся прочитать множество целиком, в токенах (≈символы/4) */
  approxTokens: number
}

/**
 * Мера охвата задачи: по каким подсистемам размазано её граф-окружение и во
 * что обойдётся прочитать его целиком. Сообщество засчитывается от двух
 * файлов множества: одиночное касание чужой подсистемы — ребро, а не фронт
 * работ. Чистая функция: размер файла приходит извне (тестируемо без диска).
 */
export function delegationView(zoneFiles: string[], labels: Map<string, string>, sizeOf: (f: string) => number): DelegationView {
  const byLabel = new Map<string, string[]>()
  let chars = 0
  for (const f of zoneFiles) {
    const l = labels.get(f)
    if (l === undefined) continue
    const list = byLabel.get(l) ?? []
    list.push(f)
    byLabel.set(l, list)
    try {
      chars += sizeOf(f)
    } catch {
      /* файла нет на диске — в цену чтения не входит */
    }
  }
  const covered = [...byLabel.values()].filter((files) => files.length >= 2)
  covered.sort((a, b) => b.length - a.length || (communityName(a) < communityName(b) ? -1 : 1))
  return {
    communities: covered.length,
    names: covered.map((files) => communityName(files)),
    approxTokens: Math.round(chars / 4),
  }
}
