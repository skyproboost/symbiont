/**
 * Петля закалки об отказы (рамка инкремент 2). Главное, что защищается:
 * отказ — НЕ успешный ответ (иначе «не могу помочь» уходит в парсер вместо
 * данных и проход тихо даёт ноль), и он же — измеримое событие.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { detectRefusal, recordRefusal, markRefusalsResolved, refusalStats, renderRefusals } from '../src/domains/refusal'
import { readFrame } from '../src/domains/frame'
import { rmrf } from './_helpers'

describe('detectRefusal', () => {
  it('явный признак платформы важнее текста', () => {
    expect(detectRefusal({ stop_reason: 'refusal' }, 'любой текст').refused).toBe(true)
  })

  it('короткий ответ с маркером — отказ (RU и EN)', () => {
    expect(detectRefusal({}, "I can't help with that request.").refused).toBe(true)
    expect(detectRefusal({}, 'Извини, я не могу помочь с этим.').refused).toBe(true)
    expect(detectRefusal({}, 'Я не буду это делать.').refused).toBe(true)
  })

  it('нормальный ответ отказом не считается', () => {
    expect(detectRefusal({}, '[{"area":"стиль","statement":"кавычки — одинарные"}]').refused).toBe(false)
  })

  it('пустой ответ — сбой доставки, а не отказ (лечится ретраем, не рамкой)', () => {
    const v = detectRefusal({}, '   ')
    expect(v.refused).toBe(false)
    expect(v.reason).toContain('сбой доставки')
  })

  it('длинный текст с фразой внутри — рассуждение об отказах, не отказ (анти-шум)', () => {
    const long = `Разбор: модель иногда отвечает «I can't help with that», и это ложный отказ. ${'Далее подробности. '.repeat(40)}`
    expect(long.length).toBeGreaterThan(600)
    expect(detectRefusal({}, long).refused).toBe(false)
  })
})

describe('журнал закалки', () => {
  it('копит события и считает, что рамка реально снимает', () => {
    const db = openDb(':memory:')
    recordRefusal(db, { model: 'sonnet', purpose: 'вербализация', framed: false, resolved: false, reason: 'маркер' })
    markRefusalsResolved(db, 1) // следующая модель ответила
    recordRefusal(db, { model: 'haiku', purpose: 'роли узлов', framed: true, resolved: false, reason: 'stop_reason=refusal' })

    const s = refusalStats(db)
    expect(s.total).toBe(2)
    expect(s.resolvedByFrame).toBe(1)
    expect(s.refusedWithFrame).toBe(1) // отказ ДАЖЕ с рамкой — фактов не хватает
    db.close()
  })

  it('без отказов — молчание, а не нули в отчёте', () => {
    const db = openDb(':memory:')
    expect(renderRefusals(refusalStats(db))).toBe('')
    db.close()
  })

  it('отказ, не снятый даже рамкой, помечается предупреждением', () => {
    const db = openDb(':memory:')
    recordRefusal(db, { model: 'opus', purpose: 'аудит', framed: true, resolved: false, reason: 'stop_reason=refusal' })
    const s = renderRefusals(refusalStats(db))
    expect(s).toContain('не снято даже с рамкой')
    expect(s).toContain('фактов легитимности не хватает')
    db.close()
  })
})

describe('readFrame', () => {
  it('несенситивный проект — пустая рамка и нулевая цена', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-frame-'))
    expect(readFrame(dir)).toBe('')
    rmrf(dir)
  })

  it('готовая рамка читается для подмешивания в свои вызовы', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-frame-'))
    writeFileSync(join(dir, 'frame.md'), 'Статья носит ознакомительный характер и не заменяет консультацию врача.\n')
    expect(readFrame(dir)).toContain('не заменяет консультацию врача')
    rmrf(dir)
  })
})
