/**
 * Единый источник сигналов направлений — чтобы «что такое БД / SEO / деплой»
 * определялось ОДИН раз, а не расходилось между stack.ts (направления),
 * profile.ts (оси качества) и остальными потребителями (находка аудита:
 * drizzle db/schema триггерил направление БД, но не ось «целостность данных»).
 *
 * Данные, не логика: сигнал = набор регэкспов по путям/зависимостям/докам.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Signal {
  paths?: RegExp
  deps?: RegExp
  docs?: RegExp
}

/**
 * Универсальный читатель зависимостей — НЕ только npm. Любой продукт/язык:
 * Node/Python/Go/PHP/Ruby/Rust/Java. Best-effort извлечение имён пакетов из
 * манифестов; не распарсилось — пропускаем (fail-open). Возвращает {all, prod}.
 */
export function readManifestDeps(root: string): { all: string[]; prod: string[] } {
  const all = new Set<string>()
  const prod = new Set<string>()
  const read = (name: string): string | null => {
    try {
      return readFileSync(join(root, name), 'utf8')
    } catch {
      return null
    }
  }

  // Node
  const pkg = read('package.json')
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      for (const d of Object.keys(j.dependencies ?? {})) { all.add(d); prod.add(d) }
      for (const d of Object.keys(j.devDependencies ?? {})) all.add(d)
    } catch { /* битый json */ }
  }
  // Python — requirements.txt (pkg==x / pkg>=x)
  const req = read('requirements.txt')
  if (req) for (const m of req.matchAll(/^\s*([A-Za-z0-9._-]+)\s*(?:[=<>!~]|$)/gm)) { all.add(m[1].toLowerCase()); prod.add(m[1].toLowerCase()) }
  // Python — pyproject.toml (грубо: имена в dependencies-блоках)
  const pyp = read('pyproject.toml')
  if (pyp) for (const m of pyp.matchAll(/["']([A-Za-z0-9._-]+)["']\s*[,=\]]|^\s*([A-Za-z0-9._-]+)\s*=/gm)) { const n = (m[1] ?? m[2])?.toLowerCase(); if (n) all.add(n) }
  // Go
  const gomod = read('go.mod')
  if (gomod) for (const m of gomod.matchAll(/^\s*([\w.\-/]+)\s+v\d/gm)) { const n = m[1].split('/').pop()!.toLowerCase(); all.add(n); all.add(m[1].toLowerCase()) }
  // PHP — composer.json
  const comp = read('composer.json')
  if (comp) {
    try {
      const j = JSON.parse(comp) as { require?: Record<string, string>; 'require-dev'?: Record<string, string> }
      for (const d of Object.keys(j.require ?? {})) { const n = d.toLowerCase(); all.add(n); prod.add(n); all.add(n.split('/').pop()!) }
      for (const d of Object.keys(j['require-dev'] ?? {})) all.add(d.toLowerCase())
    } catch { /* битый */ }
  }
  // Ruby — Gemfile
  const gem = read('Gemfile')
  if (gem) for (const m of gem.matchAll(/gem\s+["']([\w.-]+)["']/g)) { all.add(m[1].toLowerCase()); prod.add(m[1].toLowerCase()) }
  // Rust — Cargo.toml
  const cargo = read('Cargo.toml')
  if (cargo) for (const m of cargo.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) { all.add(m[1].toLowerCase()) }
  // Java — pom.xml / build.gradle
  const pom = read('pom.xml')
  if (pom) for (const m of pom.matchAll(/<artifactId>([\w.-]+)<\/artifactId>/g)) all.add(m[1].toLowerCase())
  const gradle = read('build.gradle') ?? read('build.gradle.kts')
  if (gradle) for (const m of gradle.matchAll(/["'][\w.-]+:([\w.-]+):[\w.$-]+["']/g)) all.add(m[1].toLowerCase())

  return { all: [...all], prod: [...prod] }
}

export const SIGNALS: Record<string, Signal> = {
  db: {
    // JS: prisma/drizzle/typeorm… · Python: sqlalchemy/django/alembic/psycopg2 ·
    // Go: gorm/sqlx · PHP: eloquent/doctrine · Ruby: activerecord/pg · Rust: diesel/sqlx · Elixir: ecto
    paths: /(^|\/)(migrations?|prisma|db|database|schema|models|entities|repositor(y|ies))\/|schema\.(sql|prisma)$|\.sql$/i,
    deps: /^(prisma|@prisma\/client|drizzle-orm|typeorm|sequelize|knex|mongoose|pg|postgres|mysql2?|mongodb|redis|ioredis|sqlalchemy|alembic|django|psycopg2?|asyncpg|gorm|sqlx|doctrine\/orm|illuminate\/database|activerecord|diesel|ecto|hibernate-core)$/,
    docs: /(миграци|схем[аы] (данных|бд)|migration|базой? данных|индекс)/i,
  },
  seo: {
    paths: /(^|\/)(sitemap[^/]*|robots\.txt|og-image[^/]*)$/i,
    deps: /(sitemap|seo|schema-dts|next-seo|nuxt-seo)/,
    docs: /(?<![\p{L}\d])(seo|поисков|индексаци|sitemap|e-e-a-t)/iu,
  },
  deploy: {
    paths: /(^|\/)(dockerfile|docker-compose[^/]*|\.gitlab-ci\.yml|jenkinsfile)$|(^|\/)(k8s|kube|helm|charts?|terraform|manifests)\/|\.tf$|(^|\/)Chart\.ya?ml$/i,
    deps: /^(pm2|@kubernetes\/client-node|serverless|aws-cdk-lib)$/,
    docs: /(деплой|deploy|ci\/cd|релизный цикл|оркестраци|масштабир)/i,
  },
  frontend: {
    paths: /\.(vue|jsx|tsx|svelte)$|(^|\/)components?\//i,
    deps: /^(react|vue|svelte|@angular\/core|nuxt|next|solid-js|preact)$/,
    docs: /(фронтенд|frontend|интерфейс|ui|ux|верстк)/i,
  },
  testing: {
    // + Python pytest · Ruby rspec/minitest · PHP phpunit/pest · Go testify · Rust: встроен · Java junit
    paths: /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|e2e|spec)\/)/i,
    deps: /^(jest|vitest|mocha|pytest|playwright|cypress|@testing-library\/.+|rspec|minitest|phpunit|pest|testify|junit|junit-jupiter)$/,
    docs: /(?<![\p{L}\d])(тест|test coverage|покрыти)/iu,
  },
  performance: {
    deps: /^(lighthouse|web-vitals|webpack-bundle-analyzer|autocannon|k6)$/,
    docs: /(быстр|производительн|оптимизаци|performance|latency|скорост)/i,
  },
  observability: {
    deps: /^(pino|winston|@sentry\/.+|prom-client|opentelemetry.*)$/,
    docs: /(монитор|логирован|observab|телеметри|метрик)/i,
  },
  a11y: {
    deps: /(axe-core|a11y|@axe-core\/.+)/,
    docs: /(?<![\p{L}\d])(доступност|a11y|accessibility|wcag)/iu,
  },
  compat: {
    paths: /(^|\/)\.browserslistrc$/i,
    deps: /^browserslist$/,
    docs: /(кроссбраузер|browser support|ie11|webview|слаб(ые|ых) устройств|совместимост)/i,
  },
  privacy: {
    docs: /(персональн[а-яё]* данн|приватност|privacy|gdpr|hipaa|конфиденциал)/i,
  },
  // Зона, объявленная устаревшей: локальный сигнал каскада осей — амбиция
  // «топ-1» уступает ограничению «менять минимально» (CONCEPT §4.1, специфичность)
  legacy: {
    paths: /(^|\/)(legacy|deprecated|vendor|third[_-]?party|old)\//i,
    docs: /(\blegacy\b|\bdeprecated\b|устаревш|не развива|заморож)/i,
  },
  security: {
    paths: /(^|\/)(nginx[^/]*\.conf|security\.md|\.env\.example|content-security-policy[^/]*)$/i,
    deps: /^(helmet|zod|joi|yup|validator|csurf|jsonwebtoken|bcrypt.*|argon2|express-rate-limit)$/,
    docs: /(безопасн|уязвим|security|owasp|csp|xss|инъекци)/i,
  },
}

/** Проверить сигнал против путей/зависимостей/текста доков. */
export function matchSignal(sig: Signal, opts: { paths?: string[]; deps?: string[]; docs?: string }): boolean {
  if (sig.paths && opts.paths?.some((p) => sig.paths!.test(p))) return true
  if (sig.deps && opts.deps?.some((d) => sig.deps!.test(d))) return true
  if (sig.docs && opts.docs && sig.docs.test(opts.docs)) return true
  return false
}
