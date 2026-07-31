import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMessage, callTool, TOOLS } from '../src/mcp/handlers'
import { buildPassport } from '../src/passport/build'

const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'

function passportDir(): { proj: string; data: string } {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-mcp-proj-'))
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
  const data = mkdtempSync(join(tmpdir(), 'symbiont-mcp-data-'))
  buildPassport(proj, data)
  rmrf(proj, { recursive: true, force: true })
  return { proj, data }
}

describe('MCP protocol', () => {
  it('initialize: возвращает capabilities.tools и instructions', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, 'x') as any
    expect(res.result.serverInfo.name).toBe('symbiont-passport')
    expect(res.result.capabilities.tools).toBeDefined()
    expect(res.result.instructions).toContain('Паспорт')
  })

  it('notifications игнорируются (null)', () => {
    expect(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'x')).toBe(null)
  })

  it('tools/list: все инструменты со схемами', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'x') as any
    const names = res.result.tools.map((t: any) => t.name)
    // код-граф + доменный граф сущностей (сироты/достижимость)
    expect(names).toEqual(expect.arrayContaining([
      'passport_conventions', 'passport_history', 'passport_map', 'passport_impact',
      'passport_related', 'passport_orphans', 'passport_reach',
    ]))
    expect(TOOLS.every((t) => t.inputSchema.type === 'object')).toBe(true)
  })

  it('неизвестный метод с id: -32601', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, 'x') as any
    expect(res.error.code).toBe(-32601)
  })
})

describe('passport tools', () => {
  const { data } = passportDir()

  it('passport_conventions: легенда + плотные строки фактов', () => {
    const text = callTool('passport_conventions', {}, data)
    expect(text).toContain('Легенда:')
    expect(text).toContain('только var')
    expect(text).toContain('закон')
  })

  it('фильтр по области', () => {
    const text = callTool('passport_conventions', { area: 'объявления' }, data)
    expect(text).toContain('только var')
    expect(text).not.toContain('венгерская')
  })

  it('passport_history: действующая запись помечена', () => {
    const text = callTool('passport_history', { key: 'объявления|переменные' }, data)
    expect(text).toContain('● действует')
    expect(text).toContain('только var')
  })

  it('паспорта нет — честное сообщение, не ошибка', () => {
    const empty = mkdtempSync(join(tmpdir(), 'symbiont-mcp-empty-'))
    const text = callTool('passport_conventions', {}, empty)
    expect(text).toContain('не построен')
    rmrf(empty, { recursive: true, force: true })
  })

  it('tools/call через полный конвейер сообщения', () => {
    const res = handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'passport_conventions', arguments: {} } },
      data,
    ) as any
    expect(res.result.content[0].type).toBe('text')
    expect(res.result.content[0].text).toContain('только var')
  })

  it('cleanup', () => {
    rmrf(data, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
