/**
 * Каталог фоновых работ садовника — данные, не логика (планировщик их не знает).
 *
 * Здесь живёт то, что раньше требовало команд от владельца: углубление паспорта
 * (/sym-learn), дрейф и hotspot-зоны (/sym-drift), пересборка порченых проекций
 * (/sym-rebuild). Команда, о которой надо помнить, — налог на человека; система,
 * которая знает, когда работа нужна, обязана делать её сама.
 *
 * Порядок ценностей в триггерах: дешёвое и охраняющее честность паспорта —
 * всегда; дорогое (LLM) — только при реальном сырье и под кулдауном.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { FactStore } from '../core/store'
import { t } from '../core/i18n'
import type { Work, WorkContext } from './scheduler'
import { auditTruth, healProjections } from './truth'
import { renderDriftReport, computeHealth, computeDrift, hotspotsFromGit } from './drift'
import { findClones, findNearClones } from './clones'
import { walkFiles, codeFiles, CODE_EXT } from '../miner/walk'
import { findUnknownMaterial, buildUnknownPrompt } from '../miner/unknown'
import { buildComposition, buildCompositionPrompt } from '../miner/composition'
import { mergeLearnedMaterials } from '../core/learned'
import { OFFICE, TEXT, CSVX } from '../miner/noncode'
import { ENTITY_EXT } from '../graph/entities'
import { parseRules as parseVerbalized, ruleToFact } from '../layer2/verbalize'
import { runLayer1 } from '../layer1/run'
import { runVerbalize } from '../layer2/verbalize'
import { analyzeCorrections } from './corrections'
import { runZSummaries, pendingSummaries, contentHashes } from '../graph/zsummary'
import { isConfigFile, readConfigEntries } from '../env/config-graph'
import { buildRulesPrompt, parseRules, storeRules } from '../env/rules'
import { callClaudeDetailed, callClaudeWithTools, explainNoAnswer } from '../layer2/llm'
import { PLAYBOOKS } from '../domains/playbooks'
import { dueForGrounding, buildGroundingPrompt, parseGrounding, storeGrounding } from '../domains/grounding'
import type { LlmCaller, LlmAttempt } from '../layer2/llm'

// db и purpose — для петли закалки: отказ на своём проходе должен быть
// измеримым событием с понятным «зачем», а не тихим нулём.
// sink — необязательный след попыток: работа, которая сама решает, что вызов
// провалился, обязана уметь назвать причину, а через LlmCaller она не видна
const deepCaller = (ctx: WorkContext, purpose: string, sink?: LlmAttempt[]): LlmCaller => (prompt) => {
  const outcome = callClaudeDetailed(prompt, { intent: 'deep', dataDir: ctx.dataDir, db: ctx.db, purpose })
  if (sink) sink.splice(0, sink.length, ...outcome.tried)
  return outcome.result
}
const routineCaller = (ctx: WorkContext, purpose: string): LlmCaller => (prompt) =>
  callClaudeDetailed(prompt, { intent: 'routine', dataDir: ctx.dataDir, db: ctx.db, purpose }).result

const tableExists = (ctx: WorkContext, name: string): boolean => {
  try {
    return (ctx.db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name) as { n: number }).n > 0
  } catch {
    return false
  }
}

const countOf = (ctx: WorkContext, sql: string): number => {
  try {
    return (ctx.db.query(sql).get() as { n: number }).n
  } catch {
    return 0
  }
}

/**
 * Честность карты: подаётся только живое. Дёшево и всегда — на этом стоит
 * доверие к паспорту (карта, роутящая в мёртвый путь, хуже молчания).
 */
const truthWork: Work = {
  id: 'truth',
  title: 'аудит само-образа',
  cost: 'cheap',
  cooldownH: 0,
  due: () => true,
  run: (ctx) => {
    const issues = auditTruth(ctx.db, ctx.projectRoot, ctx.dataDir)
    if (issues.length === 0) return null
    const healed = healProjections(ctx.db, ctx.projectRoot)
    const lying = issues.filter((i) => !i.healable)
    const parts: string[] = []
    if (healed.removed > 0) parts.push(t(`карта почищена: ${healed.removed} мёртвых записей`, `map cleaned: ${healed.removed} dead records`))
    if (lying.length > 0) {
      parts.push(
        t(
          `сводка расходится с журналом (${lying[0].count}) — пересборка назначена`,
          `the summary disagrees with the journal (${lying[0].count}) — a rebuild is scheduled`,
        ),
      )
    }
    return parts.length > 0 ? parts.join(', ') : null
  },
}

/**
 * Самолечение проекций (бывший /sym-rebuild). Порча не должна ждать, пока
 * человек заметит и позовёт команду: обнаружили — чистим memo, следующая сборка
 * пересчитает всё из журнала-истины. Журнал не трогается никогда.
 */
const repairWork: Work = {
  id: 'repair',
  title: 'пересборка порченых проекций',
  cost: 'cheap',
  cooldownH: 0,
  due: (ctx) => {
    const facts = countOf(ctx, 'SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL')
    if (facts === 0) return false
    // Сводка потерялась при живом журнале — явная порча
    if (!existsSync(join(ctx.dataDir, 'SUMMARY.md'))) return true
    // Сводка врёт (подаёт вытеснённое) — лечится только пересчётом проекций
    return auditTruth(ctx.db, ctx.projectRoot, ctx.dataDir).some((i) => !i.healable)
  },
  run: (ctx) => {
    try {
      ctx.db.run('DELETE FROM memo')
      ctx.db.run('DELETE FROM deps')
    } catch {
      return null // нет Salsa-таблиц — чинить нечего
    }
    return t(
      'проекции помечены к пересчёту (сводка пересоберётся при следующем старте)',
      'projections marked for recomputation (the summary will be rebuilt at the next start)',
    )
  },
}

/** Слой 1 (AST) — дешёвый, инкрементальный, обогащает конвенции семантикой. */
const layer1Work: Work = {
  id: 'layer1',
  title: 'символьный слой',
  cost: 'cheap',
  cooldownH: 0,
  due: (ctx) => countOf(ctx, 'SELECT COUNT(*) n FROM fact_journal') >= 0,
  run: async (ctx) => {
    await runLayer1(ctx.projectRoot, ctx.dataDir)
    return null // слой 1 молчалив: его результат виден фактами, а не отчётом
  },
}

/**
 * Дрейф (бывший /sym-drift): производная паспорта + где копится беспорядок.
 * Тяжёлое чтение всего кода — раз в сутки, и только ухудшения попадают в сводку.
 */
const driftWork: Work = {
  id: 'drift',
  title: 'снимок здоровья и зоны частых починок',
  cost: 'cheap',
  cooldownH: 24,
  due: (ctx) => tableExists(ctx, 'health_snapshot'),
  run: (ctx) => {
    // Единый расчёт hotspot'ов (drift.hotspotsFromGit) — чтобы фон и команда
    // здоровья физически не могли разойтись в ответе
    const hotspots = hotspotsFromGit(ctx.projectRoot)

    const codeInputs: Array<{ rel: string; content: string }> = []
    for (const f of codeFiles(walkFiles(ctx.projectRoot))) {
      try {
        codeInputs.push({ rel: relative(ctx.projectRoot, f.path).replaceAll('\\', '/'), content: readFileSync(f.path, 'utf8') })
      } catch {
        /* исчез — пропускаем */
      }
    }
    const clones = findClones(codeInputs)
    // Почти-дубли — второй класс копипаста: копию правят под новое место, и
    // точный хэш её уже не видит. На практике встречается чаще точных.
    const near = findNearClones(codeInputs)

    const parts: string[] = []
    if (hotspots.length > 0) parts.push(t(`чаще всего чинят: ${hotspots[0].file} (${hotspots[0].fixes} починок × ${hotspots[0].size} строк)`, `repaired most often: ${hotspots[0].file} (${hotspots[0].fixes} fixes × ${hotspots[0].size} lines)`))
    if (clones.length > 0) parts.push(t(`клоны: блок ×${clones[0].count} (${clones[0].lines} строк)`, `clones: a block ×${clones[0].count} (${clones[0].lines} lines)`))
    if (near.length > 0) parts.push(t(`почти-дубли: ${near[0].a.file} ≈ ${near[0].b.file}`, `near-duplicates: ${near[0].a.file} ≈ ${near[0].b.file}`))
    return parts.length > 0 ? parts.join(' · ') : null
  },
}

/** Слой 2: вербализация неписаных правил + переподтверждение due-фактов (FSRS). */
const verbalizeWork: Work = {
  id: 'verbalize',
  title: 'углубление паспорта',
  cost: 'llm',
  cooldownH: 72,
  due: (ctx) => {
    const store = new FactStore(ctx.db)
    if (store.dueForReview(ctx.nowMs).length > 0) return true
    const everRan = countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source LIKE 'llm:layer2:%'") > 0
    const hasCode = countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source='miner:layer0'") > 0
    return !everRan && hasCode
  },
  run: (ctx) => {
    const tried: LlmAttempt[] = []
    const v = runVerbalize(ctx.projectRoot, ctx.dataDir, deepCaller(ctx, 'вербализация конвенций', tried))
    if (!v.model) throw new Error(explainNoAnswer(tried))
    if (v.journal.born === 0 && v.journal.updated === 0) return null
    return t(`правил +${v.journal.born}, подтверждено ${v.journal.updated}`, `rules +${v.journal.born}, confirmed ${v.journal.updated}`)
  },
}

/** Поправки владельца — главный сигнал петли: «модель написала → человек исправил». */
const correctionsWork: Work = {
  id: 'corrections',
  title: 'разбор поправок владельца',
  cost: 'llm',
  cooldownH: 12,
  due: (ctx) => countOf(ctx, 'SELECT COUNT(*) n FROM corrections WHERE analyzed=0') > 0,
  run: (ctx) => {
    const c = analyzeCorrections(ctx.db, ctx.projectRoot, deepCaller(ctx, 'разбор поправок владельца'))
    return c.analyzed > 0 ? t(`поправок разобрано ${c.analyzed} → правил ${c.born}`, `corrections analysed ${c.analyzed} → rules ${c.born}`) : null
  },
}

/** Ленивые роли узлов: только для посещённого, пакетом, на дешёвой модели. */
const zsummaryWork: Work = {
  id: 'zsummary',
  title: 'роли посещённых узлов',
  cost: 'llm',
  cooldownH: 6,
  due: (ctx) => pendingSummaries(ctx.db, contentHashes(ctx.db), 1).length > 0,
  run: (ctx) => {
    const z = runZSummaries(ctx.db, ctx.projectRoot, routineCaller(ctx, 'роли узлов'), new Date().toISOString(), undefined, ctx.dataDir)
    return z.stored > 0 ? t(`ролей выведено +${z.stored}`, `roles derived +${z.stored}`) : null
  },
}


/**
 * Вывод правил контракта среды — механизм против бесконечности случаев.
 *
 * Сид в capabilities.ts закрывает холодный старт, но перечислить все связи
 * «код ↔ конфигурация» нельзя: вебсокеты, DNS, лимиты, права, пиксели, то, чего
 * ещё не изобрели. Поэтому правила ВЫВОДЯТСЯ по реальным конфигам проекта и
 * живут как данные: их можно пересмотреть, они стареют вместе с конфигами.
 */
const contractRulesWork: Work = {
  id: 'contract',
  title: 'вывод правил контракта среды',
  cost: 'llm',
  cooldownH: 168,
  due: (ctx) => {
    const paths = walkFiles(ctx.projectRoot).map((f) => relative(ctx.projectRoot, f.path).replaceAll('\\', '/'))
    return paths.some(isConfigFile)
  },
  run: (ctx) => {
    const paths = walkFiles(ctx.projectRoot)
      .map((f) => relative(ctx.projectRoot, f.path).replaceAll('\\', '/'))
      .filter(isConfigFile)
      .slice(0, 40)
    const entries = readConfigEntries(ctx.projectRoot, paths)
    if (entries.length === 0) return null
    const outcome = callClaudeDetailed(buildRulesPrompt(entries), {
      intent: 'deep',
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: 'вывод правил контракта среды',
    })
    const res = outcome.result
    if (!res) throw new Error(explainNoAnswer(outcome.tried))
    const rules = parseRules(res.text, res.model)
    const stored = storeRules(ctx.db, rules)
    return stored > 0 ? t(`правил среды выведено +${stored} (из ${entries.length} настроек проекта)`, `environment rules derived +${stored} (from ${entries.length} project settings)`) : null
  },
}


/**
 * Обучение незнакомому материалу. Проект может быть каким угодно — сцены Unity,
 * презентации, свой формат данных, — и ядро не вправе требовать, чтобы материал
 * был кодом на знакомом языке. Анализатора для него нет, но образцы есть, и
 * правила выводятся из них тем же проходом, что и неписаные конвенции кода.
 */
const unknownMaterialWork: Work = {
  id: 'material',
  title: 'обучение незнакомому материалу',
  cost: 'llm',
  cooldownH: 168,
  due: (ctx) => countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source='miner:unknown-material' AND superseded_by IS NULL") > 0,
  run: (ctx) => {
    const walked = walkFiles(ctx.projectRoot)
    const unknown = findUnknownMaterial(walked.map((f) => f.ext), {
      code: CODE_EXT,
      entity: ENTITY_EXT,
      office: new Set([...OFFICE, ...TEXT, ...CSVX]),
    })
    if (unknown.kinds.length === 0) return null

    const kind = unknown.kinds[0].ext
    const samples: Array<{ file: string; content: string }> = []
    for (const f of walked) {
      if (samples.length >= 5) break
      if ((f.ext || '(без расширения)') !== kind) continue
      try {
        const content = readFileSync(f.path, 'utf8')
        // Бинарное отсеиваем по нулевому байту: читать его бессмысленно, а
        // угадывать «текстовость» по расширению — снова список форматов. Байт записан
        // экранированно намеренно: сырой NUL делает файл «бинарным» для grep и
        // диффов, и модуль молча выпадает из поиска по коду
        if (content.includes('\u0000')) continue
        samples.push({ file: relative(ctx.projectRoot, f.path).replaceAll('\\', '/'), content: content.slice(0, 3000) })
      } catch {
        /* нечитаемый — пропускаем */
      }
    }
    if (samples.length < 2) return null

    const outcome = callClaudeDetailed(buildUnknownPrompt(kind, samples), {
      intent: 'deep',
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: `обучение материалу ${kind}`,
    })
    const res = outcome.result
    if (!res) throw new Error(explainNoAnswer(outcome.tried))

    const rules = parseVerbalized(res.text, 2)
    if (rules.length === 0) return null
    const facts = rules.map((r) => ruleToFact(r, samples.length))
    const journal = new FactStore(ctx.db).assertAll(facts, `llm:material:${kind}`)
    return journal.born > 0 ? t(`материал ${kind}: выведено правил +${journal.born}`, `material ${kind}: rules derived +${journal.born}`) : null
  },
}


/**
 * Разбор УСТРОЙСТВА продукта: не «как написан этот файл», а как виды материала
 * связаны между собой — что источник, что производное, что создаётся только
 * парой. Один проход по карте состава вместо прохода на каждый формат: дешевле
 * и видит систему, а не части.
 */
const compositionWork: Work = {
  id: 'composition',
  title: 'разбор устройства продукта',
  cost: 'llm',
  cooldownH: 336,
  due: (ctx) => walkFiles(ctx.projectRoot).length >= 20,
  run: (ctx) => {
    const walked = walkFiles(ctx.projectRoot)
    const rel = (p: string): string => relative(ctx.projectRoot, p).replaceAll('\\', '/')
    const rels = walked.map((f) => rel(f.path))
    const lines = new Map<string, number>()
    for (const f of walked.slice(0, 1500)) {
      try {
        if (f.size > 400_000) continue
        lines.set(rel(f.path), readFileSync(f.path, 'utf8').split('\n').length)
      } catch {
        /* нечитаемый — размер не нужен */
      }
    }
    const cochange: Array<{ a: string; b: string; n: number }> = []
    try {
      for (const r of ctx.db.query('SELECT file_a, file_b, n FROM cochange').all() as Array<{ file_a: string; file_b: string; n: number }>) {
        cochange.push({ a: r.file_a, b: r.file_b, n: r.n })
      }
    } catch {
      /* истории нет — связи выведутся по соседству и парности имён */
    }

    const composition = buildComposition({ files: rels, lines, cochange })
    if (composition.formats.length < 2) return null

    // Накопление между проектами: переезжает знание О ВИДАХ материала (что с чем
    // ходит парой, характерный размер) и НИЧЕГО о самом проекте — ни путей, ни
    // имён, ни содержимого. Санитайзер в learned.ts это гарантирует на записи.
    try {
      const observations = composition.formats.map((f) => ({
        ext: f.ext,
        pairsWith: composition.pairs.filter((p) => p.a === f.ext || p.b === f.ext).filter((p) => p.twinShare >= 0.5).map((p) => (p.a === f.ext ? p.b : p.a)),
        medianLines: f.medianLines,
      }))
      mergeLearnedMaterials(dirname(ctx.dataDir), observations, basename(ctx.dataDir))
    } catch {
      /* накопление — обогащение, его сбой не касается разбора */
    }

    const outcome = callClaudeDetailed(buildCompositionPrompt(composition, basename(ctx.projectRoot)), {
      intent: 'deep',
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: 'разбор устройства продукта',
    })
    const res = outcome.result
    if (!res) throw new Error(explainNoAnswer(outcome.tried))

    const rules = parseVerbalized(res.text, 2)
    if (rules.length === 0) return null
    const journal = new FactStore(ctx.db).assertAll(rules.map((r) => ruleToFact(r, composition.formats.length)), 'llm:composition')
    return journal.born > 0 ? t(`устройство продукта: правил +${journal.born} (видов материала ${composition.formats.length})`, `product shape: rules +${journal.born} (${composition.formats.length} kinds of material)`) : null
  },
}


/**
 * Ре-заземление доменного знания. Курируемая экспертиза — сид, а не потолок:
 * Core Web Vitals меняли пороги, OWASP переиздаёт список, WCAG выпускает версии.
 * Экспертиза, верная год назад, сегодня тихо вводит в заблуждение — и это худший
 * вид ошибки, потому что выглядит как знание.
 *
 * Курируемое НЕ переписывается: результат ложится поправкой рядом. Код правит
 * человек, а фоновый процесс, переписывающий исходники, — это дыра, а не фича.
 */
const groundingWork: Work = {
  id: 'grounding',
  title: 'перепроверка доменных стандартов',
  cost: 'llm',
  cooldownH: 720,
  due: (ctx) => {
    const domains = activePlaybookDomains(ctx)
    return dueForGrounding(ctx.db, domains, ctx.nowMs) !== null
  },
  run: (ctx) => {
    const domain = dueForGrounding(ctx.db, activePlaybookDomains(ctx), ctx.nowMs)
    if (!domain) return null
    const pb = PLAYBOOKS.find((p) => p.domain === domain)
    if (!pb) return null

    // Веб-инструменты: без них перепроверка стандарта невозможна в принципе —
    // это единственное место системы, которому нужен внешний мир
    const res = callClaudeWithTools(buildGroundingPrompt(domain, pb.checklist, pb.thresholds ?? [], pb.source), {
      intent: 'deep',
      dataDir: ctx.dataDir,
    })
    if (!res) throw new Error('модели недоступны или нет сети')

    const answer = parseGrounding(res.text)
    if (!answer) return null
    const nowIso = new Date().toISOString()
    storeGrounding(ctx.db, { domain, checkedAt: nowIso, correction: answer.changed ? answer.correction : '', source: answer.source })
    return answer.changed
      ? t(`стандарты «${domain}»: есть изменения — ${answer.correction.slice(0, 120)}`, `“${domain}” standards: there are changes — ${answer.correction.slice(0, 120)}`)
      : t(`стандарты «${domain}»: подтверждены без изменений`, `“${domain}” standards: confirmed unchanged`)
  },
}

/** Направления с курируемым плейбуком, реально активные в этом проекте. */
function activePlaybookDomains(ctx: WorkContext): string[] {
  try {
    const facts = new FactStore(ctx.db).active()
    const text = facts.map((f) => f.statement).join(' ').toLowerCase()
    return PLAYBOOKS.filter((p) => p.triggers.some((t) => text.includes(t.toLowerCase()))).map((p) => p.domain)
  } catch {
    return []
  }
}

/** Полный каталог; порядок внутри задаёт планировщик (дешёвые вперёд). */
export const WORKS: Work[] = [truthWork, repairWork, layer1Work, driftWork, verbalizeWork, correctionsWork, zsummaryWork, contractRulesWork, unknownMaterialWork, compositionWork, groundingWork]

/** Отчёт «здоровье сейчас + тренд» для будущей единой интерактивной команды. */
export function healthReport(ctx: WorkContext): string {
  const health = computeHealth(ctx.db)
  const drift = computeDrift(ctx.db)
  return renderDriftReport(health, drift, [])
}
