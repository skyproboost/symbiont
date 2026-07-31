/**
 * Heartbeat каналов: каждый хук оставляет след срабатывания.
 * Урок Graphify: канал, умерший молча, — худший режим отказа;
 * пульс каналов виден в /sym-status. Никогда не бросает (fail-open).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function beat(dataDir: string, channel: string, extra: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(dataDir, `heartbeat-${channel.toLowerCase()}.json`),
      JSON.stringify({ channel, at: new Date().toISOString(), ...extra }),
      'utf8',
    )
  } catch {
    /* пульс — диагностика, не обязанность */
  }
}
