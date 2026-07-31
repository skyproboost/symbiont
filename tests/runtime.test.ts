/**
 * Предпосылки к окружению. Плагин обязан работать молча — но не молчать, когда
 * работать не может: невидимая неработоспособность хуже видимой ошибки.
 */
import { describe, expect, it } from 'bun:test'
import { inspectRuntime, renderRuntimeWarning, silentSpawnOptions, fileOpener, loadSqliteDriver } from '../src/core/runtime'

// Наличие драйвера — свойство ЧУЖОЙ машины, поэтому в тестах оно подставляется:
// иначе проверка описывала бы ту машину, на которой сейчас идёт прогон.
const withDriver = (): boolean => true
const withoutDriver = (): boolean => false

describe('опознание рантайма', () => {
  it('bun — всё в порядке, ни слова владельцу', () => {
    const r = inspectRuntime({ bun: '1.3.14' }, withoutDriver)
    expect(r.runtime).toBe('bun')
    // у bun хранилище встроено всегда — драйвер node к делу не относится
    expect(r.hasStorage).toBe(true)
    expect(renderRuntimeWarning(r)).toBe('')
  })

  it('свежий Node — хранилище есть, работа возможна', () => {
    const r = inspectRuntime({ node: '22.14.0' }, withDriver)
    expect(r.runtime).toBe('node')
    expect(r.hasStorage).toBe(true)
    expect(renderRuntimeWarning(r)).toBe('')
  })

  it('старый Node — проблема НАЗВАНА, а не скрыта', () => {
    const r = inspectRuntime({ node: '18.19.0' }, withoutDriver)
    expect(r.hasStorage).toBe(false)
    const w = renderRuntimeWarning(r)
    expect(w).toContain('не может работать')
    expect(w).toContain('или bun')
    // и обещание не навредить — плагин не ломает работу владельца
    expect(w).toContain('ничего не сломает')
  })

  it('вердикт — по факту загрузки, а не по номеру версии', () => {
    // Node правильной версии, но собранный без node:sqlite: версия обещает, а
    // машина не даёт. Верить надо машине.
    const r = inspectRuntime({ node: '22.14.0' }, withoutDriver)
    expect(r.hasStorage).toBe(false)
    expect(renderRuntimeWarning(r)).toContain('хранилища нет')
  })

  it('рантайм не опознан — тоже сказано вслух', () => {
    const r = inspectRuntime({}, withoutDriver)
    expect(r.runtime).toBe('неизвестно')
    expect(renderRuntimeWarning(r)).toContain('не опознан')
  })

  it('драйвер текущего рантайма реально грузится', () => {
    // Прогон идёт под bun — значит bun:sqlite обязан быть, а node:sqlite нет.
    expect(loadSqliteDriver('bun')).not.toBeNull()
    expect(loadSqliteDriver('node')).toBeNull()
  })
})

describe('плагин не показывает окон', () => {
  it('любой дочерний процесс запускается скрыто', () => {
    const o = silentSpawnOptions()
    expect(o.windowsHide).toBe(true)
    expect(o.stdio).toBe('ignore')
    expect(o.detached).toBe(true)
  })

  it('на Windows файлы открывает explorer, а не консольный cmd', () => {
    expect(fileOpener('win32').cmd).toBe('explorer.exe')
    expect(fileOpener('win32').cmd).not.toContain('cmd')
    expect(fileOpener('darwin').cmd).toBe('open')
    expect(fileOpener('linux').cmd).toBe('xdg-open')
  })

  it('оболочка не используется нигде — shell порождает консоль', () => {
    for (const p of ['win32', 'darwin', 'linux']) expect(fileOpener(p).usesShell).toBe(false)
  })
})
