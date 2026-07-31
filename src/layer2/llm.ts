/**
 * LLM-вызовы плагина через headless `claude -p`.
 * Модельная адаптация (концепт): доступность моделей не предполагается.
 * Вектор моделей строится адаптивно (src/core/models.ts): АЛИАСЫ семейств
 * вместо пиннинга версий (CLI резолвит в последнюю — всегда актуально), порядок
 * по интенту с учётом выученной из реальных вызовов доступности. Каждая проба
 * фиксируется (никогда fail-silent) и записывается в кэш доступности.
 */
import { spawnSync } from 'node:child_process'
import {
  readAvailability,
  recordOutcome,
  resolveVector,
  networkDownUntil,
  markNetworkDown,
  clearNetworkDown,
  looksLikeNetworkFailure,
  FAMILY_PRIORITY,
  type Intent,
} from '../core/models'
import { internalEnv } from '../core/internal'
import { t } from '../core/i18n'
import { readFrame } from '../domains/frame'
import { detectRefusal, recordRefusal, markRefusalsResolved } from '../domains/refusal'
import type { Database } from '../core/db'

export interface LlmResult {
  text: string
  model: string
}

export interface LlmAttempt {
  model: string
  ms: number
  ok: boolean
  note: string
}

export interface LlmOutcome {
  result: LlmResult | null
  tried: LlmAttempt[]
}

export type LlmCaller = (prompt: string) => LlmResult | null

export interface LlmOpts {
  /** намерение задачи: deep — качество вперёд; routine — цена вперёд */
  intent?: Intent
  /** корень данных проекта для кэша доступности (без него — сид-порядок, без записи) */
  dataDir?: string
  /** явный оверрайд списка моделей (алиасы или полные ID) — минует адаптацию */
  models?: string[]
  /** зачем вызов — попадает в журнал отказов (наблюдаемость петли закалки) */
  purpose?: string
  /** БД проекта для журнала отказов; без неё петля закалки просто не ведёт учёт */
  db?: Database
}

/** Порядок моделей для вызова: явный оверрайд → адаптивный вектор → сид-порядок. */
export function resolveModels(opts: LlmOpts): string[] {
  if (opts.models && opts.models.length > 0) return opts.models
  const intent = opts.intent ?? 'routine'
  if (!opts.dataDir) return FAMILY_PRIORITY[intent]
  return resolveVector(intent, readAvailability(opts.dataDir), Date.now())
}

/** Первый ключ modelUsage — полный ID модели, реально ответившей (наблюдаемость). */
function resolvedIdOf(parsed: Record<string, unknown>): string | null {
  const usage = parsed.modelUsage
  if (usage && typeof usage === 'object') {
    const keys = Object.keys(usage as Record<string, unknown>)
    if (keys.length > 0) return keys[0]
  }
  return null
}

const asStatus = (v: unknown): number | null => (typeof v === 'number' ? v : null)

/**
 * Сеть недоступна — попытка бессмысленна, и об этом сказано вслух.
 * Возвращается не «пусто», а попытка с причиной: вызывающий объяснит владельцу
 * судьбу работы теми же словами, что и при лимите (аксиома «никогда молча»).
 */
function offlineOutcome(dataDir: string, nowMs: number): LlmOutcome | null {
  const until = networkDownUntil(dataDir, nowMs)
  if (until === null) return null
  const back = new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return { result: null, tried: [{ model: '—', ms: 0, ok: false, note: `сеть недоступна — следующая проба после ${back}` }] }
}

export function callClaudeDetailed(prompt: string, opts: LlmOpts = {}): LlmOutcome {
  const tried: LlmAttempt[] = []
  if (opts.dataDir) {
    const offline = offlineOutcome(opts.dataDir, Date.now())
    if (offline) return offline
  }
  // Рамка легитимности — в КАЖДЫЙ свой вызов по контенту чувствительного
  // проекта (CONCEPT §4.1). Это сухие правдивые факты из самого продукта, а не
  // уговоры: на несенситивном проекте её просто нет, и цена равна нулю.
  const frame = opts.dataDir ? readFrame(opts.dataDir) : ''
  // Язык ответа задаётся ОДНОЙ строкой, а не переводом всех промптов: то, что
  // модель напишет (правила, роли, разборы), ложится в паспорт и однажды будет
  // прочитано владельцем — значит и рождаться должно на его языке
  const framedPrompt = `${frame ? `${frame}\n\n---\n\n` : ''}${prompt}\n\n${t('Отвечай по-русски.', 'Answer in English.')}`
  for (const model of resolveModels(opts)) {
    const t0 = performance.now()
    try {
      // Массив аргументов (без shell): надёжно на Windows и позволяет передать
      // пустой --tools "" (внутренние вызовы плагина — чистые text-in/text-out,
      // без ухода модели в исследование файлов → без error_max_turns).
      // Промпт — через stdin (многострочный argv на Windows рвётся по \n).
      const r = spawnSync(
        'claude',
        ['-p', '--model', model, '--output-format', 'json', '--max-turns', '1', '--tools', ''],
        { input: framedPrompt, encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: internalEnv() },
      )
      // Тело парсим ДАЖE при ненулевом коде: ошибки модели живут в JSON stdout
      // (is_error/api_error_status/subtype), а не в stderr — иначе fail-silent.
      let parsed: Record<string, unknown> = {}
      if (typeof r.stdout === 'string' && r.stdout.trim()) {
        try {
          parsed = JSON.parse(r.stdout.trim())
        } catch {
          /* не-JSON */
        }
      }
      const text = typeof parsed.result === 'string' ? parsed.result : ''
      const ms = Math.round(performance.now() - t0)
      const resolvedId = resolvedIdOf(parsed)
      const apiStatus = asStatus(parsed.api_error_status)
      if (parsed.is_error || !text.trim()) {
        const why = apiStatus != null ? `api=${apiStatus}` : `subtype=${parsed.subtype ?? '?'}`
        const stderr = (r.stderr ?? '').toString().slice(0, 150)
        const note = `exit=${r.status}; ${why}; stderr: ${stderr}`
        tried.push({ model, ms, ok: false, note })
        // Обрыв сети — состояние машины, а не модели: следующим работам этого
        // захода пробовать нечего, и они узнают об этом без своего спавна
        if (opts.dataDir && looksLikeNetworkFailure(`${note} ${text}`)) {
          markNetworkDown(opts.dataDir, note, Date.now())
          return { result: null, tried }
        }
        // В кэш уходит и ТЕКСТ ошибки, а не только код: исчерпанный лимит CLI
        // часто объявляет словами при нулевом api_error_status, и без текста он
        // классифицировался бы транзиентом — то есть остался бы в голове вектора
        if (opts.dataDir) {
          recordOutcome(opts.dataDir, model, {
            ok: false,
            resolvedId,
            apiErrorStatus: apiStatus,
            note: `${why} ${text.slice(0, 200)} ${stderr}`.trim(),
            now: new Date().toISOString(),
          })
        }
        continue
      }
      // Отказ — НЕ успех. Раньше он возвращался как обычный ответ и уходил в
      // парсер мусором («не могу помочь» вместо JSON с правилами), а проход тихо
      // давал ноль без объяснения. Теперь это отдельное событие: пробуем
      // следующую модель (другая может не отказать) и пишем в журнал закалки.
      const refusal = detectRefusal(parsed, text)
      if (refusal.refused) {
        tried.push({ model, ms, ok: false, note: `отказ (${refusal.reason})${frame ? ' — даже с рамкой' : ''}` })
        if (opts.db) {
          recordRefusal(opts.db, {
            model: resolvedId ?? model,
            purpose: opts.purpose ?? 'llm',
            framed: frame.length > 0,
            resolved: false,
            reason: refusal.reason,
          })
        }
        continue
      }

      tried.push({ model, ms, ok: true, note: `ответ ${text.length} симв.${resolvedId ? ` (${resolvedId})` : ''}` })
      if (opts.dataDir) {
        recordOutcome(opts.dataDir, model, { ok: true, resolvedId, apiErrorStatus: null, note: `${text.length} симв.`, now: new Date().toISOString() })
        clearNetworkDown(opts.dataDir) // ответ пришёл — признак снимается сразу, а не по сроку
      }
      // Отказы предыдущих моделей сняты — проход дошёл до результата
      const refusalsBefore = tried.filter((t) => t.note.startsWith('отказ')).length
      if (opts.db && refusalsBefore > 0) markRefusalsResolved(opts.db, refusalsBefore)
      return { result: { text, model: resolvedId ?? model }, tried }
    } catch (e) {
      const note = String(e).slice(0, 200)
      tried.push({ model, ms: Math.round(performance.now() - t0), ok: false, note })
      if (opts.dataDir && looksLikeNetworkFailure(note)) {
        markNetworkDown(opts.dataDir, note, Date.now())
        return { result: null, tried }
      }
    }
  }
  return { result: null, tried }
}

export const callClaude: LlmCaller = (prompt) => callClaudeDetailed(prompt).result

/**
 * Почему проход остался без ответа — по фактическим попыткам, а не по догадке.
 *
 * Раньше фон сообщал владельцу ровно «модели недоступны»: одинаково для
 * исчерпанного лимита, отозванного доступа, отказа модели и оборванной сети —
 * то есть не сообщал ничего. Диагноз собирается из того, что реально ответила
 * каждая модель: это та же аксиома «никогда молча», применённая к тексту ошибки.
 */
export function explainNoAnswer(tried: LlmAttempt[]): string {
  if (tried.length === 0) return 'модели недоступны: ни одной попытки не сделано'
  // Обрыв сети — не свойство моделей, а состояние машины: фраза «модели
  // недоступны: opus — ошибка» тут прямо вводила бы в заблуждение
  const offline = tried.find((t) => /сеть недоступна/.test(t.note))
  if (offline) return offline.note
  const reason = (note: string): string => {
    if (/api=429/.test(note) || /(usage|rate)[\s-]?limit|limit reached|quota/i.test(note)) return 'лимит исчерпан'
    if (/api=40[134]/.test(note)) return 'нет доступа'
    if (/^отказ/.test(note)) return 'отказ модели'
    if (/timeout|ETIMEDOUT|timed out/i.test(note)) return 'таймаут'
    if (/ENOENT|not found|не найден/i.test(note)) return 'claude CLI не найден'
    return 'ошибка'
  }
  return `модели недоступны: ${tried.map((t) => `${t.model} — ${reason(t.note)}`).join(', ')}`
}

/**
 * Вызов С веб-инструментами и запасом ходов — для внешнего заземления
 * (research + синтез). Дороже и медленнее; офлайн/сбой → null (деградация).
 */
export function callClaudeWithTools(prompt: string, opts: LlmOpts = {}): LlmResult | null {
  // Заземление тем более бессмысленно без сети: оно ходит наружу по определению
  if (opts.dataDir && networkDownUntil(opts.dataDir, Date.now()) !== null) return null
  for (const model of resolveModels(opts)) {
    try {
      const r = spawnSync(
        'claude',
        ['-p', '--model', model, '--output-format', 'json', '--max-turns', '24', '--tools', 'WebSearch,WebFetch'],
        { input: prompt, encoding: 'utf8', timeout: 420_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: internalEnv() },
      )
      let parsed: Record<string, unknown> = {}
      if (typeof r.stdout === 'string' && r.stdout.trim()) {
        try {
          parsed = JSON.parse(r.stdout.trim())
        } catch {
          /* не-JSON */
        }
      }
      const text = typeof parsed.result === 'string' ? parsed.result : ''
      const resolvedId = resolvedIdOf(parsed)
      const apiStatus = asStatus(parsed.api_error_status)
      if (!parsed.is_error && text.trim()) {
        if (opts.dataDir) recordOutcome(opts.dataDir, model, { ok: true, resolvedId, apiErrorStatus: null, note: 'ground', now: new Date().toISOString() })
        return { text, model: resolvedId ?? model }
      }
      if (opts.dataDir) recordOutcome(opts.dataDir, model, { ok: false, resolvedId, apiErrorStatus: apiStatus, note: 'ground', now: new Date().toISOString() })
    } catch {
      /* следующая модель */
    }
  }
  return null
}
