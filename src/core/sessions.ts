/**
 * Сессионный журнал — каркас crash-only реконсиляции.
 *
 * Сессия открывается маркером на SessionStart и закрывается на SessionEnd
 * (best-effort — платформа не гарантирует прощание). На каждом старте
 * реконсиляция: давно открытые незакрытые сессии считаются умершими грязно
 * и закрываются с причиной — это сигнал (и будущая точка дожатия урожая),
 * а не ошибка.
 */
import { statSync } from 'node:fs'
import type { Database } from './db'

export interface SessionRow {
  session_id: string
  source: string | null
  started_at: string
  closed_at: string | null
  close_reason: string | null
  transcript_path: string | null
}

const STALE_HOURS_DEFAULT = 12

/**
 * Сколько транскрипт может молчать, прежде чем сессия считается умершей.
 *
 * Порог намеренно щедрый, и это асимметрия вреда, а не осторожность вообще.
 * Ошибиться можно в две стороны, и цены у них разные. Признать ЖИВУЮ сессию
 * мёртвой — значит снять признак параллельности, после чего Stop припишет её
 * правки себе, а из них родятся ложные «поправки владельца» в журнале фактов,
 * который append-only: это не откатывается. Признать МЁРТВУЮ живой — значит
 * до суток не писать model_state по неатрибутированным файлам: петля поправок
 * недополучит сырьё, но ничего ложного не запомнит. Поэтому порог заведомо
 * длиннее любого правдоподобного перерыва в работе (обед, созвон, ночь).
 */
const IDLE_DEAD_HOURS = 6

/**
 * Признак смерти по транскрипту: платформа дописывает его на каждый ход, и
 * долгое молчание файла — единственный доступный нам сигнал живости. PID не
 * годится: схема его не хранит, а на Windows он ещё и переиспользуется.
 *
 * Это `stat` файла, а не разбор его содержимого: анти-скоуп запрещает парсинг
 * внутреннего формата транскриптов (он официально нестабилен), а время правки
 * файла — сведение файловой системы, от формата не зависящее.
 *
 * Пути нет или файл недоступен — НЕ улика: строка могла родиться до появления
 * колонки, а транскрипт — переехать. Тогда судим по возрасту, как раньше.
 *
 * Исчезновение файла — штатное поведение платформы, а не порча: транскрипты
 * лежат в ~/.claude/projects/ и чистятся по cleanupPeriodDays (по умолчанию 30
 * дней, владелец волен поставить меньше). Поэтому признак живости у старых
 * сессий пропадает сам собой, и правило возраста остаётся вторым рубежом не
 * «на всякий случай», а по документированной причине.
 */
export function deadByTranscript(path: string | null, now: number, idleHours = IDLE_DEAD_HOURS): boolean {
  if (!path) return false
  try {
    return now - statSync(path).mtimeMs > idleHours * 3600_000
  } catch {
    return false // файла нет — молчим в сторону осторожности, см. асимметрию выше
  }
}

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
    try {
      this.db.run('ALTER TABLE sessions ADD COLUMN transcript_path TEXT')
    } catch {
      // Колонка уже есть — единственная причина отказа здесь, и она нормальна:
      // миграция обязана переживать повторный запуск на живой базе владельца
    }
  }

  open(
    sessionId: string,
    source: string | null,
    now = new Date().toISOString(),
    transcriptPath: string | null = null,
  ): void {
    // resume той же сессии не перезаписывает первый старт
    this.db
      .query(
        'INSERT INTO sessions(session_id, source, started_at, transcript_path) VALUES(?,?,?,?) ON CONFLICT(session_id) DO NOTHING',
      )
      .run(sessionId, source, now, transcriptPath)
  }

  close(sessionId: string, reason: string, now = new Date().toISOString()): void {
    this.db
      .query('UPDATE sessions SET closed_at=?, close_reason=? WHERE session_id=? AND closed_at IS NULL')
      .run(now, reason, sessionId)
  }

  /** Чужие незакрытые сессии — сырьё и для реконсиляции, и для счёта живых. */
  private openOthers(currentSessionId: string): Array<Pick<SessionRow, 'session_id' | 'started_at' | 'transcript_path'>> {
    return this.db
      .query('SELECT session_id, started_at, transcript_path FROM sessions WHERE closed_at IS NULL AND session_id != ?')
      .all(currentSessionId) as Array<Pick<SessionRow, 'session_id' | 'started_at' | 'transcript_path'>>
  }

  /**
   * Закрыть сессии, которые не попрощались и признаков жизни не подают.
   *
   * Два независимых признака смерти. Возраст (открыта дольше maxAgeHours) —
   * прежний и единственный, который работает без транскрипта. Молчание
   * транскрипта — новый: платформа не гарантирует SessionEnd при Ctrl-C,
   * закрытии окна и SIGKILL, поэтому труп восьмичасовой давности проходил под
   * порогом возраста и до половины суток числился живым соседом. Цена этого не
   * косметическая: пока сосед «жив», Stop не пишет model_state по файлам вне
   * канала PostToolUse, то есть петля поправок молча недополучает сырьё.
   *
   * Причина закрытия у признаков разная не для красоты: «died dirty» и «замолчал»
   * — разные события, и различать их нужно, когда будем дожимать урожай.
   */
  reconcileStale(
    currentSessionId: string,
    maxAgeHours = STALE_HOURS_DEFAULT,
    now = new Date(),
  ): number {
    const cutoff = new Date(now.getTime() - maxAgeHours * 3600_000).toISOString()
    const upd = this.db.query('UPDATE sessions SET closed_at=?, close_reason=? WHERE session_id=? AND closed_at IS NULL')
    let closed = 0
    for (const row of this.openOthers(currentSessionId)) {
      const byAge = row.started_at < cutoff
      const byIdle = deadByTranscript(row.transcript_path, now.getTime())
      if (!byAge && !byIdle) continue
      upd.run(now.toISOString(), byAge ? 'reconciled-dirty' : 'reconciled-idle', row.session_id)
      closed++
    }
    return closed
  }

  /**
   * Сколько ЧУЖИХ сессий подаёт признаки жизни прямо сейчас.
   *
   * Считается на чтении, а не после реконсиляции: та бежит только на
   * SessionStart, а сосед умирает когда угодно — в том числе посреди нашей
   * сессии. Правило живости при этом одно на оба места (deadByTranscript),
   * иначе две копии разошлись бы молча.
   */
  openLiveOthers(currentSessionId: string, now = Date.now()): number {
    return this.openOthers(currentSessionId).filter((r) => !deadByTranscript(r.transcript_path, now)).length
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
