import type { AgentHost } from '../core/host'

/** Only translate outputs whose contracts differ. Observations must not force another turn. */
export function hostHookOutput(out: object, channel: string, host: AgentHost): object {
  if (host !== 'codex' || !['Stop', 'PreCompact'].includes(channel)) return out
  const { hookSpecificOutput, ...common } = out as { hookSpecificOutput?: { additionalContext?: string }; [key: string]: unknown }
  return hookSpecificOutput?.additionalContext
    ? { ...common, systemMessage: hookSpecificOutput.additionalContext }
    : common
}
