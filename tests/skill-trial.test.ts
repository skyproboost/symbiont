/**
 * Навыки владельца в начале сессии с контрольной группой. Проверяется главное:
 * без конфига ничего не меняется, группа детерминирована и назначается только на
 * свежем старте, фоновые сессии не трогаются, указание стоит ДО паспорта и не
 * зависит от него, признаки считаются со смещения без удвоения, вердикт
 * смотрится в фиксированных точках и показывается владельцу раз в день.
 */
import { describe, expect, it } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import {
  readTrialConfig,
  trialArm,
  startSkillTrial,
  applyTrialLines,
  accountSkillTrial,
  trialVerdict,
  permutationP,
  isInteractive,
  trialActive,
  isCorrection,
  renderTrialStatus,
  renderDirective,
  renderVerdict,
  TRIAL_FILE,
  TRIAL_DB,
  MIN_CONTROL,
  MAX_CONTROL,
  MAX_SKILLS,
  type TrialRow,
} from '../src/gardener/skill-trial'
import { composeContext, handleSessionStart } from '../src/hooks/session-start-core'
import { rmrf } from './_helpers'

const SKILL = 'flight-protocol'

/** Мир: корень данных с конфигом и личные навыки. */
function world(config: object | null = { skills: [SKILL] }, skills: string[] = [SKILL]): { dataRoot: string; env: Record<string, string>; cleanup: () => void } {
  const dataRoot = mkdtempSync(join(tmpdir(), 'symbiont-trial-data-'))
  const home = mkdtempSync(join(tmpdir(), 'symbiont-trial-home-'))
  for (const s of skills) {
    mkdirSync(join(home, 'skills', s), { recursive: true })
    writeFileSync(join(home, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n# ${s}\n`)
  }
  if (config) writeFileSync(join(dataRoot, TRIAL_FILE), JSON.stringify(config))
  return {
    dataRoot,
    env: { CLAUDE_CONFIG_DIR: home },
    cleanup: () => {
      rmrf(dataRoot, { recursive: true, force: true })
      rmrf(home, { recursive: true, force: true })
    },
  }
}

/** id сессии, которая попадает в нужную группу при доле 0.15. */
function sidFor(arm: 'delivered' | 'withheld', from = 0, skill = SKILL): string {
  for (let i = from; ; i++) if (trialArm(`s-${i}`, skill, 0.15) === arm) return `s-${i}`
}

const NOW = new Date('2026-11-22T10:00:00Z')
const start = (dataRoot: string, env: Record<string, string>, sessionId: string, extra: object = {}) =>
  startSkillTrial(dataRoot, { sessionId, source: 'startup', transcriptPath: null, host: 'claude', now: NOW, env, ...extra })

const rowOf = (dataRoot: string, sid: string, skill = SKILL): Record<string, unknown> | null => {
  if (!existsSync(join(dataRoot, TRIAL_DB))) return null
  const db = openDb(join(dataRoot, TRIAL_DB))
  try {
    return db.query('SELECT * FROM skill_trial WHERE session_id=? AND skill=?').get(sid, skill) as Record<string, unknown> | null
  } finally {
    db.close()
  }
}

/** Временно выставить переменные окружения процесса. */
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('конфиг', () => {
  it('нет файла, битый файл, пустой список — замера нет', () => {
    const w = world(null)
    expect(readTrialConfig(w.dataRoot)).toBeNull()
    writeFileSync(join(w.dataRoot, TRIAL_FILE), '{не json')
    expect(readTrialConfig(w.dataRoot)).toBeNull()
    writeFileSync(join(w.dataRoot, TRIAL_FILE), JSON.stringify({ skills: [] }))
    expect(readTrialConfig(w.dataRoot)).toBeNull()
    w.cleanup()
  })

  it('доля по умолчанию 0.15, зажата в [0, 0.5]; чужие имена отброшены; навыков не больше MAX_SKILLS', () => {
    const w = world({ skills: [SKILL, '../evil', SKILL], holdout: 0.9 })
    expect(readTrialConfig(w.dataRoot)).toEqual({ skills: [SKILL], holdout: 0.5 })
    writeFileSync(join(w.dataRoot, TRIAL_FILE), JSON.stringify({ skills: ['a', 'b', 'c', 'd', 'e'] }))
    const cfg = readTrialConfig(w.dataRoot)
    expect(cfg?.holdout).toBe(0.15)
    expect(cfg?.skills.length).toBe(MAX_SKILLS)
    w.cleanup()
  })

  it('конфиг с BOM (Windows PowerShell 5.1) читается', () => {
    const w = world(null)
    writeFileSync(join(w.dataRoot, TRIAL_FILE), `${String.fromCharCode(0xfeff)}{"skills":["${SKILL}"]}`)
    expect(readTrialConfig(w.dataRoot)?.skills).toEqual([SKILL])
    w.cleanup()
  })
})

describe('группа', () => {
  it('детерминирована, доля около заданной, при доле 0 — всегда подача', () => {
    expect(trialArm('abc', SKILL, 0.15)).toBe(trialArm('abc', SKILL, 0.15))
    let withheld = 0
    for (let i = 0; i < 4000; i++) if (trialArm(`id-${i}`, SKILL, 0.15) === 'withheld') withheld++
    expect(withheld / 4000).toBeGreaterThan(0.12)
    expect(withheld / 4000).toBeLessThan(0.18)
    expect(trialArm('abc', SKILL, 0)).toBe('delivered')
  })
})

describe('начало сессии', () => {
  it('группа «подано»: указание вызвать навык инструментом Skill; сжатие — та же группа', () => {
    const w = world()
    const sid = sidFor('delivered')
    const first = start(w.dataRoot, w.env, sid)
    expect(first.context).toContain(SKILL)
    expect(first.context).toContain('Skill')
    expect(first.notice).toContain('идёт замер') // первая еженедельная строка — подтверждение, что замер работает
    expect(first.context).not.toContain('идёт замер') // модели ход замера не подаётся
    expect(start(w.dataRoot, w.env, sid, { source: 'compact' }).context).toBe(first.context)
    w.cleanup()
  })

  it('ход замера — владельцу раз в неделю, пока нет вердикта', () => {
    const w = world()
    const at = (iso: string, sid: string) => startSkillTrial(w.dataRoot, { sessionId: sid, source: 'startup', transcriptPath: null, host: 'claude', now: new Date(iso), env: w.env })
    expect(at('2026-11-22T10:00:00Z', sidFor('delivered')).notice).toContain('идёт замер')
    expect(at('2026-11-25T10:00:00Z', sidFor('delivered', 300)).notice).toBe('') // та же неделя
    expect(at('2026-11-29T10:00:00Z', sidFor('withheld')).notice).toContain('идёт замер') // через 7 дней, и в контроле
    w.cleanup()
  })

  it('контрольная группа молчит, но сессия записана в выборку; resume и сжатие её не перекладывают', () => {
    const w = world()
    const sid = sidFor('withheld')
    expect(start(w.dataRoot, w.env, sid).context).toBe('')
    expect(rowOf(w.dataRoot, sid)?.arm).toBe('withheld')
    writeFileSync(join(w.dataRoot, TRIAL_FILE), JSON.stringify({ skills: [SKILL], holdout: 0.5 }))
    expect(start(w.dataRoot, w.env, sid, { source: 'resume' }).context).toBe('')
    expect(start(w.dataRoot, w.env, sid, { source: 'compact' }).context).toBe('')
    w.cleanup()
  })

  it('форк и возобновлённая сессия без записи получают навык, но в выборку не идут', () => {
    const w = world()
    const sid = sidFor('withheld') // даже id «контрольной» группы: записи нет — группы нет
    expect(start(w.dataRoot, w.env, sid, { source: 'fork' }).context).toContain(SKILL)
    expect(start(w.dataRoot, w.env, sid, { source: 'resume' }).context).toContain(SKILL)
    expect(rowOf(w.dataRoot, sid)).toBeNull()
    w.cleanup()
  })

  it('фоновая сессия (sdk-cli) не трогается; исключение для живой проверки — SYMBIONT_TRIAL_HEADLESS', () => {
    const w = world()
    const sid = sidFor('delivered')
    expect(start(w.dataRoot, { ...w.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, sid).context).toBe('')
    expect(rowOf(w.dataRoot, sid)).toBeNull()
    expect(start(w.dataRoot, { ...w.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }, sid).context).toContain(SKILL)
    const other = sidFor('delivered', 500)
    expect(start(w.dataRoot, { ...w.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', SYMBIONT_TRIAL_HEADLESS: '1' }, other).context).toContain(SKILL)
    w.cleanup()
  })

  it('без навыка в личных навыках и в Codex — молчание и без записи', () => {
    const w = world()
    const sid = sidFor('delivered')
    expect(start(w.dataRoot, { CLAUDE_CONFIG_DIR: join(w.dataRoot, 'нет') }, sid).context).toBe('')
    expect(start(w.dataRoot, w.env, sid, { host: 'codex' }).context).toBe('')
    expect(rowOf(w.dataRoot, sid)).toBeNull()
    w.cleanup()
  })

  it('holdout 0 — замер окончен: навык всем, база не создаётся', () => {
    const w = world({ skills: [SKILL], holdout: 0 })
    expect(start(w.dataRoot, w.env, sidFor('withheld')).context).toContain(SKILL)
    expect(existsSync(join(w.dataRoot, TRIAL_DB))).toBe(false)
    w.cleanup()
  })
})

const user = (content: string, extra: object = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra })
const skillCall = (skill: string) => JSON.stringify({ type: 'assistant', message: { id: `m-${skill}`, content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } })
const answer = (id: string, out: number) =>
  JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: out } } })
const zero = () => ({ ownerMsgs: 0, corrections: 0, invoked: false, tokensIn: 0, tokensOut: 0, seen: [] as string[] })

describe('признаки сессии', () => {
  it('словарь: слова — с обеих границ, основы — слева; «ошибка в логах» не поправка', () => {
    for (const s of ['нет, это не то, переделай', 'Опять сломал сборку', "that's not what I asked", 'неправильно посчитано', 'неверный путь', 'всё сломалось', 'откатить это', 'it is broken', 'переделывай']) {
      expect(isCorrection(s)).toBe(true)
    }
    for (const s of ['в логах ошибка, посмотри', 'нетоварный вид', 'сделай отчёт', 'потом откроем']) expect(isCorrection(s)).toBe(false)
  })

  it('сообщение владельца любой формы считается; результат инструмента — нет; словарь — только по короткому тексту', () => {
    const arr = (content: object[]) => JSON.stringify({ type: 'user', message: { role: 'user', content } })
    const c = applyTrialLines(
      zero(),
      [
        arr([{ type: 'image', source: {} }, { type: 'text', text: 'опять не то на скриншоте' }]),
        arr([{ type: 'tool_result', tool_use_id: 'x', content: 'не то' }]),
        user(`${'длинный вставленный текст '.repeat(100)} не то`),
      ],
      SKILL,
    )
    expect(c.ownerMsgs).toBe(2) // картинка с текстом и длинное сообщение
    expect(c.corrections).toBe(1) // длинное в словарь не идёт
  })

  it('сессии IDE — живые; фоновые sdk-* — нет; при holdout 0 Stop не пишет', () => {
    expect(isInteractive({ CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' })).toBe(true)
    expect(isInteractive({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' })).toBe(false)
    expect(isInteractive({})).toBe(true)
    const w = world()
    start(w.dataRoot, w.env, sidFor('delivered'))
    expect(trialActive(w.dataRoot)).toBe(true)
    writeFileSync(join(w.dataRoot, TRIAL_FILE), JSON.stringify({ skills: [SKILL], holdout: 0 }))
    expect(trialActive(w.dataRoot)).toBe(false)
    w.cleanup()
  })

  it('сообщения владельца, вызов навыка моделью, токены без удвоения по id; служебное не считается', () => {
    const c = applyTrialLines(
      zero(),
      [
        user('сделай отчёт'),
        user('<command-name>/clear</command-name>'),
        user('служебное', { isMeta: true }),
        user('сабагент', { isSidechain: true }),
        skillCall(SKILL),
        answer('a1', 50),
        answer('a1', 50), // та же запись ответа второй раз
        user('опять не то'),
        '{битая',
      ],
      SKILL,
    )
    expect(c).toMatchObject({ ownerMsgs: 2, corrections: 1, invoked: true, tokensIn: 1110, tokensOut: 50 })
  })

  it('команда владельца и одноимённый навык плагина вызовом модели не считаются', () => {
    const c = applyTrialLines(zero(), [user('<command-name>/flight-protocol</command-name>'), skillCall(`some-plugin:${SKILL}`)], SKILL)
    expect(c.invoked).toBe(false)
    expect(c.ownerMsgs).toBe(0)
  })

  it('Stop дочитывает со смещения: повторный вызов не удваивает, новые строки добавляются', () => {
    const w = world()
    const sid = sidFor('delivered')
    start(w.dataRoot, w.env, sid)
    const tr = join(w.dataRoot, 't.jsonl')
    writeFileSync(tr, `${user('первое')}\n${answer('a1', 5)}\n`)
    accountSkillTrial(w.dataRoot, sid, tr, 0)
    accountSkillTrial(w.dataRoot, sid, tr, 0)
    appendFileSync(tr, `${user('не то')}\n${skillCall(SKILL)}\n`)
    accountSkillTrial(w.dataRoot, sid, tr, 2)
    expect(rowOf(w.dataRoot, sid)).toMatchObject({ owner_msgs: 2, corrections: 1, invoked: 1, tokens_out: 5, unverified: 2 })
    w.cleanup()
  })

  it('другой файл транскрипта у той же сессии — учёт с начала, смещение старого не применяется', () => {
    const w = world()
    const sid = sidFor('delivered')
    start(w.dataRoot, w.env, sid)
    const a = join(w.dataRoot, 'a.jsonl')
    const b = join(w.dataRoot, 'b.jsonl')
    writeFileSync(a, `${user('раз')}\n${user('два')}\n${user('три')}\n`)
    accountSkillTrial(w.dataRoot, sid, a, 0)
    writeFileSync(b, `${user('один')}\n${user('другой файл длиннее прежнего, чтобы смещение в нём существовало')}\n${user('ещё')}\n${user('и ещё')}\n`)
    accountSkillTrial(w.dataRoot, sid, b, 0)
    expect(rowOf(w.dataRoot, sid)?.owner_msgs).toBe(4)
    w.cleanup()
  })

  it('без конфига Stop ничего не создаёт', () => {
    const w = world(null)
    const tr = join(w.dataRoot, 't.jsonl')
    writeFileSync(tr, `${user('x')}\n`)
    accountSkillTrial(w.dataRoot, 'sid', tr, 0)
    expect(existsSync(join(w.dataRoot, TRIAL_DB))).toBe(false)
    w.cleanup()
  })
})

let clock = 0
/** Строка выборки; время начала растёт по порядку создания. */
const row = (arm: 'delivered' | 'withheld', corrections: number, invoked = true): TrialRow => ({
  arm,
  startedAt: new Date(Date.UTC(2026, 9, 1) + clock++ * 60_000).toISOString(),
  finished: true,
  ownerMsgs: 10,
  corrections,
  invoked,
  tokensIn: 100_000,
  tokensOut: 5_000,
  unverified: 0,
})
/** Перемешать группы по времени, как в жизни: на каждые k поданных — одна контрольная. */
function interleave(delivered: (i: number) => number, withheld: (i: number) => number, nW: number, k = 4): TrialRow[] {
  const out: TrialRow[] = []
  for (let i = 0; i < nW; i++) {
    for (let j = 0; j < k; j++) out.push(row('delivered', delivered(i * k + j)))
    out.push(row('withheld', withheld(i)))
  }
  return out
}

const kindOf = (rows: TrialRow[], decided = new Map()) => trialVerdict(rows, decided).verdict.kind

describe('вердикт', () => {
  it('мало контрольных — ждём', () => {
    expect(kindOf(interleave(() => 0, () => 5, MIN_CONTROL - 1))).toBe('pending')
  })

  it('ранний сигнал — по первым поданным, поздние вызовы его не отменяют', () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => row('delivered', 1, i < 3)), ...Array.from({ length: 30 }, () => row('delivered', 1, true))]
    const v = trialVerdict(rows).verdict
    expect(v.kind).toBe('not-invoked')
    expect(v.invokedShare).toBe(0.3)
    expect(renderVerdict(SKILL, v)).toContain(TRIAL_DB) // подсказка, как начать замер заново
  })

  it('поправок с навыком явно меньше — помогает; больше — мешает', () => {
    expect(kindOf(interleave((i) => i % 2, (i) => 3 + (i % 3), MIN_CONTROL))).toBe('helps')
    expect(kindOf(interleave((i) => 3 + (i % 3), (i) => i % 2, MIN_CONTROL))).toBe('hurts')
  })

  it('между точками вердикт не пересматривается: на 20 ничьей, разница после — ждём 40', () => {
    // первые 20 контрольных — как поданные, следующие 10 — резко хуже
    const rows = interleave((i) => i % 3, (i) => (i < MIN_CONTROL ? i % 3 : 9), 30)
    expect(kindOf(rows)).toBe('pending')
  })

  it('разницы нет: на MAX_CONTROL — «не различимо»', () => {
    expect(kindOf(interleave((i) => i % 3, (i) => i % 3, MAX_CONTROL))).toBe('unclear')
  })

  it('точка судит поданных только своего периода', () => {
    // все поданные — после 20-й контрольной: в первой точке их нет вовсе
    const rows = [...Array.from({ length: MIN_CONTROL }, (_, i) => row('withheld', i % 3)), ...Array.from({ length: 80 }, () => row('delivered', 0))]
    expect(kindOf(rows)).toBe('pending')
  })

  it('точка ждёт конца всех сессий своего периода, а решённая — не пересматривается', () => {
    const rows = interleave((i) => i % 2, (i) => 3 + (i % 3), MIN_CONTROL)
    rows[3] = { ...rows[3], finished: false } // одна из ранних поданных ещё идёт
    const waiting = trialVerdict(rows)
    expect(waiting.verdict.kind).toBe('pending')
    expect(waiting.decided.length).toBe(0) // ни ранний сигнал (она среди первых 10), ни точка 20 не готовы
    rows[3] = { ...rows[3], finished: true }
    const done = trialVerdict(rows)
    expect(done.verdict.kind).toBe('helps')
    // запись точки сильнее новых данных: те же точки, но контроль стал как поданные
    const decided = new Map(done.decided)
    const flipped = rows.map((r) => (r.arm === 'withheld' ? { ...r, corrections: 0 } : r))
    expect(kindOf(flipped, decided)).toBe('helps')
  })

  it('редкие поправки: нули в контроле не дают ложного «мешает»', () => {
    // 5% сессий с одной поправкой у поданных, в контроле — ни одной
    expect(kindOf(interleave((i) => (i % 20 === 0 ? 1 : 0), () => 0, MIN_CONTROL))).toBe('pending')
  })

  it('перестановочный тест воспроизводится и различает явную разницу', () => {
    const a = [0, 1, 0, 1, 0, 0, 1, 0, 0, 1]
    const b = [3, 2, 4, 3, 5, 3, 4, 2, 3, 4]
    expect(permutationP(a, b)).toBe(permutationP(a, b))
    expect(permutationP(a, b)).toBeLessThan(0.01)
    expect(permutationP([1, 0, 1, 0], [0, 1, 0, 1])).toBeGreaterThan(0.5)
  })
})

/** Записать в выборку законченные сессии. */
function seed(dataRoot: string, rows: TrialRow[], skill = SKILL): void {
  start(dataRoot, {}, '__init__', { host: 'codex' }) // ничего не делает; база создаётся ниже
  const db = openDb(join(dataRoot, TRIAL_DB))
  db.run(
    `CREATE TABLE IF NOT EXISTS skill_trial(session_id TEXT NOT NULL, skill TEXT NOT NULL, arm TEXT NOT NULL,
      started_at TEXT NOT NULL, transcript TEXT, byte_offset INTEGER NOT NULL DEFAULT 0,
      owner_msgs INTEGER NOT NULL DEFAULT 0, corrections INTEGER NOT NULL DEFAULT 0, invoked INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, unverified INTEGER NOT NULL DEFAULT 0,
      seen TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, PRIMARY KEY(session_id, skill))`,
  )
  const ins = db.query(
    'INSERT INTO skill_trial(session_id, skill, arm, started_at, owner_msgs, corrections, invoked, tokens_in, tokens_out, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  )
  rows.forEach((r, i) => ins.run(`old-${skill}-${i}`, skill, r.arm, r.startedAt, r.ownerMsgs, r.corrections, r.invoked ? 1 : 0, r.tokensIn, r.tokensOut, '2026-11-01T00:00:00Z'))
  db.close()
}

const helps = (): TrialRow[] => interleave((i) => i % 2, (i) => 3 + (i % 3), MIN_CONTROL)

describe('вердикт приходит сам', () => {
  it('владельцу — раз в день; модели — только в сессии с подачей', () => {
    const w = world()
    seed(w.dataRoot, helps())
    const first = start(w.dataRoot, w.env, sidFor('delivered'))
    expect(first.notice).toContain(SKILL)
    expect(first.notice).toContain('реже')
    expect(first.context).toContain('holdout') // модель знает, что править по слову владельца
    expect(start(w.dataRoot, w.env, sidFor('delivered', 1000)).notice).toBe('') // тот же день
    const nextDay = startSkillTrial(w.dataRoot, { sessionId: sidFor('withheld'), source: 'startup', transcriptPath: null, host: 'claude', now: new Date('2026-11-23T10:00:00Z'), env: w.env })
    expect(nextDay.notice).toContain('реже')
    expect(nextDay.context).toBe('') // контрольная сессия: модели ни слова о навыке
    w.cleanup()
  })

  it('вердикт одного навыка не попадает модели в сессии, где этот навык удержан', () => {
    const other = 'other-skill'
    const w = world({ skills: [SKILL, other] }, [SKILL, other])
    seed(w.dataRoot, helps(), other)
    let sid = ''
    for (let i = 0; !sid; i++) if (trialArm(`m-${i}`, SKILL, 0.15) === 'delivered' && trialArm(`m-${i}`, other, 0.15) === 'withheld') sid = `m-${i}`
    const s = start(w.dataRoot, w.env, sid)
    expect(s.context).toContain(SKILL)
    expect(s.context).not.toContain(other)
    expect(s.notice).toContain(other) // владелец видит
    w.cleanup()
  })

  it('/sym-status: ход замера, окончание при holdout 0, пропавший файл навыка', () => {
    const w = world()
    seed(w.dataRoot, [row('delivered', 1), row('withheld', 2)])
    expect(renderTrialStatus(w.dataRoot, NOW, w.env)).toContain(`${MIN_CONTROL}`)
    writeFileSync(join(w.dataRoot, TRIAL_FILE), JSON.stringify({ skills: [SKILL], holdout: 0 }))
    expect(renderTrialStatus(w.dataRoot, NOW, w.env)).toContain('holdout 0')
    expect(renderTrialStatus(w.dataRoot, NOW, { CLAUDE_CONFIG_DIR: join(w.dataRoot, 'нет') })).toContain('нет')
    w.cleanup()
  })
})

describe('SessionStart целиком', () => {
  const LEGACY = 'function f(_oX) {\n    var sName = _oX.n;\n    var aList = [];\n    return aList;\n}\n'

  it('указание стоит ДО паспорта и укладывается в лимит вместе с ним', () => {
    const w = world()
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-trial-proj-'))
    for (let i = 0; i < 6; i++) writeFileSync(join(proj, `m${i}.js`), LEGACY.repeat(12))
    withEnv({ CLAUDE_CONFIG_DIR: w.env.CLAUDE_CONFIG_DIR, SYMBIONT_HOST: 'claude', CLAUDE_CODE_ENTRYPOINT: 'cli' }, () => {
      const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: sidFor('delivered') }, w.dataRoot)
      const ctx = out.hookSpecificOutput?.additionalContext ?? ''
      const directive = ctx.indexOf(SKILL)
      expect(directive).toBeGreaterThanOrEqual(0)
      expect(ctx.indexOf('только var')).toBeGreaterThan(directive)
      expect(ctx.length).toBeLessThanOrEqual(9_500)
    })
    rmrf(proj, { recursive: true, force: true })
    w.cleanup()
  })

  it('пустой проект: указание есть; в контрольной сессии — только вердикт владельцу', () => {
    const w = world()
    seed(w.dataRoot, helps())
    const proj = mkdtempSync(join(tmpdir(), 'symbiont-trial-empty-'))
    withEnv({ CLAUDE_CONFIG_DIR: w.env.CLAUDE_CONFIG_DIR, SYMBIONT_HOST: 'claude', CLAUDE_CODE_ENTRYPOINT: 'cli' }, () => {
      const ctrl = handleSessionStart({ cwd: proj, source: 'startup', session_id: sidFor('withheld') }, w.dataRoot)
      expect(ctrl.hookSpecificOutput).toBeUndefined()
      expect(ctrl.systemMessage ?? '').toContain('реже')
      const out = handleSessionStart({ cwd: proj, source: 'startup', session_id: sidFor('delivered') }, w.dataRoot)
      expect(out.hookSpecificOutput?.additionalContext ?? '').toContain(SKILL)
    })
    rmrf(proj, { recursive: true, force: true })
    w.cleanup()
  })

  it('худший случай указания (MAX_SKILLS навыков с вердиктами) — поле в лимите вместе с толстым паспортом и хвостом', () => {
    const names = ['flight-protocol-long-name-a', 'flight-protocol-long-name-b', 'flight-protocol-long-name-c'].slice(0, MAX_SKILLS)
    const v = trialVerdict(interleave((i) => i % 2, (i) => 3 + (i % 3), MIN_CONTROL)).verdict
    const directive = renderDirective(names, names.map((n) => renderVerdict(n, v)), 'C:/Users/somebody/.claude/plugins/data/symbiont-symbiont-market/session-skills.json')
    expect(directive.length).toBeLessThan(3_500)
    const passport = `# П\n\n## Законы\n\n${Array.from({ length: 400 }, (_, i) => `- правило номер ${i} с пояснением`).join('\n')}\n`
    const tail = `\n## Состояние\n\n${Array.from({ length: 120 }, (_, i) => `- строка состояния ${i}`).join('\n')}\n`
    const out = composeContext(passport, tail, '\n_футер_', 'C:/p/S.md', () => 1, directive.length)
    expect(directive.length + out.length).toBeLessThanOrEqual(9_500)
  })
})
