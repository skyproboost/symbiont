/**
 * Язык подачи: определяется наблюдением, а не вопросом человеку.
 *
 * Главная проверка здесь — ПОРЯДОК признаков. Он выстрадан: коммиты у
 * русскоязычных владельцев сплошь английские по конвенции, поэтому судить по
 * ним нельзя, а сообщение человека модели отвечает на вопрос сразу и точно.
 */
import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { buildPassport } from '../src/passport/build'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { letters, observePrompt, observeComments, chooseLang, readState, statement, tier, pair, setLang, lang } from '../src/core/i18n'
import { deriveFacts } from '../src/miner/facts'
import { analyzeFile, aggregate } from '../src/miner/analyze'
import { artifactProfile, renderArtifacts, renderQualityStance } from '../src/passport/artifacts'
import { profileFacts } from '../src/passport/profile'
import { deriveConstitutionFacts } from '../src/passport/constitution-derive'
import { factBasis } from '../src/core/store'

const world = (): string => mkdtempSync(join(tmpdir(), 'symbiont-lang-'))

describe('язык подачи: наблюдение вместо анкеты', () => {
  it('буквы считаются по алфавитам, а не по словарю языков', () => {
    expect(letters('привет')).toEqual({ cyr: 6, lat: 0 })
    expect(letters('hello')).toEqual({ cyr: 0, lat: 5 })
    // Технический русский всегда наполовину латиница — и это по-прежнему русский
    expect(letters('поправь src/core/db.ts').cyr).toBeGreaterThan(5)
  })

  it('одно сообщение владельца уже решает вопрос', () => {
    const dir = world()
    observePrompt(dir, 'посмотри, почему падает сборка паспорта в hooks')
    expect(readState(dir).lang).toBe('ru')
    rmrf(dir)
  })

  it('английское сообщение — английская подача', () => {
    const dir = world()
    observePrompt(dir, 'check why the passport build fails in hooks')
    expect(readState(dir).lang).toBe('en')
    rmrf(dir)
  })

  it('смена языка перевешивает прошлое, но не с одного слова', () => {
    const dir = world()
    for (let i = 0; i < 5; i++) observePrompt(dir, 'сделай проверку конвенций в этом каталоге')
    expect(readState(dir).lang).toBe('ru')
    observePrompt(dir, 'ok')
    expect(readState(dir).lang).toBe('ru') // «ok» — не свидетельство
    for (let i = 0; i < 6; i++) observePrompt(dir, 'please rewrite this module and add tests for the new behaviour')
    expect(readState(dir).lang).toBe('en')
    rmrf(dir)
  })

  it('до первого сообщения решают комментарии в коде', () => {
    const dir = world()
    observeComments(dir, 800, 200)
    expect(readState(dir).lang).toBe('ru')
    expect(readState(dir).source).toBe('comments')
    rmrf(dir)
  })

  it('сообщение владельца сильнее комментариев проекта', () => {
    const dir = world()
    observeComments(dir, 5000, 100) // проект комментирован по-русски
    observePrompt(dir, 'please add a test for the new resolver behaviour')
    expect(readState(dir).lang).toBe('en')
    rmrf(dir)
  })

  it('сказанное вслух сильнее любого наблюдения', () => {
    const dir = world()
    observePrompt(dir, 'посмотри конвенции проекта и поправь')
    expect(chooseLang(dir, 'en').lang).toBe('en')
    observePrompt(dir, 'а теперь проверь граф связей и напиши что нашёл')
    expect(readState(dir).lang).toBe('en') // выбор не перетирается наблюдением
    expect(chooseLang(dir, null).lang).toBe('ru') // авто — снова наблюдение
    rmrf(dir)
  })

  it('комментарии проекта считаются майнером и приходят в наблюдение', () => {
    const obs = analyzeFile('a.ts', '.ts', '// считаем распространённость правил\nconst x = 1\n')
    expect(obs.comments.cyr).toBeGreaterThan(10)
    expect(aggregate([obs], ['.ts']).comments.cyr).toBe(obs.comments.cyr)
  })
})

describe('смена языка видна сразу, а не после первой правки кода', () => {
  it('сводка пересобирается при смене языка (язык — часть версии проекции)', () => {
    const proj = world()
    const data = world()
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'core.ts'), "export const x = 'a'\n".repeat(30))
    const first = buildPassport(proj, join(data, 'p'))
    expect(readFileSync(first.summaryPath, 'utf8')).toContain('Паспорт проекта')
    // Ничего в проекте не изменилось — но язык другой, и сводка обязана ожить:
    // проекция лежит на диске и без этого показывала бы прежний язык
    process.env.SYMBIONT_LANG = 'en'
    try {
      const second = buildPassport(proj, join(data, 'p'))
      expect(readFileSync(second.summaryPath, 'utf8')).toContain('Project passport')
    } finally {
      process.env.SYMBIONT_LANG = 'ru'
      setLang('ru')
    }
    rmrf(proj)
    rmrf(data)
  })
})

describe('перевод формулировок — на последней миле, журнал не трогается', () => {
  it('известное правило переводится, неизвестное (от модели) остаётся как есть', () => {
    const facts = deriveFacts(
      aggregate(
        [analyzeFile('a.ts', '.ts', "const a = 'x'\n".repeat(40) + 'let b = 2\n'.repeat(10))],
        ['.ts'],
      ),
    )
    const quotes = facts.find((f) => f.statement.includes('кавычки'))
    expect(quotes).toBeDefined()
    setLang('en')
    try {
      expect(statement(quotes!.statement)).toBe('quotes — single')
      expect(statement('своя формулировка модели про этот проект')).toBe('своя формулировка модели про этот проект')
      expect(tier('закон')).toBe('law')
      // Шаблонная формулировка переводится головой, хвост с числами сохраняется
      pair('венгерская нотация — префиксы типа', 'Hungarian notation — type prefixes')
      expect(statement('венгерская нотация — префиксы типа: s* (12)')).toBe('Hungarian notation — type prefixes: s* (12)')
    } finally {
      setLang('ru')
    }
    expect(lang()).toBe('ru')
  })

  it('в журнале формулировка остаётся исходной — идентичность факта не меняется', () => {
    const dir = world()
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), "const a = 'x'\n".repeat(40))
    const facts = deriveFacts(aggregate([analyzeFile('a.ts', '.ts', "const a = 'x'\n".repeat(40))], ['.ts']))
    setLang('en')
    try {
      // Даже на английской подаче ФАКТ хранит русскую формулировку: по ней
      // считается ключ вытеснения, и журнал обязан оставаться неизменным
      expect(facts.some((f) => f.statement.includes('кавычки'))).toBe(true)
    } finally {
      setLang('ru')
    }
    rmrf(dir)
  })
})

describe('английская подача — полная, а не наполовину', () => {
  // Полупереведённый вывод (заголовки английские, строки русские) — худший из
  // исходов: он выглядит рабочим и проходит проверки на подстроку. Поэтому
  // проверяется ОТСУТСТВИЕ кириллицы в том, что плагин говорит от себя.
  const cyr = /[а-яё]/i

  it('стойка качества, состав, профиль и конституция — без кириллицы', () => {
    const profile = artifactProfile([
      { name: 'a.ts', ext: '.ts' },
      { name: 'b.ts', ext: '.ts' },
      { name: 'c.md', ext: '.md' },
      { name: 'd.json', ext: '.json' },
    ])
    const probes = [
      { axis: 'корректность', evidence: ['тестовых файлов: 12', 'CI', 'заявлено в доках'] },
      { axis: 'приватность', evidence: ['заявлено в доках'] },
      { axis: 'безопасность', evidence: [] as string[] },
    ]
    setLang('en')
    try {
      expect(cyr.test(renderQualityStance(profile))).toBe(false)
      expect(cyr.test(renderArtifacts(profile))).toBe(false)
      for (const f of profileFacts(probes)) expect(cyr.test(statement(f.statement))).toBe(false)
      const consts = deriveConstitutionFacts(
        { commitTypes: { fix: 30 }, reverts: 3, fixZones: { 'src/core': 9 }, totalCommits: 60, valueMentions: { performance: 12 } },
        probes,
      )
      expect(consts.length).toBeGreaterThan(0)
      for (const f of consts) expect(cyr.test(statement(f.statement))).toBe(false)
      expect(factBasis({ positive: 5, total: 7, prevalence: 0.71 })).toBe('5 of 7 (71%)')
    } finally {
      setLang('ru')
    }
  })

  it('каждая точка, показывающая факты, объявляет загрузку таблиц формулировок', () => {
    // Список не задан руками, а ВЫВЕДЕН: кто зовёт statement(), тот и показывает
    // факты. Иначе новая точка входа появилась бы вне проверки — ровно так и
    // разъехались MCP, сводка, JIT-срез и гейт, каждый по-своему и молча.
    const callers: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          walk(p)
          continue
        }
        if (!e.name.endsWith('.ts')) continue
        const body = readFileSync(p, 'utf8')
        // сам i18n объявляет statement(), а statements.ts — таблицы: они не потребители
        if (p.endsWith('i18n.ts') || p.endsWith('statements.ts')) continue
        if (/\bstatement\(/.test(body)) callers.push(p)
      }
    }
    walk(join(import.meta.dir, '..', 'src'))
    expect(callers.length).toBeGreaterThan(3)
    const silent = callers.filter((p) => !readFileSync(p, 'utf8').includes("core/statements'"))
    expect(silent.map((p) => p.replace(/^.*[\\/]src[\\/]/, 'src/'))).toEqual([])
  })

  it('все объявленные пары доступны процессу, который рисует отчёт', async () => {
    // Таблица формулировок регистрируется ПРИ ЗАГРУЗКЕ объявившего её модуля.
    // Отчёт статуса базу только читает и ни майнер, ни верификаторы не зовёт —
    // забытый импорт-ради-регистрации поэтому ничего не ломает заметно: вывод
    // просто уходит наполовину русским, и это видит уже владелец, а не тест.
    // Так и случилось с законами формы и именами верификаторов разом.
    await import('../src/cli/reports')
    const pairs: Array<[string, string]> = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          walk(p)
          continue
        }
        if (!e.name.endsWith('.ts')) continue
        for (const m of readFileSync(p, 'utf8').matchAll(/\bpair\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/g)) {
          pairs.push([m[1], m[2]])
        }
      }
    }
    walk(join(import.meta.dir, '..', 'src'))
    expect(pairs.length).toBeGreaterThan(30) // таблицы на месте, а не «ноль пар — ноль расхождений»
    setLang('en')
    try {
      expect(pairs.filter((p) => statement(p[0]) !== p[1]).map((p) => p[0])).toEqual([])
    } finally {
      setLang('ru')
    }
  })

  it('оси качества переводятся, но ключ факта остаётся русским', () => {
    const probes = [{ axis: 'целостность данных', evidence: ['заявлено в доках'] }]
    const fact = profileFacts(probes)[0]
    // В журнале — русская формулировка: по ней считается ключ вытеснения
    expect(fact.statement.startsWith('целостность данных')).toBe(true)
    setLang('en')
    try {
      expect(statement(fact.statement)).toBe("data integrity — declared in the docs, not found in the project's code")
    } finally {
      setLang('ru')
    }
  })
})
