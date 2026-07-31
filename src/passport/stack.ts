/**
 * Детект стека и направлений: язык → фреймворк → инфра → направления.
 * Сигналами (deps, файлы, конфиги), ноль хардкод-списка «направлений» в ядре —
 * детекторы это ДАННЫЕ (как языковые пакеты). Каждое найденное направление
 * активирует свой доменный плейбук (см. domains/playbooks.ts).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readManifestDeps, matchSignal, SIGNALS } from './signals'
import { t } from '../core/i18n'

export interface StackSignals {
  frameworks: string[]
  infra: string[]
  domains: string[]
  /** Прод-зависимости вне именованных детекторов — чтобы НЕзнакомая технология
   *  всё равно была видна (снижаем зависимость от перечисления). */
  otherDeps: string[]
  /**
   * Почему сработал каждый детектор: имя → основание («зависимость», «файл в
   * корне», «пути проекта»). Вывод без основания заставляет ЧИТАТЕЛЯ домысливать
   * причину — и аудит возвышения дважды выдумал, будто «фреймворки: nuxt» пришло
   * из упоминания в доках, хотя это объявленная зависимость. Основание в подаче
   * закрывает этот класс догадок вместе с ценой их проверки.
   */
  evidence?: Record<string, string>
}

interface Detector {
  name: string
  kind: 'framework' | 'infra' | 'domain'
  deps?: RegExp
  paths?: RegExp // относительный путь любого файла проекта
  files?: string[] // конкретные файлы в корне (existsSync)
  /** ЕДИНЫЙ ИСТОЧНИК: направление берёт паттерны из signals.ts (не дублирует).
   *  Так «что такое БД/SEO/фронт/тесты/деплой» определено ОДИН раз (иначе stack
   *  и profile расходятся — напр. мультиязычный детект БД был только в signals). */
  signal?: keyof typeof SIGNALS
}

// Каталог детекторов — данные, не логика: новая технология = новая строка
const DETECTORS: Detector[] = [
  // фреймворки
  { name: 'nuxt', kind: 'framework', deps: /^nuxt$/, files: ['nuxt.config.ts', 'nuxt.config.js'] },
  { name: 'next.js', kind: 'framework', deps: /^next$/, files: ['next.config.js', 'next.config.mjs'] },
  { name: 'react', kind: 'framework', deps: /^react$/ },
  { name: 'vue', kind: 'framework', deps: /^vue$/ },
  { name: 'svelte', kind: 'framework', deps: /^svelte$/ },
  { name: 'angular', kind: 'framework', deps: /^@angular\/core$/ },
  { name: 'express', kind: 'framework', deps: /^express$/ },
  { name: 'fastify', kind: 'framework', deps: /^fastify$/ },
  { name: 'nestjs', kind: 'framework', deps: /^@nestjs\/core$/ },
  { name: 'nitro', kind: 'framework', deps: /^nitropack$/ },
  { name: 'django', kind: 'framework', paths: /(^|\/)manage\.py$|(^|\/)settings\.py$/ },
  { name: 'laravel', kind: 'framework', paths: /(^|\/)artisan$/, files: ['artisan'] },
  { name: 'rails', kind: 'framework', files: ['Gemfile'], paths: /(^|\/)config\/routes\.rb$/ },
  { name: 'unity', kind: 'framework', paths: /\.unity$|(^|\/)Assets\// },
  // инфра / хранилища
  { name: 'nginx', kind: 'infra', paths: /nginx[^/]*\.conf$|(^|\/)nginx\// },
  { name: 'docker', kind: 'infra', paths: /(^|\/)dockerfile$|docker-compose[.-]/i, files: ['Dockerfile'] },
  { name: 'kubernetes', kind: 'infra', paths: /(^|\/)(k8s|kube|manifests)\/|(^|\/)(deployment|statefulset|daemonset|ingress|hpa)[^/]*\.ya?ml$/i, deps: /^@kubernetes\/client-node$/ },
  { name: 'helm', kind: 'infra', paths: /(^|\/)(charts?)\/|(^|\/)Chart\.ya?ml$|(^|\/)values\.ya?ml$/i },
  { name: 'terraform', kind: 'infra', paths: /\.tf$|(^|\/)\.terraform\// },
  { name: 'pm2', kind: 'infra', paths: /(^|\/)ecosystem\.config\.(js|cjs|ts)$/, deps: /^pm2$/ },
  { name: 'systemd', kind: 'infra', paths: /\.service$|(^|\/)systemd\// },
  { name: 'serverless/lambda', kind: 'infra', paths: /(^|\/)serverless\.ya?ml$|(^|\/)(template\.ya?ml|sam\.ya?ml)$/i, deps: /^(aws-lambda|@aws-sdk\/.+|serverless)$/ },
  { name: 'postgres', kind: 'infra', deps: /^(pg|postgres|postgres\.js|@prisma\/client|drizzle-orm|typeorm|knex)$/ },
  { name: 'mysql', kind: 'infra', deps: /^(mysql|mysql2)$/ },
  { name: 'mongodb', kind: 'infra', deps: /^(mongodb|mongoose)$/ },
  { name: 'redis', kind: 'infra', deps: /^(redis|ioredis)$/ },
  { name: 'kafka', kind: 'infra', deps: /^(kafkajs|node-rdkafka)$/ },
  { name: 'ci', kind: 'infra', paths: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$/ },
]

// Направления — из сигналов содержимого. Совпадающие с осями качества берут
// паттерны из signals.ts (signal:) — ЕДИНЫЙ ИСТОЧНИК, без дубля-рассинхрона;
// стек-специфичные (нет в signals) остаются инлайн.
const DOMAIN_DETECTORS: Detector[] = [
  { name: 'база данных', kind: 'domain', signal: 'db' },
  { name: 'SEO', kind: 'domain', signal: 'seo' },
  { name: 'фронтенд', kind: 'domain', signal: 'frontend' },
  { name: 'тестирование', kind: 'domain', signal: 'testing' },
  { name: 'деплой/инфра', kind: 'domain', signal: 'deploy' },
  { name: 'веб-сервер', kind: 'domain', paths: /nginx[^/]*\.conf$|(^|\/)nginx\/|(^|\/)(caddyfile|apache2?\.conf)$/i },
  { name: 'фоновые задачи', kind: 'domain', paths: /(^|\/)(cron|jobs?|workers?|queues?|schedulers?)\//i, deps: /^(bullmq|bull|agenda|node-cron|node-schedule)$/ },
  { name: 'API', kind: 'domain', paths: /(^|\/)(api|routes?|controllers?|endpoints?)\//i },
  { name: 'платежи', kind: 'domain', paths: /(^|\/)(payment|billing|checkout|orders?)\//i, deps: /^(stripe|@stripe\/.+)$/ },
  { name: 'аутентификация', kind: 'domain', paths: /(^|\/)(auth|identity|session)\//i, deps: /^(passport|jsonwebtoken|next-auth|@auth\/.+|lucia)$/ },
  { name: 'оркестрация/масштабирование', kind: 'domain', paths: /(^|\/)(k8s|kube|manifests)\/|(deployment|statefulset|hpa|ingress)[^/]*\.ya?ml$|(^|\/)ecosystem\.config\.|\.service$/i, deps: /^(pm2|@kubernetes\/client-node)$/ },
  { name: 'дизайн-ассеты', kind: 'domain', paths: /\.(fig|sketch|psd|ai|xd)$/i },
  { name: 'документы', kind: 'domain', paths: /\.(docx|pptx|xlsx)$/i },
]

// Зависимости — универсально из манифестов любого языка (см. signals.ts)
const readDeps = readManifestDeps

/** Обнаружить стек. relPaths — форвард-слэш пути всех файлов проекта. */
export function detectStack(projectRoot: string, relPaths: string[]): StackSignals {
  const { all: deps, prod: prodDeps } = readDeps(projectRoot)
  const hasDep = (re: RegExp): boolean => deps.some((d) => re.test(d))
  const hasPath = (re: RegExp): boolean => relPaths.some((p) => re.test(p))
  const hasFile = (files?: string[]): boolean => (files ? files.some((f) => existsSync(join(projectRoot, f))) : false)

  // Основание срабатывания, а не просто «да/нет»: порядок проверок — от самого
  // твёрдого признака к самому мягкому, чтобы в подачу попадало сильнейшее
  const reason = (d: Detector): string | null => {
    if (d.signal) return matchSignal(SIGNALS[d.signal], { paths: relPaths, deps }) ? 'сигнал направления' : null
    if (d.deps && hasDep(d.deps)) return 'зависимость в манифесте'
    if (hasFile(d.files)) return 'файл конфигурации в корне'
    if (d.paths && hasPath(d.paths)) return 'пути файлов проекта'
    return null
  }

  const frameworks: string[] = []
  const infra: string[] = []
  const domains: string[] = []
  const evidence: Record<string, string> = {}
  for (const d of DETECTORS) {
    const why = reason(d)
    if (!why) continue
    evidence[d.name] = why
    if (d.kind === 'framework') frameworks.push(d.name)
    else infra.push(d.name)
  }
  for (const d of DOMAIN_DETECTORS) {
    const why = reason(d)
    if (!why) continue
    evidence[d.name] = why
    domains.push(d.name)
  }

  // Прод-зависимости, не пойманные ни одним именованным детектором — чтобы
  // НЕзнакомая технология была видна без её перечисления в каталоге.
  const namedDepRes = DETECTORS.filter((d) => d.deps).map((d) => d.deps as RegExp)
  const otherDeps = prodDeps
    .filter((dep) => !namedDepRes.some((re) => re.test(dep)))
    .filter((dep) => !/^@types\//.test(dep))
    .slice(0, 25)

  return { frameworks, infra, domains, otherDeps, evidence }
}

/** Направления, к которым относится ОДИН файл (по path-сигналам) — для PostToolUse. */
export function fileDomains(rel: string): string[] {
  return DOMAIN_DETECTORS.filter((d) => (d.signal ? SIGNALS[d.signal].paths?.test(rel) : d.paths?.test(rel))).map((d) => d.name)
}

/**
 * Имя направления и основание срабатывания — на языке подачи. Ключи остаются
 * русскими: по ним ходят доменные плейбуки и снимок стека в паспорте, а имя
 * фреймворка (nuxt, redis) не переводится вовсе — это данные проекта.
 */
const domainName = (ru: string): string =>
  t(
    ru,
    ({
      'база данных': 'database',
      фронтенд: 'frontend',
      тестирование: 'testing',
      'деплой/инфра': 'deploy/infra',
      'веб-сервер': 'web server',
      'фоновые задачи': 'background jobs',
      платежи: 'payments',
      аутентификация: 'authentication',
      'оркестрация/масштабирование': 'orchestration/scaling',
      'дизайн-ассеты': 'design assets',
      документы: 'documents',
    })[ru] ?? ru,
  )

const whyName = (ru: string): string =>
  t(
    ru,
    ({
      'сигнал направления': 'direction signal',
      'зависимость в манифесте': 'dependency in the manifest',
      'файл конфигурации в корне': 'config file in the root',
      'пути файлов проекта': 'project file paths',
    })[ru] ?? ru,
  )

/** Секция «Стек и направления» для сводки. */
export function renderStack(s: StackSignals): string {
  if (s.frameworks.length === 0 && s.infra.length === 0 && s.domains.length === 0 && s.otherDeps.length === 0) return ''
  // Каждое имя — с основанием: читатель не должен догадываться, откуда вывод
  // Основание может отсутствовать (старый снимок, ручной вызов) — тогда просто имя
  const withWhy = (names: string[]): string =>
    names.map((n) => (s.evidence?.[n] ? `${domainName(n)} (${whyName(s.evidence[n])})` : domainName(n))).join(', ')
  const lines = [t('## Стек и направления (обнаружено по сигналам; активирует доменную экспертизу)', '## Stack and directions (detected by signals; switches on domain expertise)'), '']
  if (s.frameworks.length > 0) lines.push(`- ${t('фреймворки', 'frameworks')}: ${withWhy(s.frameworks)}`)
  if (s.infra.length > 0) lines.push(`- ${t('инфра/хранилища', 'infra/storage')}: ${withWhy(s.infra)}`)
  if (s.domains.length > 0) lines.push(`- ${t('направления', 'directions')}: ${withWhy(s.domains)}`)
  if (s.otherDeps.length > 0) lines.push(`- ${t('прочие ключевые зависимости', 'other key dependencies')}: ${s.otherDeps.slice(0, 15).join(', ')}`)
  return lines.join('\n')
}
