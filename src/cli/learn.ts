import { join } from 'node:path'
import { runVerbalize } from '../layer2/verbalize'
import { callClaudeDetailed, type LlmAttempt } from '../layer2/llm'
import { resolveDataRoot, migrateLegacyPassports } from '../core/data-root'
import { openDb } from '../core/db'
import { slugOf } from '../hooks/session-start-core'

const root = process.cwd()
const res = resolveDataRoot(join(import.meta.dirname, '..', '..', '.data'))
migrateLegacyPassports(res)
const dataDir = join(res.root, slugOf(root))

// Слой 1 (AST) — сперва добрать символьные факты: свежие законы уйдут в промпт слоя 2
try {
  const { runLayer1 } = await import('../layer1/run')
  const l1 = await runLayer1(root, dataDir)
  console.log(`Слой 1 (AST): разобрано ${l1.parsed} · из кэша ${l1.fromCache} · фактов ${l1.facts.length}${l1.asserted ? ' · журнал обновлён' : ''}`)
} catch {
  console.log('Слой 1 (AST): недоступен (нет грамматик) — пропущен')
}

console.log('Symbiont · вывод неписаных правил проекта (один проход модели)…')
const t0 = performance.now()
let attempts: LlmAttempt[] = []
const r = runVerbalize(root, dataDir, (prompt) => {
  const o = callClaudeDetailed(prompt, { intent: 'deep', dataDir }) // вербализация — критичный проход
  attempts = o.tried
  return o.result
})
const sec = Math.round((performance.now() - t0) / 1000)
for (const a of attempts) console.log(`  проба ${a.model}: ${a.ok ? '✓' : '✗'} · ${Math.round(a.ms / 1000)}с · ${a.note}`)

if (!r.model) {
  console.log('Не удалось: нет паспорта/графа или все модели цепочки недоступны.')
} else if (r.rules.length === 0) {
  console.log(`Модель ${r.model} за ${sec}с не вывела правил, прошедших строгий фильтр (≥3 подтверждения, валидный формат). Это честный ноль, не ошибка.`)
} else {
  console.log(`Модель ${r.model} · ${sec}с · выведено правил: ${r.rules.length}`)
  console.log(`Журнал: +${r.journal.born} новых · ${r.journal.updated} уточнено · ${r.journal.superseded} вытеснено`, '\n')
  for (const rule of r.rules) {
    console.log(`  [${rule.area}] ${rule.statement}`)
    console.log(`      подтверждения: ${rule.evidence.join(', ')} · уверенность ${rule.confidence}`)
  }
  if (r.merges.length > 0) {
    console.log(`\nСадовник: слито почти-дублей: ${r.merges.length}`)
    for (const m of r.merges) console.log(`  − «${m.removed.slice(0, 70)}…» → оставлен «${m.kept.slice(0, 70)}…»`)
  }
  console.log('\nLLM-правила рождаются «привычкой»/«гипотезой» — законом станут только через подтверждение статистикой.')
}

// Поправки владельца → правила-кандидаты (замыкание петли обучения)
{
  const { analyzeCorrections } = await import('../gardener/corrections')
  const { existsSync } = await import('node:fs')
  const dbPath = join(dataDir, 'passport.db')
  if (existsSync(dbPath)) {
    const db = openDb(dbPath)
    try {
      const c = analyzeCorrections(db, root, (prompt) => callClaudeDetailed(prompt, { intent: 'deep', dataDir }).result)
      if (c.analyzed > 0) {
        console.log(`\nПоправки владельца: проанализировано ${c.analyzed} · новых правил-кандидатов: ${c.born}`)
        for (const s of c.statements) console.log(`  + ${s}`)
      }
    } finally {
      db.close()
    }
  }
}
