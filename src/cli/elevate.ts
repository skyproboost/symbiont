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

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))
const dbPath = join(dataDir, 'passport.db')
const args = stripDataFlag(process.argv.slice(2))
const verb = args.find((a) => /^(отклонить|принять|решения)$/.test(a)) ?? ''

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
    console.log('Паспорт не построен — решений быть не может.')
  } else {
    const db = openDb(dbPath, { readonly: true })
    console.log(renderVerdicts(readVerdicts(db)))
    db.close()
  }
} else if (verb === 'отклонить' || verb === 'принять') {
  const idx = Number(args[args.indexOf(verb) + 1])
  const proposals = lastProposals()
  const p = Number.isFinite(idx) ? proposals[idx - 1] : undefined
  if (!p) {
    console.log(`Нет предложения №${args[args.indexOf(verb) + 1] ?? '?'} в последнем прогоне (их ${proposals.length}). Сначала прогоните аудит.`)
  } else if (!existsSync(dbPath)) {
    console.log('Паспорт не построен — записывать решение некуда.')
  } else {
    const reason = args.slice(args.indexOf(verb) + 2).join(' ').trim()
    if (verb === 'отклонить' && !reason) {
      console.log('Отклонение без причины бесполезно: именно причина уходит в следующий аудит. Напишите её после номера.')
    } else {
      const db = openDb(dbPath)
      recordVerdict(db, { verdict: verb === 'отклонить' ? 'отклонено' : 'принято', axis: p.axis, observation: p.observation, reason })
      db.close()
      console.log(`Записано: ${verb === 'отклонить' ? '✗ отклонено' : '✓ принято'} — [${p.axis}] ${p.observation.slice(0, 100)}`)
      console.log('Следующий аудит это учтёт и не повторит тот же довод без нового основания.')
    }
  }
} else {
  // порог уверенности можно задать аргументом: /sym-elevate 80
  const threshold = Number(args.find((a) => /^\d+$/.test(a))) || 70

  console.log('Symbiont · возвышение · глубокий аудит проекта (один LLM-проход)…')
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
  for (const a of attempts) console.log(`  проба ${a.model}: ${a.ok ? '✓' : '✗'} · ${Math.round(a.ms / 1000)}с · ${a.note}`)
  console.log(`  порог уверенности: ${threshold} · ${sec}с\n`)
  console.log(renderProposals(r))
  if (r.proposals.length > 0) {
    console.log('\nРешение записывается командой: /symbiont:elevate отклонить N причина… (или «принять N»).')
    console.log('Записанное уходит в следующий аудит — отклонённый довод не вернётся без нового основания.')
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
