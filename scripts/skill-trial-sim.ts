/**
 * Калибровка вердикта замера навыков (gardener/skill-trial.ts): какова доля
 * ложных тревог, когда навык НЕ влияет, и какова мощность, когда влияет.
 *
 * Модель данных: поправки за сессию — Пуассон с интенсивностью из гамма-
 * распределения (форма 0.5: много нулей и тяжёлый хвост длинных сессий, как у
 * реальных счётчиков). Группа — случайно с заданной долей контроля. Поток сессий
 * идёт до 40 контрольных; вердикт — тот же trialVerdict, что в плагине.
 *
 * Запуск: bun run scripts/skill-trial-sim.ts [симуляций=400] [доля контроля=0.3]
 */
import { trialVerdict, type TrialRow } from '../src/gardener/skill-trial'

const SIMS = Number(process.argv[2] ?? 400)
const HOLDOUT = Number(process.argv[3] ?? 0.3)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** Гамма(форма k<1, масштаб θ) — метод Ахренса–Дитера через бустинг k+1. */
function gamma(rnd: () => number, k: number, theta: number): number {
  const d = k + 1 - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  let v = 0
  let x = 0
  for (;;) {
    do {
      const u1 = rnd() || 1e-12
      const u2 = rnd()
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rnd()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) break
  }
  return d * v * theta * (rnd() || 1e-12) ** (1 / k)
}

function poisson(rnd: () => number, lambda: number): number {
  const l = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rnd()
  } while (p > l)
  return k - 1
}

/** Один замер: средние поправок в группах — mD и mW. */
function run(seed: number, mD: number, mW: number): string {
  const rnd = mulberry32(seed)
  const rows: TrialRow[] = []
  let withheld = 0
  for (let i = 0; withheld < 40; i++) {
    const arm = rnd() < HOLDOUT ? 'withheld' : 'delivered'
    if (arm === 'withheld') withheld++
    const m = arm === 'withheld' ? mW : mD
    const corrections = poisson(rnd, gamma(rnd, 0.5, m / 0.5))
    rows.push({ arm, startedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), finished: true, ownerMsgs: 5, corrections, invoked: true, tokensIn: 0, tokensOut: 0, unverified: 0 })
  }
  return trialVerdict(rows).verdict.kind
}

function scenario(name: string, mD: number, mW: number): void {
  const counts: Record<string, number> = {}
  for (let s = 0; s < SIMS; s++) {
    const k = run(1000 + s, mD, mW)
    counts[k] = (counts[k] ?? 0) + 1
  }
  const share = (k: string): string => `${(((counts[k] ?? 0) / SIMS) * 100).toFixed(1)}%`
  console.log(`${name.padEnd(46)} помогает ${share('helps').padStart(6)} · мешает ${share('hurts').padStart(6)} · не различимо ${share('unclear').padStart(6)}`)
}

console.log(`симуляций на сценарий: ${SIMS}; доля контроля ${HOLDOUT}; точки 20 и 40\n`)
console.log('Нет эффекта (доля ложной тревоги = помогает + мешает):')
scenario('  редкие поправки, 0.1 на сессию', 0.1, 0.1)
scenario('  умеренные, 0.5 на сессию', 0.5, 0.5)
scenario('  частые, 2 на сессию', 2, 2)
console.log('\nЕсть эффект (мощность = доля верного вывода):')
scenario('  навык вдвое снижает: 0.5 против 1.0', 0.5, 1.0)
scenario('  навык снижает на треть: 0.67 против 1.0', 0.67, 1.0)
scenario('  навык вдвое повышает: 1.0 против 0.5', 1.0, 0.5)
