import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { coveredCapabilities, buildCharterPrompt, parseCharter, runCharter, verdictsToPairs, renderCharter } from '../src/elevate/charter'
import { FactStore } from '../src/core/store'
import { slugOf } from '../src/hooks/session-start-core'
import type { Fact } from '../src/miner/facts'

function world() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-charter-proj-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-charter-data-'))
  const dataDir = join(dataRoot, slugOf(proj))
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ dependencies: { nuxt: '3', 'drizzle-orm': '1' } }))
  mkdirSync(join(proj, 'server', 'db'), { recursive: true })
  writeFileSync(join(proj, 'server', 'db', 'schema.ts'), 'x')
  const db = openDb(join(dataDir, 'passport.db'))
  const pf: Fact = { area: 'профиль качества', statement: 'SEO — ось качества здесь', positive: 2, total: 2, prevalence: 1, tier: 'привычка' }
  new FactStore(db).assertAll([pf], 'miner:profile')
  db.close()
  return { proj, dataDir }
}

describe('coveredCapabilities', () => {
  it('включает оси рубрики, плейбуки активного стека, факты профиля', () => {
    const { proj, dataDir } = world()
    const caps = coveredCapabilities(proj, dataDir).join(' | ')
    expect(caps).toContain('ось «безопасность»')
    expect(caps).toContain('ось «производительность»')
    expect(caps).toContain('плейбук «база данных»') // drizzle + db/schema
    expect(caps).toContain('плейбук «фронтенд»') // nuxt
    expect(caps).toContain('SEO — ось качества здесь') // факт профиля
    rmrf(proj)
    rmrf(dataDir)
  })
})

describe('buildCharterPrompt', () => {
  it('содержит покрытое, требования и три статуса', () => {
    const p = buildCharterPrompt('хочу чтобы всё было быстро', ['ось «производительность»: цена на горячем пути'])
    expect(p).toContain('хочу чтобы всё было быстро')
    expect(p).toContain('уже-покрыто')
    expect(p).toContain('уникальное')
    expect(p).toContain('уточнение')
    expect(p).toContain('производительность')
  })
})

describe('parseCharter', () => {
  it('разбирает вердикты, отсеивает мусор', () => {
    const text = JSON.stringify([
      { requirement: 'всё быстро', status: 'уже-покрыто', coveredBy: 'ось производительность' },
      { requirement: 'приватность важнее скорости', status: 'уточнение', asWill: 'цель — приватность превыше · ограничение — скоростью жертвуем при конфликте' },
      { requirement: 'кривой', status: 'выдумка' }, // невалидный статус
    ])
    const v = parseCharter(text)
    expect(v.length).toBe(2)
    expect(v[0].status).toBe('уже-покрыто')
    expect(v[1].status).toBe('уточнение')
  })
  it('мусор → пустой список', () => {
    expect(parseCharter('бла')).toEqual([])
    expect(parseCharter('{}')).toEqual([])
  })
})

describe('verdictsToPairs', () => {
  it('уже-покрыто отбрасывается; уникальное/уточнение → пары воли', () => {
    const pairs = verdictsToPairs([
      { requirement: 'быстро', status: 'уже-покрыто', coveredBy: 'x' },
      { requirement: 'приватность', status: 'уточнение', asWill: 'цель — приватность превыше всего · ограничение — при конфликте жертвуем скоростью' },
      { requirement: 'не трогать оплаты', status: 'уникальное', asWill: 'цель — стабильность оплат · ограничение — прод-оплаты не менять без явного OK' },
    ])
    expect(pairs.length).toBe(2)
    expect(pairs[0].goal).toContain('приватность превыше')
    expect(pairs[0].constraint).toContain('жертвуем скоростью')
    expect(pairs[1].constraint).toContain('не менять без явного OK')
  })
})

describe('runCharter + renderCharter (стаб)', () => {
  it('полный путь: покрытое отсекается, уникальное фиксируется', () => {
    const { proj, dataDir } = world()
    const stub = () => ({
      model: 'stub',
      text: JSON.stringify([
        { requirement: 'сайт должен быстро грузиться', status: 'уже-покрыто', coveredBy: 'ось производительность (Core Web Vitals)' },
        { requirement: 'база не должна терять данные при сбое', status: 'уже-покрыто', coveredBy: 'плейбук база данных (PITR/бэкапы)' },
        { requirement: 'веду в топ-1 именно по качеству медразборов', status: 'уникальное', asWill: 'цель — топ-1 по качеству медицинских разборов · ограничение — не жертвовать точностью ради охвата' },
      ]),
    })
    const r = runCharter(proj, dataDir, 'быстро; не терять данные; топ-1 по разборам', stub)
    const report = renderCharter(r)
    expect(report).toContain('Уже под капотом')
    expect(report).toContain('ось производительность')
    expect(report).toContain('Уникальная воля')
    expect(report).toContain('медицинских разборов')
    const pairs = verdictsToPairs(r.verdicts)
    expect(pairs.length).toBe(1) // только уникальное
    rmrf(proj)
    rmrf(dataDir)
  })

  it('пустые требования → ничего', () => {
    const { proj, dataDir } = world()
    const r = runCharter(proj, dataDir, '  ', () => ({ model: 'x', text: '[]' }))
    expect(r.model).toBe(null)
    rmrf(proj)
    rmrf(dataDir)
  })
})
