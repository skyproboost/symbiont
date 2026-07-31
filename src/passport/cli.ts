import { basename, join, resolve } from 'node:path'
import { buildPassport } from './build'
import { resolveDataRoot } from '../core/data-root'

const root = resolve(process.argv[2] ?? '.')
const slug = basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '..', '.data')).root, slug)

const t0 = performance.now()
const r = buildPassport(root, dataDir)
const ms = Math.round(performance.now() - t0)

console.log(`\nSymbiont passport · ${root} · ${ms}мс`)
console.log(`Факты:   ${r.factsExecuted ? 'пересчитаны' : 'из кэша (red-green — входы не менялись)'}`)
console.log(`Сводка:  ${r.summaryRebuilt ? 'пересобрана' : 'не тронута (early cutoff — факты те же)'}`)
console.log(`Журнал:  +${r.journal.born} новых · ${r.journal.updated} уточнено · ${r.journal.superseded} вытеснено`)
console.log(`Проекция: ${r.summaryPath}\n`)
