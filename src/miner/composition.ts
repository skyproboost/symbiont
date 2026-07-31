/**
 * Карта состава продукта: не «какие форматы есть», а КАК ОНИ УСТРОЕНЫ ДРУГ
 * ОТНОСИТЕЛЬНО ДРУГА.
 *
 * Развитие идеи владельца. Обучение материалу по одному формату отвечает на
 * вопрос «как здесь пишут .unity», но упускает главное: в любом продукте форматы
 * образуют СИСТЕМУ. Один формат — источник, другой сгенерирован из него; одна
 * пара всегда ходит вместе (компонент и его стиль, сцена и её мета); третий
 * лежит особняком и меняется раз в год. Понимание этой системы объясняет
 * продукт лучше, чем разбор любого отдельного файла.
 *
 * Почему карта, а не отдельный обходчик: обход уже сделан для паспорта, и второй
 * проход по диску был бы чистым дублированием. Здесь считаются ОТНОШЕНИЯ по уже
 * собранным данным — соседство в каталогах, совместная правка в истории,
 * парность имён. Всё детерминированно, без единого токена.
 *
 * Дорогой проход потом получает эту карту целиком и отвечает одним запросом на
 * вопрос «как устроен материал этого продукта» — вместо запроса на каждый формат.
 */

export interface FormatStat {
  ext: string
  files: number
  share: number
  /** каталоги, где этот формат встречается чаще всего */
  zones: string[]
  /** медианный размер в строках — отличает исходники от сгенерированного */
  medianLines: number
}

export interface FormatPair {
  a: string
  b: string
  /** во скольких каталогах встречаются вместе */
  together: number
  /** сколько раз правились одним коммитом */
  cochanged: number
  /** доля файлов a, у которых есть сосед b с тем же именем (component.vue + component.scss) */
  twinShare: number
}

export interface Composition {
  formats: FormatStat[]
  pairs: FormatPair[]
  totalFiles: number
}

const MIN_FILES = 3
const MAX_FORMATS = 14

const zoneOf = (rel: string): string => {
  const parts = rel.split('/')
  return parts.length <= 1 ? '(корень)' : parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

const extOf = (rel: string): string => {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '(без расширения)' : base.slice(dot).toLowerCase()
}

const stemOf = (rel: string): string => {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? base : base.slice(0, dot)
}

const median = (nums: number[]): number => {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export interface CompositionInput {
  /** относительные пути всех файлов проекта */
  files: string[]
  /** число строк по файлу, если известно (исходник против сгенерированного) */
  lines?: Map<string, number>
  /** пары файлов, правленные вместе (из co-change) */
  cochange?: Array<{ a: string; b: string; n: number }>
}

/** Карта состава — целиком детерминированно, из уже собранных данных. */
export function buildComposition(input: CompositionInput): Composition {
  const files = input.files
  const byExt = new Map<string, string[]>()
  for (const f of files) {
    const e = extOf(f)
    const list = byExt.get(e) ?? []
    list.push(f)
    byExt.set(e, list)
  }

  const formats: FormatStat[] = [...byExt.entries()]
    .filter((e) => e[1].length >= MIN_FILES)
    .map((e) => {
      const zoneCount = new Map<string, number>()
      for (const f of e[1]) zoneCount.set(zoneOf(f), (zoneCount.get(zoneOf(f)) ?? 0) + 1)
      const zones = [...zoneCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((z) => z[0])
      const lines = input.lines ? e[1].map((f) => input.lines!.get(f) ?? 0).filter((n) => n > 0) : []
      return { ext: e[0], files: e[1].length, share: e[1].length / Math.max(files.length, 1), zones, medianLines: median(lines) }
    })
    .sort((a, b) => b.files - a.files)
    .slice(0, MAX_FORMATS)

  // Отношения между форматами: соседство в каталоге, парность имён, совместная
  // правка. Каждый признак отвечает на свой вопрос — «лежат рядом», «сделаны
  // друг для друга», «меняются вместе», — и вместе они описывают систему.
  const pairs: FormatPair[] = []
  const known = new Set(formats.map((f) => f.ext))
  const zonesByExt = new Map<string, Set<string>>()
  const stemsByExt = new Map<string, Set<string>>()
  for (const f of files) {
    const e = extOf(f)
    if (!known.has(e)) continue
    const z = zonesByExt.get(e) ?? new Set<string>()
    z.add(zoneOf(f))
    zonesByExt.set(e, z)
    const s = stemsByExt.get(e) ?? new Set<string>()
    s.add(`${zoneOf(f)}/${stemOf(f)}`)
    stemsByExt.set(e, s)
  }

  const cochangeByPair = new Map<string, number>()
  for (const c of input.cochange ?? []) {
    const ea = extOf(c.a)
    const eb = extOf(c.b)
    if (ea === eb || !known.has(ea) || !known.has(eb)) continue
    const key = [ea, eb].sort().join('|')
    cochangeByPair.set(key, (cochangeByPair.get(key) ?? 0) + c.n)
  }

  const list = formats.map((f) => f.ext)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const za = zonesByExt.get(a) ?? new Set()
      const zb = zonesByExt.get(b) ?? new Set()
      const together = [...za].filter((z) => zb.has(z)).length
      const sa = stemsByExt.get(a) ?? new Set()
      const sb = stemsByExt.get(b) ?? new Set()
      // Прямая парность: component.vue ↔ component.scss (одинаковое имя).
      let twins = [...sa].filter((s) => sb.has(s)).length
      // Производная парность: scene.unity ↔ scene.unity.meta — спутник дописывает
      // своё расширение к ПОЛНОМУ имени исходного файла. Без этого случая пара,
      // очевидная человеку, не находилась вовсе (поймано симуляцией Unity).
      const derived = [...sa].filter((s) => sb.has(`${s}${a}`)).length
      const derivedBack = [...sb].filter((s) => sa.has(`${s}${b}`)).length
      twins += Math.max(derived, derivedBack)
      const base = Math.max(Math.min(sa.size, sb.size), 1)
      const twinShare = Math.min(1, twins / base)
      const cochanged = cochangeByPair.get([a, b].sort().join('|')) ?? 0
      // Пара интересна, если её связь чем-то подтверждена: случайное соседство
      // в одном каталоге ничего не значит
      if (twinShare >= 0.3 || cochanged >= 3 || together >= 3) {
        pairs.push({ a, b, together, cochanged, twinShare })
      }
    }
  }
  pairs.sort((x, y) => y.twinShare + y.cochanged / 10 - (x.twinShare + x.cochanged / 10))

  return { formats, pairs: pairs.slice(0, 12), totalFiles: files.length }
}

/**
 * Промпт разбора системы материала. Даётся КАРТА, а не образцы: вопрос здесь не
 * «как написан этот файл», а «как устроен продукт». Формат не называется своим
 * общеизвестным именем и не комментируется — модель видит только то, что видно
 * в самом проекте, и не подменяет наблюдение общими сведениями.
 */
export function buildCompositionPrompt(c: Composition, projectName: string): string {
  return [
    `Ниже — карта состава проекта «${projectName}»: из каких видов файлов он сделан и как эти виды связаны между собой.`,
    '',
    'Виды файлов (доля, где лежат, медианный размер в строках):',
    ...c.formats.map(
      (f) => `- ${f.ext}: ${f.files} файлов (${Math.round(f.share * 100)}%), каталоги: ${f.zones.join(', ')}${f.medianLines > 0 ? `, обычно ~${f.medianLines} строк` : ''}`,
    ),
    '',
    ...(c.pairs.length > 0
      ? [
          'Связи между видами (парность имён — доля файлов первого вида, у которых есть одноимённый сосед второго; совместные правки — из истории):',
          ...c.pairs.map(
            (p) => `- ${p.a} ↔ ${p.b}: парность ${Math.round(p.twinShare * 100)}%, общих каталогов ${p.together}, правились вместе ${p.cochanged} раз`,
          ),
          '',
        ]
      : []),
    'Задача: описать УСТРОЙСТВО этого продукта как системы. Что здесь источник, а что производное от него; какие виды файлов создаются только парой; что меняется вместе и почему; что здесь главное, а что вспомогательное; какие зависимости между видами существуют.',
    '',
    'Ответ — ТОЛЬКО валидный JSON-массив без пояснений и markdown:',
    '[{"area": "устройство продукта", "statement": "предмет — вердикт", "evidence": ["вид1", "вид2"], "confidence": 0.8}]',
    '',
    'Правила: утверждать только то, что следует из карты; формулировать фактом («стили — создаются парой к компоненту»), а не советом; не опираться на общеизвестные сведения о форматах, если карта их не подтверждает; если система не просматривается — вернуть пустой массив, это честный ответ.',
  ].join('\n')
}
