/**
 * Авто-петля обучения: дорогой LLM-проход запускается САМ — по триггеру
 * сырья, а не по команде владельца (владелец просто работает).
 *
 * Триггеры (без сырья не бегаем — «дорогое — по триггеру», аксиома §3.7):
 * - есть непроанализированные поправки владельца (главный сигнал петли), или
 * - есть LLM-факты с истёкшим FSRS-интервалом (пора переподтвердить), или
 * - слой 2 ещё ни разу не бегал на непустом проекте (первичная вербализация).
 * Предохранители: кулдаун (модели недоступны — ретрай раньше), выключатель
 * learn.json {"auto": false}, детач-процесс (старт сессии не ждёт ни секунды).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Database } from '../core/db'
import { FactStore } from '../core/store'
import { pendingSummaries, contentHashes } from '../graph/zsummary'

const COOLDOWN_OK_H = 72 // успешный проход — не чаще раза в 3 дня
const COOLDOWN_FAIL_H = 12 // модели были недоступны — попробовать раньше

export interface AutoLearnDecision {
  run: boolean
  reason: string
}

/** Выключатель автономии владельцем: learn.json {"auto": false}. */
export function autoEnabled(dataDir: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dataDir, 'learn.json'), 'utf8')) as { auto?: boolean }).auto !== false
  } catch {
    return true // автономия — дефолт; выключается явно
  }
}

export function shouldAutoLearn(db: Database, dataDir: string, nowMs = Date.now()): AutoLearnDecision {
  if (!autoEnabled(dataDir)) return { run: false, reason: 'выключено learn.json' }

  db.run('CREATE TABLE IF NOT EXISTS learn_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const last = db.query("SELECT value FROM learn_meta WHERE key='auto_learn'").get() as { value: string } | null
  if (last) {
    try {
      const j = JSON.parse(last.value) as { at: string; ok: boolean }
      const hours = (nowMs - Date.parse(j.at)) / 3600_000
      const cooldown = j.ok ? COOLDOWN_OK_H : COOLDOWN_FAIL_H
      if (hours < cooldown) return { run: false, reason: `кулдаун ${Math.round(cooldown - hours)}ч` }
    } catch {
      /* битая мета — не препятствие */
    }
  }

  const corrections = (() => {
    try {
      return (db.query('SELECT COUNT(*) n FROM corrections WHERE analyzed=0').get() as { n: number }).n
    } catch {
      return 0
    }
  })()
  if (corrections > 0) return { run: true, reason: `поправок владельца: ${corrections}` }

  const store = new FactStore(db)
  const due = store.dueForReview(nowMs).length
  if (due > 0) return { run: true, reason: `к перепроверке: ${due}` }

  const everRan = !!(db.query("SELECT 1 x FROM fact_journal WHERE source LIKE 'llm:layer2:%' LIMIT 1").get())
  const hasCode = !!(db.query("SELECT 1 x FROM fact_journal WHERE source='miner:layer0' LIMIT 1").get())
  if (!everRan && hasCode) return { run: true, reason: 'первичная вербализация (слой 2 ещё не бегал)' }

  // Посещённые узлы без свежего z-резюме — тоже сырьё (ленивый зум-граф):
  // очередь копится подачей, а тратится дешёвым пакетным проходом в детаче.
  const zpending = pendingSummaries(db, contentHashes(db), 1).length
  if (zpending > 0) return { run: true, reason: 'роли файлов: посещённые узлы без описания' }

  return { run: false, reason: 'сырья нет' }
}

export function recordAutoLearn(db: Database, ok: boolean, note: string, now = new Date().toISOString()): void {
  db.run('CREATE TABLE IF NOT EXISTS learn_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.query("INSERT INTO learn_meta(key,value) VALUES('auto_learn',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    JSON.stringify({ at: now, ok, note }),
  )
}

export function lastAutoLearn(db: Database): { at: string; ok: boolean; note: string } | null {
  try {
    const row = db.query("SELECT value FROM learn_meta WHERE key='auto_learn'").get() as { value: string } | null
    return row ? (JSON.parse(row.value) as { at: string; ok: boolean; note: string }) : null
  } catch {
    return null
  }
}
