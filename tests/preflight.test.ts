/**
 * Предпосылки к окружению: их проверяет КАЖДАЯ команда, а не только хуки.
 *
 * Поймано на первой чужой установке: Node 20.19.6, `/symbiont:init` — команда
 * ушла прямо в openDb и выдала восемь строк стека ESM-загрузчика. Механизм
 * честного сообщения в проекте был, звал его только SessionStart.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRY_SOURCES } from '../src/bundle/core'
import { runtimeBlocker, inspectRuntime, type RuntimeReport } from '../src/core/runtime'
import { setLang } from '../src/core/i18n'

const ROOT = join(import.meta.dir, '..')

describe('сообщение о неподходящем окружении', () => {
  const noStorage: RuntimeReport = { runtime: 'node', version: '20.19.6', hasStorage: false, problems: ['x'] }

  it('называет три вещи: что есть, что нужно, что ничего не сломано', () => {
    setLang('ru')
    const msg = runtimeBlocker(noStorage) ?? ''
    expect(msg).toContain('node 20.19.6') // что на машине
    expect(msg).toContain('22.13') // что требуется
    expect(msg).toContain('Bun') // и чем ещё можно
    expect(msg.toLowerCase()).toContain('ничего не сломано') // и что проект цел
  })

  it('на английской подаче — тот же смысл без кириллицы', () => {
    setLang('en')
    try {
      const msg = runtimeBlocker(noStorage) ?? ''
      expect(/[а-яё]/i.test(msg)).toBe(false)
      expect(msg).toContain('22.13')
    } finally {
      setLang('ru')
    }
  })

  it('рантайм не опознан — тоже объясняется, а не молчит', () => {
    setLang('ru')
    const msg = runtimeBlocker({ runtime: 'неизвестно', version: '', hasStorage: false, problems: ['x'] }) ?? ''
    expect(msg).toContain('ни Node, ни Bun')
  })

  it('рабочее окружение не получает ни строки', () => {
    expect(runtimeBlocker({ runtime: 'bun', version: '1.2.9', hasStorage: true, problems: [] })).toBeNull()
    // и на этой машине тоже: тест гоняется там, где хранилище есть
    expect(runtimeBlocker(inspectRuntime())).toBeNull()
  })
})

describe('каждая команда поставки проверяет предпосылки', () => {
  it('точки входа CLI зовут runtimeBlocker до работы', () => {
    // Список берётся из ЕДИНСТВЕННОГО места, где он и так объявлен, — сборщика.
    // Появится новая команда — она попадёт сюда сама, без правки теста.
    const commands = ENTRY_SOURCES.filter((s) => s.startsWith('src/cli/'))
    expect(commands.length).toBeGreaterThan(3)
    const silent = commands.filter((s) => !readFileSync(join(ROOT, s), 'utf8').includes('runtimeBlocker()'))
    expect(silent).toEqual([])
  })
})
