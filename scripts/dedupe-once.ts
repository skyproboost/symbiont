// Разовый прогон садовника-дедупа по паспорту указанного проекта (отладка/обкатка)
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { dedupeLlmFacts } from '../src/gardener/dedupe'
import { slugOf } from '../src/hooks/session-start-core'

const slug = slugOf(process.argv[2] ?? process.cwd())
const db = openDb(join(import.meta.dirname, '..', '.data', slug, 'passport.db'))
const merges = dedupeLlmFacts(db)
console.log(`слито почти-дублей: ${merges.length}`)
for (const m of merges) console.log(`  − «${m.removed.slice(0, 65)}»\n    → «${m.kept.slice(0, 65)}»`)
const n = db
  .query("SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%'")
  .get() as { n: number }
console.log(`активных LLM-фактов осталось: ${n.n}`)
db.close()
