/**
 * Ре-заземление доменных стандартов. Главное, что защищается: курируемое знание
 * НЕ переписывается, поправка ложится рядом с датой и источником — иначе она
 * выглядит как произвол, а не как уточнение.
 */
import { describe, expect, it } from 'bun:test'
import { openDb } from '../src/core/db'
import {
  dueForGrounding,
  storeGrounding,
  readGrounding,
  buildGroundingPrompt,
  parseGrounding,
  renderCorrection,
  GROUNDING_TTL_DAYS,
} from '../src/domains/grounding'

const now = Date.parse('2026-07-31T12:00:00.000Z')
const daysAgo = (n: number): string => new Date(now - n * 24 * 3600_000).toISOString()

describe('очередь перепроверки', () => {
  it('никогда не проверенное направление идёт первым — о нём не известно ничего', () => {
    const db = openDb(':memory:')
    storeGrounding(db, { domain: 'фронтенд', checkedAt: daysAgo(200), correction: '', source: '' })
    expect(dueForGrounding(db, ['фронтенд', 'база данных'], now)).toBe('база данных')
    db.close()
  })

  it('свежее не перепроверяется — стандарты меняются редко', () => {
    const db = openDb(':memory:')
    storeGrounding(db, { domain: 'фронтенд', checkedAt: daysAgo(10), correction: '', source: '' })
    expect(dueForGrounding(db, ['фронтенд'], now)).toBeNull()
    db.close()
  })

  it('просроченное возвращается, начиная с самого старого', () => {
    const db = openDb(':memory:')
    storeGrounding(db, { domain: 'фронтенд', checkedAt: daysAgo(GROUNDING_TTL_DAYS + 5), correction: '', source: '' })
    storeGrounding(db, { domain: 'безопасность', checkedAt: daysAgo(GROUNDING_TTL_DAYS + 200), correction: '', source: '' })
    expect(dueForGrounding(db, ['фронтенд', 'безопасность'], now)).toBe('безопасность')
    db.close()
  })

  it('нет активных направлений — нечего перепроверять', () => {
    const db = openDb(':memory:')
    expect(dueForGrounding(db, [], now)).toBeNull()
    db.close()
  })
})

describe('промпт и разбор', () => {
  it('спрашивает узко «что изменилось», а не «расскажи о направлении»', () => {
    const p = buildGroundingPrompt('фронтенд', ['LCP ≤ 2.5с на p75'], ['INP ≤ 200мс'], 'web.dev')
    expect(p).toContain('не устарели ли')
    expect(p).toContain('LCP ≤ 2.5с на p75')
    expect(p).toContain('АКТУАЛЬНОЕ состояние')
    // подтверждение «не изменилось» объявлено нормальным ответом
    expect(p).toContain('подтверждение не менее ценно')
  })

  it('«изменилось» без содержания находкой не считается', () => {
    expect(parseGrounding('{"changed": true, "correction": "да", "source": "x"}')).toBeNull()
  })

  it('честное «не изменилось» принимается как результат', () => {
    const a = parseGrounding('{"changed": false, "correction": "", "source": "web.dev"}')!
    expect(a.changed).toBe(false)
  })

  it('мусор не превращается в выдуманную поправку', () => {
    expect(parseGrounding('не json вовсе')).toBeNull()
  })
})

describe('подача поправки', () => {
  it('поправка несёт дату и источник — иначе выглядит произволом', () => {
    const s = renderCorrection({ domain: 'фронтенд', checkedAt: '2026-07-31T10:00:00Z', correction: 'порог INP снижен до 150мс', source: 'web.dev' })
    expect(s).toContain('уточнение от 2026-07-31')
    expect(s).toContain('порог INP снижен до 150мс')
    expect(s).toContain('web.dev')
  })

  it('подтверждение без изменений в подачу не идёт — это не новость', () => {
    expect(renderCorrection({ domain: 'фронтенд', checkedAt: '2026-07-31T10:00:00Z', correction: '', source: 'web.dev' })).toBe('')
    expect(renderCorrection(undefined)).toBe('')
  })

  it('запись переживает чтение и обновляется по направлению', () => {
    const db = openDb(':memory:')
    storeGrounding(db, { domain: 'SEO', checkedAt: daysAgo(5), correction: 'первое', source: 'a' })
    storeGrounding(db, { domain: 'SEO', checkedAt: daysAgo(1), correction: 'второе', source: 'b' })
    const all = readGrounding(db)
    expect(all.length).toBe(1)
    expect(all[0].correction).toBe('второе')
    db.close()
  })
})
