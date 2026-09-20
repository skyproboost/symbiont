/**
 * Незаякоренная проверка находок возвышения.
 *
 * Боль, из которой это выросло. Состязательная проверка жила ОДНОЙ СТРОКОЙ
 * внутри того же промпта: «каждое предложение сначала попробуй опровергнуть».
 * Проверяющий при этом видел собственное рассуждение, которым находку и
 * породил, — и закономерно с ним соглашался. Поле `survives` приходило `true`
 * почти всегда: самопроверка внутри одного контекста измеряет связность
 * рассказа, а не истинность находки.
 *
 * Что меняется. Находки уходят во ВТОРОЙ вызов, который получает только
 * заземление (паспорт, стек, оси) и сам список — но НЕ рассуждение, которым
 * находки получены. Проверяющий не может согласиться «по инерции»: ему нечего
 * подтверждать, он обязан вынести суждение сам. Первый проход отдаёт
 * `refutation` в текст ответа, но до `Proposal` это поле не доживает
 * (`parseProposals` его не переносит) — поэтому утечки рассуждения нет по
 * устройству, а не по договорённости.
 *
 * Почему пакетом, а не по находке. Проверка каждой находки отдельным вызовом
 * стоила бы +N вызовов на самой дорогой команде. Один вызов на весь список
 * даёт ту же независимость от первого прохода при цене +1.
 *
 * Почему fail-open. Проверка УТОЧНЯЕТ результат, а не производит его. Сбой
 * модели, обрыв сети, мусор в ответе — находки первого прохода остаются как
 * есть: потерять верную находку из-за недоступности проверяющего хуже, чем
 * показать её непроверенной. Ровно так же ведёт себя `--ground`.
 */
import { documentsBlock, jsonOnly } from '../layer2/prompt'
import type { LlmCaller } from '../layer2/llm'
import type { ElevateContext, Proposal } from './engine'

export type ChallengeVerdict = 'оставить' | 'снять'

export interface ChallengeRow {
  n: number
  verdict: ChallengeVerdict
  /** Уверенность проверяющего; отсутствует — уверенность первого прохода сохраняется */
  confidence?: number
  why: string
}

export interface ChallengeOutcome {
  proposals: Proposal[]
  /** Сколько находок проверяющий снял; 0 при недоступности проверки */
  cut: number
  /** Проверка реально состоялась (ответ разобран), а не деградировала в no-op */
  applied: boolean
}

/**
 * Промпт проверяющего. Сознательно НЕ содержит рассуждения первого прохода, его
 * опровержений и формулировки его принципов: иначе проверка снова станет
 * проверкой связности рассказа.
 *
 * Но улики подаются ТЕ ЖЕ — паспорт, стек, оси и фрагменты файлов. Разница
 * между «не вижу хода мысли» и «не вижу материала» решающая: первый прогон на
 * живой модели подавал проверяющему только паспорт, и он снял все находки до
 * единой с одним и тем же основанием — «кода в заземлении нет, подтвердить
 * нельзя». Он был прав, а проверка при этом превращалась из фильтра в глушитель:
 * судья, осведомлённый хуже обвинителя, обязан оправдывать всё подряд.
 */
export function buildChallengePrompt(proposals: Proposal[], ctx: ElevateContext): string {
  const st = ctx.stack
  const stackLine = [
    st.frameworks.length ? `фреймворки: ${st.frameworks.join(', ')}` : '',
    st.infra.length ? `инфра: ${st.infra.join(', ')}` : '',
    st.domains.length ? `направления: ${st.domains.join(', ')}` : '',
  ].filter(Boolean).join(' · ')

  const findings = proposals
    .map((p, i) => [
      `${i + 1}. ось: ${p.axis} · охват: ${p.scope}`,
      `   наблюдение: ${p.observation}`,
      `   предложение: ${p.proposal}`,
    ].join('\n'))
    .join('\n')

  // Оси, по которым реально пришли находки: без определения оси судить
  // «относится ли находка к этой оси» не на чем, а весь список осей — лишний вес
  const usedAxes = new Set(proposals.map((p) => p.axis))
  const axesBlock = ctx.rubric
    .filter((a) => usedAxes.has(a.axis))
    .map((a) => `- ${a.axis} — ${a.lens}`)
    .join('\n')

  return [
    'Ты — независимый проверяющий. Ниже — находки аудита этого проекта, сделанные ДРУГИМ аудитором, рассуждения которого тебе не показаны и не будут показаны.',
    'Материал у тебя тот же, что был у него: паспорт, стек, оси и фрагменты файлов. Не показан только ход его мысли — суждение выноси своё.',
    'ВАЖНО: НЕ используй инструменты и НЕ читай файлы — весь доступный контекст приведён ниже. Ответь напрямую JSON-ом за один ход.',
    '',
    '## Паспорт проекта (выведен системой из кода)',
    ctx.summary.slice(0, 4000),
    '',
    stackLine ? `## Обнаруженный стек\n${stackLine}` : '',
    axesBlock ? `\n## Оси, по которым сделаны находки\n${axesBlock}` : '',
    '',
    '## Фрагменты самых связных файлов',
    documentsBlock(ctx.samples),
    '',
    '## Находки на проверку',
    findings,
    '',
    '## Как судить',
    '- «снять» — если находка ссылается на код, которого в приведённых фрагментах нет (материал у аудитора был тот же, значит подробность выдумана); если причина кода правдоподобно иная (намеренное решение, легаси-зона, внешнее требование); если это общая best-practice, а не свойство ЭТОГО проекта.',
    '- «оставить» — если находка следует из заземления и остаётся верной при попытке объяснить код иначе.',
    '- Согласие по умолчанию — брак работы. Если оснований судить не хватает, это «снять», а не «оставить»: ложная уверенность дороже пропуска.',
    '- Своя уверенность обязательна и должна быть калиброванной: не переноси чужую.',
    '',
    jsonOnly('[{"n":1,"verdict":"оставить|снять","confidence":0-100,"why":"на чём основано суждение"}]'),
  ].filter((line) => line !== '').join('\n')
}

/** Строгий разбор вердиктов. Мусор = пустой список = проверка не состоялась. */
export function parseChallengeVerdicts(text: string, count: number): ChallengeRow[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []

    const out: ChallengeRow[] = []
    const seen = new Set<number>()
    for (const r of arr) {
      const n = typeof r?.n === 'number' ? Math.round(r.n) : NaN
      if (!Number.isFinite(n) || n < 1 || n > count || seen.has(n)) continue
      if (r?.verdict !== 'оставить' && r?.verdict !== 'снять') continue
      seen.add(n)
      const confidence = typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 100
        ? Math.round(r.confidence)
        : undefined
      out.push({ n, verdict: r.verdict, confidence, why: typeof r.why === 'string' ? r.why : '' })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Применяет вердикты к находкам.
 *
 * Находка без вердикта остаётся нетронутой: молчание проверяющего — не приговор.
 * Порядок не восстанавливается здесь — ранжирование принадлежит движку, который
 * знает веса охвата; иначе два места считали бы ранг по-разному.
 */
export function applyChallenge(proposals: Proposal[], rows: ChallengeRow[], threshold: number): ChallengeOutcome {
  if (rows.length === 0) return { proposals, cut: 0, applied: false }

  const byIndex = new Map(rows.map((r) => [r.n, r]))
  const kept: Proposal[] = []
  let cut = 0

  for (let i = 0; i < proposals.length; i++) {
    const source = proposals[i] as Proposal
    const row = byIndex.get(i + 1)
    if (!row) {
      kept.push(source)
      continue
    }
    if (row.verdict === 'снять') {
      cut++
      continue
    }
    const confidence = row.confidence ?? source.confidence
    if (confidence < threshold) {
      cut++
      continue
    }
    kept.push({ ...source, confidence })
  }

  return { proposals: kept, cut, applied: true }
}

/** Один вызов проверяющего над всем списком. Находок нет — вызова нет. */
export function challengeProposals(
  proposals: Proposal[],
  ctx: ElevateContext,
  caller: LlmCaller,
  threshold: number,
  dataDir?: string
): ChallengeOutcome {
  if (proposals.length === 0) return { proposals, cut: 0, applied: false }
  let res: ReturnType<LlmCaller>
  try {
    res = caller(buildChallengePrompt(proposals, ctx))
  } catch {
    return { proposals, cut: 0, applied: false }
  }

  // Сырой ответ на диск — снятая находка обязана быть объяснимой. Без этого
  // «проверка сняла 3» неотличимо от «проверяющий ответил мусором».
  if (dataDir) {
    try {
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      const { join } = require('node:path') as typeof import('node:path')
      writeFileSync(
        join(dataDir, 'elevate-challenge-last.json'),
        JSON.stringify({ at: new Date().toISOString(), judged: proposals.length, raw: res }, null, 1),
        'utf8'
      )
    } catch {
      /* диагностика необязательна */
    }
  }

  if (!res) return { proposals, cut: 0, applied: false }
  return applyChallenge(proposals, parseChallengeVerdicts(res.text, proposals.length), threshold)
}
