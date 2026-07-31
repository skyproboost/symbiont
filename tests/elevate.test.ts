import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { buildContext, buildElevatePrompt, parseProposals, runElevate, renderProposals } from '../src/elevate/engine'
import { recordVerdict, readVerdicts, renderVerdictsForPrompt, renderVerdicts } from '../src/elevate/verdicts'

const SUMMARY_MIXED = `# Паспорт проекта «x»

## Состав проекта (из чего сделан)

- код — 100 файлов (40%)
- контент/тексты — 60 файлов (24%)
- данные — 30 файлов (12%)
- активные оси качества: безопасность, корректность, находимость/SEO, связность/перелинковка, производительность

## Профиль качества

- SEO — ось качества здесь
`

function world(summary = SUMMARY_MIXED, withGraph = true) {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-elev-proj-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-elev-data-'))
  writeFileSync(join(dataDir, 'SUMMARY.md'), summary)
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  if (withGraph) {
    mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src', 'core.ts'), "export const load = () => 1\n")
    // Состав проекта считается по НАСТОЯЩИМ файлам, а не по тексту сводки,
    // поэтому смешанный материал в мире теста настоящий: тексты и данные.
    for (let i = 0; i < 3; i++) writeFileSync(join(proj, `doc${i}.md`), `# заметка ${i}\n\nтекст\n`)
    for (let i = 0; i < 3; i++) writeFileSync(join(proj, `data${i}.json`), `{"n": ${i}}\n`)
    db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.5, 3, 0)
  }
  db.close()
  return { proj, dataDir }
}

describe('buildContext', () => {
  it('выводит классы и оси из материала проекта; собирает выборку из графа', () => {
    const { proj, dataDir } = world()
    const ctx = buildContext(proj, dataDir)
    const axes = ctx.rubric.map((a) => a.axis)
    expect(axes).toContain('находимость/SEO') // контент есть
    expect(axes).toContain('производительность') // код есть
    expect(axes).toContain('целостность данных') // данные есть
    expect(ctx.activeAxes).toContain('безопасность')
    // Первым идёт самый связный файл графа, дальше выборка добирается не-кодом:
    // проект смешанный, и аудит по одному .ts судил бы о нём не по материалу.
    expect(ctx.samples[0].file).toBe('src/core.ts')
    expect(ctx.samples.some((s) => s.file.endsWith('.md'))).toBe(true)
    rmrf(proj)
    rmrf(dataDir)
  })

  it('нераспознанный состав → дефолт «код»', () => {
    const { proj, dataDir } = world('# Паспорт\n\nничего про состав\n', false)
    const ctx = buildContext(proj, dataDir)
    expect(ctx.rubric.map((a) => a.axis)).toContain('производительность')
    rmrf(proj)
    rmrf(dataDir)
  })
})

describe('buildElevatePrompt', () => {
  it('включает оси, пороги, принципы и требование состязательной проверки', () => {
    const { proj, dataDir } = world()
    const prompt = buildElevatePrompt(buildContext(proj, dataDir))
    expect(prompt).toContain('LCP ≤ 2.5с') // порог из рубрики
    expect(prompt).toContain('OWASP') // безопасность всегда
    expect(prompt).toContain('опровержения') // состязательная проверка
    expect(prompt).toContain('пустой список') // молчание — фича
    expect(prompt.toLowerCase()).toContain('собственных конвенций') // анти-карго-культ
    expect(prompt).toContain('src/core.ts') // выборка вложена
    expect(prompt).toContain('применяй СВОЮ актуальную') // плейбук на лету для незнакомого
    rmrf(proj)
    rmrf(dataDir)
  })
})

describe('parseProposals', () => {
  const good = JSON.stringify([
    { axis: 'производительность', scope: 'модуль', observation: 'N+1 запрос', proposal: 'батчинг', impact: 'меньше latency', effort: 'среднее', risk: 'низкий', confidence: 85, refutation: 'может кэш решает', survives: true },
    { axis: 'безопасность', scope: 'локальное', observation: 'нет валидации', proposal: 'zod на границе', impact: 'меньше инъекций', effort: 'низкое', risk: 'низкий', confidence: 90, survives: true },
    { axis: 'слабое', scope: 'локальное', observation: 'x', proposal: 'y', confidence: 40, survives: true }, // ниже порога
    { axis: 'отклонено', scope: 'локальное', observation: 'x', proposal: 'y', confidence: 95, survives: false }, // не пережило
  ])

  it('фильтр по порогу и по провалу опровержения; ранжирование по влиянию', () => {
    const p = parseProposals(good, 70)
    expect(p.length).toBe(2)
    const axes = p.map((x) => x.axis)
    expect(axes).toContain('производительность')
    expect(axes).toContain('безопасность')
    expect(axes).not.toContain('слабое') // порог
    expect(axes).not.toContain('отклонено') // survives:false
    // безопасность (90×1.0) выше производительности (85×1.05=89.25)
    expect(p[0].axis).toBe('безопасность')
  })

  it('концепция весит больше при равной уверенности', () => {
    const arr = JSON.stringify([
      { axis: 'a', scope: 'локальное', observation: 'o', proposal: 'p', confidence: 80, survives: true },
      { axis: 'b', scope: 'концепция', observation: 'o', proposal: 'p', confidence: 80, survives: true },
    ])
    expect(parseProposals(arr, 70)[0].axis).toBe('b')
  })

  it('мусор/пустой/не-массив → пустой список (fail-open)', () => {
    expect(parseProposals('бла бла', 70)).toEqual([])
    expect(parseProposals('{}', 70)).toEqual([])
    expect(parseProposals('[]', 70)).toEqual([])
  })

  it('порог настраивается', () => {
    expect(parseProposals(good, 95).length).toBe(0) // 85 и 90 ниже 95
  })
})

describe('runElevate + renderProposals', () => {
  it('стаб-модель: предложения проходят весь путь до отчёта', () => {
    const { proj, dataDir } = world()
    const stub = () => ({
      model: 'stub',
      text: JSON.stringify([
        { axis: 'находимость/SEO', scope: 'модуль', observation: 'нет структурных данных', proposal: 'добавить schema.org', impact: 'богатые сниппеты', effort: 'среднее', risk: 'низкий', confidence: 88, survives: true },
      ]),
    })
    const r = runElevate(proj, dataDir, stub, 70)
    expect(r.model).toBe('stub')
    expect(r.proposals.length).toBe(1)
    const report = renderProposals(r)
    expect(report).toContain('находимость/SEO')
    expect(report).toContain('schema.org')
    expect(report).toContain('Ничего не применено')
    rmrf(proj)
    rmrf(dataDir)
  })

  it('здоровый проект (пустой ответ): достойный «нечего улучшать», не ошибка', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, () => ({ model: 'stub', text: '[]' }), 70)
    expect(r.proposals.length).toBe(0)
    expect(renderProposals(r)).toContain('здоров')
    rmrf(proj)
    rmrf(dataDir)
  })

  it('модель недоступна → честное сообщение, не падение', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, () => null, 70)
    expect(r.model).toBe(null)
    expect(renderProposals(r)).toContain('недоступны')
    rmrf(proj)
    rmrf(dataDir)
  })
})

describe('память аудита о решениях владельца', () => {
  it('отклонённое подаётся в следующий промпт с причиной и требованием нового основания', () => {
    const db = openDb(':memory:')
    recordVerdict(db, { verdict: 'отклонено', axis: 'корректность', observation: 'фреймворки: nuxt на CLI-плагине — ложный детект', reason: 'nuxt объявлен зависимостью в package.json, детект верен' })
    const block = renderVerdictsForPrompt(readVerdicts(db))
    expect(block).toContain('ОТКЛОНЕНО ранее')
    expect(block).toContain('ложный детект')
    expect(block).toContain('объявлен зависимостью')
    expect(block).toContain('НОВОГО основания')
    db.close()
  })

  it('принятое подаётся отдельно — «сделано, не предлагай повторно»', () => {
    const db = openDb(':memory:')
    recordVerdict(db, { verdict: 'принято', axis: 'поддерживаемость', observation: 'две копии factLine', reason: '' })
    const block = renderVerdictsForPrompt(readVerdicts(db))
    expect(block).toContain('УЖЕ ПРИНЯТО')
    expect(block).toContain('factLine')
    db.close()
  })

  it('без решений блок пуст — промпт не растёт на пустом месте', () => {
    const db = openDb(':memory:')
    expect(renderVerdictsForPrompt(readVerdicts(db))).toBe('')
    db.close()
  })

  it('владельцу решения показываются человеческим списком', () => {
    const db = openDb(':memory:')
    recordVerdict(db, { verdict: 'отклонено', axis: 'корректность', observation: 'ложный детект стека', reason: 'проверено грепом' })
    const out = renderVerdicts(readVerdicts(db))
    expect(out).toContain('память аудита')
    expect(out).toContain('✗')
    expect(out).toContain('проверено грепом')
    db.close()
  })

  it('нет таблицы — пустой список, а не падение (fail-open)', () => {
    const db = openDb(':memory:')
    expect(readVerdicts(db)).toEqual([])
    db.close()
  })
})
