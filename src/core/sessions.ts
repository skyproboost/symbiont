/**
 * Сессионный журнал — каркас crash-only реконсиляции.
 *
 * Сессия открывается маркером на SessionStart и закрывается на SessionEnd
 * (best-effort — платформа не гарантирует прощание). На каждом старте
 * реконсиляция: давно открытые незакрытые сессии считаются умершими грязно
 * и закрываются с причиной — это сигнал (и будущая точка дожатия урожая),
 * а не ошибка.
 */
import type { Database } from './db'

export interface SessionRow {
  session_id: string
  source: string | null
  started_at: string
  closed_at: string | null
  close_reason: string | null
}

const STALE_HOURS_DEFAULT = 12

/**
 * Граница среза содержимого для model_state — ОБЩАЯ для обеих сторон.
 *
 * Раньше литерал 50_000 стоял отдельно в Stop (запись) и SessionStart (чтение),
 * связывая два канала молча: разойдись границы — и каждый файл длиннее лимита
 * вечно детектировался бы как поправка владельца, кормя петлю самообучения
 * ложным сырьём. Приём тот же, которым закрыты db.ts, signals.ts и factBasis:
 * одно место, где определено X, вместо памяти человека.
 */
export const SNAPSHOT_LIMIT = 50_000

/** Срез содержимого файла для сравнения «модель написала → человек исправил». */
export function snapshotContent(text: string): string {
  return text.slice(0, SNAPSHOT_LIMIT)
}

export class SessionLog {
  constructor(private db: Database) {
    db.run(
      `CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY,
        source TEXT,
        started_at TEXT NOT NULL,
        closed_at TEXT,
        close_reason TEXT
      )`,
    )
  }

  open(sessionId: string, source: string | null, now = new Date().toISOString()): void {
    // resume той же сессии не перезаписывает первый старт
    this.db
      .query(
        'INSERT INTO sessions(session_id, source, started_at) VALUES(?,?,?) ON CONFLICT(session_id) DO NOTHING',
      )
      .run(sessionId, source, now)
  }

  close(sessionId: string, reason: string, now = new Date().toISOString()): void {
    this.db
      .query('UPDATE sessions SET closed_at=?, close_reason=? WHERE session_id=? AND closed_at IS NULL')
      .run(now, reason, sessionId)
  }

  /**
   * Закрыть сессии, открытые дольше maxAgeHours и не попрощавшиеся, — «умерли грязно».
   * Свежие открытые не трогаем: это могут быть живые параллельные сессии.
   * Возвращает число реконсилированных.
   */
  reconcileStale(
    currentSessionId: string,
    maxAgeHours = STALE_HOURS_DEFAULT,
    now = new Date(),
  ): number {
    const cutoff = new Date(now.getTime() - maxAgeHours * 3600_000).toISOString()
    const res = this.db
      .query(
        `UPDATE sessions SET closed_at=?, close_reason='reconciled-dirty'
         WHERE closed_at IS NULL AND session_id != ? AND started_at < ?`,
      )
      .run(now.toISOString(), currentSessionId, cutoff)
    return Number(res.changes)
  }

  get(sessionId: string): SessionRow | null {
    return this.db.query('SELECT * FROM sessions WHERE session_id=?').get(sessionId) as SessionRow | null
  }

  /** started_at прошлых сессий (новые первыми), исключая текущую — для самодиагностики. */
  recentStarts(exceptSessionId: string, limit = 10): string[] {
    return (
      this.db
        .query('SELECT started_at FROM sessions WHERE session_id != ? ORDER BY started_at DESC LIMIT ?')
        .all(exceptSessionId, limit) as Array<{ started_at: string }>
    ).map((r) => r.started_at)
  }

  /**
   * Уборка эфемерных посессионных логов (jit_log/gate_log/model_state): строки
   * сессий вне последних `keep` — удаляются. Аксиома храповика/ревизии памяти:
   * рабочие таблицы не растут вечно; журнал фактов (истина) не трогается.
   * Fail-open: таблицы может не быть.
   */
  pruneEphemeral(keep = 30): void {
    const recent = this.db
      .query('SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT ?')
      .all(keep) as Array<{ session_id: string }>
    if (recent.length < keep) return // ещё мало сессий — чистить нечего
    const ids = recent.map((r) => r.session_id)
    const placeholders = ids.map(() => '?').join(',')
    for (const table of ['jit_log', 'gate_log', 'model_state', 'gate_fuse', 'session_edits']) {
      try {
        this.db.query(`DELETE FROM ${table} WHERE session_id NOT IN (${placeholders})`).run(...ids)
      } catch {
        /* таблицы ещё нет — нечего чистить */
      }
    }
  }
}
