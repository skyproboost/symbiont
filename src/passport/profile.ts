/**
 * Профиль качества: что «топ-1» значит именно для ЭТОГО проекта.
 *
 * Оси не зашиты в ядро — они ОБНАРУЖИВАЮТСЯ по сигналам содержимого
 * (как языковые пакеты слоя 0: каталог детекторов по одному шаблону,
 * ядро не знает ни одного названия оси заранее). Три источника сигналов:
 * файлы проекта, зависимости/скрипты package.json, текст README/доков.
 *
 * Особый случай — безопасность: единственная ось, присутствующая всегда;
 * её СОДЕРЖАНИЕ (найденные защитные слои) индивидуально, и их
 * неприкосновенность — будущий гейт.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Fact } from '../miner/facts'
import { SIGNALS, readManifestDeps, type Signal } from './signals'

export interface ProfileProbe {
  axis: string
  evidence: string[]
}

interface AxisDetector {
  axis: string
  /** имя сигнала из единого источника (signals.ts) */
  signal: keyof typeof SIGNALS
}

// Оси качества → общие сигналы (единый источник, см. signals.ts): новая ось —
// это привязка к сигналу, а не свой набор регэкспов (устраняет рассинхрон).
const DETECTORS: AxisDetector[] = [
  { axis: 'корректность', signal: 'testing' },
  { axis: 'производительность', signal: 'performance' },
  { axis: 'SEO', signal: 'seo' },
  { axis: 'целостность данных', signal: 'db' },
  { axis: 'поставляемость', signal: 'deploy' },
  { axis: 'наблюдаемость', signal: 'observability' },
  { axis: 'доступность', signal: 'a11y' },
  { axis: 'совместимость', signal: 'compat' },
  { axis: 'приватность', signal: 'privacy' },
]
const README_LIMIT = 40_000

/** Текст концепции: README + первые файлы docs/.docs (бюджетно). */
export function readConceptText(root: string, relPaths: string[]): string {
  const parts: string[] = []
  for (const name of ['README.md', 'readme.md', 'README.rst', 'CONCEPT.md']) {
    try {
      parts.push(readFileSync(join(root, name), 'utf8').slice(0, README_LIMIT))
    } catch {
      /* нет — идём дальше */
    }
  }
  const docFiles = relPaths.filter((p) => /^(docs|\.docs|doc)\//i.test(p) && p.endsWith('.md')).slice(0, 12)
  for (const rel of docFiles) {
    try {
      parts.push(readFileSync(join(root, rel), 'utf8').slice(0, 8000))
    } catch {
      /* исчез — пропускаем */
    }
  }
  return parts.join('\n')
}

function readPackageSignals(root: string): { deps: string[]; scripts: string } {
  // Универсально: зависимости из манифестов любого языка (не только package.json)
  const { all } = readManifestDeps(root)
  let scripts = ''
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    scripts = Object.values(pkg.scripts ?? {}).join(' ')
  } catch {
    /* нет package.json — не-node проект, это норма */
  }
  return { deps: all, scripts }
}

/**
 * Обнаружение осей. relPaths — форвард-слэш пути всех файлов проекта;
 * скрытые каталоги walker не отдаёт, поэтому CI-поверхность пробуется точечно.
 */
export function probeProfile(root: string, relPaths: string[]): ProfileProbe[] {
  const { deps } = readPackageSignals(root)
  const docsText = readConceptText(root, relPaths)
  // Пустой мир (нет файлов, зависимостей, доков) — профилировать нечего:
  // даже вечная ось безопасности молчит, пока проекта фактически нет
  if (relPaths.length === 0 && deps.length === 0 && docsText.trim().length === 0) return []
  const probes: ProfileProbe[] = []

  const ciPresent = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile'].filter((p) => existsSync(join(root, p)))

  for (const d of DETECTORS) {
    const sig: Signal = SIGNALS[d.signal]
    const evidence: string[] = []
    if (sig.paths) {
      const hits = relPaths.filter((p) => sig.paths!.test(p))
      if (hits.length > 0) {
        // Единица названа прямо: «тестов: 74» читалось как число тест-кейсов и
        // расходилось с CLAUDE.md («700+ тестов») на порядок, хотя оба числа
        // верны — просто в разных единицах. Основание обязано быть самоописательным
        evidence.push(d.axis === 'корректность' ? `тестовых файлов: ${hits.length}` : hits.slice(0, 2).join(', '))
      }
    }
    if (d.axis === 'поставляемость' && ciPresent.length > 0) evidence.push(ciPresent.join(', '))
    if (d.axis === 'корректность' && ciPresent.length > 0 && evidence.length > 0) evidence.push('CI')
    if (sig.deps) {
      const hits = deps.filter((x) => sig.deps!.test(x)).slice(0, 3)
      if (hits.length > 0) evidence.push(hits.join(', '))
    }
    if (sig.docs && sig.docs.test(docsText)) evidence.push('заявлено в доках')
    if (evidence.length > 0) probes.push({ axis: d.axis, evidence })
  }

  // Безопасность — всегда; содержание = найденные защитные слои (сигнал security)
  const sec = SIGNALS.security
  const layers = [
    ...deps.filter((x) => sec.deps!.test(x)).slice(0, 4),
    ...relPaths.filter((p) => sec.paths!.test(p)).slice(0, 3),
  ]
  probes.push({ axis: 'безопасность', evidence: layers })

  return probes
}

/** Пробы → факты журнала (area «профиль качества», ключ стабилен по оси). */
export function profileFacts(probes: ProfileProbe[]): Fact[] {
  return probes.map((p) => {
    const n = p.evidence.length
    if (p.axis === 'безопасность') {
      return {
        area: 'профиль качества',
        statement:
          n > 0
            ? `безопасность — защитные слои: ${p.evidence.join(', ')} (их ослабление — не рядовая правка)`
            : 'безопасность — явных защитных слоёв не обнаружено (появятся — станут неприкосновенными)',
        positive: Math.max(n, 1),
        total: Math.max(n, 1),
        prevalence: 1,
        tier: n > 0 ? 'привычка' : 'гипотеза',
      }
    }
    // Заявление в доках и найденный код — разной силы основания, и разница
    // обязана быть видна в самой формулировке. «SEO — ось качества здесь
    // (заявлено в доках)» читается как признанная ось проекта, хотя за ней
    // может стоять одно слово в README и ни строчки кода. Тот же инвариант, что
    // у фактов майнера против правил модели: измеренное и заявленное — разное.
    const onlyDocs = p.evidence.length === 1 && p.evidence[0] === 'заявлено в доках'
    return {
      area: 'профиль качества',
      statement: onlyDocs
        ? `${p.axis} — заявлена в доках, в коде проекта не обнаружена`
        : `${p.axis} — ось качества здесь (${p.evidence.join('; ')})`,
      positive: n,
      total: n,
      prevalence: 1,
      tier: n >= 2 ? 'привычка' : 'гипотеза',
    }
  })
}
