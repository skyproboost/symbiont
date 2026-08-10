/**
 * Полезность подачи: система учится на себе. Проверяется главное — молодой вид
 * не хоронится, бесполезный затухает, заглушённый получает разведку, а польза
 * зачитывается зональным и доменным видам (иначе они выглядели бы бесполезными).
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { noteSurfaced, noteUsed, utilityOf, shouldFeed, rankKinds, renderUtility, UTILITY_HALF_LIFE_MS } from '../src/gardener/utility'
import { ensureFeedLog, claimNode, markUsed } from '../src/hooks/node-brief'
import { handlePostTool } from '../src/hooks/post-tool-core'
import { buildPassport } from '../src/passport/build'
import { slugOf } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

describe('оценка вида', () => {
  it('новый вид — «неизвестно» (0.5), а не «бесполезно»', () => {
    const db = openDb(':memory:')
    expect(utilityOf(db, 'lesson').score).toBe(0.5)
    expect(shouldFeed(db, 'lesson')).toBe(true)
    db.close()
  })

  it('сглаживание не хоронит вид по малой выборке', () => {
    const db = openDb(':memory:')
    for (let i = 0; i < 3; i++) noteSurfaced(db, 'lesson') // 3 подачи, 0 пользы
    expect(shouldFeed(db, 'lesson')).toBe(true) // выборка мала — судить рано
    expect(utilityOf(db, 'lesson').score).toBeGreaterThan(0.15)
    db.close()
  })

  it('устойчиво бесполезный вид затухает', () => {
    const db = openDb(':memory:')
    for (let i = 0; i < 30; i++) noteSurfaced(db, 'playbook')
    const u = utilityOf(db, 'playbook')
    expect(u.surfaced).toBe(30)
    expect(u.score).toBeLessThan(0.15)
    expect(shouldFeed(db, 'playbook')).toBe(false)
    db.close()
  })

  it('окупающийся вид продолжает подаваться', () => {
    const db = openDb(':memory:')
    for (let i = 0; i < 20; i++) noteSurfaced(db, 'graph')
    for (let i = 0; i < 8; i++) noteUsed(db, 'graph')
    expect(shouldFeed(db, 'graph')).toBe(true)
    expect(utilityOf(db, 'graph').score).toBeGreaterThan(0.15)
    db.close()
  })

  it('mute — не приговор навсегда: улики затухают, и вид возвращается к молодости', () => {
    // Поглощающее состояние — задокументированная болезнь рекомендательных
    // систем: заглушённое никогда не показывается, значит, никогда не
    // реабилитируется. Затухание счётчиков возвращает surfaced ниже
    // MIN_SAMPLE — «мнения нет, подаём» — без единой удачной разведки.
    const db = openDb(':memory:')
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    for (let i = 0; i < 30; i++) noteSurfaced(db, 'zone', t0) // 30 подач, 0 пользы
    expect(shouldFeed(db, 'zone', t0 + 1000)).toBe(false) // заглушён (первая попытка — не разведочная)
    // Два месяца без подач: 30 × 0.5² = 7.5 < MIN_SAMPLE → снова подаём всегда
    expect(shouldFeed(db, 'zone', t0 + 2 * UTILITY_HALF_LIFE_MS)).toBe(true)
    expect(utilityOf(db, 'zone').surfaced).toBeLessThan(12)
    db.close()
  })

  it('затухание не меняет долю пользы само по себе — только вес улик', () => {
    const db = openDb(':memory:')
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    for (let i = 0; i < 20; i++) noteSurfaced(db, 'graph', t0)
    for (let i = 0; i < 10; i++) noteUsed(db, 'graph', t0)
    const before = utilityOf(db, 'graph').score
    shouldFeed(db, 'graph', t0 + UTILITY_HALF_LIFE_MS) // сложить затухание
    const after = utilityOf(db, 'graph')
    // Оба счётчика умножены на один множитель: сглаженная доля лишь слегка
    // подтянулась к 0.5 (Лаплас на меньшей выборке), знак вердикта прежний
    expect(after.surfaced).toBeCloseTo(10, 1)
    expect(after.used).toBeCloseTo(5, 1)
    expect(Math.abs(after.score - before)).toBeLessThan(0.05)
    db.close()
  })

  it('в масштабе одной сессии счётчики остаются целыми (затухание не складывается)', () => {
    const db = openDb(':memory:')
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    noteSurfaced(db, 'lesson', t0)
    noteSurfaced(db, 'lesson', t0 + 60_000) // минута спустя — младше часа
    expect(utilityOf(db, 'lesson').surfaced).toBe(2)
    db.close()
  })

  it('заглушённый вид выходит на разведку каждую N-ю ПОПЫТКУ, а не подачу', () => {
    // Ключевой инвариант: у заглушённого вида surfaced замирает (подачи-то нет),
    // поэтому разведка обязана считаться по попыткам — иначе вид либо никогда
    // не глушится, либо глушится навсегда.
    const db = openDb(':memory:')
    for (let i = 0; i < 30; i++) noteSurfaced(db, 'zone')
    const decisions: boolean[] = []
    for (let i = 0; i < 20; i++) decisions.push(shouldFeed(db, 'zone'))
    expect(decisions.filter(Boolean).length).toBe(2) // ровно две разведки на 20 попыток
    expect(decisions[9]).toBe(true)
    expect(decisions[0]).toBe(false)
    db.close()
  })
})

describe('зачёт пользы по покрывающим ключам', () => {
  it('правка файла зачитывает пользу и узлу, и зоне, и плейбуку', () => {
    const db = openDb(':memory:')
    ensureFeedLog(db)
    claimNode(db, 's1', 'server/db/schema.ts', 'graph')
    claimNode(db, 's1', '#zone:server/db', 'zone')
    claimNode(db, 's1', '#lesson:server/db', 'lesson')
    claimNode(db, 's1', '#playbook:база данных', 'playbook')

    markUsed(db, 's1', 'server/db/schema.ts', ['#zone:server/db', '#lesson:server/db', '#playbook:база данных'])

    for (const kind of ['graph', 'zone', 'lesson', 'playbook']) {
      expect(utilityOf(db, kind).used).toBe(1)
    }
    db.close()
  })

  it('повторная правка того же файла не накручивает пользу дважды', () => {
    const db = openDb(':memory:')
    ensureFeedLog(db)
    claimNode(db, 's1', 'a.ts', 'graph')
    markUsed(db, 's1', 'a.ts')
    markUsed(db, 's1', 'a.ts')
    expect(utilityOf(db, 'graph').used).toBe(1)
    db.close()
  })

  it('неподанный файл пользу не зачитывает — метрика не искажается', () => {
    const db = openDb(':memory:')
    ensureFeedLog(db)
    markUsed(db, 's1', 'никогда-не-подавался.ts')
    expect(utilityOf(db, 'graph').used).toBe(0)
    expect(utilityOf(db, 'graph').surfaced).toBe(0)
    db.close()
  })
})

describe('наблюдаемость', () => {
  it('ранжирует по окупаемости и рендерит человекочитаемо', () => {
    const db = openDb(':memory:')
    for (let i = 0; i < 10; i++) noteSurfaced(db, 'graph')
    for (let i = 0; i < 7; i++) noteUsed(db, 'graph')
    for (let i = 0; i < 10; i++) noteSurfaced(db, 'playbook')
    const ranked = rankKinds(db)
    expect(ranked[0].kind).toBe('graph')
    const s = renderUtility(ranked)
    expect(s).toContain('окупаемость подачи')
    expect(s).toContain('graph')
    expect(renderUtility([])).toBe('')
    db.close()
  })
})

describe('симуляция: подача учится на живом проекте', () => {
  it('касание файла зоны копит статистику вида, правка зачитывает пользу', () => {
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-util-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'symbiont-util-data-'))
    mkdirSync(join(proj, 'app', 'legacy'), { recursive: true })
    for (let i = 0; i < 3; i++) writeFileSync(join(proj, 'app', 'legacy', `old${i}.js`), 'var a = 1\nvar b = 2\n')
    writeFileSync(join(proj, 'README.md'), 'Сервис.\n')
    const dataDir = join(data, slugOf(proj))
    buildPassport(proj, dataDir)

    // Чтение файла зоны — каскад подаётся (вид zone учтён как поданный)
    handlePostTool({ cwd: proj, session_id: 'u1', tool_name: 'Read', tool_input: { file_path: join(proj, 'app', 'legacy', 'old0.js') } }, data)
    const db = openDb(join(dataDir, 'passport.db'))
    expect(utilityOf(db, 'zone').surfaced).toBeGreaterThan(0)
    expect(utilityOf(db, 'zone').used).toBe(0)
    db.close()

    // Правка файла той же зоны — подача окупилась
    handlePostTool({ cwd: proj, session_id: 'u1', tool_name: 'Write', tool_input: { file_path: join(proj, 'app', 'legacy', 'old0.js') } }, data)
    const db2 = openDb(join(dataDir, 'passport.db'), { readonly: true })
    expect(utilityOf(db2, 'zone').used).toBe(1)
    db2.close()

    rmrf(proj)
    rmrf(data)
  })
})
