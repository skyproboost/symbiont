/**
 * Кандидаты на вытеснение: факты, у которых основание могло уйти из-под ног.
 *
 * Журнал вытесняет факт только новым замером: пока замера нет, устаревшее
 * правило подаётся с той же уверенностью, что и вчера. Здесь называются
 * классы, у которых расхождение с диском видно БЕЗ замера и без модели (четвёртый
 * — правило слоя 2 с ушедшими уликами — описан у своей проверки ниже):
 *
 * 1) зональный закон, чьей зоны на диске больше нет (каталог удалён или
 *    переименован) — следующая сборка отзовёт его сама, до неё он судит
 *    файлы, которых нет;
 * 2) правило модели, чей срок перепроверки по FSRS вышел — оно ещё «живое»,
 *    но система сама уже не поручилась бы за него;
 * 3) правило модели, которого не видели дольше STALE_DAYS — отдельно от FSRS:
 *    расписание может не сработать, если фон долго не бегал, а календарь
 *    работает всегда.
 *
 * Показ, не лечение: отзыв делает пересборка/перепроверка. Идея взята из
 * staleness policy duet («автоматические кандидаты в superseded при конфликте
 * с repo state») — у нас конфликт с диском определим ровно в этих трёх формах.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../core/db'
import { FactStore, type FactRow } from '../core/store'
import { zoneOfArea } from '../miner/facts'
import { evidenceOf, MIN_EVIDENCE } from '../layer2/evidence'
import { statement, t } from '../core/i18n'
import '../core/statements' // таблицы формулировок: импорт ради регистрации

/** Правило модели старше этого без единого подтверждения — кандидат независимо от FSRS. */
export const STALE_DAYS = 90
const SHOW_MAX = 4

export interface StaleGroup {
  kind: string
  facts: FactRow[]
}

export function staleFacts(db: Database, root: string, nowMs = Date.now()): StaleGroup[] {
  const store = new FactStore(db)
  const active = store.active(nowMs)
  const groups: StaleGroup[] = []
  const push = (kind: string, facts: FactRow[]): void => {
    if (facts.length > 0) groups.push({ kind, facts })
  }

  push(
    t('законы зон, которых нет на диске', 'zone laws whose zone is gone from disk'),
    active.filter((f) => {
      const zone = zoneOfArea(f.area)
      return zone !== null && !existsSync(join(root, zone))
    }),
  )

  const due = new Set(store.dueForReview(nowMs).map((f) => f.id))
  push(
    t('правила модели с истёкшим сроком перепроверки', 'model rules past their re-check date'),
    active.filter((f) => due.has(f.id)),
  )

  const cutoff = nowMs - STALE_DAYS * 24 * 3600_000
  push(
    t(`правила модели, не подтверждавшиеся дольше ${STALE_DAYS} дней`, `model rules unconfirmed for over ${STALE_DAYS} days`),
    active.filter((f) => f.source.startsWith('llm:') && !due.has(f.id) && Date.parse(f.seen_at) < cutoff),
  )

  // 4) Правило слоя 2, чьи цитаты-улики ушли: файлы удалены или строки
  // переписаны, и в стольких файлах, сколько нужно для приёма правила, улики
  // уже не стоят. Судятся только правила с записанными уликами — у рождённых
  // до их хранения основание неизвестно, а не утрачено.
  push(
    t('правила, чьи улики ушли из кода', 'rules whose evidence is gone from the code'),
    active.filter((f) => {
      if (!f.source.startsWith('llm:layer2:')) return false
      const evidence = evidenceOf(db, root, f.id)
      return evidence.recorded > 0 && evidence.standing < MIN_EVIDENCE
    }),
  )
  return groups
}

export function renderStale(groups: StaleGroup[]): string {
  const L = [t(' Устаревание (кандидаты на вытеснение; отзовёт пересборка или перепроверка)', ' Staleness (candidates for supersession; a rebuild or re-check retires them)')]
  if (groups.length === 0) {
    L.push(t('   кандидатов нет — у каждого активного факта основание на месте', '   no candidates — every active fact still stands on its ground'))
    return L.join('\n')
  }
  for (const g of groups) {
    L.push(`   ${g.kind}: ${g.facts.length}`)
    for (const f of g.facts.slice(0, SHOW_MAX)) L.push(`     · ${statement(f.statement).split('—')[0].trim()} (${f.key})`)
    if (g.facts.length > SHOW_MAX) L.push(t(`     … ещё ${g.facts.length - SHOW_MAX}`, `     … ${g.facts.length - SHOW_MAX} more`))
  }
  return L.join('\n')
}
