import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleMessage, toolDefs } from '../src/mcp/handlers'

// Без пометок хост считает вызов потенциально пишущим и спрашивает разрешения; там, где спросить некого (Codex в
// фоне у duet, approval_policy=never), вызов отклоняется — паспорт недоступен именно там, где он нужнее всего.
describe('MCP tool annotations', () => {
  it('tools/list: у каждого инструмента — все четыре пометки, булевы', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'x') as any
    const tools = res.result.tools as any[]
    expect(tools.length).toBe(toolDefs().length)
    for (const tool of tools) {
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        expect(typeof tool.annotations?.[hint]).toBe('boolean')
      }
    }
  })

  it('инструменты паспорта объявлены только читающими и не выходящими во внешний мир', () => {
    for (const tool of toolDefs()) {
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.annotations.destructiveHint).toBe(false)
      expect(tool.annotations.openWorldHint).toBe(false)
    }
  })

  it('пометка правдива: обработчик открывает базу паспорта только на чтение', () => {
    // контракт: смени кто-нибудь открытие базы на пишущее — readOnlyHint стал бы ложью, и тест это поймает
    const src = readFileSync(join(import.meta.dir, '..', 'src', 'mcp', 'handlers.ts'), 'utf8')
    const opens = src.match(/openDb\([^)]*\)/g) ?? []
    expect(opens.length).toBeGreaterThan(0)
    for (const call of opens) expect(call).toContain('readonly: true')
  })
})
