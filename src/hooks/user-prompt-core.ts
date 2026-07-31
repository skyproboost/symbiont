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
import { openDb } from '../core/db'
import { observePrompt, initLang } from '../core/i18n'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'
import { ensureFeedLog, claimNode, nodeBrief } from './node-brief'
import { FactStore } from '../core/store'
import { rolesFromProfile, isHighStakes, renderTable } from '../passport/roles'
import { taskRelevantNeighbors, reachableUndirected, type Edge, type SeedWeight } from '../graph/graph'
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

      const fresh = matched.filter((n) => claimNode(db, sid, n.file))

      const lines = fresh.map((n) => `- ${nodeBrief(db, n)}`)

      // Персонализированный PageRank от сида задачи (упомянутые файлы ×50):
      // «связанные по задаче» соседи за пределами прямо названного — граф-
      // окружение задачи, а не глобальные хабы. Только если есть упоминания.
      let relatedBlock = ''
      if (matched.length > 0) {
        const edges = db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>
        if (edges.length > 0) {
          const edgeList: Edge[] = edges.map((e) => ({ from: e.from_file, to: e.to_file }))
          const seedFiles = new Set(matched.map((n) => n.file))
          const seeds: SeedWeight[] = matched.map((n) => ({ file: n.file, weight: 50 }))
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
            for (const t of ranked) {
              if (related.length >= 3) break
              if (claimNode(db, sid, t.file, 'related')) related.push(t.file) // дедуп на сессию
            }
            if (related.length > 0) {
              relatedBlock = `Symbiont · связано с задачей (по связям проекта, а не по совпадению слов): ${related.join(', ')}`
            }
          }
        }
      }

      // Компаундинг уроков: касание зоны → уроки прошлых поправок владельца по
      // этой зоне («здесь уже исправляли X»). Дедуп на сессию по зоне.
      let lessonBlock = ''
      if (matched.length > 0 && shouldFeed(db, 'lesson')) {
        const zones = [...new Set(matched.map((n) => zoneOf(n.file)))]
        const freshZones = zones.filter((z) => claimNode(db, sid, `#lesson:${z}`, 'lesson'))
        if (freshZones.length > 0) {
          const lessons = lessonsForZones(db, freshZones, 2)
          if (lessons.length > 0) {
            lessonBlock = `Symbiont · уроки по зоне (из прошлых поправок владельца — не повтори): ${lessons.map((l) => l.statement).join(' · ')}`
          }
        }
      }

      if (fresh.length === 0 && !relatedBlock && !lessonBlock && !tableBlock) return {}

      // Факт о глубине — не императив: модель сама решит уйти в планирование
      const DEEP_THRESHOLD = 30
      const deep = fresh.filter((n) => n.in_deg >= DEEP_THRESHOLD)
      const depthNote =
        deep.length > 0
          ? `\nУзлы глубокого влияния (${deep.map((n) => `${n.file}: вход ${n.in_deg}`).join('; ')}) — правки таких узлов многофайловые по последствиям.`
          : ''

      const graphBlock =
        lines.length > 0
          ? `Symbiont · срез графа по упомянутым файлам (полный радиус: passport_impact):\n${lines.join('\n')}${depthNote}`
          : ''
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: [tableBlock, graphBlock, relatedBlock, lessonBlock].filter(Boolean).join('\n\n'),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return {} // fail-open
  }
}
