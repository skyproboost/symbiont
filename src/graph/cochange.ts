/**
 * Co-change: какие файлы исторически меняются вместе (прецеденты из git-лога).
 * Детерминированно: парсинг `git log --name-only`, счёт пар.
 * Гигантские коммиты (bulk/merge) отбрасываются — они шум, не прецедент.
 */
import { extname } from 'node:path'
import { CODE_EXT as WALK_CODE_EXT } from '../miner/walk'

// «Что такое код» определено ОДИН раз — в майнере (walk.ts). Свой список здесь
// расходился с ним и молча выкидывал из прецедентов правок java/c#/rust/kotlin:
// на таком проекте co-change просто не находил пар. Плюс миграции: .sql не код
// по классификации майнера, но правится ВМЕСТЕ с кодом — а это ровно тот сигнал,
// ради которого co-change и существует.
const CODE_EXT = new Set([...WALK_CODE_EXT, '.sql'])
const MAX_FILES_PER_COMMIT = 30

/** Разбор вывода `git log --name-only --pretty=format:@%H` на списки файлов по коммитам. */
export function parseNameOnlyLog(text: string): string[][] {
  const commits: string[][] = []
  let current: string[] | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('@')) {
      if (current && current.length > 0) commits.push(current)
      current = []
      continue
    }
    if (!line || current === null) continue
    const f = line.replaceAll('\\', '/')
    if (CODE_EXT.has(extname(f).toLowerCase())) current.push(f)
  }
  if (current && current.length > 0) commits.push(current)
  return commits
}

export interface CochangeData {
  pairs: Map<string, number> // 'a|b' (a<b) → сколько раз менялись вместе
  totals: Map<string, number> // file → в скольких коммитах участвовал
}

export function pairCounts(commits: string[][], maxPerCommit = MAX_FILES_PER_COMMIT): CochangeData {
  const pairs = new Map<string, number>()
  const totals = new Map<string, number>()
  for (const files of commits) {
    const uniq = [...new Set(files)]
    if (uniq.length < 1 || uniq.length > maxPerCommit) continue
    for (const f of uniq) totals.set(f, (totals.get(f) ?? 0) + 1)
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const [a, b] = uniq[i] < uniq[j] ? [uniq[i], uniq[j]] : [uniq[j], uniq[i]]
        pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + 1)
      }
    }
  }
  return { pairs, totals }
}

export interface Partner {
  file: string
  together: number
  /** Доля правок исходного файла, в которых партнёр менялся вместе с ним. */
  share: number
}

export function partnersOf(file: string, data: CochangeData, limit = 10, minTogether = 2): Partner[] {
  const total = data.totals.get(file) ?? 0
  if (total === 0) return []
  const out: Partner[] = []
  for (const [key, n] of data.pairs) {
    if (n < minTogether) continue
    const [a, b] = key.split('|')
    if (a !== file && b !== file) continue
    out.push({ file: a === file ? b : a, together: n, share: n / total })
  }
  return out.sort((x, y) => y.together - x.together).slice(0, limit)
}
