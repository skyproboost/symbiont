import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FAMILY_PRIORITY,
  classify,
  resolveVector,
  recordOutcome,
  readAvailability,
  renderAvailability,
  networkDownUntil,
  markNetworkDown,
  clearNetworkDown,
  looksLikeNetworkFailure,
  type ModelAvail,
} from '../src/core/models'
import { resolveModels, explainNoAnswer, callClaudeDetailed } from '../src/layer2/llm'

const NOW = Date.parse('2026-07-30T12:00:00Z')
const iso = (msFromNow: number): string => new Date(NOW + msFromNow).toISOString()

describe('вектор моделей: приоритет по интенту (алиасы, не версии)', () => {
  it('deep — качество вперёд (сильнейшее первым), haiku последний рубеж', () => {
    expect(FAMILY_PRIORITY.deep[0]).toBe('fable')
    expect(FAMILY_PRIORITY.deep.at(-1)).toBe('haiku')
  })
  it('routine — цена вперёд (дешёвое первым)', () => {
    expect(FAMILY_PRIORITY.routine[0]).toBe('haiku')
  })
  it('интенты разведены — критичное и рутинное начинаются с разного', () => {
    expect(FAMILY_PRIORITY.deep[0]).not.toBe(FAMILY_PRIORITY.routine[0])
  })
  it('только алиасы, без пиннинга версий (нет claude-* и точек)', () => {
    for (const list of Object.values(FAMILY_PRIORITY)) {
      for (const alias of list) {
        expect(alias).not.toContain('claude-')
        expect(alias).not.toContain('.')
        expect(alias).not.toMatch(/\d/) // ни одной цифры версии
      }
    }
  })
})

describe('classify: исход пробы → статус доступности', () => {
  it('успех → alive + резолвнутый id', () => {
    const r = classify(undefined, { ok: true, resolvedId: 'claude-opus-5-1', apiErrorStatus: null, note: 'ok', now: iso(0) })
    expect(r.status).toBe('alive')
    expect(r.resolvedId).toBe('claude-opus-5-1')
  })
  it('404/403/401 → dead (нет доступа/подписки)', () => {
    for (const code of [404, 403, 401]) {
      const r = classify(undefined, { ok: false, resolvedId: null, apiErrorStatus: code, note: '', now: iso(0) })
      expect(r.status).toBe('dead')
    }
  })
  it('транзиент (500/сеть) НЕ рушит прошлый статус', () => {
    const alive: ModelAvail = { alias: 'opus', status: 'alive', resolvedId: 'claude-opus-5', checkedAt: iso(-1000), note: '' }
    const r = classify(alive, { ok: false, resolvedId: null, apiErrorStatus: 500, note: 'net', now: iso(0) })
    expect(r.status).toBe('alive') // сетевой сбой не «убивает» доступное семейство
    expect(r.note).toContain('транзиент')
  })
  it('транзиент без прошлого — остаётся unknown', () => {
    const r = classify(undefined, { ok: false, resolvedId: null, apiErrorStatus: null, note: 'net', now: iso(0) })
    expect(r.status).toBe('unknown')
  })
  it('429 — исчерпанный лимит, а не транзиент: отдельный статус со сроком', () => {
    // Живое наблюдение у владельца: fable отдавала api=429, статус оставался
    // «не пробована» — и каждый следующий глубокий проход снова начинал с неё
    const alive: ModelAvail = { alias: 'fable', status: 'alive', resolvedId: 'claude-fable-5', checkedAt: iso(-1000), note: '' }
    const r = classify(alive, { ok: false, resolvedId: null, apiErrorStatus: 429, note: 'api=429', now: iso(0) })
    expect(r.status).toBe('limited')
    expect(Date.parse(r.until ?? '')).toBeGreaterThan(NOW)
  })
  it('лимит, объявленный словами при пустом коде статуса, тоже опознан', () => {
    const r = classify(undefined, {
      ok: false,
      resolvedId: null,
      apiErrorStatus: null,
      note: 'subtype=error Claude AI usage limit reached',
      now: iso(0),
    })
    expect(r.status).toBe('limited')
  })
  it('срок берётся из подсказки CLI, когда она есть', () => {
    const r = classify(undefined, {
      ok: false,
      resolvedId: null,
      apiErrorStatus: 429,
      note: 'usage limit reached · resets at 11pm',
      now: iso(0),
    })
    expect(r.status).toBe('limited')
    expect(new Date(r.until ?? '').getHours()).toBe(23)
  })
  it('успех снимает лимит — состояние не залипает', () => {
    const limited: ModelAvail = { alias: 'fable', status: 'limited', resolvedId: null, checkedAt: iso(-1000), note: 'лимит', until: iso(60 * 60_000) }
    const r = classify(limited, { ok: true, resolvedId: 'claude-fable-5', apiErrorStatus: null, note: 'ok', now: iso(0) })
    expect(r.status).toBe('alive')
    expect(r.until).toBeNull()
  })
})

describe('explainNoAnswer: провал прохода объясняется, а не констатируется', () => {
  it('каждая попытка названа своей причиной', () => {
    const out = explainNoAnswer([
      { model: 'fable', ms: 900, ok: false, note: 'exit=1; api=429; stderr: ' },
      { model: 'opus', ms: 700, ok: false, note: 'exit=1; api=403; stderr: ' },
      { model: 'sonnet', ms: 120, ok: false, note: 'отказ (policy)' },
    ])
    expect(out).toContain('fable — лимит исчерпан')
    expect(out).toContain('opus — нет доступа')
    expect(out).toContain('sonnet — отказ модели')
  })

  it('лимит словами тоже опознаётся — код статуса не всегда есть', () => {
    const out = explainNoAnswer([{ model: 'fable', ms: 500, ok: false, note: 'subtype=error Claude AI usage limit reached' }])
    expect(out).toContain('лимит исчерпан')
  })

  it('отсутствие самого CLI названо прямо, а не «ошибкой»', () => {
    const out = explainNoAnswer([{ model: 'haiku', ms: 5, ok: false, note: 'Error: spawnSync claude ENOENT' }])
    expect(out).toContain('claude CLI не найден')
  })

  it('пустой список попыток — тоже внятная фраза, а не пустота', () => {
    expect(explainNoAnswer([])).toContain('ни одной попытки')
  })
})

describe('исчерпанный лимит: вектор и самолечение', () => {
  const limited = (untilMs: number): Record<string, ModelAvail> => ({
    fable: { alias: 'fable', status: 'limited', resolvedId: null, checkedAt: iso(-60_000), note: 'лимит', until: iso(untilMs) },
  })

  it('пока лимит держится — семейство уходит из головы вектора', () => {
    const vec = resolveVector('deep', limited(30 * 60_000), NOW)
    expect(vec[0]).not.toBe('fable')
    expect(vec).toContain('fable') // не выброшено: лимит пройдёт
  })

  it('срок вышел — семейство само возвращается на своё место', () => {
    const vec = resolveVector('deep', limited(-1000), NOW)
    expect(vec[0]).toBe('fable')
  })

  it('лимит пробуется раньше «нет доступа»: одно вернётся, другое — нет', () => {
    const avail: Record<string, ModelAvail> = {
      ...limited(30 * 60_000),
      opus: { alias: 'opus', status: 'dead', resolvedId: null, checkedAt: iso(-60_000), note: 'api=403' },
      sonnet: { alias: 'sonnet', status: 'dead', resolvedId: null, checkedAt: iso(-60_000), note: 'api=403' },
      haiku: { alias: 'haiku', status: 'dead', resolvedId: null, checkedAt: iso(-60_000), note: 'api=403' },
    }
    expect(resolveVector('deep', avail, NOW)[0]).toBe('fable')
  })

  it('владелец видит состояние словами и срок возврата, а не «не пробована»', () => {
    const out = renderAvailability(limited(45 * 60_000), NOW).join('\n')
    expect(out).toContain('лимит исчерпан')
    expect(out).toContain('вернётся к')
  })
})

describe('resolveVector: доступность переставляет, интент первичен', () => {
  it('пустой кэш → чистый порядок интента', () => {
    expect(resolveVector('deep', {}, NOW)).toEqual(FAMILY_PRIORITY.deep)
  })
  it('мёртвое семейство уходит в хвост (первая попытка не тратится впустую)', () => {
    const avail = { opus: { alias: 'opus', status: 'dead', resolvedId: null, checkedAt: iso(0), note: '404' } as ModelAvail }
    const vec = resolveVector('deep', avail, NOW)
    expect(vec.at(-1)).toBe('opus') // было 2-м, стало последним
    expect(vec[0]).toBe('fable')
  })
  it('неизвестное НЕ теряет позицию интента (deep: подтверждённый haiku не обгоняет неизвестную fable)', () => {
    // Только haiku подтверждён живым; для deep качество важнее — fable остаётся первой.
    const avail = { haiku: { alias: 'haiku', status: 'alive', resolvedId: 'claude-haiku-4-5', checkedAt: iso(0), note: '' } as ModelAvail }
    const vec = resolveVector('deep', avail, NOW)
    expect(vec).toEqual(FAMILY_PRIORITY.deep) // порядок интента не тронут
    expect(vec[0]).toBe('fable')
  })
  it('только мёртвое отодвигается в хвост; живое/неизвестное держат интент', () => {
    // routine: haiku, sonnet, opus, fable. haiku мёртв, opus жив → haiku в хвост, остальные по интенту.
    const avail = {
      haiku: { alias: 'haiku', status: 'dead', resolvedId: null, checkedAt: iso(0), note: '' } as ModelAvail,
      opus: { alias: 'opus', status: 'alive', resolvedId: 'claude-opus-5', checkedAt: iso(0), note: '' } as ModelAvail,
    }
    const vec = resolveVector('routine', avail, NOW)
    expect(vec[0]).toBe('sonnet') // дешёвое живое/неизвестное вперёд (не opus — цена важнее)
    expect(vec.at(-1)).toBe('haiku') // подтверждённо мёртвое в хвост
  })
  it('устаревший статус (>14д) снова unknown — перепроверится', () => {
    const stale = { opus: { alias: 'opus', status: 'dead', resolvedId: null, checkedAt: iso(-15 * 86_400_000), note: '' } as ModelAvail }
    const vec = resolveVector('deep', stale, NOW)
    expect(vec).toEqual(FAMILY_PRIORITY.deep) // dead протух → как будто не пробовали
  })
  it('мёртвое всё равно в векторе (самолечение: подписку могли вернуть)', () => {
    const avail = {
      fable: { alias: 'fable', status: 'dead', resolvedId: null, checkedAt: iso(0), note: '' } as ModelAvail,
      opus: { alias: 'opus', status: 'dead', resolvedId: null, checkedAt: iso(0), note: '' } as ModelAvail,
    }
    const vec = resolveVector('deep', avail, NOW)
    expect(new Set(vec)).toEqual(new Set(FAMILY_PRIORITY.deep)) // никто не выброшен
  })
})

describe('кэш доступности: чтение/запись/fail-open', () => {
  it('запись исхода → чтение видит статус (побочный продукт вызова)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-models-'))
    recordOutcome(dir, 'sonnet', { ok: true, resolvedId: 'claude-sonnet-5', apiErrorStatus: null, note: 'ok', now: iso(0) })
    recordOutcome(dir, 'opus', { ok: false, resolvedId: null, apiErrorStatus: 404, note: '', now: iso(0) })
    const avail = readAvailability(dir)
    expect(avail.sonnet.status).toBe('alive')
    expect(avail.sonnet.resolvedId).toBe('claude-sonnet-5')
    expect(avail.opus.status).toBe('dead')
    rmrf(dir)
  })
  it('нет файла/битый JSON → пустой кэш (fail-open, не падаем)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-models-empty-'))
    expect(readAvailability(dir)).toEqual({})
    expect(readAvailability(join(dir, 'nope'))).toEqual({})
    rmrf(dir)
  })
})

describe('признак «сети нет»: открытие однократно, а не у каждой работы', () => {
  it('обрыв опознаётся по тексту, ответ сервера — нет', () => {
    expect(looksLikeNetworkFailure('getaddrinfo ENOTFOUND api.anthropic.com')).toBe(true)
    expect(looksLikeNetworkFailure('connect ECONNREFUSED 127.0.0.1:443')).toBe(true)
    expect(looksLikeNetworkFailure('fetch failed')).toBe(true)
    // Разговор с сервером состоялся — сеть есть, это лимит или сбой сервиса
    expect(looksLikeNetworkFailure('api=429 usage limit reached')).toBe(false)
    expect(looksLikeNetworkFailure('exit=1; api=500; stderr: internal')).toBe(false)
    expect(looksLikeNetworkFailure('timeout')).toBe(false)
  })

  it('отметка живёт срок и снимается ответом сети', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-net-'))
    expect(networkDownUntil(dir, NOW)).toBeNull()
    markNetworkDown(dir, 'getaddrinfo ENOTFOUND', NOW)
    const until = networkDownUntil(dir, NOW)
    expect(until).not.toBeNull()
    expect(until! - NOW).toBeGreaterThan(60_000)
    // Срок вышел — признака нет: сеть возвращается сама, ждать нечего
    expect(networkDownUntil(dir, NOW + 10 * 60_000)).toBeNull()
    markNetworkDown(dir, 'fetch failed', NOW)
    clearNetworkDown(dir)
    expect(networkDownUntil(dir, NOW)).toBeNull()
    rmrf(dir)
  })

  it('пока признак стоит, вызов не спавнит процесс и честно называет причину', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-net-skip-'))
    markNetworkDown(dir, 'ENETUNREACH', Date.now())
    const t0 = Date.now()
    const out = callClaudeDetailed('привет', { dataDir: dir, intent: 'routine' })
    // Ни одного спавна `claude`: проверка стоит миллисекунды, а не таймауты
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.result).toBeNull()
    expect(out.tried).toHaveLength(1)
    expect(explainNoAnswer(out.tried)).toContain('сеть недоступна')
    rmrf(dir)
  })
})

describe('resolveModels (llm.ts): оверрайд → интент+кэш → сид', () => {
  it('явный models побеждает всё', () => {
    expect(resolveModels({ models: ['claude-opus-5'], intent: 'deep' })).toEqual(['claude-opus-5'])
  })
  it('без dataDir — сид-порядок интента', () => {
    expect(resolveModels({ intent: 'routine' })).toEqual(FAMILY_PRIORITY.routine)
  })
  it('с dataDir — учитывает выученную доступность', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-models-rm-'))
    // Время — РЕАЛЬНОЕ, а не пиннутое NOW: resolveModels зовёт Date.now() (llm.ts
    // — объявленная граница часов), и запись, помеченная фиксированной датой,
    // выпадала бы из окна свежести FRESH_DAYS по мере ухода календаря. Такой тест
    // зеленеет в день написания и краснеет через две недели без единой правки кода
    // — что и случилось. Пиннутое время допустимо только там, где nowMs передаётся.
    recordOutcome(dir, 'fable', { ok: false, resolvedId: null, apiErrorStatus: 404, now: new Date().toISOString(), note: '' })
    const vec = resolveModels({ intent: 'deep', dataDir: dir })
    expect(vec.at(-1)).toBe('fable') // выучено «нет доступа» → в хвост
    rmrf(dir)
  })
})

describe('renderAvailability: наблюдаемость для /sym-status', () => {
  it('показывает оба вектора и статусы известных семейств', () => {
    const avail = {
      opus: { alias: 'opus', status: 'dead', resolvedId: null, checkedAt: new Date(Date.now()).toISOString(), note: '404' } as ModelAvail,
    }
    const lines = renderAvailability(avail, Date.now())
    expect(lines.some((l) => l.startsWith('deep:'))).toBe(true)
    expect(lines.some((l) => l.startsWith('routine:'))).toBe(true)
    expect(lines.some((l) => l.includes('opus') && l.includes('нет доступа'))).toBe(true)
  })
})
