/**
 * Контракт среды: сопоставление того, что код ТРЕБУЕТ, с тем, что среда
 * РАЗРЕШАЕТ (docs/environment-contract.md).
 *
 * Здесь замыкается третий вид связи, которого графу не хватало. Код и конфиг не
 * связаны ни импортом, ни ссылкой — их связывает только смысл: `blob:`-видео
 * работает ровно тогда, когда CSP разрешает `blob:` в `media-src`. Пока эту
 * связь никто не проверяет, она вскрывается в проде.
 *
 * Дисциплина шума — половина ценности. Расхождение сообщается ТОЛЬКО когда
 * известны оба конца: требование найдено в коде И политика такого рода в
 * проекте существует И она это требование не покрывает. Проект без CSP молчит
 * полностью: отсутствие политики не превращается в претензию.
 */
import { extractCapabilities, extractEnvUsage } from './capabilities'
import { cspAllows, type EnvironmentPolicies } from './policies'
import { applyRules, type ContractRule } from './rules'

export interface ContractIssue {
  kind: 'csp' | 'env' | 'service' | 'выведенное'
  /** что код хочет */
  requirement: string
  /** чем это ограничено и где ограничение лежит */
  policy: string
  /** прямое противоречие или наблюдение с оговоркой */
  certainty: 'противоречие' | 'наблюдение'
  detail: string
}

/** Сервисы, чьё использование в коде распознаётся однозначно. */
const SERVICE_HINTS: Array<{ id: string; match: RegExp }> = [
  { id: 'redis', match: /\b(createClient\s*\(|new\s+Redis\s*\(|ioredis|redis:\/\/)/ },
  { id: 'postgres', match: /\b(new\s+Pool\s*\(|postgres:\/\/|postgresql:\/\/)/ },
  { id: 'mysql', match: /\bmysql:\/\/|createConnection\s*\(\s*\{[^}]*mysql/i },
  { id: 'mongo', match: /\bmongodb(\+srv)?:\/\/|new\s+MongoClient\s*\(/ },
  { id: 'rabbitmq', match: /\bamqp:\/\// },
  { id: 'elasticsearch', match: /new\s+Client\s*\(\s*\{[^}]*node:\s*['"`]https?:\/\/[^'"`]*9200/ },
]

/**
 * Расхождения одного файла. content — его текст, policies — политики проекта.
 */
export function checkContract(content: string, policies: EnvironmentPolicies, learned: ContractRule[] = []): ContractIssue[] {
  const out: ContractIssue[] = []

  // 0) ВЫВЕДЕННЫЕ правила — то, чего сид не предвидел. Они первыми: именно ради
  // них слой и строился, сид лишь закрывает холодный старт.
  for (const hit of applyRules(content, learned)) {
    const r = hit.rule
    // Правило срабатывает, только если настройка ДЕЙСТВИТЕЛЬНО не содержит
    // требуемого: сам факт наличия кода претензией не является.
    const configured = policies.raw.get(`${r.configFile}::${r.configKey}`) ?? policies.raw.get(r.configKey) ?? null
    if (configured === null) continue // настройка исчезла — правило молчит
    if (r.requires && configured.toLowerCase().includes(r.requires.toLowerCase())) continue
    out.push({
      kind: 'выведенное',
      requirement: r.what,
      policy: `${r.configKey}: ${configured.slice(0, 120)} — ${r.configFile}`,
      certainty: 'наблюдение',
      detail: r.requires ? `ожидается наличие «${r.requires}» в настройке` : 'настройка не покрывает это требование',
    })
  }

  // 1) CSP: проверяем, только если политика в проекте вообще есть
  if (policies.csp) {
    const csp = policies.csp
    for (const hit of extractCapabilities(content)) {
      const rule = hit.rule
      if (rule.policy !== 'csp' || !rule.directive || !rule.source) continue
      if (cspAllows(csp, rule.directive, rule.source)) continue
      const configured = csp.directives.get(rule.directive) ?? csp.directives.get('default-src') ?? []
      out.push({
        kind: 'csp',
        requirement: rule.what,
        policy: `${rule.directive}: ${configured.join(' ') || '(не задана)'} — ${csp.source}`,
        certainty: 'противоречие',
        detail: `нужен источник ${rule.source} в ${rule.directive}, иначе браузер заблокирует это в проде`,
      })
    }
  }

  // 2) Переменные окружения: код читает то, чего нет в образце окружения.
  // Проверяем только при наличии образца — иначе это не проект с контрактом env.
  if (policies.declaredEnv.size > 0) {
    for (const name of extractEnvUsage(content)) {
      if (policies.declaredEnv.has(name)) continue
      out.push({
        kind: 'env',
        requirement: `код читает переменную окружения ${name}`,
        policy: `образец окружения (${policies.declaredEnv.size} переменных) её не объявляет`,
        certainty: 'противоречие',
        detail: 'на чистой машине и в CI значение будет пустым — добавить в образец окружения',
      })
    }
  }

  // 3) Сервисы: код обращается к сервису, которого нет в инфраструктуре.
  // Мягче остальных: сервис может быть внешним (управляемый Redis, облачная БД),
  // поэтому это наблюдение, а не противоречие.
  if (policies.services.size > 0) {
    for (const s of SERVICE_HINTS) {
      if (!s.match.test(content)) continue
      if ([...policies.services].some((svc) => svc.includes(s.id))) continue
      out.push({
        kind: 'service',
        requirement: `код обращается к ${s.id}`,
        policy: `инфраструктура проекта поднимает: ${[...policies.services].slice(0, 6).join(', ')}`,
        certainty: 'наблюдение',
        detail: `${s.id} среди них нет — либо сервис внешний, либо в локальной среде его не будет`,
      })
    }
  }

  return out
}

/** Строки для гейт-потока: факт и адрес починки, без императива. */
export function renderContract(issues: ContractIssue[]): string[] {
  return issues.map(
    (i) => `- контракт среды (${i.certainty}): ${i.requirement} · политика: ${i.policy} · ${i.detail}`,
  )
}

/**
 * Строка о действующих политиках для подачи при касании файла: знать про CSP
 * полезно ДО того, как код написан, а не только когда он уже противоречит.
 */
export function renderPolicySummary(policies: EnvironmentPolicies): string {
  const parts: string[] = []
  if (policies.csp) {
    const key = ['default-src', 'script-src', 'style-src', 'media-src', 'connect-src']
      .filter((d) => policies.csp!.directives.has(d))
      .slice(0, 4)
      .map((d) => `${d}: ${(policies.csp!.directives.get(d) as string[]).join(' ')}`)
    parts.push(`CSP (${policies.csp.source}) — ${key.join(' · ')}`)
  }
  if (policies.services.size > 0) parts.push(`сервисы среды: ${[...policies.services].slice(0, 5).join(', ')}`)
  return parts.length > 0 ? `Symbiont · среда проекта: ${parts.join(' | ')}` : ''
}
