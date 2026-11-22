/**
 * Heartbeat каналов: каждый хук оставляет след срабатывания.
 * Урок Graphify: канал, умерший молча, — худший режим отказа;
 * пульс каналов виден в /sym-status. Никогда не бросает (fail-open).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Каналы, зарегистрированные у платформы, — из манифеста хоста, лежащего рядом
 * с кодом: у собранного артефакта это `../hooks/hooks.json` от `dist`, у
 * исходников — `hooks/hooks.json` в корне. Список именно читается, а не
 * вписан константой: у пакета для Codex свой манифест, и канала упавшей правки
 * в нём нет — константа показывала бы его там вечным «ни разу».
 *
 * Нужен показу пульса: канал, не бивший НИ РАЗУ, следа на диске не оставляет,
 * и список «у кого пульс есть» его просто не содержал — так PostToolUseFailure
 * промолчал с рождения во всех проектах незамеченным. Манифест не нашёлся —
 * пустой список: показ вернётся к прежнему «только те, у кого пульс есть».
 */
export function registeredChannels(): string[] {
  for (const path of [join(import.meta.dirname, '..', 'hooks', 'hooks.json'), join(import.meta.dirname, '..', '..', 'hooks', 'hooks.json')]) {
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { hooks?: Record<string, unknown> }
      if (manifest.hooks) return Object.keys(manifest.hooks)
    } catch {
      /* не здесь — пробуем следующее место */
    }
  }
  return []
}

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
