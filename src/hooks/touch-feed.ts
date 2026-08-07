/**
 * Подача по касанию файла: то, что говорится о тронутом узле независимо от
 * того, читают его или правят.
 *
 * Зачем отдельный модуль. Раньше этот блок жил в PostToolUse и срабатывал на
 * ЛЮБОЕ касание, включая Read. Когда появился канал до чтения, чтение стало
 * стоить два запуска процесса вместо одного — замер показал 83ms + 84ms там,
 * где раньше было 84ms, и это регрессия на самой частой операции сессии.
 * Лечится не ускорением кода (его доля — около миллисекунды из восьмидесяти,
 * остальное берут старт рантайма и разбор бандла), а тем, что запуск на чтении
 * остаётся один: `Read` убран из матчера PostToolUse, а весь его дар по касанию
 * переехал сюда и подаётся ДО чтения.
 *
 * Отсюда и форма: чистая функция над открытой базой, возвращающая строки. Один
 * и тот же дар обязан быть одним и тем же кодом — копия в двух каналах разошлась
 * бы ровно на том, что в них правят по отдельности.
 */
import type { Database } from '../core/db'
import { FactStore } from '../core/store'
import { ensureFeedLog, claimNode, nodeBrief, type GraphNode } from './node-brief'
import { bumpHeat } from '../graph/heat'
import { fileDomains } from '../passport/stack'
import { readZoneProfiles, effectiveProfile, renderEffective, rootAxesFromFacts } from '../passport/cascade'
import { shouldFeed } from '../gardener/utility'
import { playbooksFor, renderPlaybookBrief } from '../domains/playbooks'
import { readGrounding, renderCorrection } from '../domains/grounding'

/**
 * Строки о тронутом файле: срез узла графа, эффективные условия зоны и
 * доменный плейбук. Пусто — сказать нечего (всё уже подавалось этой сессии,
 * или узла нет в графе). Дедуп общий для всех каналов подачи через jit_log.
 */
export function touchFeed(db: Database, sid: string, rel: string, kind: string): string[] {
  const lines: string[] = []

  // 1) Срез узла графа — если файл в графе и ещё не подавался этой сессии
  const node = db.query('SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?').get(rel) as GraphNode | null
  if (node) {
    // Тепло: касание узла излучает релевантность (влияет на подачу и hotspot)
    try {
      bumpHeat(db, node.file, new Date().toISOString())
    } catch {
      /* тепло — обогащение, не критично */
    }
    ensureFeedLog(db)
    if (claimNode(db, sid, node.file, kind)) lines.push(`- ${nodeBrief(db, node)}`)
  }

  // 2) Каскад осей профиля: спускаясь в зону, агент получает её ЭФФЕКТИВНЫЕ
  // условия — только дельту к корню (корневые уже пришли сводкой). Дедуп по
  // зоне на сессию: условия зоны не меняются от файла к файлу.
  try {
    const profiles = readZoneProfiles(db)
    if (profiles.length > 0) {
      const rootAxes = rootAxesFromFacts(
        new FactStore(db).active().filter((f) => f.area === 'профиль качества').map((f) => f.statement),
      )
      const eff = effectiveProfile(rel, rootAxes, profiles)
      if (eff && shouldFeed(db, 'zone')) {
        ensureFeedLog(db)
        if (claimNode(db, sid, `#zone:${eff.zone}`, 'zone')) lines.push('', renderEffective(eff))
      }
    }
  } catch {
    /* каскад — обогащение подачи, молчим при любой заминке */
  }

  // 3) Доменный плейбук — если файл относится к направлению с плейбуком,
  // подаём его срез один раз за сессию (дедуп через общий jit_log)
  const domains = fileDomains(rel)
  if (domains.length > 0 && shouldFeed(db, 'playbook')) {
    ensureFeedLog(db)
    const active = playbooksFor({ frameworks: [], infra: [], domains })
    const corrections = new Map(readGrounding(db).map((r) => [r.domain, r]))
    for (const pb of active) {
      if (!claimNode(db, sid, `#playbook:${pb.domain}`, 'playbook')) continue
      lines.push('', renderPlaybookBrief(pb))
      // Поправка показывается РЯДОМ с курируемым знанием, а не вместо него:
      // видно и исходный ориентир, и то, что мы узнали позже
      const corr = renderCorrection(corrections.get(pb.domain))
      if (corr) lines.push(corr)
    }
  }

  return lines
}
