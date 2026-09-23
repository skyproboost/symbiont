import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSample, buildPrompt, parseRules, parseQuotedRules, ruleToFact, runVerbalize } from '../src/layer2/verbalize'
import { handleSessionStart, slugOf } from '../src/hooks/session-start-core'
import { openDb } from '../src/core/db'

/** Дословные строки из файлов мира-проекта ниже — улики, проходящие сверку. */
const QUOTED = [
  { file: 'lib/core.js', quote: "var e = require('./err');" },
  { file: 'lib/err.js', quote: 'module.exports = E;' },
  { file: 'app.js', quote: "var core = require('./lib/core');" },
]

describe('parseRules (строгий fail-open парс)', () => {
  it('валидный массив с обвязкой — разбирается', () => {
    const text = 'Вот правила:\n[{"area":"ошибки","statement":"ошибки — возвращаются значением","evidence":["a.js","b.js","c.js"],"confidence":0.9}]\nконец'
    const rules = parseRules(text)
    expect(rules.length).toBe(1)
    expect(rules[0].statement).toContain('—')
  })

  it('мусор, не-массив, битый JSON — пустой список', () => {
    expect(parseRules('извините, не могу')).toEqual([])
    expect(parseRules('{"a":1}')).toEqual([])
    expect(parseRules('[{broken')).toEqual([])
  })

  it('правила без 3 подтверждений / слишком короткие / с кривой уверенностью отсеиваются', () => {
    const text = JSON.stringify([
      { area: 'x', statement: 'коротко', evidence: ['a', 'b', 'c'], confidence: 0.9 },
      { area: 'x', statement: 'мало подтверждений у правила', evidence: ['a'], confidence: 0.9 },
      { area: 'x', statement: 'кривая уверенность у правила', evidence: ['a', 'b', 'c'], confidence: 1.5 },
      { area: 'ок', statement: 'валидное правило достаточной длины', evidence: ['a', 'b', 'c'], confidence: 0.7 },
    ])
    const rules = parseRules(text)
    expect(rules.length).toBe(1)
    expect(rules[0].area).toBe('ок')
  })
})

describe('ruleToFact', () => {
  it('LLM-факт никогда не закон: высокая уверенность → привычка, prevalence < 0.95', () => {
    const f = ruleToFact({ area: 'x', statement: 'а — б', evidence: ['1', '2', '3'], confidence: 0.99 }, 6)
    expect(f.tier).toBe('привычка')
    expect(f.prevalence).toBeLessThan(0.95)
  })
  it('низкая уверенность → гипотеза', () => {
    const f = ruleToFact({ area: 'x', statement: 'а — б', evidence: ['1', '2', '3'], confidence: 0.5 }, 6)
    expect(f.tier).toBe('гипотеза')
  })
})

describe('runVerbalize с фейковым LLM', () => {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-l2-proj-'))
  mkdirSync(join(proj, 'lib'), { recursive: true })
  writeFileSync(join(proj, 'lib', 'core.js'), "var e = require('./err');\nvar x = 1;\n".repeat(6))
  writeFileSync(join(proj, 'lib', 'err.js'), 'var E = { fail: 1 };\nmodule.exports = E;\n'.repeat(6))
  writeFileSync(join(proj, 'app.js'), "var core = require('./lib/core');\n")
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-l2-data-'))
  handleSessionStart({ cwd: proj, source: 'startup', session_id: 'l2' }, dataRoot)
  const dataDir = join(dataRoot, slugOf(proj))

  it('образец строится из топа графа, промпт содержит законы и файлы', () => {
    const samples = buildSample(proj, dataDir)
    expect(samples.length).toBeGreaterThan(0)
    const prompt = buildPrompt(['переменные — только var'], samples)
    expect(prompt).toContain('чего в этом списке нет')
    expect(prompt).toContain('переменные — только var')
    expect(prompt).toContain('<document_content>')
    expect(prompt).toContain('JSON')
  })

  it('полный прогон: правила записаны в журнал с источником llm:layer2', () => {
    const fake = () => ({
      model: 'fake-sonnet',
      text: JSON.stringify([
        { area: 'ошибки', statement: 'ошибки — возвращаются кодом, не бросаются', evidence: QUOTED, confidence: 0.85 },
      ]),
    })
    const r = runVerbalize(proj, dataDir, fake)
    expect(r.model).toBe('fake-sonnet')
    expect(r.rules.length).toBe(1)
    expect(r.rules[0].evidence.sort()).toEqual(['app.js', 'lib/core.js', 'lib/err.js'])
    expect(r.unverified).toBe(0)
    expect(r.journal.born).toBe(1)

    const db = openDb(join(dataDir, 'passport.db'))
    const row = db.query("SELECT * FROM fact_journal WHERE source LIKE 'llm:layer2%'").get() as any
    db.close()
    expect(row.statement).toContain('возвращаются кодом')
    expect(row.tier).toBe('привычка')
  })

  it('ранний срез: материал не менялся — модель не вызывается', () => {
    // Вход прошлого успешного прохода байт-в-байт тот же → повторный вызов
    // дал бы только сэмплинговый шум; срез экономит единственную дорогую
    // стадию петли
    let called = 0
    const fake = () => {
      called++
      return { model: 'fake', text: '[]' }
    }
    const r = runVerbalize(proj, dataDir, fake)
    expect(r.cutoff).toBe(true)
    expect(r.model).toBeNull()
    expect(called).toBe(0)
  })

  it('материал изменился — срез снят, модель вызвана', () => {
    writeFileSync(join(proj, 'lib', 'core.js'), 'var changed = 2;\n'.repeat(8))
    let called = 0
    const fake = () => {
      called++
      return { model: 'fake', text: '[]' }
    }
    const r = runVerbalize(proj, dataDir, fake)
    expect(r.cutoff).toBe(false)
    expect(called).toBe(1)
  })

  it('LLM вернул мусор — ноль фактов, журнал не тронут', () => {
    // Материал меняется (иначе сработал бы ранний срез и вызов не состоялся)
    writeFileSync(join(proj, 'lib', 'err.js'), 'var E = { fail: 2 };\nmodule.exports = E;\n'.repeat(6))
    const before = (() => {
      const db = openDb(join(dataDir, 'passport.db'))
      const n = (db.query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n
      db.close()
      return n
    })()
    const r = runVerbalize(proj, dataDir, () => ({ model: 'fake', text: 'извините, вот эссе о коде…' }))
    expect(r.rules).toEqual([])
    const db = openDb(join(dataDir, 'passport.db'))
    const after = (db.query('SELECT COUNT(*) n FROM fact_journal').get() as { n: number }).n
    db.close()
    expect(after).toBe(before)
  })

  it('cleanup', () => {
    rmrf(proj, { recursive: true, force: true })
    rmrf(dataRoot, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})

/**
 * Дубли в паспорте родились не из плохого дедупа, а из слепоты прохода: он
 * видел статистические законы («не повторяй их») и не видел СВОИХ прошлых
 * правил — и выводил их заново другими словами, а то и на другом языке.
 * Идентичность факта — область плюс предмет, и модель переименовывала оба.
 */
describe('проход слоя 2 знает, что уже записал', () => {
  it('записанные привычки уходят в промпт с запретом повтора', () => {
    const p = buildPrompt(['отступы — 2 пробела'], [{ file: 'a.ts', content: 'const a = 1' }], [], ['экспорт — только именованный'])
    expect(p).toContain('Уже записанные привычки')
    expect(p).toContain('ни на другом языке')
    expect(p).toContain('экспорт — только именованный')
  })

  it('без записанных привычек лишней секции нет', () => {
    const p = buildPrompt(['отступы — 2 пробела'], [{ file: 'a.ts', content: 'const a = 1' }])
    expect(p).not.toContain('Уже записанные привычки')
  })

  it('проход отдаёт модели свой прошлый урожай — проверка проводки, а не только сборки строки', () => {
    const proj2 = mkdtempSync(join(tmpdir(), 'symbiont-l2-known-'))
    mkdirSync(join(proj2, 'lib'), { recursive: true })
    writeFileSync(join(proj2, 'lib', 'core.js'), "var e = require('./err');\nvar x = 1;\n".repeat(6))
    writeFileSync(join(proj2, 'lib', 'err.js'), 'var E = { fail: 1 };\nmodule.exports = E;\n'.repeat(6))
    // третий файл — третья улика: правило принимается по цитатам минимум из трёх разных файлов
    writeFileSync(join(proj2, 'app.js'), "var core = require('./lib/core');\n")
    const dataRoot2 = mkdtempSync(join(tmpdir(), 'symbiont-l2-known-data-'))
    handleSessionStart({ cwd: proj2, source: 'startup', session_id: 'l2k' }, dataRoot2)
    const dataDir2 = join(dataRoot2, slugOf(proj2))

    const harvest = JSON.stringify([
      { area: 'модули', statement: 'экспорт — только именованный', evidence: QUOTED, confidence: 0.85 },
    ])
    runVerbalize(proj2, dataDir2, () => ({ model: 'fake', text: harvest }))

    // Материал меняем, иначе второй проход срежется ранним cutoff
    writeFileSync(join(proj2, 'lib', 'core.js'), 'var y = 2;\n'.repeat(9))
    const prompts: string[] = []
    runVerbalize(proj2, dataDir2, (prompt) => {
      prompts.push(prompt)
      return { model: 'fake', text: '[]' }
    })
    expect(prompts[0]).toContain('Уже записанные привычки')
    expect(prompts[0]).toContain('экспорт — только именованный')
    rmrf(proj2)
    rmrf(dataRoot2)
  })

  it('правило на переподтверждении в запрет не попадает — его просят повторить дословно', () => {
    const p = buildPrompt([], [{ file: 'a.ts', content: 'const a = 1' }], ['ошибки — возвращаются значением'], [])
    expect(p).toContain('пора переподтверждение')
    expect(p.split('Уже записанные привычки')).toHaveLength(1)
  })
})

/**
 * Улика — строка файла образца, а не имя файла. Принцип из Evidence-Preserving
 * Reducer (NVlabs SoL-Pi): делегированному пересказу не верят, каждое его
 * утверждение сверяется с источником символ в символ.
 */
describe('сверка улик слоя 2 с образцом', () => {
  const samples = [
    { file: 'lib/core.js', content: "var e = require('./err');\nvar x = 1;\n" },
    { file: 'lib/err.js', content: 'var E = { fail: 1 };\r\nmodule.exports = E;\r\n' },
    { file: 'app.js', content: "var core = require('./lib/core');\ncore.run()\n" },
  ]
  const rule = (evidence: unknown[]): string => JSON.stringify([{ area: 'модули', statement: 'модули — подключаются через require', evidence, confidence: 0.9 }])

  it('три дословные цитаты из трёх файлов — правило принято, улики — сверенные файлы', () => {
    const r = parseQuotedRules(rule(QUOTED), samples)
    expect(r.unverified).toBe(0)
    expect(r.rules).toHaveLength(1)
    expect(r.rules[0].evidence.sort()).toEqual(['app.js', 'lib/core.js', 'lib/err.js'])
  })

  it('пересказ вместо цитаты — правило отброшено целиком и посчитано', () => {
    const r = parseQuotedRules(rule([...QUOTED.slice(0, 2), { file: 'app.js', quote: 'core подключается через require' }]), samples)
    expect(r.rules).toEqual([])
    expect(r.unverified).toBe(1)
  })

  it('цитата есть, но в другом файле — не улика этого файла', () => {
    const r = parseQuotedRules(rule([...QUOTED.slice(0, 2), { file: 'app.js', quote: 'module.exports = E;' }]), samples)
    expect(r.rules).toEqual([])
  })

  it('старый формат — голые имена файлов — не проходит: имя не доказывает правило', () => {
    const r = parseQuotedRules(rule(['lib/core.js', 'lib/err.js', 'app.js']), samples)
    expect(r.rules).toEqual([])
    expect(r.unverified).toBe(1)
  })

  it('три цитаты из одного файла — одна улика, а не три', () => {
    const r = parseQuotedRules(rule([
      { file: 'lib/core.js', quote: "var e = require('./err');" },
      { file: 'lib/core.js', quote: 'var x = 1;' },
      { file: 'lib/err.js', quote: 'module.exports = E;' },
    ]), samples)
    expect(r.rules).toEqual([])
  })

  it('многоточие и слишком короткая цитата не сверяются; переводы строк Windows и ./ в пути — не помеха', () => {
    const dotted = parseQuotedRules(rule([...QUOTED.slice(0, 2), { file: 'app.js', quote: "var core = require(…)" }]), samples)
    expect(dotted.rules).toEqual([])
    const short = parseQuotedRules(rule([...QUOTED.slice(0, 2), { file: 'app.js', quote: ');' }]), samples)
    expect(short.rules).toEqual([])
    const crlf = parseQuotedRules(rule([
      QUOTED[0],
      { file: './lib\\err.js', quote: 'var E = { fail: 1 };\nmodule.exports = E;' },
      QUOTED[2],
    ]), samples)
    expect(crlf.rules).toHaveLength(1)
  })

  it('промпт просит дословную строку и объясняет, почему', () => {
    const p = buildPrompt([], samples)
    expect(p).toContain('дословно')
    expect(p).toContain('"quote"')
    expect(p).toContain('по словам')
  })

  // Случаи с живого прохода по labreadai-v2: побайтная сверка отбросила 4
  // правила из 5, а несверенные цитаты были подлинным текстом, переложенным моделью
  it('переложенный комментарий сверяется, изменённое слово или регистр — нет', () => {
    const commented = [
      {
        file: 'shared/pdf.ts',
        content: [
          '/**',
          ' * Модуль разбора. Бюджеты:',
          ' *  • Бюджеты жёсткие: у рендеров СВОЯ квота, она',
          ' *    НЕ конкурирует с лимитом обычных фото.',
          ' */',
          '//    PDF-снимками всё равно получает извлечение (решение владельца 2026-07-10).',
          '// числа, текст собирает UI. Модель — прогрессивная точность (§11.1',
          '// плана calculators-hub-plan.md):',
          '//   авторитетно. Без I/O и зависимостей → тестируемо.',
        ].join('\n'),
      },
    ]
    const ok = (quote: string): boolean =>
      parseQuotedRules(rule([{ file: 'shared/pdf.ts', quote }]), commented, 1).rules.length === 1
    expect(ok('// PDF-снимками всё равно получает извлечение (решение владельца 2026-07-10).')).toBe(true) // пробелы после //
    expect(ok('// Модель — прогрессивная точность (§11.1 плана calculators-hub-plan.md):')).toBe(true) // середина строки + склейка
    expect(ok('Бюджеты жёсткие: у рендеров СВОЯ квота, она НЕ конкурирует с лимитом обычных фото.')).toBe(true) // без маркера списка
    expect(ok('// БЕЗ I/O и зависимостей → тестируемо.')).toBe(false) // регистр изменён — это уже не цитата
    expect(ok('// Без ввода-вывода и зависимостей → тестируемо.')).toBe(false) // слово заменено
    expect(ok('// Модель — точность (§11.1 плана calculators-hub-plan.md):')).toBe(false) // слово выпущено
  })
})
