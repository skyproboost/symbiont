/**
 * Журнал фактов паспорта (модель Datomic: вытеснение вместо удаления).
 *
 * - Идентичность факта — key (область + предмет утверждения): у «отступы — табы»
 *   и «отступы — 2 пробела» один key, поэтому смена стиля = вытеснение.
 * - Смена вердикта: старая запись получает superseded_by → новая запись.
 *   История неистребима — «что паспорт знал месяц назад» восстановимо.
 * - Уточнение измерения (тот же вердикт, новые числа) — update на месте:
 *   это не новый факт, а более свежий замер того же факта.
 */
import type { Database } from './db'
import type { Fact } from '../miner/facts'
import { t } from './i18n'
import { initRating, confirmRating, isSurprise, effectiveDeviation, liveTier } from './ratings'
import { initialStability, retrievability, confirmStability, isDue } from './schedule'

export interface FactRow extends Fact {
  id: number
  key: string
  source: string
  asserted_at: string
  seen_at: string
  superseded_by: number | null
  rating: number
  deviation: number
  confirmations: number
  /** FSRS-интервал в днях; NULL у статистики майнера (перемеряется и так) */
  stability: number | null
}

/**
 * На чём стоит факт — ЕДИНСТВЕННОЕ место, где это формулируется словами.
 *
 * У статистики майнера основание измерено («5339 из 5344»), у правила, которое
 * вывела модель, — её уверенность при горстке показанных файлов. Формулировки
 * жили в двух копиях (сводка и MCP-инструменты), и CLAUDE.md держал их
 * синхронность только напоминанием «оба места правятся вместе» — то есть
 * памятью человека. Копии разъезжаются молча; общий модуль — не может.
 * Тот же приём, что с core/db.ts и signals.ts: одно место, где определено X.
 */
export function factBasis(fact: { source?: string; positive: number; total: number; prevalence: number }): string {
  const pct = Math.round(fact.prevalence * 100)
  if (typeof fact.source === 'string' && fact.source.startsWith('llm:')) {
    return t(
      `выведено по ${fact.total} образцам (уверенность ${pct}%, не измерено)`,
      `inferred from ${fact.total} samples (confidence ${pct}%, not measured)`,
    )
  }
  return `${fact.positive} ${t('из', 'of')} ${fact.total} (${pct}%)`
}

/** Ключ факта: «область|предмет» — часть утверждения до тире. */
export function keyOf(fact: Pick<Fact, 'area' | 'statement'>): string {
  const subject = fact.statement.split('—')[0].trim()
  return `${fact.area}|${subject}`
}

export class FactStore {
  constructor(private db: Database) {
    // Миграции — под try: read-only подключения (MCP, отчёты) их пропускают,
    // пишущие пути (хуки) успевают мигрировать первыми.
    try {
      db.run(
        `CREATE TABLE IF NOT EXISTS fact_journal(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          area TEXT NOT NULL,
          statement TEXT NOT NULL,
          tier TEXT NOT NULL,
          prevalence REAL NOT NULL,
          positive INTEGER NOT NULL,
          total INTEGER NOT NULL,
          source TEXT NOT NULL,
          asserted_at TEXT NOT NULL,
          seen_at TEXT NOT NULL,
          superseded_by INTEGER
        )`,
      )
      db.run('CREATE INDEX IF NOT EXISTS idx_fact_key ON fact_journal(key)')

      const cols = (db.query('PRAGMA table_info(fact_journal)').all() as Array<{ name: string }>).map((c) => c.name)
      if (!cols.includes('rating')) {
        db.run('ALTER TABLE fact_journal ADD COLUMN rating REAL')
        db.run('ALTER TABLE fact_journal ADD COLUMN deviation REAL')
        db.run('ALTER TABLE fact_journal ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0')
      }
      // Бэкфилл дорейтинговых записей
      const legacy = db
        .query('SELECT id, source, prevalence, total FROM fact_journal WHERE rating IS NULL')
        .all() as Array<{ id: number; source: string; prevalence: number; total: number }>
      if (legacy.length > 0) {
        const upd = db.query('UPDATE fact_journal SET rating=?, deviation=? WHERE id=?')
        for (const r of legacy) {
          const init = initRating(r.source, r.prevalence, r.total)
          upd.run(init.rating, init.deviation, r.id)
        }
      }

      if (!cols.includes('stability')) {
        db.run('ALTER TABLE fact_journal ADD COLUMN stability REAL')
        // Бэкфилл: LLM-факты получают стартовый интервал от своего источника
        const llm = db
          .query("SELECT id, source FROM fact_journal WHERE source LIKE 'llm:%'")
          .all() as Array<{ id: number; source: string }>
        const upd = db.query('UPDATE fact_journal SET stability=? WHERE id=?')
        for (const r of llm) upd.run(initialStability(r.source), r.id)
      }
    } catch {
      /* read-only подключение — таблица уже существует */
    }
  }

  /** Активные факты с ЖИВЫМ ярусом (рейтинг + старение), не ярусом рождения. */
  active(nowMs = Date.now()): FactRow[] {
    const rows = this.db
      .query('SELECT * FROM fact_journal WHERE superseded_by IS NULL ORDER BY area, statement')
      .all() as FactRow[]
    for (const r of rows) {
      if (typeof r.rating === 'number' && typeof r.deviation === 'number') {
        r.tier = liveTier(r.rating, effectiveDeviation(r.deviation, r.seen_at, nowMs), r.total)
      }
    }
    return rows
  }

  journalSize(): number {
    return (this.db.query('SELECT COUNT(*) AS n FROM fact_journal').get() as { n: number }).n
  }

  /** Внести замер фактов; возвращает что произошло с каждым key. */
  assertAll(facts: Fact[], source: string, now = new Date().toISOString()): {
    born: number
    updated: number
    superseded: number
  } {
    let born = 0
    let updated = 0
    let superseded = 0

    for (const f of facts) {
      const key = keyOf(f)
      const current = this.db
        .query('SELECT * FROM fact_journal WHERE key=? AND superseded_by IS NULL')
        .get(key) as FactRow | null

      if (!current) {
        this.insert(f, key, source, now)
        born++
        continue
      }

      if (current.statement === f.statement) {
        // Подтверждение того же вердикта: Glicko-сдвиг + сжатие отклонения
        const prev = {
          rating: current.rating ?? initRating(current.source, current.prevalence, current.total).rating,
          deviation: current.deviation ?? initRating(current.source, current.prevalence, current.total).deviation,
        }
        const next = confirmRating(prev, f.prevalence)
        // FSRS: успешное повторение растит интервал; прирост больше,
        // если подтверждение пришло ближе к порогу забвения. Сюрприз
        // (замер разошёлся с уверенностью — см. ratings.ts) повторением НЕ
        // считается: интервал замирает, перепроверка не откладывается.
        const prevStability = current.stability ?? initialStability(current.source)
        const nextStability =
          prevStability === null
            ? null
            : isSurprise(prev, f.prevalence)
              ? prevStability
              : confirmStability(prevStability, retrievability(prevStability, current.seen_at, Date.parse(now)))
        this.db
          .query(
            'UPDATE fact_journal SET prevalence=?, positive=?, total=?, seen_at=?, rating=?, deviation=?, stability=?, confirmations=confirmations+1 WHERE id=?',
          )
          .run(f.prevalence, f.positive, f.total, now, next.rating, next.deviation, nextStability, current.id)
        updated++
        continue
      }

      // Вердикт или ярус изменился — вытеснение
      const newId = this.insert(f, key, source, now)
      this.db.query('UPDATE fact_journal SET superseded_by=? WHERE id=?').run(newId, current.id)
      superseded++
    }
    return { born, updated, superseded }
  }

  private insert(f: Fact, key: string, source: string, now: string): number {
    const init = initRating(source, f.prevalence, f.total)
    const res = this.db
      .query(
        `INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by, rating, deviation, confirmations, stability)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,0,?)`,
      )
      .run(key, f.area, f.statement, f.tier, f.prevalence, f.positive, f.total, source, now, now, init.rating, init.deviation, initialStability(source))
    return Number(res.lastInsertRowid)
  }

  /** LLM-факты, которым по FSRS пора на переподтверждение (/sym-learn спросит о них). */
  dueForReview(nowMs = Date.now()): FactRow[] {
    const rows = this.db
      .query("SELECT * FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' AND stability IS NOT NULL")
      .all() as FactRow[]
    return rows.filter((r) => isDue(r.stability, r.seen_at, nowMs))
  }

  /**
   * Освежить seen_at статистических фактов БЕЗ подтверждения (red-green:
   * код не менялся → прошлый замер всё ещё актуален; уверенность не растёт).
   * LLM-факты не трогаются — они стареют до переподтверждения /sym-learn.
   */
  touchAll(now = new Date().toISOString()): void {
    this.db
      .query("UPDATE fact_journal SET seen_at=? WHERE superseded_by IS NULL AND source NOT LIKE 'llm:%'")
      .run(now)
  }

  /**
   * Отзыв без замены (Datomic-retraction): активные факты ИСТОЧНИКА, чей key
   * не представлен в свежем замере, перестают быть активными. Владение по
   * источнику (урок SCIP): пересчёт источника = его факты, чужие не трогаются.
   * superseded_by=0 — маркер «отозван, замены нет» (id 0 в AUTOINCREMENT
   * не существует); история неистребима, active() их больше не отдаёт.
   */
  retractMissingBySource(source: string, presentKeys: Set<string>): number {
    const rows = this.db
      .query('SELECT id, key FROM fact_journal WHERE superseded_by IS NULL AND source=?')
      .all(source) as Array<{ id: number; key: string }>
    let retracted = 0
    const upd = this.db.query('UPDATE fact_journal SET superseded_by=0 WHERE id=?')
    for (const r of rows) {
      if (presentKeys.has(r.key)) continue
      upd.run(r.id)
      retracted++
    }
    return retracted
  }

  /** История одного key: от новых к старым (для time-travel и «why»). */
  history(key: string): FactRow[] {
    return this.db
      .query('SELECT * FROM fact_journal WHERE key=? ORDER BY id DESC')
      .all(key) as FactRow[]
  }
}
