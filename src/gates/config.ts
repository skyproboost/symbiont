/**
 * Режим гейта формы. Дефолт — dry-run (наблюдение): блокировка включается
 * владельцем осознанно, после обкатки на данных поимок (правило выкатки
 * Этапа 2: сначала смотрим, что ловится, потом принуждаем).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type GateMode = 'dry-run' | 'block'

/** gate.json в каталоге данных проекта: {"mode": "block"}; отсутствие/мусор = dry-run. */
export function readGateMode(dataDir: string): GateMode {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, 'gate.json'), 'utf8')) as { mode?: string }
    return j.mode === 'block' ? 'block' : 'dry-run'
  } catch {
    return 'dry-run'
  }
}
