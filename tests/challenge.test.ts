import { rmrf } from './_helpers'
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { runElevate, renderProposals, type Proposal, type ElevateContext } from '../src/elevate/engine'
import {
  buildChallengePrompt,
  parseChallengeVerdicts,
  applyChallenge,
  challengeProposals,
} from '../src/elevate/challenge'

const SUMMARY = `# Паспорт проекта «x»

## Состав проекта (из чего сделан)

- код — 100 файлов (40%)
- контент/тексты — 60 файлов (24%)
- данные — 30 файлов (12%)
- активные оси качества: безопасность, корректность, находимость/SEO, связность/перелинковка, производительность
`

function world() {
  const proj = mkdtempSync(join(tmpdir(), 'symbiont-chal-proj-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'symbiont-chal-data-'))
  writeFileSync(join(dataDir, 'SUMMARY.md'), SUMMARY)
  const db = openDb(join(dataDir, 'passport.db'))
  db.run('CREATE TABLE graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)')
  mkdirSync(join(proj, 'src'))
  writeFileSync(join(proj, 'src', 'core.ts'), 'export const load = () => 1\n')
  for (let i = 0; i < 3; i++) writeFileSync(join(proj, `doc${i}.md`), `# заметка ${i}\n\nтекст\n`)
  for (let i = 0; i < 3; i++) writeFileSync(join(proj, `data${i}.json`), `{"n": ${i}}\n`)
  db.query('INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)').run('src/core.ts', 0.5, 3, 0)
  db.close()
  return { proj, dataDir }
}

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    axis: 'безопасность',
    scope: 'модуль',
    observation: 'вход не валидируется',
    proposal: 'добавить схему на границе',
    impact: 'меньше мусора в хранилище',
    effort: 'среднее',
    risk: 'низкий',
    confidence: 80,
    survivesRefutation: true,
    ...over,
  }
}

const CTX: ElevateContext = {
  summary: SUMMARY,
  activeAxes: ['безопасность'],
  rubric: [],
  samples: [],
  playbooks: [],
  stack: { frameworks: ['nuxt'], infra: [], domains: ['seo'], otherDeps: [] },
  verdictsBlock: '',
}

describe('buildChallengePrompt', () => {
  it('нумерует находки и подаёт наблюдение с предложением', () => {
    const text = buildChallengePrompt([proposal(), proposal({ observation: 'вторая' })], CTX)
    expect(text).toContain('1. ось: безопасность')
    expect(text).toContain('2. ось: безопасность')
    expect(text).toContain('вход не валидируется')
    expect(text).toContain('вторая')
  })

  it('заземляет проверяющего паспортом и стеком', () => {
    const text = buildChallengePrompt([proposal()], CTX)
    expect(text).toContain('Паспорт проекта')
    expect(text).toContain('nuxt')
  })

  it('подаёт ТЕ ЖЕ фрагменты файлов, что видел аудитор', () => {
    // судья, осведомлённый хуже обвинителя, оправдывает всё подряд: на живом
    // прогоне без этого блока проверяющий снял все находки с одним доводом —
    // «кода в заземлении нет»
    const withSamples: ElevateContext = {
      ...CTX,
      samples: [{ file: 'src/core.ts', content: 'export const load = () => 1' }],
    }
    const text = buildChallengePrompt([proposal()], withSamples)
    expect(text).toContain('Фрагменты самых связных файлов')
    expect(text).toContain('src/core.ts')
    expect(text).toContain('export const load')
  })

  it('подаёт определение только тех осей, по которым есть находки', () => {
    const withRubric: ElevateContext = {
      ...CTX,
      rubric: [
        { axis: 'безопасность', lens: 'какой вход без проверки', checks: [], appliesTo: [] },
        { axis: 'доступность', lens: 'что недоступно с клавиатуры', checks: [], appliesTo: [] },
      ] as ElevateContext['rubric'],
    }
    const text = buildChallengePrompt([proposal({ axis: 'безопасность' })], withRubric)
    expect(text).toContain('какой вход без проверки')
    expect(text).not.toContain('что недоступно с клавиатуры')
  })

  it('не переносит рассуждение первого прохода — в этом весь смысл', () => {
    const text = buildChallengePrompt([proposal()], CTX)
    // формулировки первого промпта, которые заякорили бы проверяющего
    expect(text).not.toContain('Ты — аудитор возвышения')
    expect(text).not.toContain('Обязательные принципы')
    expect(text).not.toContain('survives')
    expect(text).not.toContain('refutation')
  })

  it('запрещает согласие по умолчанию', () => {
    expect(buildChallengePrompt([proposal()], CTX)).toContain('Согласие по умолчанию — брак работы')
  })
})

describe('parseChallengeVerdicts', () => {
  it('разбирает нормальный ответ', () => {
    const rows = parseChallengeVerdicts('[{"n":1,"verdict":"снять","confidence":30,"why":"нет оснований"}]', 2)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ n: 1, verdict: 'снять', confidence: 30, why: 'нет оснований' })
  })

  it('терпит болтовню вокруг JSON', () => {
    const rows = parseChallengeVerdicts('Вот вердикты:\n[{"n":1,"verdict":"оставить","why":"ok"}]\nготово', 1)
    expect(rows).toHaveLength(1)
  })

  it('мусор = пустой список, а не исключение', () => {
    expect(parseChallengeVerdicts('не json', 3)).toEqual([])
    expect(parseChallengeVerdicts('', 3)).toEqual([])
    expect(parseChallengeVerdicts('[{сломано}]', 3)).toEqual([])
    expect(parseChallengeVerdicts('{"n":1}', 3)).toEqual([])
  })

  it('отбрасывает номера вне списка находок', () => {
    const rows = parseChallengeVerdicts('[{"n":0,"verdict":"снять","why":""},{"n":9,"verdict":"снять","why":""}]', 2)
    expect(rows).toEqual([])
  })

  it('берёт первый вердикт по номеру и игнорирует повтор', () => {
    const rows = parseChallengeVerdicts(
      '[{"n":1,"verdict":"снять","why":"a"},{"n":1,"verdict":"оставить","why":"b"}]',
      1
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verdict).toBe('снять')
  })

  it('не принимает посторонний вердикт', () => {
    expect(parseChallengeVerdicts('[{"n":1,"verdict":"может быть","why":""}]', 1)).toEqual([])
  })

  it('уверенность вне 0..100 отбрасывается, сама находка — нет', () => {
    const rows = parseChallengeVerdicts('[{"n":1,"verdict":"оставить","confidence":140,"why":""}]', 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.confidence).toBeUndefined()
  })
})

describe('applyChallenge', () => {
  it('снимает то, что проверяющий не подтвердил', () => {
    const out = applyChallenge([proposal(), proposal({ observation: 'вторая' })], [
      { n: 1, verdict: 'снять', why: '' },
    ], 70)
    expect(out.proposals).toHaveLength(1)
    expect(out.proposals[0]?.observation).toBe('вторая')
    expect(out.cut).toBe(1)
    expect(out.applied).toBe(true)
  })

  it('переносит уверенность проверяющего, а не первого прохода', () => {
    const out = applyChallenge([proposal({ confidence: 95 })], [
      { n: 1, verdict: 'оставить', confidence: 75, why: '' },
    ], 70)
    expect(out.proposals[0]?.confidence).toBe(75)
  })

  it('оставленное, но упавшее ниже порога, всё равно уходит', () => {
    const out = applyChallenge([proposal({ confidence: 95 })], [
      { n: 1, verdict: 'оставить', confidence: 40, why: '' },
    ], 70)
    expect(out.proposals).toHaveLength(0)
    expect(out.cut).toBe(1)
  })

  it('находка без вердикта остаётся нетронутой — молчание не приговор', () => {
    const out = applyChallenge([proposal(), proposal({ observation: 'вторая' })], [
      { n: 2, verdict: 'оставить', why: '' },
    ], 70)
    expect(out.proposals).toHaveLength(2)
    expect(out.cut).toBe(0)
  })

  it('без вердиктов ничего не трогает и честно говорит, что проверки не было', () => {
    const list = [proposal()]
    const out = applyChallenge(list, [], 70)
    expect(out.proposals).toEqual(list)
    expect(out.applied).toBe(false)
    expect(out.cut).toBe(0)
  })

  it('не мутирует поданный список', () => {
    const list = [proposal({ confidence: 95 })]
    applyChallenge(list, [{ n: 1, verdict: 'оставить', confidence: 71, why: '' }], 70)
    expect(list[0]?.confidence).toBe(95)
  })
})

describe('challengeProposals', () => {
  it('без находок не зовёт модель вовсе', () => {
    let calls = 0
    const out = challengeProposals([], CTX, () => { calls++; return { model: 'stub', text: '[]' } }, 70)
    expect(calls).toBe(0)
    expect(out.applied).toBe(false)
  })

  it('недоступная модель оставляет находки как есть', () => {
    const list = [proposal()]
    const out = challengeProposals(list, CTX, () => null, 70)
    expect(out.proposals).toEqual(list)
    expect(out.applied).toBe(false)
  })

  it('падение вызывателя не роняет аудит', () => {
    const list = [proposal()]
    const out = challengeProposals(list, CTX, () => { throw new Error('сеть') }, 70)
    expect(out.proposals).toEqual(list)
    expect(out.applied).toBe(false)
  })

  it('мусор вместо вердиктов оставляет находки как есть', () => {
    const list = [proposal()]
    const out = challengeProposals(list, CTX, () => ({ model: 'stub', text: 'извините, не могу' }), 70)
    expect(out.proposals).toEqual(list)
    expect(out.applied).toBe(false)
  })
})

describe('runElevate с незаякоренной проверкой', () => {
  const FIRST = JSON.stringify([
    { axis: 'безопасность', scope: 'модуль', observation: 'вход не валидируется', proposal: 'схема на границе', impact: '', effort: 'среднее', risk: 'низкий', confidence: 90, survives: true },
    { axis: 'корректность', scope: 'локальное', observation: 'нет теста на границу', proposal: 'добавить тест', impact: '', effort: 'низкое', risk: 'низкий', confidence: 85, survives: true },
  ])

  function twoStage(second: string) {
    let call = 0
    return (prompt: string) => {
      call++
      // второй вызов узнаётся по роли проверяющего, а не по счётчику:
      // так тест не сломается, если порядок вызовов когда-нибудь изменится
      return prompt.includes('независимый проверяющий')
        ? { model: 'stub', text: second }
        : { model: 'stub', text: FIRST }
    }
  }

  it('снятое проверяющим не доходит до владельца', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, twoStage('[{"n":1,"verdict":"снять","why":"паспорт этого не показывает"}]'), 70)
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0]?.axis).toBe('корректность')
    expect(r.challenged).toBe(true)
    expect(r.challengeCut).toBe(1)
    rmrf(proj); rmrf(dataDir)
  })

  it('зовёт проверяющего ровно один раз на весь список', () => {
    const { proj, dataDir } = world()
    let checks = 0
    runElevate(proj, dataDir, (prompt: string) => {
      if (prompt.includes('независимый проверяющий')) checks++
      return prompt.includes('независимый проверяющий')
        ? { model: 'stub', text: '[{"n":1,"verdict":"оставить","why":""}]' }
        : { model: 'stub', text: FIRST }
    }, 70)
    expect(checks).toBe(1)
    rmrf(proj); rmrf(dataDir)
  })

  it('порядок пересчитывается по новой уверенности', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, twoStage(
      '[{"n":1,"verdict":"оставить","confidence":71,"why":""},{"n":2,"verdict":"оставить","confidence":99,"why":""}]'
    ), 70)
    expect(r.proposals.map((p) => p.axis)).toEqual(['корректность', 'безопасность'])
    rmrf(proj); rmrf(dataDir)
  })

  it('недоступный проверяющий не отнимает находки первого прохода', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, (prompt: string) =>
      prompt.includes('независимый проверяющий') ? null : { model: 'stub', text: FIRST }, 70)
    expect(r.proposals).toHaveLength(2)
    expect(r.challenged).toBe(false)
    expect(r.challengeCut).toBe(0)
    rmrf(proj); rmrf(dataDir)
  })

  it('пустой первый проход не тратит второй вызов', () => {
    const { proj, dataDir } = world()
    let calls = 0
    const r = runElevate(proj, dataDir, () => { calls++; return { model: 'stub', text: '[]' } }, 70)
    expect(calls).toBe(1)
    expect(r.proposals).toHaveLength(0)
    rmrf(proj); rmrf(dataDir)
  })

  it('выключается флагом — первый проход остаётся прежним', () => {
    const { proj, dataDir } = world()
    let calls = 0
    const r = runElevate(proj, dataDir, () => { calls++; return { model: 'stub', text: FIRST } }, 70, { challenge: false })
    expect(calls).toBe(1)
    expect(r.proposals).toHaveLength(2)
    expect(r.challenged).toBe(false)
    rmrf(proj); rmrf(dataDir)
  })

  it('снятое называется вслух в отчёте', () => {
    const { proj, dataDir } = world()
    const r = runElevate(proj, dataDir, twoStage(
      '[{"n":1,"verdict":"снять","why":""},{"n":2,"verdict":"снять","why":""}]'
    ), 70)
    const text = renderProposals(r)
    expect(text).toContain('независимая проверка сняла 2')
    expect(r.proposals).toHaveLength(0)
    rmrf(proj); rmrf(dataDir)
  })
})
