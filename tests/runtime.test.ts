/**
 * Предпосылки к окружению. Плагин обязан работать молча — но не молчать, когда
 * работать не может: невидимая неработоспособность хуже видимой ошибки.
 */
import { describe, expect, it } from 'bun:test'
import { inspectRuntime, renderRuntimeWarning, silentSpawnOptions, fileOpener, loadSqliteDriver, claudeBin } from '../src/core/runtime'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmrf } from './_helpers'
import { setLang } from '../src/core/i18n'

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
    expect(r.runtime).toBe('unknown')
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

describe('окружение говорит на языке владельца', () => {
  it('англоязычному владельцу не приходит кириллицы ни в одной строке', () => {
    setLang('en')
    try {
      const noStorage = inspectRuntime({ node: '20.0.0' }, withoutDriver)
      const unknown = inspectRuntime({}, withoutDriver)

      for (const p of [...noStorage.problems, ...unknown.problems]) {
        expect(p, `«${p}» — кириллица в английской подаче`).not.toMatch(/[а-яА-ЯёЁ]/)
      }
      const warning = renderRuntimeWarning(noStorage)
      expect(warning).not.toBe('')
      expect(warning, `«${warning}» — кириллица в английской подаче`).not.toMatch(/[а-яА-ЯёЁ]/)
    } finally {
      setLang('ru')
    }
  })

  it('русскоязычному владельцу приходит по-русски', () => {
    setLang('ru')
    const r = inspectRuntime({}, withoutDriver)
    expect(renderRuntimeWarning(r)).toMatch(/[а-яА-ЯёЁ]/)
  })

  it('значение рантайма — английский идентификатор, а не слово подачи', () => {
    // 'неизвестно' в типе было русским литералом в КОДЕ против конвенции
    // «код и идентификаторы — английские»; русская форма рождается на показе
    expect(inspectRuntime({}, withoutDriver).runtime).toBe('unknown')
  })
})

/**
 * Модели зовутся алиасами, и версию им назначает CLI: устаревшая копия в PATH
 * молча понижала «opus» на поколение. Поэтому вызов идёт через CLI сессии.
 */
describe('CLI для собственных вызовов модели', () => {
  it('в сессии — бинарник, который её ведёт; вне сессии — из PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-clibin-'))
    try {
      const exe = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
      writeFileSync(exe, '')
      expect(claudeBin({ CLAUDE_CODE_EXECPATH: exe })).toBe(exe)
      expect(claudeBin({})).toBe('claude')
    } finally {
      rmrf(dir)
    }
  })

  it('чужой исполняемый файл или несуществующий путь — не CLI: остаётся PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-clibin2-'))
    try {
      // node вместо CLI исполнил бы промпт как код (`node -p`)
      const runtime = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
      writeFileSync(runtime, '')
      expect(claudeBin({ CLAUDE_CODE_EXECPATH: runtime })).toBe('claude')
      expect(claudeBin({ CLAUDE_CODE_EXECPATH: join(dir, 'нет', 'claude.exe') })).toBe('claude')
    } finally {
      rmrf(dir)
    }
  })
})
