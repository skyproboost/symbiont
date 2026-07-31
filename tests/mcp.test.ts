import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMessage, callTool, toolDefs } from '../src/mcp/handlers'
import { buildPassport } from '../src/passport/build'
import { setLang } from '../src/core/i18n'

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
  // Язык закрепляется явно. Раньше эти проверки зависели от того, какой файл
  // батареи отработал раньше и что оставил в состоянии процесса, — то есть
  // проходили по стечению обстоятельств, а не по проверяемому свойству.
  it('initialize: возвращает capabilities.tools и instructions', () => {
    setLang('ru')
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
    expect(toolDefs().every((d) => d.inputSchema.type === 'object')).toBe(true)
  })

  it('неизвестный метод с id: -32601', () => {
    const res = handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, 'x') as any
    expect(res.error.code).toBe(-32601)
  })
})

describe('passport tools', () => {
  const { data } = passportDir()

  it('passport_conventions: легенда + плотные строки фактов', () => {
    setLang('ru')
    const text = callTool('passport_conventions', {}, data)
    expect(text).toContain('Легенда:')
    expect(text).toContain('только var')
    expect(text).toContain('закон')
  })

  it('фильтр по области', () => {
    setLang('ru')
    const text = callTool('passport_conventions', { area: 'объявления' }, data)
    expect(text).toContain('только var')
    expect(text).not.toContain('венгерская')
  })

  it('область принимается и на языке подачи, а не только ключом журнала', () => {
    // Описание инструмента перечисляет области на языке владельца. Принять их
    // обратно обязан тот же инструмент — иначе перечень читается, но не работает
    setLang('en')
    try {
      const byEnglish = callTool('passport_conventions', { area: 'declarations' }, data)
      expect(byEnglish).toContain('var only')
      // русский ключ остаётся идентичностью и принимается при любом языке
      expect(callTool('passport_conventions', { area: 'объявления' }, data)).toContain('var only')
    } finally {
      setLang('ru')
    }
  })

  it('passport_history: действующая запись помечена', () => {
    setLang('ru')
    const text = callTool('passport_history', { key: 'объявления|переменные' }, data)
    expect(text).toContain('● действует')
    expect(text).toContain('только var')
  })

  it('английская подача MCP: ни описаний, ни ответов по-русски', () => {
    // MCP — единственная поверхность метаданных, которая рождается в НАШЕМ
    // процессе на каждый tools/list, а значит обязана следовать языку владельца.
    // Замер до этой правки: 51 формулировка из 51 уходила по-русски.
    setLang('en')
    try {
      const cyr = /[а-яё]/i
      const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, data) as any
      expect(cyr.test(init.result.instructions)).toBe(false)
      for (const d of toolDefs()) {
        expect(cyr.test(d.description)).toBe(false)
        for (const p of Object.values(d.inputSchema.properties)) {
          expect(cyr.test(String((p as { description?: string }).description ?? ''))).toBe(false)
        }
      }
      for (const name of ['passport_map', 'passport_orphans', 'passport_reach']) {
        expect(cyr.test(callTool(name, {}, data))).toBe(false)
      }
      // У конвенций первая колонка — КЛЮЧ факта, идентификатор журнала: он
      // остаётся в исходной форме намеренно (по нему считается вытеснение и по
      // нему же спрашивают passport_history). Проверяем всё, КРОМЕ него, —
      // иначе проверка требовала бы переводить идентичность факта.
      const facts = callTool('passport_conventions', {}, data)
      for (const line of facts.split('\n')) {
        const body = line.includes(' · ') ? line.slice(line.indexOf(' · ')) : line
        expect(cyr.test(body)).toBe(false)
      }
      // и формулировки самих фактов, и ярус — на языке подачи
      expect(facts).toContain('var only')
      expect(facts).toContain('law')
      expect(facts).toContain('project maturity')
    } finally {
      setLang('ru')
    }
  })

  it('паспорта нет — честное сообщение, не ошибка', () => {
    setLang('ru')
    const empty = mkdtempSync(join(tmpdir(), 'symbiont-mcp-empty-'))
    const text = callTool('passport_conventions', {}, empty)
    expect(text).toContain('не построен')
    rmrf(empty, { recursive: true, force: true })
  })

  it('tools/call через полный конвейер сообщения', () => {
    setLang('ru')
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
