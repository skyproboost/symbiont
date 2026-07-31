/**
 * A/B-стенд: тот же вопрос к боевому проекту с плагином и без.
 *
 * Меряем per-вопрос: токены (вход/выход/кэш), стоимость, время, ходы.
 * Качество ответов — глазами владельца: оба ответа кладутся рядом в MD.
 * Экономика меряется задачей (tokens-to-done), не вызовом — CONCEPT §6.
 *
 * Запуск:  bun run scripts/ab-test.ts [путь-к-проекту] [--pilot]
 *   --pilot — один вопрос вместо всей батареи (проверка механики).
 * Переключение плеча: claude plugin enable/disable в local-скоупе проекта
 * (состояние восстанавливается в исходное «включён» по завершении).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Дефолт — текущий каталог, а не путь с машины автора: репозиторий публичный
const PROJECT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.cwd()
const PILOT = process.argv.includes('--pilot')
const PLUGIN = 'symbiont@symbiont-market'

const QUESTIONS = [
  { id: 'conventions', q: 'Какие стилевые и архитектурные конвенции у этого проекта? Кратко, списком, с примерными долями.' },
  { id: 'impact', q: 'Что сломается, если поменять сигнатуры функций в shared/decode.ts? Назови зоны и ключевые зависимые файлы.' },
  { id: 'cochange', q: 'Какие файлы исторически правятся вместе с server/utils/decode/case.ts? Откуда это видно?' },
  { id: 'multihop', q: 'Через какие модули данные анализа проходят от загрузки файла до готового разбора? Дай цепочку файлов.' },
]

interface RunMetrics {
  arm: 'с плагином' | 'без плагина'
  id: string
  ok: boolean
  durationS: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  costUsd: number
  answer: string
}

function setPlugin(enabled: boolean): boolean {
  const r = spawnSync('claude', ['plugin', enabled ? 'enable' : 'disable', PLUGIN, '--scope', 'local'], {
    cwd: PROJECT,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return r.status === 0
}

function ask(id: string, q: string, arm: RunMetrics['arm']): RunMetrics {
  const t0 = Date.now()
  const r = spawnSync('claude', ['-p', q, '--output-format', 'json', '--max-turns', '12'], {
    cwd: PROJECT,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const durationS = Math.round((Date.now() - t0) / 1000)
  try {
    const j = JSON.parse(r.stdout ?? '') as {
      result?: string
      num_turns?: number
      total_cost_usd?: number
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    }
    return {
      arm,
      id,
      ok: true,
      durationS,
      turns: j.num_turns ?? 0,
      inputTokens: j.usage?.input_tokens ?? 0,
      outputTokens: j.usage?.output_tokens ?? 0,
      cacheRead: j.usage?.cache_read_input_tokens ?? 0,
      costUsd: j.total_cost_usd ?? 0,
      answer: j.result ?? '',
    }
  } catch {
    return { arm, id, ok: false, durationS, turns: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0, answer: `сбой: ${(r.stderr ?? '').slice(0, 300)}` }
  }
}

const questions = PILOT ? QUESTIONS.slice(0, 1) : QUESTIONS
const rows: RunMetrics[] = []
console.log(`A/B · проект: ${PROJECT} · вопросов: ${questions.length} · плечи: без плагина → с плагином\n`)

try {
  if (!setPlugin(false)) throw new Error('не удалось выключить плагин (local scope)')
  for (const { id, q } of questions) {
    console.log(`  [без плагина] ${id}…`)
    rows.push(ask(id, q, 'без плагина'))
  }
} finally {
  setPlugin(true) // исходное состояние — включён; восстанавливаем при любом исходе
}
for (const { id, q } of questions) {
  console.log(`  [с плагином]  ${id}…`)
  rows.push(ask(id, q, 'с плагином'))
}

// Таблица метрик
console.log('\n вопрос        плечо          сек   ходы   вход     кэш       выход   $')
for (const r of rows) {
  console.log(
    ` ${r.id.padEnd(13)}${r.arm.padEnd(14)}${String(r.durationS).padStart(4)}${String(r.turns).padStart(6)}${String(r.inputTokens).padStart(8)}${String(r.cacheRead).padStart(9)}${String(r.outputTokens).padStart(9)}   ${r.costUsd.toFixed(3)}`,
  )
}

// Ответы рядом — качество судит владелец
const outDir = join(import.meta.dirname, '..', '.data')
mkdirSync(outDir, { recursive: true })
const md = ['# A/B: ответы рядом (качество — глазами владельца)', '']
for (const { id, q } of questions) {
  md.push(`## ${id}`, '', `> ${q}`, '')
  for (const arm of ['без плагина', 'с плагином'] as const) {
    const r = rows.find((x) => x.id === id && x.arm === arm)
    md.push(`### ${arm} · ${r?.durationS}с · ${r?.turns} ходов · $${r?.costUsd.toFixed(3)}`, '', r?.answer ?? '—', '')
  }
}
const mdPath = join(outDir, 'ab-results.md')
writeFileSync(mdPath, md.join('\n'), 'utf8')
writeFileSync(join(outDir, 'ab-results.json'), JSON.stringify(rows, null, 1), 'utf8')
console.log(`\nОтветы рядом: ${mdPath}`)
