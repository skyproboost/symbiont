/**
 * Сборка паспорта (Этап 1, срез): майнер → Salsa → журнал фактов → проекция-сводка.
 *
 * Инкрементальность: входы Salsa — hash каждого кодового файла + hash списка файлов.
 * Ничего не изменилось → факты не пересчитываются (red-green).
 * Изменился комментарий → факты пересчитались в то же значение → сводка
 * не пересобирается (early cutoff).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, join, relative, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseNameOnlyLog, pairCounts } from '../graph/cochange'
import { Engine, sha1 } from '../core/salsa'
import { FactStore, keyOf, factBasis } from '../core/store'
import { walkFiles, codeFiles, CODE_EXT } from '../miner/walk'
import { analyzeFile, aggregate } from '../miner/analyze'
import { deriveFacts, type Fact } from '../miner/facts'
import { buildEdges, nodeStats, type NodeStat } from '../graph/graph'
import { buildEntityGraph, renderEntityBlock, ENTITY_EXT, type EntityGraph } from '../graph/entities'
import { probeProfile, profileFacts, readConceptText } from './profile'
import { parseCommitLog, deriveSignals, deriveConstitutionFacts } from './constitution-derive'
import { computeZoneProfiles, storeZoneProfiles } from './cascade'
import { healProjections } from '../gardener/truth'
import { collectConfigLinks, storeConfigEdges, configPathsOf } from '../env/links'
import { readConfigEntries } from '../env/config-graph'
import { artifactProfile, renderArtifacts, renderQualityStance } from './artifacts'
import { detectStack, renderStack } from './stack'
import { assessMaturity, maturityFact, renderMaturity } from './maturity'
import { findUnknownMaterial, unknownFact } from '../miner/unknown'
import { hintsForMaterials } from '../core/learned'
import { OFFICE, TEXT, CSVX } from '../miner/noncode'
import { captureHealth } from '../gardener/drift'
import { buildFrame } from '../domains/frame'
import { observeComments, initLang, lang, t, statement } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

export interface GraphResult {
  nodeCount: number
  edgeCount: number
  top: NodeStat[]
}

export interface BuildResult {
  factsExecuted: boolean
  graphExecuted: boolean
  summaryRebuilt: boolean
  facts: Fact[]
  graph: GraphResult
  journal: { born: number; updated: number; superseded: number }
  summaryPath: string
}

const tierSections = (): Array<[Fact['tier'], string]> => [
  ['закон', t('Законы стиля (в этом репозитории соблюдаются практически всегда)', 'Style laws (in this repository they hold almost always)')],
  ['привычка', t('Преобладающий стиль (возможны легитимные исключения)', 'Prevailing style (legitimate exceptions possible)')],
]

export function renderGraphBlock(top: NodeStat[]): string {
  if (top.length === 0) return ''
  const lines = [`## ${t('Ключевые модули (по связности импортов; вход↑ = многие зависят)', 'Key modules (by import connectivity; in↑ = many depend on it)')}`, '']
  for (const s of top) lines.push(`- ${s.file} · ${t('вход', 'in')}:${s.inDeg} · ${t('исход', 'out')}:${s.outDeg}`)
  lines.push('')
  return lines.join('\n')
}

/** Строка факта: утверждение плюс его основание (формулировка — factBasis). */
const factLine = (f: Fact & { source?: string }): string => `- ${statement(f.statement)} — ${factBasis(f)}`

/**
 * Блоки сводки одним аргументом, а не хвостом позиционных параметров.
 *
 * Их было шесть подряд, все типа string и все — рендер-блоки: перепутанные
 * местами два блока не поймал бы ни компилятор, ни тест на непустоту вывода, а
 * сводка тихо собралась бы неправильно. Закон проекта запрещает деструктуризацию
 * В ПАРАМЕТРАХ, поэтому объект принимается целиком и читается полями внутри —
 * закон соблюдён, порядок перестал быть частью контракта.
 */
export interface SummaryBlocks {
  graphTop?: NodeStat[]
  artifacts?: string
  stance?: string
  stack?: string
  entity?: string
  maturity?: string
}

/** Проекция: компактная сводка фактов — формулировки фактами, не императивами. */
export function renderSummary(projectName: string, allFacts: Array<Fact & { source?: string }>, blocks: SummaryBlocks = {}): string {
  const graphTop = blocks.graphTop ?? []
  const artifactsBlock = blocks.artifacts ?? ''
  const stanceBlock = blocks.stance ?? ''
  const stackBlock = blocks.stack ?? ''
  const entityBlock = blocks.entity ?? ''
  const maturityBlock = blocks.maturity ?? ''
  const profile = allFacts.filter((f) => f.area === 'профиль качества')
  const constitution = allFacts.filter((f) => f.area === 'конституция')
  const facts = allFacts.filter((f) => f.area !== 'профиль качества' && f.area !== 'конституция')
  const lines: string[] = [
    t(`# Паспорт проекта «${projectName}» — выведено из его же кода и истории`, `# Project passport for “${projectName}” — derived from its own code and history`),
    '',
    t(
      '> Сгенерировано Symbiont. Числа статистики — измеренная распространённость; правила, выведенные моделью, помечены «по N образцам».',
      '> Generated by Symbiont. Statistics are measured prevalence; rules inferred by a model are marked “from N samples”.',
    ),
    '',
  ]
  if (stanceBlock) lines.push(stanceBlock, '')
  // Стадия — сразу после стойки: она определяет, как читать всё остальное
  if (maturityBlock) lines.push(maturityBlock, '')
  for (const [tier, title] of tierSections()) {
    const list = facts.filter((f) => f.tier === tier)
    if (list.length === 0) continue
    lines.push(`## ${title}`, '')
    for (const f of list) lines.push(factLine(f))
    lines.push('')
  }
  const mixed = facts.filter((f) => f.tier === 'нет консенсуса')
  if (mixed.length > 0) {
    lines.push(`## ${t('Смешанный стиль (единого правила нет)', 'Mixed style (no single rule)')}`, '')
    for (const f of mixed) lines.push(`- ${statement(f.statement).split('—')[0].trim()}: ${Math.round(f.prevalence * 100)}% / ${100 - Math.round(f.prevalence * 100)}%`)
    lines.push('')
  }
  if (artifactsBlock) lines.push(artifactsBlock, '')
  if (stackBlock) lines.push(stackBlock, '')
  if (profile.length > 0) {
    lines.push(`## ${t('Профиль качества (что «топ-1» значит именно здесь; выведено из сигналов проекта)', 'Quality profile (what “best in class” means here; derived from project signals)')}`, '')
    for (const f of profile) lines.push(`- ${statement(f.statement)}`)
    lines.push('')
  }
  if (constitution.length > 0) {
    lines.push(`## ${t('Приоритеты и ограничения (выведены из git-истории и профиля; наблюдения, не догадки)', 'Priorities and constraints (derived from git history and the profile; observations, not guesses)')}`, '')
    for (const f of constitution) lines.push(`- ${statement(f.statement)}`)
    lines.push('')
  }
  const graphBlock = renderGraphBlock(graphTop)
  if (graphBlock) lines.push(graphBlock)
  if (entityBlock) lines.push(entityBlock)
  return lines.join('\n')
}

// Инжектится сборкой (--define): хэш исходников на момент бандла. В dev не
// определена — typeof-гвард безопасен для необъявленного глобала.
declare const __SYM_PROJECTION_VERSION__: string

/**
 * Версия логики проекций — из sha1 СОДЕРЖИМОГО файлов-проекций (находка
 * /sym-elevate: ручная константа зависела от того, вспомнил ли автор её бампнуть;
 * теперь любая правка кода проекции сама инвалидирует кэш). В бандле исходников
 * на диске нет — версию впечатывает сборка (иначе fallback-константа не менялась
 * бы между релизами и memo не инвалидировался). Хешируем ровно как build.ts
 * хеширует входные файлы Salsa — из собственных конвенций проекта.
 */
function projectionCodeVersion(): string {
  if (typeof __SYM_PROJECTION_VERSION__ !== 'undefined') return __SYM_PROJECTION_VERSION__
  const rel = ['build.ts', 'artifacts.ts', 'profile.ts', 'constitution-derive.ts', '../miner/facts.ts', '../graph/graph.ts', '../graph/entities.ts']
  const parts: string[] = []
  for (const r of rel) {
    try {
      parts.push(readFileSync(join(import.meta.dirname, r), 'utf8'))
    } catch {
      /* бандл/недоступно — пропускаем */
    }
  }
  return parts.length > 0 ? `auto-${sha1(parts.join(' '))}` : 'fallback-v4-2026-07-30'
}

export function buildPassport(projectRoot: string, dataDir: string): BuildResult {
  mkdirSync(dataDir, { recursive: true })
  initLang(dataDir, projectRoot)
  const engine = new Engine(join(dataDir, 'passport.db'))
  // Смена версии проекций → одноразовая чистка memo (см. Salsa).
  // Язык подачи — часть версии проекции, а не отдельная забота: сводка лежит на
  // диске и пересобирается только при изменении входов. Без этого смена языка
  // не показалась бы до первой правки кода — человек переключил бы и не увидел
  engine.invalidateIfCodeChanged(`${projectionCodeVersion()}:${lang()}`)
  const store = new FactStore(engine.db)

  // Кэш хэшей: файл с неизменными mtime+size не читается вообще.
  // Истина по-прежнему content-hash (Bazel-инвариант); mtime — только подсказка «можно не перечитывать».
  engine.db.run(
    'CREATE TABLE IF NOT EXISTS file_cache(path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL)',
  )
  const cacheGet = engine.db.query('SELECT mtime_ms, size, hash FROM file_cache WHERE path=?')
  const cachePut = engine.db.query(
    'INSERT INTO file_cache(path,mtime_ms,size,hash) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET mtime_ms=excluded.mtime_ms, size=excluded.size, hash=excluded.hash',
  )

  const walked = walkFiles(projectRoot)
  const files = codeFiles(walked)
  const relPaths = files.map((f) => relative(projectRoot, f.path)).sort()

  engine.setInput('fileset', sha1(JSON.stringify(relPaths)))
  for (const f of files) {
    const rel = relative(projectRoot, f.path)
    const cached = cacheGet.get(rel) as { mtime_ms: number; size: number; hash: string } | null
    let hash: string
    if (cached && cached.mtime_ms === f.mtimeMs && cached.size === f.size) {
      hash = cached.hash
    } else {
      let content = ''
      try {
        content = readFileSync(f.path, 'utf8')
      } catch {
        /* файл исчез между walk и чтением — crash-only: пропускаем */
      }
      hash = sha1(content)
      cachePut.run(rel, f.mtimeMs, f.size, hash)
    }
    engine.setInput(`file:${rel}`, hash)
  }

  engine.register('facts', (ctx) => {
    ctx.input('fileset')
    // Содержимое читается только здесь — то есть только когда факты реально пересчитываются.
    const observations = files.map((f) => {
      const rel = relative(projectRoot, f.path)
      ctx.input(`file:${rel}`)
      let content = ''
      try {
        content = readFileSync(f.path, 'utf8')
      } catch {
        /* исчез — пропускаем */
      }
      return analyzeFile(f.path, f.ext, content)
    })
    const agg = aggregate(observations, files.map((f) => f.ext))
    // Язык комментариев — признак языка ВЛАДЕЛЬЦА, а не проекта: комментарий
    // человек пишет для себя. До первого обращения к модели это лучшее, что
    // есть для выбора языка подачи (core/i18n.ts)
    observeComments(dataDir, agg.comments.cyr, agg.comments.lat)
    return deriveFacts(agg)
  })

  engine.register('graph', (ctx) => {
    ctx.input('fileset')
    const entries = files.map((f) => {
      const rel = relative(projectRoot, f.path)
      ctx.input(`file:${rel}`)
      let content = ''
      try {
        content = readFileSync(f.path, 'utf8')
      } catch {
        /* исчез — пропускаем */
      }
      return { rel: rel.replaceAll('\\', '/'), content }
    })
    const g = buildEdges(entries)
    const stats = nodeStats(g)
    return {
      nodeCount: g.nodes.length,
      edgeCount: g.edges.length,
      top: stats.slice(0, 8),
      allStats: stats,
      edges: g.edges,
    }
  })

  // Состав артефактов — из ВСЕХ файлов проекта (не только код): природа проекта
  // и активные оси качества. Дёшево (счёт расширений), вход для red-green сводки.
  const artProfile = artifactProfile(walked.map((f) => ({ name: basename(f.path), ext: f.ext })))
  const artifactsBlock = renderArtifacts(artProfile)
  const stanceBlock = renderQualityStance(artProfile)
  const stack = detectStack(projectRoot, walked.map((f) => relative(projectRoot, f.path).replaceAll('\\', '/')))
  const stackBlock = renderStack(stack)


  // Доменный граф сущностей: контент (md/html/yaml) как узлы, перелинковки как
  // рёбра. Парс дёшев (регулярки), поэтому бежит каждую сборку; журнал таблиц
  // трогается только при изменении результата (red-green через input-хэш —
  // паттерн profile-probes).
  const MAX_ENTITY_FILES = 5000
  const entityFiles = walked.filter((f) => ENTITY_EXT.has(f.ext)).slice(0, MAX_ENTITY_FILES)
  const entityInputs: Array<{ rel: string; ext: string; content: string }> = []
  for (const f of entityFiles) {
    let content: string | null = null
    try {
      content = readFileSync(f.path, 'utf8')
    } catch {
      /* исчез между walk и чтением — не узел */
    }
    // Пустой файл — полноценный узел: ссылка НА него не битая (он существует).
    if (content === null || content.length > 1_000_000) continue
    entityInputs.push({ rel: relative(projectRoot, f.path).replaceAll('\\', '/'), ext: f.ext, content })
  }
  const entityGraph = buildEntityGraph(entityInputs)
  const entityBlock = renderEntityBlock(entityGraph)
  engine.setInput(
    'entity-graph',
    sha1(JSON.stringify([entityGraph.edges, entityGraph.nodes.map((n) => [n.file, n.depth, n.isHub]), entityGraph.broken])),
  )
  engine.register('entities', (ctx) => {
    ctx.input('entity-graph')
    return entityGraph
  })
  engine.get<EntityGraph>('entities') // исполнить вход (red-green трекинг), иначе executions=0
  if (engine.executions('entities') > 0) {
    engine.db.run(
      'CREATE TABLE IF NOT EXISTS entity_nodes(file TEXT PRIMARY KEY, kind TEXT NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL, depth INTEGER, is_hub INTEGER NOT NULL)',
    )
    engine.db.run(
      'CREATE TABLE IF NOT EXISTS entity_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, anchor TEXT NOT NULL, PRIMARY KEY(from_file, to_file, anchor))',
    )
    engine.db.run(
      'CREATE TABLE IF NOT EXISTS entity_broken(from_file TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(from_file, target))',
    )
    engine.db.run('BEGIN')
    engine.db.run('DELETE FROM entity_nodes')
    engine.db.run('DELETE FROM entity_edges')
    engine.db.run('DELETE FROM entity_broken')
    const insNode = engine.db.query('INSERT INTO entity_nodes(file,kind,in_deg,out_deg,depth,is_hub) VALUES(?,?,?,?,?,?)')
    for (const n of entityGraph.nodes) insNode.run(n.file, n.kind, n.inDeg, n.outDeg, n.depth, n.isHub ? 1 : 0)
    const insEdge = engine.db.query('INSERT OR IGNORE INTO entity_edges(from_file,to_file,anchor) VALUES(?,?,?)')
    for (const e of entityGraph.edges) insEdge.run(e.from, e.to, e.anchor)
    const insBroken = engine.db.query('INSERT OR IGNORE INTO entity_broken(from_file,target) VALUES(?,?)')
    for (const b of entityGraph.broken) insBroken.run(b.from, b.target)
    engine.db.run('COMMIT')
  }

  engine.setInput('artifacts', sha1(artifactsBlock + ' ' + stanceBlock + ' ' + stackBlock + ' ' + entityBlock))

  // Сводка строится из ЖУРНАЛА (статистика + LLM-правила, живые ярусы);
  // вход journal-active делает её чувствительной и к /sym-learn между сборками.
  engine.register('summary', (ctx) => {
    ctx.input('journal-active')
    ctx.input('artifacts')
    ctx.input('maturity') // стадия проекта считается ниже: сводка читает её как вход
    return renderSummary(basename(projectRoot), new FactStore(engine.db).active(), {
      graphTop: ctx.get<{ top: NodeStat[] }>('graph').top,
      artifacts: artifactsBlock,
      stance: stanceBlock,
      stack: stackBlock,
      entity: entityBlock,
      maturity: maturityBlock ? `${maturityBlock}${learnedBlock ? `

${learnedBlock}` : ''}` : learnedBlock,
    })
  })

  // Co-change из git-истории: пересчитывается только при смене HEAD (новые коммиты)
  const head = (() => {
    try {
      const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', timeout: 3000, windowsHide: true })
      return r.status === 0 ? r.stdout.trim() : 'no-git'
    } catch {
      return 'no-git'
    }
  })()
  engine.setInput('git-head', head)
  engine.register('cochange', (ctx) => {
    if (ctx.input('git-head') === 'no-git') return { pairs: [], totals: [] }
    const r = spawnSync('git', ['log', '--name-only', '--pretty=format:@%H', '-n', '300'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })
    if (r.status !== 0 || typeof r.stdout !== 'string') return { pairs: [], totals: [] }
    const data = pairCounts(parseNameOnlyLog(r.stdout))
    return {
      pairs: [...data.pairs.entries()].filter(([, n]) => n >= 2).map(([k, n]) => ({ k, n })),
      totals: [...data.totals.entries()].map(([file, n]) => ({ file, n })),
    }
  })
  const cochange = engine.get<{ pairs: Array<{ k: string; n: number }>; totals: Array<{ file: string; n: number }> }>('cochange')
  if (engine.executions('cochange') > 0) {
    engine.db.run('CREATE TABLE IF NOT EXISTS cochange(file_a TEXT NOT NULL, file_b TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(file_a, file_b))')
    engine.db.run('CREATE TABLE IF NOT EXISTS cochange_totals(file TEXT PRIMARY KEY, n INTEGER NOT NULL)')
    engine.db.run('BEGIN')
    engine.db.run('DELETE FROM cochange')
    engine.db.run('DELETE FROM cochange_totals')
    const insPair = engine.db.query('INSERT INTO cochange(file_a,file_b,n) VALUES(?,?,?)')
    for (const p of cochange.pairs) {
      const [a, b] = p.k.split('|')
      insPair.run(a, b, p.n)
    }
    const insTotal = engine.db.query('INSERT INTO cochange_totals(file,n) VALUES(?,?)')
    for (const t of cochange.totals) insTotal.run(t.file, t.n)
    engine.db.run('COMMIT')
  }

  // Связи конфигурации с кодом как рёбра: настройка управляет кодом, хотя между
  // ними нет ни одного импорта. Считаем после co-change — он один из источников.
  try {
    const allRelForCfg = walked.map((f) => relative(projectRoot, f.path).replaceAll('\\', '/'))
    const cfgPaths = configPathsOf(allRelForCfg).slice(0, 40)
    if (cfgPaths.length > 0) {
      const entries = readConfigEntries(projectRoot, cfgPaths)
      const codeSample: Array<{ rel: string; content: string }> = []
      for (const f of files.slice(0, 400)) {
        try {
          codeSample.push({ rel: relative(projectRoot, f.path).replaceAll('\\', '/'), content: readFileSync(f.path, 'utf8') })
        } catch {
          /* исчез — пропускаем */
        }
      }
      const pairs = cochange.pairs.map((p) => {
        const parts = p.k.split('|')
        return { a: parts[0], b: parts[1], n: p.n }
      })
      storeConfigEdges(engine.db, collectConfigLinks(entries, codeSample, pairs))
    }
  } catch {
    /* слой связей — обогащение картины, паспорт без него полон */
  }

  // Профиль качества: пробы дёшевы и бегут каждую сборку, но журнал трогается
  // ТОЛЬКО при изменении их результата (red-green руками через input-хэш) —
  // иначе каждый старт сессии накачивал бы подтверждения из ничего
  const allRel = walked.map((f) => relative(projectRoot, f.path).replaceAll('\\', '/'))
  const probes = probeProfile(projectRoot, allRel)
  engine.setInput('profile-probes', sha1(JSON.stringify(probes)))
  engine.register('profile', (ctx) => {
    ctx.input('profile-probes')
    return profileFacts(probes)
  })
  const profFacts = engine.get<Fact[]>('profile')

  const facts = engine.get<Fact[]>('facts')
  const graphFull = engine.get<GraphResult & { allStats: NodeStat[]; edges: Array<{ from: string; to: string }> }>('graph')
  // Подтверждение уверенности — только по реально изменившемуся коду;
  // red-green (код тот же) лишь освежает seen_at статистики.
  const factsExecutedNow = engine.executions('facts') > 0
  let journal = { born: 0, updated: 0, superseded: 0 }
  if (factsExecutedNow) {
    journal = store.assertAll(facts, 'miner:layer0')
  } else {
    store.touchAll()
  }
  if (engine.executions('profile') > 0) {
    const pj = store.assertAll(profFacts, 'miner:profile')
    // Ось, чьи сигналы исчезли, отзывается (история цела, из сводки уходит)
    const gone = store.retractMissingBySource('miner:profile', new Set(profFacts.map((f) => keyOf(f))))
    journal = {
      born: journal.born + pj.born,
      updated: journal.updated + pj.updated,
      superseded: journal.superseded + pj.superseded + gone,
    }
  }

  // Авто-конституция: приоритеты/ограничения из git-истории + профиля.
  // Тот же git-лог, что и co-change, но с темами коммитов (@hash\tsubject).
  const commitLog = (() => {
    if (head === 'no-git') return ''
    const r = spawnSync('git', ['log', '--name-only', '--pretty=format:@%H%x09%s', '-n', '300'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : ''
  })()
  const derived = commitLog
    ? deriveSignals(parseCommitLog(commitLog))
    : { commitTypes: {}, reverts: 0, fixZones: {}, totalCommits: 0, valueMentions: {} }
  const constFacts = deriveConstitutionFacts(derived, probes)

  // Стадия проекта: на чистом листе подражать нечему, и молчание об этом читается
  // как «всё в порядке» — тогда как именно здесь решается архитектура. Считается
  // из уже собранного материала (пути, история, журнал), без лишних обходов.
  const styleFacts = store.active().filter((f) => f.area !== 'профиль качества' && f.area !== 'конституция' && f.area !== 'зрелость проекта')
  const maturity = assessMaturity({
    codeFiles: relPaths.length,
    commits: derived.totalCommits,
    testFiles: allRel.filter((p) => /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i.test(p)).length,
    hasCi: ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile'].some((p) => existsSync(join(projectRoot, p))),
    // Доли конвенций — материал для энтропии: насколько однозначно решён каждый
    // вопрос стиля (0.97 — решён, 0.53 — ещё нет)
    prevalences: styleFacts.map((f) => f.prevalence),
    fixCommits: derived.commitTypes.fix ?? 0,
    reverts: derived.reverts,
    // Природа материала решает, ЧЕМ измерять проверяемость: код проверяется
    // тестами, контент — целостностью связей. Обе цифры уже посчитаны выше.
    nature: artProfile.dominant === 'контент' ? 'контент' : artProfile.dominant === 'код' ? 'код' : 'смешанный',
    content: {
      entities: entityGraph.nodes.length,
      broken: entityGraph.broken.length,
      orphans: entityGraph.orphans.length,
    },
  })
  // Непокрытый материал: система обязана признавать границы своего знания, а не
  // молчать о том, чего не умеет понимать (молчание читается как «здесь нечего
  // понимать» — самая дорогая ошибка, потому что невидима).
  try {
    const unknown = findUnknownMaterial(walked.map((f) => f.ext), {
      code: CODE_EXT,
      entity: ENTITY_EXT,
      office: new Set([...OFFICE, ...TEXT, ...CSVX]),
    })
    const uf = unknownFact(unknown)
    if (uf) store.assertAll([uf], 'miner:unknown-material')
    else store.retractMissingBySource('miner:unknown-material', new Set())
  } catch {
    /* граница знания — обогащение, паспорт без неё полон */
  }

  // Опыт других проектов о ТЕХ ЖЕ ВИДАХ материала — подсказка, а не вердикт:
  // наблюдение в текущем проекте всегда сильнее (индивидуальность священна).
  let learnedBlock = ''
  try {
    const hints = hintsForMaterials(dirname(dataDir), [...new Set(walked.map((f) => f.ext))])
    if (hints.length > 0) {
      learnedBlock = ['## Опыт по видам материала (из других проектов; здешнее наблюдение сильнее)', '', ...hints.map((h) => `- ${h}`)].join('\n')
    }
  } catch {
    /* накопленного нет — блок молчит */
  }

  const maturityBlock = renderMaturity(maturity)
  engine.setInput('maturity', sha1(`${maturity.score.toFixed(3)}|${maturity.level}`))
  try {
    if (!maturity.empty) store.assertAll([maturityFact(maturity)], 'miner:maturity')
  } catch {
    /* стадия — обогащение стойки, её отсутствие не ломает паспорт */
  }

  // Каскад осей профиля: зоны получают свой эффективный набор условий
  // (проекция, не журнал — выводится целиком из путей и git-истории)
  try {
    storeZoneProfiles(engine.db, computeZoneProfiles(projectRoot, allRel, derived.fixZones))
  } catch {
    /* каскад — обогащение подачи, паспорт без него полон */
  }

  engine.setInput('constitution-derived', sha1(JSON.stringify(constFacts.map((f) => f.statement))))
  engine.register('constitution', (ctx) => {
    ctx.input('constitution-derived')
    return constFacts
  })
  engine.get<Fact[]>('constitution') // исполнить вход (red-green трекинг), иначе executions=0
  if (engine.executions('constitution') > 0) {
    const cj = store.assertAll(constFacts, 'miner:constitution')
    const gone = store.retractMissingBySource('miner:constitution', new Set(constFacts.map((f) => keyOf(f))))
    journal = {
      born: journal.born + cj.born,
      updated: journal.updated + cj.updated,
      superseded: journal.superseded + cj.superseded + gone,
    }
  }
  const journalHash = sha1(
    JSON.stringify(store.active().map((r) => [r.id, r.tier, r.statement, r.prevalence, r.positive, r.total])),
  )
  engine.setInput('journal-active', journalHash)
  const summary = engine.get<string>('summary')

  // Таблицы графа для MCP — переписываются только при реальном пересчёте
  const graphExecuted = engine.executions('graph') > 0
  if (graphExecuted) {
    engine.db.run(
      'CREATE TABLE IF NOT EXISTS graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))',
    )
    engine.db.run(
      'CREATE TABLE IF NOT EXISTS graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)',
    )
    engine.db.run('BEGIN')
    engine.db.run('DELETE FROM graph_edges')
    engine.db.run('DELETE FROM graph_nodes')
    const insEdge = engine.db.query('INSERT OR IGNORE INTO graph_edges(from_file,to_file) VALUES(?,?)')
    for (const e of graphFull.edges) insEdge.run(e.from, e.to)
    const insNode = engine.db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)')
    for (const s of graphFull.allStats) insNode.run(s.file, s.rank, s.inDeg, s.outDeg)
    engine.db.run('COMMIT')
  }

  // «Паспорт не врёт»: мёртвое из проекций (роли/тепло/уроки/узлы удалённых
  // файлов) вычищается на каждой сборке — карта не должна роутить в
  // несуществующее. Строго ПОСЛЕ записи графа: иначе чистили бы прошлый снимок,
  // который тут же перезапишется. Журнал не трогается — истина неприкосновенна.
  try {
    healProjections(engine.db, projectRoot)
  } catch {
    /* гигиена — не обязанность сборки */
  }

  // Слой дрейфа: снимок здоровья на коммит (из уже посчитанного паспорта) —
  // тренд качества (конвенции/сироты/плотность), а не разовое нарушение.
  captureHealth(engine.db, head, new Date().toISOString())

  // Рамка легитимности: текст = доки + СЭМПЛ контента (дисклеймеры продукта живут
  // в контенте, не в README — лабрид: README дефолтный Nuxt, «не заменяет врача» в
  // yaml-статьях). Переиспользуем уже прочитанный entityInputs (ноль лишних чтений).
  try {
    const framePath = join(dataDir, 'frame.md')
    // Страйд-сэмпл по ВСЕМУ корпусу (не первые N): дисклеймеры разбросаны по
    // статьям; равномерная выборка ~60 файлов ловит повторяющиеся заявления.
    const step = Math.max(1, Math.floor(entityInputs.length / 60))
    const sample: string[] = []
    for (let i = 0; i < entityInputs.length; i += step) sample.push(entityInputs[i].content)
    const frameText = [readConceptText(projectRoot, allRel), ...sample].join('\n').slice(0, 150_000)
    const frame = buildFrame(frameText)
    if (frame) writeFileSync(framePath, frame, 'utf8')
    else if (existsSync(framePath)) writeFileSync(framePath, '', 'utf8') // перестал быть сенситивным → гасим
  } catch {
    /* рамка — обогащение, не обязанность */
  }

  const summaryPath = join(dataDir, 'SUMMARY.md')
  const summaryRebuilt = engine.executions('summary') > 0
  if (summaryRebuilt || !existsSync(summaryPath)) writeFileSync(summaryPath, summary, 'utf8')

  const result: BuildResult = {
    factsExecuted: factsExecutedNow,
    graphExecuted,
    summaryRebuilt,
    facts,
    graph: { nodeCount: graphFull.nodeCount, edgeCount: graphFull.edgeCount, top: graphFull.top },
    journal,
    summaryPath,
  }
  engine.close()
  return result
}
