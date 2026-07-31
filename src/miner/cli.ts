import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { walkFiles, codeFiles } from './walk'
import { analyzeFile, aggregate, type FileObservation } from './analyze'
import { deriveFacts, type Fact } from './facts'

const root = resolve(process.argv[2] ?? '.')

const t0 = performance.now()
const all = walkFiles(root)
const code = codeFiles(all)

const observations: FileObservation[] = []
for (const f of code) {
  let content: string
  try {
    content = readFileSync(f.path, 'utf8')
  } catch {
    continue
  }
  observations.push(analyzeFile(f.path, f.ext, content))
}

const agg = aggregate(observations, all.map((f) => f.ext))
const facts = deriveFacts(agg)
const ms = Math.round(performance.now() - t0)

const pct = (f: Fact) => `${Math.round(f.prevalence * 100)}%`
const line = (f: Fact) => `  • [${f.area}] ${f.statement} — ${f.positive}/${f.total} (${pct(f)})`

console.log(`\nSymbiont miner · слой 0 · ${root}`)
console.log(`Файлов всего: ${all.length}, кодовых: ${observations.length}, строк кода: ${agg.totalLines}, время: ${ms}мс\n`)

const byTier = (tier: Fact['tier']) => facts.filter((f) => f.tier === tier)

const sections: Array<[string, Fact[]]> = [
  ['◆ ЗАКОНЫ (≥95%, компилируются в гейты)', byTier('закон')],
  ['◆ ПРИВЫЧКИ (70–95%, подаются фактами)', byTier('привычка')],
  ['◆ ГИПОТЕЗЫ (55–70%, спят до подтверждений)', byTier('гипотеза')],
  ['◆ НЕТ КОНСЕНСУСА (<55%, смешанный стиль)', byTier('нет консенсуса')],
]
for (const [title, list] of sections) {
  if (list.length === 0) continue
  console.log(title)
  for (const f of list) console.log(line(f))
  console.log('')
}

const topExt = Object.entries(agg.extHist)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([e, n]) => `${e}:${n}`)
  .join('  ')
console.log(`◆ СТРУКТУРА\n  ${topExt}\n`)
