import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs'

const readFileSyncUtf8 = (p: string) => readFileSync(p, 'utf8')
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPassport, renderSummary } from '../src/passport/build'
import { profileFacts } from '../src/passport/profile'
import type { Fact } from '../src/miner/facts'

const LEGACY = `
function processOrder(_oOrder, _aItems) {
    var sName = _oOrder.name;
    var aResult = [];
    var nTotal = 0;
    for (var i = 0; i < _aItems.length; i++) {
        var oItem = _aItems[i];
        nTotal = nTotal + oItem.price;
        aResult.push(oItem);
    }
    return aResult;
}
`

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'symbiont-passport-proj-'))
  for (let i = 0; i < 6; i++) writeFileSync(join(dir, `m${i}.js`), LEGACY.repeat(6))
  return dir
}

describe('renderSummary', () => {
  it('факты, не императивы; ярусы по секциям', () => {
    const facts: Fact[] = [
      { area: 'объявления', statement: 'переменные — только var', positive: 100, total: 100, prevalence: 1, tier: 'закон' },
      { area: 'именование', statement: 'венгерская нотация — префиксы типа: s* (44)', positive: 87, total: 100, prevalence: 0.87, tier: 'привычка' },
      { area: 'итерации', statement: 'filter/map/reduce — используются свободно', positive: 50, total: 100, prevalence: 0.5, tier: 'нет консенсуса' },
    ]
    const md = renderSummary('demo', facts)
    // Пустой класс контрпримеров называется отсутствием, а не соблюдением:
    // «100 из 100 (100%)» стояло бы в строке неотличимо от «87 из 100»
    expect(md).toContain('переменные — только var — ни одного случая обратного на 100 наблюдений')
    expect(md).toContain('Законы стиля')
    expect(md).toContain('возможны легитимные исключения')
    expect(md).toContain('Смешанный стиль')
    expect(md).not.toMatch(/всегда используй|обязан|запрещено/i)
  })

  it('измеренное и выведенное по образцам НЕ выглядят одинаково', () => {
    // Живой случай: правило, подтверждённое тремя файлами из пяти показанных,
    // читалось как измеренная привычка проекта — а таких файлов было 3 из 74
    const facts: Array<Fact & { source?: string }> = [
      { area: 'объявления', statement: 'переменные — только var', positive: 5339, total: 5344, prevalence: 0.999, tier: 'привычка', source: 'miner:layer0' },
      { area: 'структура файла', statement: 'шапка файла — блок ссылок', positive: 3, total: 5, prevalence: 0.9, tier: 'привычка', source: 'llm:material:.less' },
    ]
    const md = renderSummary('demo', facts)
    expect(md).toContain('переменные — только var — 5339 из 5344')
    expect(md).toContain('шапка файла — блок ссылок — выведено по 5 образцам')
    expect(md).toContain('не измерено')
    // и заголовок сводки не обещает, что все числа — измерения
    expect(md).not.toContain('Числа — реальная распространённость')
  })
})

describe('buildPassport: полный конвейер', () => {
  const proj = makeProject()
  const data = mkdtempSync(join(tmpdir(), 'symbiont-passport-data-'))

  it('первый прогон: факты пересчитаны, сводка собрана, журнал наполнен', () => {
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(true)
    expect(r.summaryRebuilt).toBe(true)
    expect(r.journal.born).toBeGreaterThan(3)
    expect(r.facts.some((f) => f.statement.includes('только var'))).toBe(true)
  })

  it('повторный прогон без изменений: red-green, ничего не выполняется', () => {
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(false)
    expect(r.summaryRebuilt).toBe(false)
    expect(r.journal.born).toBe(0)
    expect(r.journal.superseded).toBe(0)
  })

  it('touch без изменения содержимого: кэш перехэширует, но red-green держит', () => {
    // меняем mtime, содержимое то же → hash тот же → ревизия не двигается
    const p = join(proj, 'm1.js')
    const content = readFileSyncUtf8(p)
    writeFileSync(p, content)
    const { utimesSync } = require('node:fs')
    utimesSync(p, new Date(), new Date(Date.now() + 5000))
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(false)
    expect(r.summaryRebuilt).toBe(false)
  })

  it('правка комментария: факты пересчитались, сводка — early cutoff', () => {
    // Первый содержательный пересчёт — подтверждение может мигрировать ярусы
    // (рост уверенности) и легитимно пересобрать сводку
    appendFileSync(join(proj, 'm0.js'), '\n// комментарий не меняет конвенций\n')
    buildPassport(proj, data)
    // Второй: ярусы устоялись — чистый early cutoff
    appendFileSync(join(proj, 'm0.js'), '\n// ещё комментарий\n')
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(true)
    expect(r.summaryRebuilt).toBe(false) // факты и ярусы те же — проекция не тронута
  })

  it('смена стиля: вытеснение в журнале и новая сводка', () => {
    // «рефакторинг»: проект переходит на const/стрелочные
    for (let i = 0; i < 6; i++) {
      writeFileSync(
        join(proj, `m${i}.js`),
        'const handle = (order) => {\n  const items = order.items.map((x) => x.id)\n  let total = 0\n  return items\n}\n'.repeat(
          12,
        ),
      )
    }
    const r = buildPassport(proj, data)
    expect(r.factsExecuted).toBe(true)
    expect(r.summaryRebuilt).toBe(true)
    expect(r.journal.superseded).toBeGreaterThan(0) // «только var» вытеснен
    expect(r.facts.some((f) => f.statement.includes('const/let'))).toBe(true)
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(data, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})

describe('профиль качества: заявленное отличается от найденного', () => {
  it('ось, подтверждённая только доками, названа заявленной, а не действующей', () => {
    const facts = profileFacts([{ axis: 'SEO', evidence: ['заявлено в доках'] }])
    expect(facts[0].statement).toBe('SEO — заявлена в доках, в коде проекта не обнаружена')
    expect(facts[0].statement).not.toContain('ось качества здесь')
  })

  it('ось с кодовым основанием остаётся действующей осью', () => {
    const facts = profileFacts([{ axis: 'корректность', evidence: ['тестов: 74', 'CI', 'заявлено в доках'] }])
    expect(facts[0].statement).toContain('ось качества здесь')
    expect(facts[0].statement).toContain('тестов') // счётчик — в основании, не в формулировке
    expect(facts[0].statement).not.toContain('74')
  })
})
