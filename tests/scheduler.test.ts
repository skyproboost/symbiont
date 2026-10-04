/**
 * Садовник-планировщик: работа без сырья не бежит, кулдаун держит, дешёвое
 * идёт вперёд дорогого, падение одной работы не рушит очередь, бюджет режет
 * только LLM-работы. Заменил собой команды — потому проверяется строго.
 */
import { describe, expect, it } from 'bun:test'
import { openDb, type Database } from '../src/core/db'
import { runWorks, cooldownPassed, recordRun, lastRun, renderBackground, renderGardenerSilence, renderSkipped, MAX_FAST_RETRIES, type Work, type WorkContext } from '../src/gardener/scheduler'

const ctxOf = (db: Database, nowMs = Date.parse('2026-07-30T12:00:00.000Z'), full = false): WorkContext => ({
  db,
  projectRoot: 'D:/proj',
  dataDir: 'D:/data',
  nowMs,
  full,
})

const work = (id: string, over: Partial<Work> = {}): Work => ({
  id,
  title: id,
  cost: 'cheap',
  cooldownH: 0,
  due: () => true,
  run: () => `сделано ${id}`,
  ...over,
})

describe('порядок и триггеры', () => {
  it('дешёвые работы идут раньше дорогих (фундамент до LLM)', async () => {
    const db = openDb(':memory:')
    const order: string[] = []
    const works = [
      work('llm-1', { cost: 'llm', run: () => { order.push('llm-1'); return 'ok' } }),
      work('cheap-1', { run: () => { order.push('cheap-1'); return 'ok' } }),
      work('llm-2', { cost: 'llm', run: () => { order.push('llm-2'); return 'ok' } }),
      work('cheap-2', { run: () => { order.push('cheap-2'); return 'ok' } }),
    ]
    await runWorks(works, ctxOf(db))
    expect(order.slice(0, 2).sort()).toEqual(['cheap-1', 'cheap-2'])
    expect(order.slice(2).sort()).toEqual(['llm-1', 'llm-2'])
    db.close()
  })

  it('работа без сырья не бежит', async () => {
    const db = openDb(':memory:')
    let ran = false
    const r = await runWorks([work('idle', { due: () => false, run: () => { ran = true; return 'x' } })], ctxOf(db))
    expect(ran).toBe(false)
    expect(r.skipped).toEqual([{ id: 'idle', reason: 'idle' }])
    expect(r.outcomes).toEqual([])
    db.close()
  })

  it('«нечего делать» (null) не считается прогоном и не пишет мету', async () => {
    const db = openDb(':memory:')
    const r = await runWorks([work('quiet', { run: () => null })], ctxOf(db))
    expect(r.outcomes).toEqual([])
    expect(r.skipped).toEqual([{ id: 'quiet', reason: 'empty' }])
    expect(lastRun(db, 'quiet')).toBeNull()
    db.close()
  })

  it('кулдаун и отсутствие сырья — разные причины пропуска', async () => {
    const db = openDb(':memory:')
    recordRun(db, 'recent', true, 'ok', '2026-07-30T11:00:00.000Z')
    const r = await runWorks([work('recent', { cooldownH: 24 }), work('idle', { due: () => false })], ctxOf(db))
    expect(r.skipped).toContainEqual({ id: 'recent', reason: 'cooldown' })
    expect(r.skipped).toContainEqual({ id: 'idle', reason: 'idle' })
    db.close()
  })
})

describe('полный пересчёт (init re)', () => {
  it('снимает кулдаун: недавно отработавшая работа бежит снова', async () => {
    const db = openDb(':memory:')
    recordRun(db, 'recent', true, 'ok', '2026-07-30T11:00:00.000Z')
    let ran = false
    const w = work('recent', { cooldownH: 24, run: () => { ran = true; return 'заново' } })
    const r = await runWorks([w], ctxOf(db, undefined, true))
    expect(ran).toBe(true)
    expect(r.outcomes.map((o) => o.id)).toEqual(['recent'])
    expect(r.skipped).toEqual([])
    db.close()
  })

  it('не снимает требование сырья: работа без материала не зовётся и при пересчёте', async () => {
    const db = openDb(':memory:')
    let ran = false
    const r = await runWorks([work('idle', { due: () => false, run: () => { ran = true; return 'x' } })], ctxOf(db, undefined, true))
    expect(ran).toBe(false)
    expect(r.skipped).toEqual([{ id: 'idle', reason: 'idle' }])
    db.close()
  })

  it('флаг доходит до due: работа может отличить «уже сделано» от «сырья нет»', async () => {
    const db = openDb(':memory:')
    const seen: boolean[] = []
    const w = work('exhausted', { due: (ctx) => { seen.push(ctx.full); return ctx.full } })
    expect((await runWorks([w], ctxOf(db))).skipped).toEqual([{ id: 'exhausted', reason: 'idle' }])
    expect((await runWorks([w], ctxOf(db, undefined, true))).outcomes.map((o) => o.id)).toEqual(['exhausted'])
    expect(seen).toEqual([false, true])
    db.close()
  })
})

describe('renderSkipped — отчёт init о том, что не бежало', () => {
  const never = (): boolean => false

  it('каждая пропущенная работа названа по имени, ни одна не теряется', () => {
    const lines = renderSkipped(
      [
        { id: 'repair', reason: 'idle' },
        { id: 'truth', reason: 'empty' },
        { id: 'drift', reason: 'cooldown' },
        { id: 'grounding', reason: 'budget' },
      ],
      never,
    )
    const text = lines.join('\n')
    for (const id of ['repair', 'truth', 'drift', 'grounding']) expect(text).toContain(id)
    expect(lines.length).toBe(3)
  })

  it('работа без сырья не выдаётся за «уже сделанную»', () => {
    const lines = renderSkipped([{ id: 'contract', reason: 'idle' }], never)
    expect(lines).toEqual([expect.stringContaining('без материала')])
    expect(lines[0]).not.toContain('уже сделаны')
    expect(lines[0]).toContain('contract')
  })

  it('кулдаун и исчерпанное прошлым проходом сырьё — «уже сделано, re форсирует»', () => {
    const lines = renderSkipped(
      [
        { id: 'drift', reason: 'cooldown' },
        { id: 'verbalize', reason: 'idle' },
      ],
      (id) => id === 'verbalize',
    )
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('уже сделаны ранее')
    expect(lines[0]).toContain('/symbiont:init re')
    expect(lines[0]).toContain('drift, verbalize')
  })

  it('не уместившееся в бюджет названо отдельно', () => {
    expect(renderSkipped([{ id: 'grounding', reason: 'budget' }], never)).toEqual([expect.stringContaining('бюджет')])
  })

  it('пропусков нет — строк нет', () => {
    expect(renderSkipped([], never)).toEqual([])
  })
})

describe('кулдаун', () => {
  it('успешная работа молчит положенные часы, провалившаяся повторяется вчетверо раньше', () => {
    const db = openDb(':memory:')
    const w = work('w', { cooldownH: 24 })
    const t0 = Date.parse('2026-07-30T12:00:00.000Z')
    expect(cooldownPassed(db, w, t0)).toBe(true) // ни разу не бегала

    recordRun(db, 'w', true, 'ok', '2026-07-30T12:00:00.000Z')
    expect(cooldownPassed(db, w, t0 + 3_600_000 * 12)).toBe(false)
    expect(cooldownPassed(db, w, t0 + 3_600_000 * 25)).toBe(true)

    recordRun(db, 'w', false, 'сбой', '2026-07-30T12:00:00.000Z')
    expect(cooldownPassed(db, w, t0 + 3_600_000 * 7)).toBe(true) // 24/4 = 6ч
    db.close()
  })

  it('работа с нулевым кулдауном бежит всегда', () => {
    const db = openDb(':memory:')
    recordRun(db, 'always', true, 'ok', '2026-07-30T12:00:00.000Z')
    expect(cooldownPassed(db, work('always'), Date.parse('2026-07-30T12:00:01.000Z'))).toBe(true)
    db.close()
  })
})

describe('повторы после провала: временный сбой не отправляет работу в тишину', () => {
  const T0 = '2026-07-30T12:00:00.000Z'
  const t0 = Date.parse(T0)

  it('первый провал назначает повтор через минуты, а не через часы кулдауна', () => {
    const db = openDb(':memory:')
    const w = work('verbalize', { cooldownH: 72 })
    recordRun(db, 'verbalize', false, 'модели недоступны: fable — лимит исчерпан', T0)

    expect(lastRun(db, 'verbalize')?.attempts).toBe(1)
    expect(cooldownPassed(db, w, t0 + 60_000)).toBe(false) // минута — рано
    expect(cooldownPassed(db, w, t0 + 6 * 60_000)).toBe(true) // шесть — пора
    db.close()
  })

  it('лестница растёт: минуты → полчаса → два часа', () => {
    const db = openDb(':memory:')
    const w = work('verbalize', { cooldownH: 72 })
    const delays: number[] = []
    for (let i = 0; i < MAX_FAST_RETRIES; i++) {
      recordRun(db, 'verbalize', false, 'сбой', T0)
      const next = Date.parse(lastRun(db, 'verbalize')?.nextAt ?? '')
      delays.push(Math.round((next - t0) / 60_000))
    }
    expect(delays).toEqual([5, 30, 120])
    expect(cooldownPassed(db, w, t0 + 60 * 60_000)).toBe(false) // час < двух
    db.close()
  })

  it('быстрые повторы кончаются — работа возвращается к обычному расписанию, а не сдаётся', () => {
    const db = openDb(':memory:')
    const w = work('verbalize', { cooldownH: 72 })
    for (let i = 0; i <= MAX_FAST_RETRIES; i++) recordRun(db, 'verbalize', false, 'сбой', T0)

    expect(lastRun(db, 'verbalize')?.nextAt).toBeNull()
    expect(cooldownPassed(db, w, t0 + 3_600_000 * 10)).toBe(false) // 72/4 = 18ч
    expect(cooldownPassed(db, w, t0 + 3_600_000 * 19)).toBe(true) // расписание живо
    db.close()
  })

  it('успех гасит лестницу — следующий сбой начинает с первой ступени', () => {
    const db = openDb(':memory:')
    recordRun(db, 'verbalize', false, 'сбой', T0)
    recordRun(db, 'verbalize', false, 'сбой', T0)
    recordRun(db, 'verbalize', true, 'правил +7', T0)

    expect(lastRun(db, 'verbalize')?.attempts).toBe(0)
    expect(lastRun(db, 'verbalize')?.nextAt).toBeNull()

    recordRun(db, 'verbalize', false, 'сбой', T0)
    expect(Math.round((Date.parse(lastRun(db, 'verbalize')?.nextAt ?? '') - t0) / 60_000)).toBe(5)
    db.close()
  })

  it('владелец видит судьбу провала, а не только его факт', () => {
    const db = openDb(':memory:')
    recordRun(db, 'verbalize', false, 'модели недоступны: fable — лимит исчерпан', T0)
    const line = renderBackground(db, ['verbalize'], t0 + 60_000)
    expect(line).toContain('лимит исчерпан')
    expect(line).toContain('повтор назначен')
    expect(line).toContain('попытка 2 из 4')
    db.close()
  })

  it('старая база без колонок повторов читается и мигрируется на месте', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE gardener_meta(work TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)')
    db.run("INSERT INTO gardener_meta(work, at, ok, note) VALUES('drift', ?, 1, 'старая запись')", T0)

    const last = lastRun(db, 'drift')
    expect(last?.note).toBe('старая запись')
    expect(last?.attempts).toBe(0)
    expect(last?.nextAt).toBeNull()
    db.close()
  })
})

describe('живучесть', () => {
  it('падение одной работы не отменяет остальные и записывается честно', async () => {
    const db = openDb(':memory:')
    const r = await runWorks(
      [
        work('boom', { run: () => { throw new Error('внутренний сбой') } }),
        work('after', { run: () => 'дошло до второй' }),
      ],
      ctxOf(db),
    )
    expect(r.outcomes.length).toBe(2)
    expect(r.outcomes.find((o) => o.id === 'boom')!.ok).toBe(false)
    expect(r.outcomes.find((o) => o.id === 'after')!.ok).toBe(true)
    expect(lastRun(db, 'boom')!.ok).toBe(false)
    db.close()
  })

  it('работа, упавшая на оценке сырья, просто пропускается', async () => {
    const db = openDb(':memory:')
    const r = await runWorks([work('bad-due', { due: () => { throw new Error('нет таблицы') } })], ctxOf(db))
    expect(r.outcomes).toEqual([])
    expect(r.skipped).toEqual([{ id: 'bad-due', reason: 'idle' }])
    db.close()
  })

  it('async-работа поддерживается (слой 1 на WASM)', async () => {
    const db = openDb(':memory:')
    const r = await runWorks([work('async', { run: async () => 'из промиса' })], ctxOf(db))
    expect(r.outcomes[0].note).toBe('из промиса')
    db.close()
  })
})

describe('бюджет', () => {
  it('режет только дорогие работы — дешёвые обязаны отработать всегда', async () => {
    const db = openDb(':memory:')
    const done: string[] = []
    const works = [
      work('cheap', { run: () => { done.push('cheap'); return 'ok' } }),
      work('expensive', { cost: 'llm', run: () => { done.push('expensive'); return 'ok' } }),
    ]
    const r = await runWorks(works, ctxOf(db), 0) // нулевой бюджет на дорогое
    expect(done).toEqual(['cheap'])
    expect(r.skipped).toEqual([{ id: 'expensive', reason: 'budget' }])
    db.close()
  })
})

describe('renderBackground', () => {
  it('собирает заметки свежих работ, проваленную помечает', () => {
    const db = openDb(':memory:')
    const now = Date.parse('2026-07-30T12:00:00.000Z')
    recordRun(db, 'truth', true, 'карта почищена: 3 мёртвых записей', '2026-07-30T11:00:00.000Z')
    recordRun(db, 'verbalize', false, 'модели недоступны', '2026-07-30T10:00:00.000Z')
    const s = renderBackground(db, ['truth', 'verbalize'], now)
    expect(s).toContain('фоновая работа')
    expect(s).toContain('карта почищена')
    expect(s).toContain('⚠ модели недоступны')
    db.close()
  })

  it('старое (>72ч) не шумит, пустой фон — пустая строка', () => {
    const db = openDb(':memory:')
    const now = Date.parse('2026-07-30T12:00:00.000Z')
    recordRun(db, 'drift', true, 'hotspot: a.ts', '2026-07-20T12:00:00.000Z')
    expect(renderBackground(db, ['drift'], now)).toBe('')
    expect(renderBackground(db, ['никогда-не-бегала'], now)).toBe('')
    db.close()
  })
})

describe('молчание фона — тоже событие', () => {
  const T0 = Date.parse('2026-07-30T12:00:00.000Z')

  it('молодой проект не получает ложной тревоги: фон просто не успел', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    db.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 2 * 86_400_000).toISOString())
    expect(renderGardenerSilence(db, T0)).toBe('')
    db.close()
  })

  /** Журнал сессий: у фона была возможность, только если после его работы открывали проект. */
  const sessionsAt = (db: Database, ...daysAgo: number[]): void => {
    db.run('CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL)')
    for (const d of daysAgo) db.run('INSERT INTO sessions(session_id, started_at) VALUES(?,?)', `s-${d}`, new Date(T0 - d * 86_400_000).toISOString())
  }

  it('зрелый проект без единого следа работы — тревога названа вслух', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    db.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 30 * 86_400_000).toISOString())
    sessionsAt(db, 30, 5)
    const line = renderGardenerSilence(db, T0)
    expect(line).toContain('ни разу не отрабатывало')
    expect(line).toContain('learn.json')
    db.close()
  })

  it('фон замолчал надолго при живых сессиях — сказано, сколько дней', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    db.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 30 * 86_400_000).toISOString())
    recordRun(db, 'drift', true, 'ок', new Date(T0 - 12 * 86_400_000).toISOString())
    sessionsAt(db, 13, 4) // после последней работы фона проект открывали — возможность была
    expect(renderGardenerSilence(db, T0)).toContain('молчит 12д')
    db.close()
  })

  it('проект просто не открывали — это не отказ фона: демонов нет, будить его было некому', () => {
    // Наблюдалось вживую: владелец вернулся через 24 дня, сводка сказала «молчит
    // 24д: проверьте рантайм», а через три минуты тот же фон отработал
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    db.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 60 * 86_400_000).toISOString())
    recordRun(db, 'drift', true, 'ок', new Date(T0 - 24 * 86_400_000).toISOString())
    sessionsAt(db, 24.1) // та сессия, внутри которой фон работал в последний раз
    db.run('INSERT INTO sessions(session_id, started_at) VALUES(?,?)', 'current', new Date(T0 - 60_000).toISOString()) // текущая, только что открытая
    expect(renderGardenerSilence(db, T0)).toBe('')
    // журнала сессий нет вовсе — возможность не доказана, тревоги нет
    const bare = openDb(':memory:')
    bare.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    bare.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 60 * 86_400_000).toISOString())
    expect(renderGardenerSilence(bare, T0)).toBe('')
    db.close()
    bare.close()
  })

  it('работающий фон молчания не объявляет', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE fact_journal(asserted_at TEXT)')
    db.run("INSERT INTO fact_journal(asserted_at) VALUES(?)", new Date(T0 - 30 * 86_400_000).toISOString())
    recordRun(db, 'drift', true, 'ок', new Date(T0 - 3_600_000).toISOString())
    expect(renderGardenerSilence(db, T0)).toBe('')
    db.close()
  })
})

describe('миграция старых баз', () => {
  const T0 = Date.parse('2026-07-30T12:00:00.000Z')

  it('провал, записанный до появления лестницы, получает право на повтор сразу', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE gardener_meta(work TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)')
    db.run("INSERT INTO gardener_meta(work, at, ok, note) VALUES('verbalize', ?, 0, 'модели недоступны')", new Date(T0 - 3_600_000).toISOString())

    const w: Work = { id: 'verbalize', title: 'v', cost: 'llm', cooldownH: 72, due: () => true, run: () => null }
    // старое правило дало бы 18ч тишины; новое — пробуем при первом же входе
    expect(cooldownPassed(db, w, T0)).toBe(true)
    expect(lastRun(db, 'verbalize')?.attempts).toBe(1)
    db.close()
  })

  it('успешные старые записи миграция не трогает', () => {
    const db = openDb(':memory:')
    db.run('CREATE TABLE gardener_meta(work TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)')
    db.run("INSERT INTO gardener_meta(work, at, ok, note) VALUES('drift', ?, 1, 'ок')", new Date(T0 - 3_600_000).toISOString())

    const w: Work = { id: 'drift', title: 'd', cost: 'cheap', cooldownH: 24, due: () => true, run: () => null }
    expect(lastRun(db, 'drift')?.attempts).toBe(0)
    expect(lastRun(db, 'drift')?.nextAt).toBeNull()
    expect(cooldownPassed(db, w, T0)).toBe(false) // кулдаун 24ч ещё держит
    db.close()
  })
})
