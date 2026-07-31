/**
 * CLI /sym-elevate: глубокий аудит возвышения проекта.
 * Явный дорогой проход (один LLM-вызов по цепочке фолбэков). Ничего не применяет.
 *
 * Два режима записи решения владельца — без них аудит безпамятен и предлагает
 * отклонённое снова каждый прогон (см. elevate/verdicts.ts):
 *   отклонить N причина…  ·  принять N  ·  решения (что аудит помнит)
 */
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { runElevate, renderProposals, parseProposals } from '../elevate/engine'
import { runGround } from '../elevate/ground'
import { recordVerdict, readVerdicts, renderVerdicts } from '../elevate/verdicts'
import { openDb } from '../core/db'
import { callClaudeDetailed, callClaudeWithTools, type LlmAttempt } from '../layer2/llm'
import { resolveDataRoot, migrateLegacyPassports, stripDataFlag, renderRootNotice } from '../core/data-root'
import { slugOf } from '../hooks/session-start-core'
import { initLang, t } from '../core/i18n'

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const dbPath = join(dataDir, 'passport.db')
initLang(dataDir, root)
const args = stripDataFlag(process.argv.slice(2))
// Ключевые слова принимаются на обоих языках. Описание команды живёт в статичном
// манифесте, который под язык владельца подстроиться не может в принципе, и
// потому объявлено по-английски — значит англоязычный владелец обязан мочь
// ВЫПОЛНИТЬ написанное там, а не только прочитать. Канон внутри остаётся
// русским: по нему уже записаны прошлые вердикты в журнале.
const VERB_ALIAS: Record<string, string> = { reject: 'отклонить', accept: 'принять', decisions: 'решения' }
const rawVerb = args.find((a) => /^(отклонить|принять|решения|reject|accept|decisions)$/.test(a)) ?? ''
const verb = VERB_ALIAS[rawVerb] ?? rawVerb

/** Предложения последнего прогона — по ним нумеруются вердикты. */
function lastProposals(): ReturnType<typeof parseProposals> {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'elevate-last.json'), 'utf8')) as { raw?: { text?: string } }
    return raw.raw?.text ? parseProposals(raw.raw.text, 0) : []
  } catch {
    return [] // прогона ещё не было — нумеровать нечего
  }
}

if (verb === 'решения') {
  if (!existsSync(dbPath)) {
    console.log(t('Паспорт не построен — решений быть не может.', 'The passport has not been built — there can be no decisions yet.'))
  } else {
    const db = openDb(dbPath, { readonly: true })
    console.log(renderVerdicts(readVerdicts(db)))
    db.close()
  }
} else if (verb === 'отклонить' || verb === 'принять') {
  const idx = Number(args[args.indexOf(rawVerb) + 1])
  const proposals = lastProposals()
  const p = Number.isFinite(idx) ? proposals[idx - 1] : undefined
  if (!p) {
    const n = args[args.indexOf(rawVerb) + 1] ?? '?'
    console.log(
      t(
        `Нет предложения №${n} в последнем прогоне (их ${proposals.length}). Сначала прогоните аудит.`,
        `There is no proposal #${n} in the last run (it had ${proposals.length}). Run the audit first.`,
      ),
    )
  } else if (!existsSync(dbPath)) {
    console.log(t('Паспорт не построен — записывать решение некуда.', 'The passport has not been built — there is nowhere to record the decision.'))
  } else {
    const reason = args.slice(args.indexOf(rawVerb) + 2).join(' ').trim()
    if (verb === 'отклонить' && !reason) {
      console.log(
        t(
          'Отклонение без причины бесполезно: именно причина уходит в следующий аудит. Напишите её после номера.',
          'A rejection without a reason is useless — the reason is what the next audit receives. Write it after the number.',
        ),
      )
    } else {
      const db = openDb(dbPath)
      recordVerdict(db, { verdict: verb === 'отклонить' ? 'отклонено' : 'принято', axis: p.axis, observation: p.observation, reason })
      db.close()
      const mark = verb === 'отклонить' ? t('✗ отклонено', '✗ rejected') : t('✓ принято', '✓ accepted')
      console.log(`${t('Записано', 'Recorded')}: ${mark} — [${p.axis}] ${p.observation.slice(0, 100)}`)
      console.log(
        t(
          'Следующий аудит это учтёт и не повторит тот же довод без нового основания.',
          'The next audit will take this into account and will not repeat the same argument without new grounds.',
        ),
      )
    }
  }
} else {
  // порог уверенности можно задать аргументом: /sym-elevate 80
  const threshold = Number(args.find((a) => /^\d+$/.test(a))) || 70

  console.log(t('Symbiont · возвышение · глубокий аудит проекта (один LLM-проход)…', 'Symbiont · elevation · deep project audit (a single LLM pass)…'))
  const rootNotice = renderRootNotice(res)
  if (rootNotice) console.log(rootNotice)
  const t0 = performance.now()
  let attempts: LlmAttempt[] = []
  const r = runElevate(root, dataDir, (prompt) => {
    const o = callClaudeDetailed(prompt, { intent: 'deep', dataDir }) // критичный проход — сильнейшая модель первой
    attempts = o.tried
    return o.result
  }, threshold)
  const sec = Math.round((performance.now() - t0) / 1000)
  for (const a of attempts) console.log(`  ${t('проба', 'attempt')} ${a.model}: ${a.ok ? '✓' : '✗'} · ${Math.round(a.ms / 1000)}${t('с', 's')} · ${a.note}`)
  console.log(`  ${t('порог уверенности', 'confidence threshold')}: ${threshold} · ${sec}${t('с', 's')}\n`)
  console.log(renderProposals(r))
  if (r.proposals.length > 0) {
    console.log(
      t(
        '\nРешение записывается командой: /symbiont:elevate отклонить N причина… (или «принять N»).',
        '\nRecord a decision with: /symbiont:elevate reject N reason… (or "accept N").',
      ),
    )
    console.log(
      t(
        'Записанное уходит в следующий аудит — отклонённый довод не вернётся без нового основания.',
        'What is recorded goes into the next audit — a rejected argument will not return without new grounds.',
      ),
    )
  }

  // Внешнее заземление (опционально, дорого): --ground
  if (args.includes('--ground') && r.proposals.length > 0) {
    const needs = r.proposals.map((p) => `${p.axis}: ${p.proposal}`).slice(0, 6)
    console.log('\n— Внешнее заземление (research + синтез с внутренним проекта; веб-инструменты)…')
    const g = runGround(root, needs, (prompt) => callClaudeWithTools(prompt, { intent: 'deep', dataDir }))
    if (g.model) {
      console.log(`\nЗаземление (модель ${g.model}):\n${g.text}`)
    } else {
      console.log('\nЗаземление недоступно (нет интернета/инструментов) — предложения выше стоят на априори модели.')
    }
  }
}
