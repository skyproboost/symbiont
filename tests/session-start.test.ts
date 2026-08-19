import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleSessionStart, slugOf, fitToBudget } from '../src/hooks/session-start-core'

const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'

describe('slugOf', () => {
  it('нормализует имя проекта', () => {
    expect(slugOf('D:\\OSPanel\\domains\\labreadai-v2')).toBe('labreadai-v2')
    expect(slugOf('/home/user/My Project!')).toBe('my-project-')
  })
})

describe('handleSessionStart', () => {
  it('проект с конвенциями: additionalContext со сводкой + heartbeat', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-hook-proj-'))
    for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data-'))

    const out = handleSessionStart({ cwd: proj, source: 'startup' }, dataRoot)

    expect(out.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('только var')
    expect(ctx).toContain('Symbiont')

    const hb = JSON.parse(readFileSync(join(dataRoot, slugOf(proj), 'heartbeat-sessionstart.json'), 'utf8'))
    expect(hb.channel).toBe('SessionStart')
    expect(hb.source).toBe('startup')

    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
  })

  it('пустой проект: молчит (не занимает контекст), но heartbeat есть', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-hook-empty-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data2-'))
    const out = handleSessionStart({ cwd: proj }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined()
    expect(existsSync(join(dataRoot, slugOf(proj), 'heartbeat-sessionstart.json'))).toBe(true)
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
  })

  it('fail-open: несуществующий cwd не роняет хук', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-hook-data3-'))
    const out = handleSessionStart({ cwd: 'Z:\\нет\\такого\\пути' }, dataRoot)
    expect(out.hookSpecificOutput).toBeUndefined() // молчание, не исключение
    rmrf(dataRoot, { recursive: true, force: true })
  })
})

/**
 * Бюджет подачи тратится по ВЕСУ секций, а не по их месту в файле. Слайс по
 * 8000-му символу был безобиден, пока паспорт мал: на зрелом проекте самая
 * толстая секция стоит раньше измеренных и выталкивала из подачи и профиль
 * качества, и карту ключевых модулей — то есть то, ради чего сводку читают.
 */
describe('fitToBudget', () => {
  const section = (title: string, items: number, len = 60): string =>
    [`## ${title}`, '', ...Array.from({ length: items }, (_, i) => `- ${title}-${i} ${'ы'.repeat(len)}`)].join('\n')
  const doc = (): string => ['# Паспорт', '', section('Толстая', 60), section('Тонкая', 4), section('Карта', 5)].join('\n')

  it('режет самую толстую секцию, а хвост документа доезжает целиком', () => {
    const out = fitToBudget(doc(), 2000, 'C:/p/SUMMARY.md')
    expect(out.length).toBeLessThanOrEqual(2000)
    expect(out).toContain('## Карта') // раньше её сносило слайсом
    expect(out).toContain('## Тонкая')
    expect((out.match(/- Тонкая-/g) ?? []).length).toBe(4) // тонкую не трогали
    expect((out.match(/- Толстая-/g) ?? []).length).toBeLessThan(60)
  })

  it('отрезанное называется вслух, а не исчезает молча', () => {
    const out = fitToBudget(doc(), 2000, 'C:/p/SUMMARY.md')
    const said = out.match(/…ещё (\d+) — passport_conventions/)
    expect(said).not.toBeNull()
    const shown = (out.match(/- Толстая-/g) ?? []).length
    expect(Number(said![1])).toBe(60 - shown)
  })

  it('сводка в бюджете не трогается вовсе', () => {
    const small = ['# Паспорт', '', section('Тонкая', 3)].join('\n')
    expect(fitToBudget(small, 8000, 'C:/p/SUMMARY.md')).toBe(small)
  })

  it('когда резать больше нечего — честный обрыв со ссылкой на полную версию', () => {
    const out = fitToBudget(doc(), 300, 'C:/p/SUMMARY.md')
    expect(out.length).toBeLessThanOrEqual(300 + 80)
    expect(out).toContain('полная версия: C:/p/SUMMARY.md')
  })
})
