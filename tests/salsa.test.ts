import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, sha1 } from '../src/core/salsa'

const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'symbiont-salsa-')), 'test.db')

describe('Salsa-lite', () => {
  it('кэширует: без смены входов запрос не выполняется повторно', () => {
    const e = new Engine(tmpDb())
    e.setInput('a', sha1('v1'))
    e.register('double', (ctx) => (ctx.input('a') ?? '') + '!')
    e.get('double')
    e.get('double')
    e.get('double')
    expect(e.executions('double')).toBe(1)
  })

  it('пересчитывает при смене входа; повторный set того же hash ревизию не двигает', () => {
    const e = new Engine(tmpDb())
    e.setInput('a', sha1('v1'))
    const rev1 = e.rev
    e.setInput('a', sha1('v1'))
    expect(e.rev).toBe(rev1)

    e.register('q', (ctx) => ctx.input('a'))
    e.get('q')
    e.setInput('a', sha1('v2'))
    e.get('q')
    expect(e.executions('q')).toBe(2)
  })

  it('red-green: чистая цепочка только штампуется (после рестарта движка)', () => {
    const db = tmpDb()
    let e = new Engine(db)
    e.setInput('a', sha1('v1'))
    e.register('q', (ctx) => ctx.input('a'))
    e.get('q')
    e.close()

    // новый процесс: memo в БД, счётчики в памяти обнулены
    e = new Engine(db)
    e.register('q', (ctx) => ctx.input('a'))
    e.setInput('a', sha1('v1')) // тот же hash — ревизия не двигается
    expect(e.get('q')).toBe(sha1('v1'))
    expect(e.executions('q')).toBe(0)
  })

  it('early cutoff: зависимость пересчиталась в то же значение — родитель не пересобирается', () => {
    const e = new Engine(tmpDb())
    e.setInput('file', sha1('содержимое v1'))
    // b зависит от file, но возвращает константу (аналог: комментарий не меняет факты)
    e.register('facts', (ctx) => {
      ctx.input('file')
      return { law: 'var-only' }
    })
    e.register('summary', (ctx) => `Сводка: ${(ctx.get('facts') as { law: string }).law}`)

    expect(e.get('summary')).toBe('Сводка: var-only')
    expect(e.executions('summary')).toBe(1)

    e.setInput('file', sha1('содержимое v2 — правка комментария'))
    e.get('summary')
    expect(e.executions('facts')).toBe(2) // факты пересчитались…
    expect(e.executions('summary')).toBe(1) // …но сводка НЕ пересобралась (cutoff)
  })

  it('изменение результата зависимости пересобирает родителя', () => {
    const e = new Engine(tmpDb())
    e.setInput('style', 'v1')
    e.register('facts', (ctx) => ({ law: ctx.input('style') === 'v1' ? 'var-only' : 'const-only' }))
    e.register('summary', (ctx) => `Сводка: ${(ctx.get('facts') as { law: string }).law}`)

    expect(e.get('summary')).toBe('Сводка: var-only')
    e.setInput('style', 'v2')
    expect(e.get('summary')).toBe('Сводка: const-only')
    expect(e.executions('summary')).toBe(2)
  })

  it('динамические зависимости: запрос зависит только от того, что реально читал', () => {
    const e = new Engine(tmpDb())
    e.setInput('used', 'u1')
    e.setInput('unused', 'x1')
    e.register('q', (ctx) => ctx.input('used'))
    e.get('q')
    e.setInput('unused', 'x2') // не зависимость q
    e.get('q')
    expect(e.executions('q')).toBe(1)
  })

  it('незарегистрированный запрос — понятная ошибка', () => {
    const e = new Engine(tmpDb())
    expect(() => e.get('нет-такого')).toThrow('не зарегистрирован')
  })

  it('invalidateIfCodeChanged: смена зависимостей запроса подхватывается после бампа версии', () => {
    const db = tmpDb()
    let e = new Engine(db)
    e.invalidateIfCodeChanged('code-v1')
    e.setInput('file', sha1('c1'))
    e.register('facts', (ctx) => {
      ctx.input('file')
      return 'law-x'
    })
    e.register('summary', (ctx) => `старая: ${ctx.get('facts')}`)
    expect(e.get('summary')).toBe('старая: law-x')
    e.close()

    // новый код: summary теперь зависит от journal, не от facts.
    // Без инвалидации осталась бы «чистой» по facts и не перезапустилась.
    e = new Engine(db)
    e.setInput('file', sha1('c1'))
    e.setInput('journal', 'j1')
    e.register('facts', (ctx) => {
      ctx.input('file')
      return 'law-x'
    })
    e.register('summary', (ctx) => `новая: ${ctx.input('journal')}`)
    expect(e.invalidateIfCodeChanged('code-v2')).toBe(true)
    expect(e.get('summary')).toBe('новая: j1')
    expect(e.executions('summary')).toBe(1)
    expect(e.invalidateIfCodeChanged('code-v2')).toBe(false)
    e.close()
  })
})
