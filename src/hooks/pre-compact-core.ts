/**
 * PreCompact-хук: перед сжатием контекста (авто или ручным).
 *
 * Роль в lifecycle (CONCEPT §4.2): точка, где ещё жив полный контекст сессии.
 * Symbiont здесь (1) оставляет пульс канала (самодиагностика: PreCompact живёт),
 * (2) даёт петле самообучения дополнительный оппортунистический триггер харвеста
 * ПЕРЕД сжатием — детач в процесс-обёртке, само-гейт с кулдауном не даёт ему
 * бегать на каждом сжатии.
 *
 * Важно: непрерывность контекста восстанавливает SessionStart(source=compact) —
 * он переинжектит сводку паспорта после сжатия. Паспорт/нити/журнал живут в
 * passport.db, сжатие их не теряет; теряется лишь живой диалог, а его и
 * восстанавливает сводка. Поэтому PreCompact — best-effort обогащение, не
 * обязанность; fail-open, ничего не блокирует.
 */
import { join } from 'node:path'
import { slugOf } from './session-start-core'
import { beat } from './heartbeat'

export interface PreCompactInput {
  cwd?: string
  session_id?: string
  /** что запустило сжатие: 'auto' | 'manual' */
  trigger?: string
}

export interface PreCompactOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreCompact'
    additionalContext: string
  }
}

export function handlePreCompact(input: PreCompactInput, dataRoot: string): PreCompactOutput {
  try {
    const cwd = input.cwd ?? process.cwd()
    const dataDir = join(dataRoot, slugOf(cwd))
    beat(dataDir, 'PreCompact', { trigger: input.trigger ?? null })
  } catch {
    /* fail-open: пульс — оптимизация, не обязанность */
  }
  return {} // побочный эффект (пульс) + харвест детачит процесс-обёртка; вывод не нужен
}
