/**
 * Замер рамки легитимности на настоящих проектах: какие направления объявляются
 * чувствительными и на каких уликах. Нужен, потому что вердикт «направление
 * заявлено» выносился по ОДНОМУ совпадению слова в 150 000 символов доков —
 * агрегатор записи на автомойки получил «медицина, финансы, право».
 *
 * Текст собирается той же функцией, что в passport/build.ts (frameCorpus),
 * иначе замер мерил бы не то, что подаётся.
 *
 * Запуск: bun run scripts/frame-sim.ts [--kept] <путь> [<путь> …]
 */
import { readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { walkFiles } from '../src/miner/walk'
import { ENTITY_EXT } from '../src/graph/entities'
import { readConceptText } from '../src/passport/profile'
import { compileFrame, deriveFrameCandidates, directionEvidence, frameCorpus, sensitiveDirections } from '../src/domains/frame'

const MAX_ENTITY_FILES = 5000

function frameTextOf(root: string): string {
  const walked = walkFiles(root)
  const allRel = walked.map((f) => relative(root, f.path).replaceAll('\\', '/'))
  const contents: string[] = []
  for (const f of walked.filter((w) => ENTITY_EXT.has(w.ext)).slice(0, MAX_ENTITY_FILES)) {
    try {
      const content = readFileSync(f.path, 'utf8')
      if (content.length <= 1_000_000) contents.push(content)
    } catch {
      /* исчез между обходом и чтением — в замер не входит */
    }
  }
  return frameCorpus(readConceptText(root, allRel), contents)
}

const verbose = process.argv.includes('--kept')

for (const arg of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const root = resolve(arg)
  const text = frameTextOf(root)
  const t0 = performance.now()
  const kept = compileFrame(deriveFrameCandidates(text)).kept
  const ms = Math.round(performance.now() - t0)
  console.log(`\n${basename(root)} · текст ${text.length} симв. · разбор ${ms} мс · заявлений продукта о себе: ${kept.length}`)
  console.log(`  слова направлений в тексте: ${sensitiveDirections(text).join(', ') || '—'}`)
  console.log(`  объявлено рамкой: ${sensitiveDirections(kept.join('\n')).join(', ') || '— (рамки нет)'}`)
  for (const e of directionEvidence(text)) {
    if (e.hits === 0) continue
    console.log(`  ${e.name.padEnd(28)} встреч ${String(e.hits).padStart(4)} · разных слов ${e.stems} · на 10 тыс. симв. ${e.per10k.toFixed(2)}`)
  }
  if (!verbose) continue
  for (const s of kept) {
    const named = directionEvidence(s).filter((e) => e.hits > 0).map((e) => e.name).join(', ') || '—'
    console.log(`    «${s.slice(0, 140)}» → ${named}`)
  }
}
