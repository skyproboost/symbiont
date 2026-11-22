/** Read the supported JSONL shapes of either host. Unknown records remain inert. */
import { patchPaths } from './patch-paths'

export function transcriptLines(text: string): string[] {
  let cwd = ''
  return text.split('\n').flatMap(line => {
    let event: any
    try { event = JSON.parse(line) } catch { return [line] }
    if (event.type === 'session_meta') { cwd = event.payload?.cwd ?? cwd; return [] }
    if (event.type === 'turn_context') { cwd = event.payload?.cwd ?? cwd; return [] }
    if (event.type === 'event_msg' && event.payload?.type === 'user_message') {
      return [JSON.stringify({ type: 'user', message: { content: event.payload.message }, timestamp: event.timestamp })]
    }
    if (event.type !== 'response_item') return [line]
    const p = event.payload
    if (!p || typeof p !== 'object') return []
    if (p.type === 'message' && p.role === 'assistant') {
      return [JSON.stringify({ type: 'assistant', message: { id: p.id, content: (p.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => ({ type: 'text', text: c.text })) } })]
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      return [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: p.call_id, content: typeof p.output === 'string' ? p.output : JSON.stringify(p.output) }] } })]
    }
    if (p.type !== 'function_call' && p.type !== 'custom_tool_call') return []
    let args: any = {}
    try { args = JSON.parse(p.arguments ?? '{}') } catch { /* custom patch is plain text */ }
    const name = String(p.name ?? '').replace(/^functions\./, '')
    let content: object[] = []
    if (name === 'exec_command' || name === 'shell_command') {
      content = [{ type: 'tool_use', id: p.call_id, name: 'Bash', input: { command: args.cmd ?? args.command ?? '' } }]
    } else if (name === 'apply_patch' && cwd) {
      content = patchPaths(p.input ?? args.command ?? args.patch, cwd).map(file_path => ({ type: 'tool_use', id: p.call_id, name: 'Edit', input: { file_path } }))
    }
    return content.length ? [JSON.stringify({ type: 'assistant', message: { content } })] : []
  })
}
