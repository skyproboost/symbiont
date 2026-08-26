/**
 * Режим гейта формы. Дефолт — dry-run (наблюдение): блокировка включается
 * владельцем осознанно, после обкатки на данных поимок (правило выкатки
 * Этапа 2: сначала смотрим, что ловится, потом принуждаем).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type GateMode = 'dry-run' | 'block'
/** offer — предложить оглавление примечанием (умолчание); deny — отменить первое чтение большого файла, отдав оглавление причиной. */
export type OutlineMode = 'offer' | 'deny'

export function readOutlineMode(dataDir: string): OutlineMode {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, 'gate.json'), 'utf8')) as { outline?: string }
    return j.outline === 'deny' ? 'deny' : 'offer'
  } catch {
    return 'offer'
  }
}

/** gate.json в каталоге данных проекта: {"mode": "block"}; отсутствие/мусор = dry-run. */
export function readGateMode(dataDir: string): GateMode {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, 'gate.json'), 'utf8')) as { mode?: string }
    return j.mode === 'block' ? 'block' : 'dry-run'
  } catch {
    return 'dry-run'
  }
}
