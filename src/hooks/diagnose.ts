/**
 * Самодиагностика каналов (концепт §7): SessionStart сверяет, не замолчал ли
 * канал, который должен срабатывать. Молчащий канал — худший режим отказа
 * (урок Graphify), поэтому «ничего молча»: честное предупреждение в сводке.
 *
 * Логика чистая (тестируется без процесса): на вход — время пульса каналов и
 * времена стартов прошлых сессий; на выход — предупреждения о замолчавших.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Каналы, которые ДОЛЖНЫ срабатывать при обычной работе (надёжные сигналы).
 *  SessionEnd — best-effort (не гарантирован платформой), PostToolUse — только
 *  при использовании инструментов; их молчание не тревожим. */
const EXPECTED = ['userpromptsubmit', 'stop']
const SILENT_SESSIONS = 3 // молчит столько прошлых сессий подряд → сигнал

export interface ChannelBeat {
  channel: string
  at: string
}

/**
 * Замолчавшие каналы. sessionStartsDesc — started_at прошлых сессий (новые
 * первыми), НЕ включая текущую. Канал считается молчащим, если его последний
 * пульс старше старта SILENT_SESSIONS-й по счёту прошлой сессии (т.е. он не
 * бил на протяжении последних N сессий, в которых был шанс).
 */
export function silentChannels(beats: ChannelBeat[], sessionStartsDesc: string[]): string[] {
  if (sessionStartsDesc.length < SILENT_SESSIONS) return [] // мало истории — не паникуем
  const cutoff = Date.parse(sessionStartsDesc[SILENT_SESSIONS - 1])
  if (!Number.isFinite(cutoff)) return []
  const beatAt = new Map(beats.map((b) => [b.channel.toLowerCase(), Date.parse(b.at)]))
  const silent: string[] = []
  for (const ch of EXPECTED) {
    const at = beatAt.get(ch)
    // канал ни разу не бил, ИЛИ его пульс старше отсечки — молчит N сессий
    if (at === undefined || !Number.isFinite(at) || at < cutoff) silent.push(ch)
  }
  return silent
}

/** Прочитать пульсы каналов из каталога данных. */
export function readBeats(dataDir: string): ChannelBeat[] {
  try {
    return readdirSync(dataDir)
      .filter((f) => f.startsWith('heartbeat-') && f.endsWith('.json'))
      .map((f) => {
        try {
          const j = JSON.parse(readFileSync(join(dataDir, f), 'utf8')) as { channel?: string; at?: string }
          return j.channel && j.at ? { channel: j.channel, at: j.at } : null
        } catch {
          return null
        }
      })
      .filter((b): b is ChannelBeat => b !== null)
  } catch {
    return []
  }
}

const LABEL: Record<string, string> = {
  userpromptsubmit: 'UserPromptSubmit (JIT-срез по промпту)',
  stop: 'Stop (гейт формы / HANDOFF)',
}

/** Строка предупреждения для блока «Состояние» сводки, если каналы молчат. */
export function renderDiagnosis(silent: string[]): string {
  if (silent.length === 0) return ''
  const named = silent.map((c) => LABEL[c] ?? c).join(', ')
  return `- ⚠ самодиагностика: канал(ы) молчат ${SILENT_SESSIONS}+ сессий — ${named}. Возможен сломанный хук (обнови плагин / перезапусти Claude Code); паспорт работает на оставшихся каналах.`
}
