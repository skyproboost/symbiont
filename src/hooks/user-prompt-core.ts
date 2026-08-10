/**
 * JIT-ретаргетинг (UserPromptSubmit): срез графа под конкретный промпт.
 *
 * Принципы:
 * - молчание по умолчанию: инъекция только при уверенном совпадении
 *   (имя файла/модуля из промпта = basename узла графа);
 * - крошечный срез (сотни символов), факты, не императивы;
 * - дедуп на сессию: один узел не подкладывается дважды;
 * - fail-open: любая ошибка = пустой вывод.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Database } from '../core/db'
import { observePrompt, initLang, t, statement } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { ensureFeedLog, claimNode, nodeBrief } from './node-brief'
import { FactStore } from '../core/store'
import { rolesFromProfile, isHighStakes, renderTable } from '../passport/roles'
import { taskRelevantNeighbors, reachableUndirected, type Edge, type SeedWeight } from '../graph/graph'
import { communityLabels, delegationView } from '../graph/communities'
import { statSync } from 'node:fs'
import { readHeatRows, effectiveHeat, hotFiles } from '../graph/heat'
import { lessonsForZones, zoneOf } from '../gardener/lessons'
import { shouldFeed } from '../gardener/utility'

export interface UserPromptInput {
  prompt?: string
  cwd?: string
  session_id?: string
}

export interface PromptHookOutput {
  hookSpecificOutput?: {
    hookEventName: 'UserPromptSubmit'
    additionalContext: string
  }
}

const MAX_NODES = 3
const MIN_TOKEN_LEN = 4

/** Токены промпта, похожие на имена файлов/модулей. */
export function promptTokens(prompt: string): string[] {
  const tokens = prompt.toLowerCase().match(/[\w$][\w$.\-/]*[\w$]/g) ?? []
  return [...new Set(tokens.filter((t) => t.length >= MIN_TOKEN_LEN))]
}

const base = (file: string): string => {
  const b = file.slice(file.lastIndexOf('/') + 1).toLowerCase()
  return b
}
const baseNoExt = (file: string): string => base(file).replace(/\.[a-z]+$/, '')

/** Канон aider: упомянутый идентификатор — сид ×10 (прямо названный файл — ×50). */
const SYMBOL_SEED_WEIGHT = 10
/**
 * Имя, определённое более чем в стольких файлах, — слишком частое, задачу не
 * выдаёт (та же семантика «единственность или ничего», что у резолва
 * импортов). Двойка, а не единица: легитимная пара «реализация + тест»
 * определяет одно имя в двух файлах, и оба уместны в срезе.
 */
const SYMBOL_FILES_MAX = 2
/** Потолок сидов от символов: промпт-простыня не должна раздувать сид до бессмысленности. */
const SYMBOL_SEEDS_MAX = 4
/** Потолок токенов в запросе к индексу: длина промпта не должна превращаться в длину SQL. */
const SYMBOL_TOKENS_MAX = 40

/**
 * Пороги делегационной подсказки. Совет «раздай разведку сабагентам» окупается
 * только на широкой задаче: опубликованная экономика мультиагентности —
 * ×15 токенов, и главный документированный провал — спавн там, где хватило бы
 * одного окна. Поэтому подсказка молчит, пока задача не размазана минимум по
 * трём подсистемам И её чтение не тянет на заметную долю контекстного окна
 * (25k токенов ≈ восьмая часть окна — с этого объёма изоляция разведки в
 * чужих окнах начинает беречь качество рассуждений, а не только токены).
 */
const DELEGATE_MIN_COMMUNITIES = 3
const DELEGATE_MIN_TOKENS = 25_000

/**
 * Файлы, определяющие упомянутые в промпте символы (индекс слоя 1).
 * Владелец часто называет не файл, а функцию или класс («поправь bumpHeat»);
 * basename-матчинг в этом случае слеп, а оглавления слоя 1 уже знают, где
 * символ определён. Частые имена отфильтрованы порогом SYMBOL_FILES_MAX:
 * `get`/`run` определены везде и свидетельствуют ни о чём.
 */
function symbolSeedFiles(db: Database, tokens: string[], exclude: Set<string>): string[] {
  try {
    const has = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='symbols'").get() as { n: number }).n > 0
    if (!has || tokens.length === 0) return []
    const capped = tokens.slice(0, SYMBOL_TOKENS_MAX)
    const rows = db
      .query(`SELECT DISTINCT lower(name) AS lname, file FROM symbols WHERE lower(name) IN (${capped.map(() => '?').join(',')})`)
      .all(...capped) as Array<{ lname: string; file: string }>
    const byName = new Map<string, string[]>()
    for (const r of rows) {
      const list = byName.get(r.lname) ?? []
      list.push(r.file)
      byName.set(r.lname, list)
    }
    const out: string[] = []
    for (const files of byName.values()) {
      if (files.length > SYMBOL_FILES_MAX) continue // частое имя — не сигнал
      for (const f of files) {
        if (exclude.has(f) || out.includes(f)) continue
        out.push(f)
        if (out.length >= SYMBOL_SEEDS_MAX) return out
      }
    }
    return out
  } catch {
    return [] // индекс символов — обогащение сида, не условие подачи
  }
}

export function handleUserPrompt(input: UserPromptInput, dataRoot: string): PromptHookOutput {
  try {
    const prompt = input.prompt ?? ''
    const cwd = input.cwd ?? process.cwd()
    if (prompt.length < MIN_TOKEN_LEN) return {}

    const dataDir = join(dataRoot, slugOf(cwd))
    beat(dataDir, 'UserPromptSubmit')
    // Сообщение владельца — самый прямой ответ на вопрос «на каком языке с ним
    // говорить»: человек пишет модели на своём языке. Наблюдение копится здесь,
    // решение принимает initLang (см. core/i18n.ts)
    observePrompt(dataDir, prompt)
    initLang(dataDir, cwd)
    const dbPath = join(dataDir, 'passport.db')
    if (!existsSync(dbPath)) return {}
    const db = openDb(dbPath)
    try {
      ensureFeedLog(db)
      const sid = input.session_id ?? 'manual'

      // Симулированный стол: high-stakes промпт → линзы ролей из профиля
      // качества, один раз за сессию (дальше они уже в контексте)
      let tableBlock = ''
      if (isHighStakes(prompt) && shouldFeed(db, 'table') && claimNode(db, sid, '#стол', 'table')) {
        try {
          const profile = new FactStore(db).active().filter((f) => f.area === 'профиль качества')
          const roles = rolesFromProfile(profile)
          if (roles.length > 0) tableBlock = renderTable(roles)
        } catch {
          /* профиля нет — стол молчит */
        }
      }

      const nodes = db
        .query('SELECT file, in_deg, out_deg FROM graph_nodes')
        .all() as Array<{ file: string; in_deg: number; out_deg: number }>

      const tokens = promptTokens(prompt)
      const tokenSet = new Set(tokens)

      // Уверенное совпадение: токен = basename узла (с расширением или без)
      const matched = nodes
        .filter((n) => tokenSet.has(base(n.file)) || tokenSet.has(baseNoExt(n.file)))
        .sort((a, b) => b.in_deg - a.in_deg)
        .slice(0, MAX_NODES)

      // Файл упомянутого СИМВОЛА — тоже уверенный матч: имя редкое (порог
      // SYMBOL_FILES_MAX), связь прямая. Владелец назвал не файл, а функцию —
      // подача обязана понять его так же, как если бы он назвал файл.
      const seedFiles = new Set(matched.map((n) => n.file))
      const symFiles = symbolSeedFiles(db, tokens, seedFiles)
      const symNodes = symFiles
        .map((f) => nodes.find((n) => n.file === f))
        .filter((n): n is { file: string; in_deg: number; out_deg: number } => n !== undefined)

      const fresh = [...matched, ...symNodes].filter((n) => claimNode(db, sid, n.file))

      const lines = fresh.map((n) => `- ${nodeBrief(db, n)}`)

      // Персонализированный PageRank от сида задачи (упомянутые файлы ×50,
      // файлы упомянутых символов ×10 — канон aider «mentioned identifiers»):
      // «связанные по задаче» соседи за пределами прямо названного — граф-
      // окружение задачи, а не глобальные хабы. Только если промпт хоть
      // что-то назвал — файлом или символом.
      let relatedBlock = ''
      let delegateBlock = ''
      if (matched.length > 0 || symFiles.length > 0) {
        const edges = db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>
        if (edges.length > 0) {
          const edgeList: Edge[] = edges.map((e) => ({ from: e.from_file, to: e.to_file }))
          const seeds: SeedWeight[] = matched.map((n) => ({ file: n.file, weight: 50 }))
          for (const sf of symFiles) {
            seedFiles.add(sf)
            seeds.push({ file: sf, weight: SYMBOL_SEED_WEIGHT })
          }
          // Тепло — второй тир сида (×10 недавно тронутым, канон aider): подача
          // учитывает контекст недавней работы, не только упомянутое в промпте.
          const heat = effectiveHeat(readHeatRows(db), Date.now())
          for (const hf of hotFiles(heat, 0.5, 5)) {
            if (!seedFiles.has(hf)) {
              seedFiles.add(hf)
              seeds.push({ file: hf, weight: 10 })
            }
          }
          const neighborhood = reachableUndirected(edgeList, seedFiles, 2)
          if (neighborhood.size > 0) {
            const allNodes = nodes.map((n) => n.file)
            // Ранжирование по ЛИФТУ (perso/global на ненаправленном графе) —
            // подавляет god-узлы, поднимает специфично притянутое сидом.
            const ranked = taskRelevantNeighbors(allNodes, edgeList, seeds, neighborhood, 8)
            const related: string[] = []
            // Имя `cand`, а не `t`: короткое `t` затенило бы функцию перевода.
            for (const cand of ranked) {
              if (related.length >= 3) break
              if (claimNode(db, sid, cand.file, 'related')) related.push(cand.file) // дедуп на сессию
            }
            if (related.length > 0) {
              relatedBlock = `Symbiont · ${t(
                'связано с задачей (по связям проекта, а не по совпадению слов)',
                "related to the task (by the project's links, not by word overlap)",
              )}: ${related.join(', ')}`
            }

            // Делегационная подсказка: Symbiont — единственный, кто ЗАРАНЕЕ
            // измеряет охват задачи (PPR-окружение уже посчитано). Широкая
            // задача (≥3 подсистем, чтение — заметная доля окна) — факт,
            // который меняет способ работы: разведку по подсистемам дешевле
            // раздать сабагентам и свести выводы, чем читать всё одним окном.
            // На узких задачах подсказка молчит: преждевременный спавн —
            // главный документированный провал мультиагентности. Совет —
            // факт с числами, не императив: решает модель.
            try {
              if (shouldFeed(db, 'delegate')) {
                const zone = [...new Set([...seedFiles, ...neighborhood])]
                const view = delegationView(zone, communityLabels(allNodes, edgeList), (f) => statSync(join(cwd, f)).size)
                if (view.communities >= DELEGATE_MIN_COMMUNITIES && view.approxTokens >= DELEGATE_MIN_TOKENS && claimNode(db, sid, '#delegate', 'delegate')) {
                  const named = view.names.slice(0, 4).join(', ')
                  delegateBlock = `Symbiont · ${t(
                    `охват задачи по графу: ${view.communities} подсистем (${named}), чтение окружения целиком ≈${Math.round(view.approxTokens / 1000)}k токенов — разведку по подсистемам дешевле делегировать сабагентам и свести выводы, чем вносить всё в одно окно`,
                    `task footprint by the graph: ${view.communities} subsystems (${named}), reading the full neighborhood ≈${Math.round(view.approxTokens / 1000)}k tokens — delegating per-subsystem exploration to subagents and merging conclusions is cheaper than pulling it all into one window`,
                  )}`
                }
              }
            } catch {
              /* охват — обогащение; без него срез и связи всё равно поданы */
            }
          }
        }
      }

      // Компаундинг уроков: касание зоны → уроки прошлых поправок владельца по
      // этой зоне («здесь уже исправляли X»). Дедуп на сессию по зоне.
      let lessonBlock = ''
      // Якорь зоны — и названный файл, и файл упомянутого символа: урок зоны
      // одинаково уместен, как бы владелец ни назвал место работы
      const lessonAnchors = [...matched.map((n) => n.file), ...symFiles]
      if (lessonAnchors.length > 0 && shouldFeed(db, 'lesson')) {
        const zones = [...new Set(lessonAnchors.map((f) => zoneOf(f)))]
        const freshZones = zones.filter((z) => claimNode(db, sid, `#lesson:${z}`, 'lesson'))
        if (freshZones.length > 0) {
          const lessons = lessonsForZones(db, freshZones, 2)
          if (lessons.length > 0) {
            lessonBlock = `Symbiont · ${t(
              'уроки по зоне (из прошлых поправок владельца — не повтори)',
              "lessons for this area (from the owner's past corrections — do not repeat them)",
            )}: ${lessons.map((l) => statement(l.statement)).join(' · ')}`
          }
        }
      }

      if (fresh.length === 0 && !relatedBlock && !delegateBlock && !lessonBlock && !tableBlock) return {}

      // Факт о глубине — не императив: модель сама решит уйти в планирование
      const DEEP_THRESHOLD = 30
      const deep = fresh.filter((n) => n.in_deg >= DEEP_THRESHOLD)
      const depthNote =
        deep.length > 0
          ? t(
              `\nУзлы глубокого влияния (${deep.map((n) => `${n.file}: вход ${n.in_deg}`).join('; ')}) — правки таких узлов многофайловые по последствиям.`,
              `\nDeep-influence nodes (${deep.map((n) => `${n.file}: in ${n.in_deg}`).join('; ')}) — changes to these have multi-file consequences.`,
            )
          : ''

      const graphBlock =
        lines.length > 0
          ? `Symbiont · ${t(
              'срез графа по упомянутому в промпте — файлам и символам (полный радиус: passport_impact)',
              'graph slice for the files and symbols you mentioned (full radius: passport_impact)',
            )}:\n${lines.join('\n')}${depthNote}`
          : ''
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: [tableBlock, graphBlock, relatedBlock, delegateBlock, lessonBlock].filter(Boolean).join('\n\n'),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open
  }
}
