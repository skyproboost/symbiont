/**
 * Текст хука обязан укладываться в лимит платформы — и это проверяется, а не
 * подразумевается.
 *
 * Поймано замером на транскриптах владельца: 146 сводок SessionStart (141 на
 * labreadai-v2) были длиннее 10 000 символов, и платформа подменяла ВСЁ поле
 * превью на 2 000 — модель видела заголовок паспорта без законов и карты
 * модулей. Бюджет держал только паспорт; устав, рамка, состояние и вход в
 * работу приклеивались сверху.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENTRY_SOURCES } from '../src/bundle/core'
import { capText, capHookOutput, recordOverflow, renderOverflow, HOOK_TEXT_BUDGET, PLATFORM_TEXT_LIMIT } from '../src/hooks/emit'
import { composeContext, fitToBudget, handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { setLang, lang } from '../src/core/i18n'

const ROOT = join(import.meta.dir, '..')

const section = (title: string, items: number, len = 80): string =>
  [`## ${title}`, '', ...Array.from({ length: items }, (_, i) => `- ${title}-${i} ${'ы'.repeat(len)}`)].join('\n')

describe('рубеж на выходе хука', () => {
  it('короткий текст не трогается, длинный укладывается в бюджет с пометкой', () => {
    expect(capText('коротко')).toBe('коротко')
    const long = Array.from({ length: 400 }, (_, i) => `- строка ${i} ${'x'.repeat(40)}`).join('\n')
    const out = capText(long)
    expect(out.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
    expect(out.startsWith('- строка 0 ')).toBe(true) // начало сохранено
    expect(out).toMatch(/Symbiont: \d+ (символов|characters)/)
  })

  it('режутся текстовые поля на любой глубине, поля-данные — нет', () => {
    const big = 'а'.repeat(PLATFORM_TEXT_LIMIT + 500)
    const res = capHookOutput({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: big, permissionDecisionReason: big, updatedInput: { content: big } },
      systemMessage: 'ok',
    })
    expect(res.out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
    expect(res.out.hookSpecificOutput.permissionDecisionReason.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
    expect(res.out.hookSpecificOutput.updatedInput.content).toBe(big) // содержимое файла — не подача
    expect(res.out.systemMessage).toBe('ok')
    expect(res.overflows.map((o) => o.field).sort()).toEqual(['additionalContext', 'permissionDecisionReason'])
  })

  it('срабатывание записывается и называется в сводке неделю — не молча', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiont-overflow-'))
    try {
      expect(renderOverflow(dir)).toBe('')
      const now = new Date('2026-09-23T10:00:00Z')
      recordOverflow(dir, 'SessionStart', [{ field: 'additionalContext', length: 11888 }], now)
      recordOverflow(dir, 'SessionStart', [{ field: 'additionalContext', length: 10100 }], now)
      const line = renderOverflow(dir, now.getTime() + 86_400_000)
      expect(line).toContain('SessionStart')
      expect(line).toContain('×2')
      expect(renderOverflow(dir, now.getTime() + 8 * 86_400_000)).toBe('') // неделя прошла — устарело
    } finally {
      rmrf(dir)
    }
  })

  it('ни одна точка входа не печатает вывод в обход рубежа', () => {
    // Список входов — у сборщика: новый канал попадает под правило самим фактом появления
    const hooks = ENTRY_SOURCES.filter((s) => s.startsWith('src/hooks/'))
    expect(hooks.length).toBeGreaterThan(5)
    const raw = hooks.filter((s) => readFileSync(join(ROOT, s), 'utf8').includes('console.log(JSON.stringify('))
    expect(raw).toEqual([])
    const printing = hooks.filter((s) => readFileSync(join(ROOT, s), 'utf8').includes('emitHookOutput('))
    // печатают все, кроме прощания (SessionEnd ничего не отдаёт платформе)
    expect(printing.length).toBe(hooks.length - 1)
  })
})

describe('fitToBudget держит бюджет вместе с пометкой', () => {
  it('честный обрыв не выводит текст за бюджет', () => {
    const doc = ['# П', '', section('А', 3, 400), section('Б', 3, 400), section('В', 3, 400)].join('\n')
    for (const budget of [600, 1500, 3000]) {
      const out = fitToBudget(doc, budget, 'C:/p/SUMMARY.md')
      expect(out.length).toBeLessThanOrEqual(budget)
      expect(out).toContain('C:/p/SUMMARY.md')
    }
  })

  it('без полного файла пометка не обещает несуществующую ссылку', () => {
    const doc = ['', section('Состояние', 3, 400), section('Вход', 3, 400)].join('\n')
    const out = fitToBudget(doc, 800, null)
    expect(out.length).toBeLessThanOrEqual(800)
    expect(out).not.toContain('полная версия')
  })
})

describe('сводка SessionStart — одно поле, один лимит', () => {
  const footer = '\n_Symbiont · тест_'

  it('случай labreadai-v2: паспорт 8000 + хвост 3.6 тыс. укладываются вместе, хвост доезжает', () => {
    // Размеры секций — с настоящей переполненной сводки labreadai-v2
    const passport = ['# Паспорт', '', ...['Стойка', 'Зрелость', 'Законы', 'Привычки', 'Смешанный', 'Состав', 'Стек', 'Профиль', 'Приоритеты', 'Модули'].map((s) => section(s, 8, 90))].join('\n\n')
    const tail = ['', section('Сказано вслух', 2, 100), section('Рамка', 6, 120), section('Состояние', 12, 110), section('Вход в работу', 8, 110)].join('\n')
    expect(passport.length + tail.length).toBeGreaterThan(PLATFORM_TEXT_LIMIT)
    const out = composeContext(passport, tail, footer, 'C:/p/SUMMARY.md')
    expect(out.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
    expect(out.endsWith(footer)).toBe(true)
    // хвост — состояние именно этой сессии, его нет больше нигде: доезжает целиком
    expect(out).toContain(tail)
    // уступил паспорт — и назвал, сколько за кадром
    expect(out).toMatch(/ещё \d+ — passport_conventions|\d+ more — passport_conventions/)
    expect(out).toContain('## Модули') // последняя секция паспорта не снесена слайсом
  })

  it('огромный хвост не съедает паспорт ниже пола — урезается сам, с числом за кадром', () => {
    const passport = ['# Паспорт', '', ...['Законы', 'Привычки', 'Модули'].map((s) => section(s, 20, 90))].join('\n\n')
    const tail = ['', section('Воля владельца', 60, 140), section('Состояние', 10, 100)].join('\n')
    const out = composeContext(passport, tail, footer, 'C:/p/SUMMARY.md')
    expect(out.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
    expect(out.indexOf('## Воля владельца')).toBeGreaterThan(0)
    expect(out.slice(0, out.indexOf('\n## Воля владельца')).length).toBeGreaterThanOrEqual(4500) // паспорт у пола, не выжат
    expect(out).toMatch(/не вместилось в лимит подачи|did not fit the delivery limit/)
  })

  it('короткая сводка собирается как есть', () => {
    const out = composeContext('# П\n\n## Законы\n\n- а', '\n## Состояние\n\n- б\n', footer, 'C:/p/S.md')
    expect(out).toBe(`# П\n\n## Законы\n\n- а\n## Состояние\n\n- б\n${footer}`)
  })

  it('сквозь настоящий хук: большой устав и рамка не выводят поле за лимит', () => {
    const before = lang()
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-limit-proj-'))
    const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-limit-data-'))
    try {
      setLang('ru')
      for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), 'function f(_oX) {\n    var sName = _oX.n;\n    return sName;\n}\n'.repeat(12))
      const dataDir = join(dataRoot, slugOf(proj))
      mkdirSync(dataDir, { recursive: true })
      // Устав на ~11 тыс. символов: владелец волен записать сколько угодно
      const pairs = Array.from({ length: 70 }, (_, i) => ({ goal: `цель номер ${i} ${'ц'.repeat(60)}`, constraint: `ограничение ${i} ${'о'.repeat(60)}` }))
      writeFileSync(join(dataDir, 'constitution.json'), JSON.stringify({ pairs, updated_at: '2026-09-23' }), 'utf8')
      const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: 'limit-1' }, dataRoot)
      const ctx = out.hookSpecificOutput?.additionalContext ?? ''
      expect(ctx.length).toBeGreaterThan(0)
      expect(ctx.length).toBeLessThanOrEqual(HOOK_TEXT_BUDGET)
      expect(ctx).toContain('только var') // закон паспорта на месте
      expect(ctx).toContain('_Symbiont ·') // подвал на месте
    } finally {
      setLang(before)
      rmrf(proj)
      rmrf(dataRoot)
    }
  })
})
