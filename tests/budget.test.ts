/**
 * Бюджеты качества: храповик в момент правки. Половина проверок — на МОЛЧАНИЕ:
 * гейт, срабатывающий на обычной работе, будет выключен через неделю.
 */
import { describe, expect, it } from 'bun:test'
import { measure, measureBefore, compareBudgets, renderBudgets } from '../src/gates/budget'

const diffOf = (removed: string[], added: string[]): string =>
  [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n')

describe('порог берётся из прошлого состояния, а не из выдуманного числа', () => {
  it('исчезновение проверок ловится', () => {
    const before = [{ metric: 'проверок в коде', value: 20, direction: 'больше лучше' as const }]
    const after = [{ metric: 'проверок в коде', value: 12, direction: 'больше лучше' as const }]
    const b = compareBudgets(before, after)
    expect(b.length).toBe(1)
    expect(b[0].detail).toContain('упало с 20 до 12')
  })

  it('разбухание файла ловится', () => {
    const before = [{ metric: 'строк в самом большом файле', value: 200, direction: 'меньше лучше' as const }]
    const after = [{ metric: 'строк в самом большом файле', value: 900, direction: 'меньше лучше' as const }]
    expect(compareBudgets(before, after)[0].detail).toContain('в 4.5 раза')
  })

  it('улучшение молчит — гейт охраняет, а не комментирует', () => {
    const before = [{ metric: 'проверок в коде', value: 10, direction: 'больше лучше' as const }]
    const after = [{ metric: 'проверок в коде', value: 30, direction: 'больше лучше' as const }]
    expect(compareBudgets(before, after)).toEqual([])
  })

  it('дыхание проекта в пределах допуска молчит', () => {
    const before = [{ metric: 'строк в самом большом файле', value: 200, direction: 'меньше лучше' as const }]
    const after = [{ metric: 'строк в самом большом файле', value: 210, direction: 'меньше лучше' as const }]
    expect(compareBudgets(before, after)).toEqual([])
  })

  it('на малых числах одиночное движение катастрофой не считается', () => {
    const before = [{ metric: 'файлов с тестами', value: 2, direction: 'больше лучше' as const }]
    const after = [{ metric: 'файлов с тестами', value: 1, direction: 'больше лучше' as const }]
    expect(compareBudgets(before, after)).toEqual([]) // абсолютная разница меньше двух
  })

  it('без опорной точки молчим, а не гадаем', () => {
    expect(compareBudgets([], [{ metric: 'проверок в коде', value: 5, direction: 'больше лучше' }])).toEqual([])
  })
})

describe('восстановление «как было» из диффа', () => {
  it('удалённые проверки восстанавливаются точно', () => {
    const content = "it('живой', () => { expect(a).toBe(1) })\n"
    const files = [
      {
        rel: 'tests/a.test.ts',
        content,
        diff: diffOf(["  expect(b).toBe(2)", "  expect(c).toBe(3)"], []),
      },
    ]
    const before = measureBefore(files)
    const after = measure(files)
    const assertionsBefore = before.find((m) => m.metric === 'проверок в коде')!.value
    const assertionsAfter = after.find((m) => m.metric === 'проверок в коде')!.value
    expect(assertionsBefore).toBe(3)
    expect(assertionsAfter).toBe(1)
    expect(compareBudgets(before, after).some((b) => b.metric === 'проверок в коде')).toBe(true)
  })

  it('новый тестовый файл не выглядит как пропажа теста', () => {
    const content = "it('новый', () => { expect(x).toBe(1) })\nexpect(y).toBe(2)\n"
    const files = [{ rel: 'tests/new.test.ts', content, diff: diffOf([], content.split('\n')) }]
    const before = measureBefore(files)
    expect(before.find((m) => m.metric === 'файлов с тестами')!.value).toBe(0)
    expect(compareBudgets(before, measure(files))).toEqual([])
  })

  it('рост общего объёма кода не показывается — это цель работы, а не регресс', () => {
    const breaches = compareBudgets(
      [{ metric: 'строк всего в затронутых файлах', value: 100, direction: 'меньше лучше' }],
      [{ metric: 'строк всего в затронутых файлах', value: 400, direction: 'меньше лучше' }],
    )
    expect(breaches.length).toBe(1) // нарушение зафиксировано
    expect(renderBudgets(breaches)).toEqual([]) // но владельцу не показывается
  })
})

describe('формулировка', () => {
  it('называет опорную точку — иначе число выглядит взятым с потолка', () => {
    const lines = renderBudgets(
      compareBudgets(
        [{ metric: 'проверок в коде', value: 20, direction: 'больше лучше' }],
        [{ metric: 'проверок в коде', value: 10, direction: 'больше лучше' }],
      ),
    )
    expect(lines[0]).toContain('бюджет качества')
    expect(lines[0]).toContain('прошлое состояние этого же проекта')
  })
})
