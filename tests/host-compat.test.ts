import { describe, it, expect } from 'bun:test'
import { agentHost, codexModels } from '../src/core/host'
import { resolveModels } from '../src/layer2/llm'
import { patchPaths } from '../src/core/patch-paths'
import { transcriptLines } from '../src/core/transcript'
import { resolveDataRoot } from '../src/core/data-root'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evidenceFromTranscript } from '../src/gates/evidence'
import { rmrf } from './_helpers'
import { hostHookOutput } from '../src/hooks/host-output'

describe('host compatibility', () => {
  it('Codex stop observations are informational and explicit blocking stays explicit', () => {
    const info = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'observed' } }
    expect(hostHookOutput(info, 'Stop', 'codex')).toEqual({ systemMessage: 'observed' })
    expect(hostHookOutput(info, 'Stop', 'claude')).toBe(info)
    expect(hostHookOutput({ decision: 'block', reason: 'check failed' }, 'Stop', 'codex')).toEqual({ decision: 'block', reason: 'check failed' })
  })
  it('uses explicit host and does not mistake a Claude session for its parent Codex', () => {
    expect(agentHost({ SYMBIONT_HOST: 'codex', CLAUDECODE: '1' })).toBe('codex')
    expect(agentHost({ CLAUDECODE: '1', CODEX_THREAD_ID: 'parent' })).toBe('claude')
    expect(agentHost({ CODEX_THREAD_ID: 'thread' })).toBe('codex')
    expect(agentHost({})).toBe('claude')
    expect(codexModels({})).toEqual(['gpt-6-astra'])
  })
  it('uses Astra for both internal intents in Codex and restores the Claude chain', () => {
    const previous = process.env.SYMBIONT_HOST
    try {
      process.env.SYMBIONT_HOST = 'codex'
      expect(resolveModels({ intent: 'routine' })).toEqual(['gpt-6-astra'])
      expect(resolveModels({ intent: 'deep' })).toEqual(['gpt-6-astra'])
      process.env.SYMBIONT_HOST = 'claude'
      expect(resolveModels({ intent: 'deep' })[0]).toBe('fable')
      expect(resolveModels({ intent: 'routine' })[0]).toBe('haiku')
    } finally { if (previous === undefined) delete process.env.SYMBIONT_HOST; else process.env.SYMBIONT_HOST = previous }
  })
  it('resolves Codex data without writing into the versioned plugin', () => {
    expect(resolveDataRoot('/not-installed/.data', [], { PLUGIN_DATA: '/stable/codex-data' }).root).toBe('/stable/codex-data')
  })
  it('extracts all patch paths including renames and never interprets added content as headers', () => {
    const root = tmpdir()
    const paths = patchPaths('*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n+*** Add File: fake.ts\n*** Add File: c.ts\n*** End Patch', root)
    expect(paths).toEqual(['a.ts','b.ts','c.ts'].map(p => join(root,p)))
    expect(patchPaths('echo *** Add File: fake.ts',root)).toEqual([])
  })
  it('preserves existing Claude transcript records byte-for-byte', () => {
    const line = '{"type":"assistant","message":{"content":[]}}'
    expect(transcriptLines(line)).toEqual([line])
  })
  it('recognizes edit/check/edit order in a Codex rollout', () => {
    const dir=mkdtempSync(join(tmpdir(),'symbiont-host-'))
    try {
      const file=join(dir,'rollout.jsonl')
      const patch=(id:string)=>({type:'response_item',payload:{type:'custom_tool_call',name:'apply_patch',call_id:id,input:'*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch'}})
      const events=[{type:'session_meta',payload:{cwd:dir}},patch('1'),{type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'2',arguments:JSON.stringify({cmd:'bun test'})}}]
      writeFileSync(file,events.map(e=>JSON.stringify(e)).join('\n'))
      const own=new Set(['a.ts']);const rel=(p:string)=>p===join(dir,'a.ts')?'a.ts':null
      expect(evidenceFromTranscript(file,own,rel).uncheckedFiles).toEqual([])
      writeFileSync(file,[...events,patch('3')].map(e=>JSON.stringify(e)).join('\n'))
      expect(evidenceFromTranscript(file,own,rel).uncheckedFiles).toEqual(['a.ts'])
    } finally { rmrf(dir) }
  })
})
