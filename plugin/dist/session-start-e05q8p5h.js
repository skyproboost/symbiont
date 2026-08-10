import {
  __esm,
  __export,
  __require,
  __toCommonJS
} from "./session-start-rvra3cez.js";

// src/core/i18n.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function letters(text) {
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (ch >= "а" && ch <= "я")
      cyr++;
    else if (ch >= "А" && ch <= "Я")
      cyr++;
    else if (ch === "ё" || ch === "Ё")
      cyr++;
    else if (ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z")
      lat++;
  }
  return { cyr, lat };
}
function readState(dataDir) {
  try {
    const p = join(dataDir, FILE);
    if (!existsSync(p))
      return { ...EMPTY };
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return {
      choice: raw.choice === "ru" || raw.choice === "en" ? raw.choice : null,
      prompts: { ...EMPTY.prompts, ...raw.prompts ?? {} },
      comments: { ...EMPTY.comments, ...raw.comments ?? {} },
      lang: raw.lang === "en" ? "en" : "ru",
      source: raw.source ?? "default",
      at: raw.at ?? ""
    };
  } catch {
    return { ...EMPTY };
  }
}
function writeState(dataDir, s) {
  try {
    writeFileSync(join(dataDir, FILE), `${JSON.stringify(s, null, 2)}
`, "utf8");
  } catch {}
}
function langFromSystem() {
  try {
    const locale = process.env.LANG ?? process.env.LC_ALL ?? Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    if (/^ru/i.test(locale))
      return "ru";
    return /^[a-z]{2}/i.test(locale) ? "en" : null;
  } catch {
    return null;
  }
}
function langFromDocs(projectRoot) {
  const names = ["README.md", "readme.md", "README.txt", "CONTRIBUTING.md", "docs/README.md"];
  let text = "";
  for (const n of names) {
    try {
      const p = join(projectRoot, n);
      if (existsSync(p))
        text += readFileSync(p, "utf8").slice(0, 20000);
    } catch {
      continue;
    }
  }
  const l = letters(text);
  return l.cyr + l.lat < 200 ? null : decide(l.cyr, l.lat);
}
function langFromCommits(projectRoot) {
  try {
    const r = spawnSync("git", ["log", "--format=%s", "-n", "120"], { cwd: projectRoot, encoding: "utf8", timeout: 4000, windowsHide: true });
    if (r.status !== 0 || !r.stdout)
      return null;
    const l = letters(r.stdout);
    return l.cyr + l.lat < 100 ? null : decide(l.cyr, l.lat);
  } catch {
    return null;
  }
}
function decideFrom(state, projectRoot) {
  if (state.choice)
    return { lang: state.choice, source: "choice" };
  if (enough(state.prompts, 25))
    return { lang: decide(state.prompts.cyr, state.prompts.lat), source: "prompts" };
  if (enough(state.comments, 200))
    return { lang: decide(state.comments.cyr, state.comments.lat), source: "comments" };
  if (projectRoot) {
    const docs = langFromDocs(projectRoot);
    if (docs)
      return { lang: docs, source: "docs" };
  }
  const sys = langFromSystem();
  if (sys)
    return { lang: sys, source: "system" };
  if (projectRoot) {
    const commits = langFromCommits(projectRoot);
    if (commits)
      return { lang: commits, source: "commits" };
  }
  return { lang: "ru", source: "default" };
}
function initLang(dataDir, projectRoot) {
  const env = envLang();
  if (env) {
    setLang(env);
    return { lang: env, source: "env" };
  }
  if (!dataDir)
    return { lang: current, source: "default" };
  const state = readState(dataDir);
  const verdict = decideFrom(state, projectRoot);
  setLang(verdict.lang);
  if (state.lang !== verdict.lang || state.source !== verdict.source) {
    writeState(dataDir, { ...state, lang: verdict.lang, source: verdict.source, at: new Date().toISOString() });
  }
  return verdict;
}
function observePrompt(dataDir, text) {
  const l = letters(text);
  if (l.cyr + l.lat < 5)
    return;
  const state = readState(dataDir);
  const decay = 0.7;
  state.prompts = {
    cyr: Math.round((state.prompts.cyr * decay + l.cyr) * 100) / 100,
    lat: Math.round((state.prompts.lat * decay + l.lat) * 100) / 100,
    n: state.prompts.n + 1
  };
  const verdict = decideFrom(state, null);
  state.lang = verdict.lang;
  state.source = verdict.source;
  state.at = new Date().toISOString();
  writeState(dataDir, state);
}
function observeComments(dataDir, cyr, lat) {
  if (cyr + lat < 50)
    return;
  const state = readState(dataDir);
  if (state.comments.cyr === cyr && state.comments.lat === lat)
    return;
  state.comments = { cyr, lat, n: 1 };
  const verdict = decideFrom(state, null);
  state.lang = verdict.lang;
  state.source = verdict.source;
  state.at = new Date().toISOString();
  writeState(dataDir, state);
}
function chooseLang(dataDir, choice) {
  const state = readState(dataDir);
  state.choice = choice;
  const verdict = decideFrom(state, null);
  state.lang = verdict.lang;
  state.source = verdict.source;
  state.at = new Date().toISOString();
  writeState(dataDir, state);
  setLang(verdict.lang);
  return verdict;
}
function pair(ru, en) {
  STATEMENTS.set(ru, en);
  return ru;
}
function pattern(re, en) {
  PATTERNS.push({ re, en });
}
function statement(ru) {
  if (current !== "en")
    return ru;
  const known = STATEMENTS.get(ru);
  if (known)
    return known;
  for (const p of PATTERNS) {
    const m = ru.match(p.re);
    if (m)
      return p.en(m);
  }
  const colon = ru.indexOf(": ");
  if (colon > 0) {
    const head = STATEMENTS.get(ru.slice(0, colon));
    if (head)
      return `${head}: ${ru.slice(colon + 2)}`;
  }
  return ru;
}
function areaKey(input) {
  const low = input.trim().toLowerCase();
  if (!low)
    return "";
  for (const ru of Object.keys(AREAS)) {
    if (ru.toLowerCase() === low || AREAS[ru].toLowerCase() === low)
      return ru;
  }
  return low;
}
var FILE = "lang.json", current, lang = () => current, setLang = (l) => {
  current = l;
}, t = (ru, en) => current === "en" ? en : ru, RU_SHARE = 0.15, decide = (cyr, lat) => cyr + lat > 0 && cyr / (cyr + lat) >= RU_SHARE ? "ru" : "en", sourceLabel = (key) => ({
  choice: t("ваш выбор", "your choice"),
  env: t("переменная окружения", "environment variable"),
  prompts: t("язык ваших сообщений", "the language you write in"),
  comments: t("язык комментариев в коде", "the language of code comments"),
  docs: t("язык документации проекта", "the language of project docs"),
  system: t("язык системы", "system language"),
  commits: t("язык коммитов", "the language of commits"),
  default: t("умолчание", "default")
})[key], EMPTY, enough = (c, min) => c.cyr + c.lat >= min, envLang = () => {
  const v = (process.env.SYMBIONT_LANG ?? "").toLowerCase();
  return v === "ru" || v === "en" ? v : null;
}, STATEMENTS, PATTERNS, axisName = (ru) => current === "en" ? {
  безопасность: "security",
  корректность: "correctness",
  производительность: "performance",
  поддерживаемость: "maintainability",
  отказоустойчивость: "resilience",
  наблюдаемость: "observability",
  "находимость/SEO": "findability/SEO",
  "связность/перелинковка": "connectedness/interlinking",
  "полнота/покрытие": "completeness/coverage",
  доступность: "accessibility",
  "легитимность/контекст": "legitimacy/context",
  совместимость: "compatibility",
  "целостность данных": "data integrity",
  поставляемость: "deliverability",
  "масштабируемость (горизонт+вертикаль)": "scalability (horizontal + vertical)",
  согласованность: "consistency",
  "UX/эргономика": "UX/ergonomics",
  стоимость: "cost",
  приватность: "privacy",
  SEO: "SEO"
}[ru] ?? ru : ru, axisList = (axes) => axes.map(axisName).join(", "), tier = (ru) => current === "en" ? { закон: "law", привычка: "habit", гипотеза: "hypothesis", "нет консенсуса": "no consensus" }[ru] ?? ru : ru, AREAS, area = (ru) => current === "en" ? AREAS[ru] ?? ru : ru, areaList = () => Object.keys(AREAS).map(area).join(", ");
var init_i18n = __esm(() => {
  current = (() => {
    const v = (process.env.SYMBIONT_LANG ?? "").toLowerCase();
    return v === "ru" || v === "en" ? v : "ru";
  })();
  EMPTY = {
    choice: null,
    prompts: { cyr: 0, lat: 0, n: 0 },
    comments: { cyr: 0, lat: 0, n: 0 },
    lang: "ru",
    source: "default",
    at: ""
  };
  STATEMENTS = new Map;
  PATTERNS = [];
  AREAS = {
    форматирование: "formatting",
    объявления: "declarations",
    функции: "functions",
    итерации: "iteration",
    именование: "naming",
    параметры: "parameters",
    строки: "strings",
    сигнатуры: "signatures",
    массивы: "arrays",
    сравнения: "comparisons",
    методы: "methods",
    "обработка ошибок": "error handling",
    асинхронность: "asynchrony",
    классы: "classes",
    vue: "vue"
  };
});

// src/passport/signals.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
function readManifestDeps(root) {
  const all = new Set;
  const prod = new Set;
  const read = (name) => {
    try {
      return readFileSync3(join3(root, name), "utf8");
    } catch {
      return null;
    }
  };
  const pkg = read("package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      for (const d of Object.keys(j.dependencies ?? {})) {
        all.add(d);
        prod.add(d);
      }
      for (const d of Object.keys(j.devDependencies ?? {}))
        all.add(d);
    } catch {}
  }
  const req = read("requirements.txt");
  if (req)
    for (const m of req.matchAll(/^\s*([A-Za-z0-9._-]+)\s*(?:[=<>!~]|$)/gm)) {
      all.add(m[1].toLowerCase());
      prod.add(m[1].toLowerCase());
    }
  const pyp = read("pyproject.toml");
  if (pyp)
    for (const m of pyp.matchAll(/["']([A-Za-z0-9._-]+)["']\s*[,=\]]|^\s*([A-Za-z0-9._-]+)\s*=/gm)) {
      const n = (m[1] ?? m[2])?.toLowerCase();
      if (n)
        all.add(n);
    }
  const gomod = read("go.mod");
  if (gomod)
    for (const m of gomod.matchAll(/^\s*([\w.\-/]+)\s+v\d/gm)) {
      const n = m[1].split("/").pop().toLowerCase();
      all.add(n);
      all.add(m[1].toLowerCase());
    }
  const comp = read("composer.json");
  if (comp) {
    try {
      const j = JSON.parse(comp);
      for (const d of Object.keys(j.require ?? {})) {
        const n = d.toLowerCase();
        all.add(n);
        prod.add(n);
        all.add(n.split("/").pop());
      }
      for (const d of Object.keys(j["require-dev"] ?? {}))
        all.add(d.toLowerCase());
    } catch {}
  }
  const gem = read("Gemfile");
  if (gem)
    for (const m of gem.matchAll(/gem\s+["']([\w.-]+)["']/g)) {
      all.add(m[1].toLowerCase());
      prod.add(m[1].toLowerCase());
    }
  const cargo = read("Cargo.toml");
  if (cargo)
    for (const m of cargo.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) {
      all.add(m[1].toLowerCase());
    }
  const pom = read("pom.xml");
  if (pom)
    for (const m of pom.matchAll(/<artifactId>([\w.-]+)<\/artifactId>/g))
      all.add(m[1].toLowerCase());
  const gradle = read("build.gradle") ?? read("build.gradle.kts");
  if (gradle)
    for (const m of gradle.matchAll(/["'][\w.-]+:([\w.-]+):[\w.$-]+["']/g))
      all.add(m[1].toLowerCase());
  return { all: [...all], prod: [...prod] };
}
function matchSignal(sig, opts) {
  if (sig.paths && opts.paths?.some((p) => sig.paths.test(p)))
    return true;
  if (sig.deps && opts.deps?.some((d) => sig.deps.test(d)))
    return true;
  if (sig.docs && opts.docs && sig.docs.test(opts.docs))
    return true;
  return false;
}
var SIGNALS;
var init_signals = __esm(() => {
  SIGNALS = {
    db: {
      paths: /(^|\/)(migrations?|prisma|db|database|schema|models|entities|repositor(y|ies))\/|schema\.(sql|prisma)$|\.sql$/i,
      deps: /^(prisma|@prisma\/client|drizzle-orm|typeorm|sequelize|knex|mongoose|pg|postgres|mysql2?|mongodb|redis|ioredis|sqlalchemy|alembic|django|psycopg2?|asyncpg|gorm|sqlx|doctrine\/orm|illuminate\/database|activerecord|diesel|ecto|hibernate-core)$/,
      docs: /(миграци|схем[аы] (данных|бд)|migration|базой? данных|индекс)/i
    },
    seo: {
      paths: /(^|\/)(sitemap[^/]*|robots\.txt|og-image[^/]*)$/i,
      deps: /(sitemap|seo|schema-dts|next-seo|nuxt-seo)/,
      docs: /(?<![\p{L}\d])(seo|поисков|индексаци|sitemap|e-e-a-t)/iu
    },
    deploy: {
      paths: /(^|\/)(dockerfile|docker-compose[^/]*|\.gitlab-ci\.yml|jenkinsfile)$|(^|\/)(k8s|kube|helm|charts?|terraform|manifests)\/|\.tf$|(^|\/)Chart\.ya?ml$/i,
      deps: /^(pm2|@kubernetes\/client-node|serverless|aws-cdk-lib)$/,
      docs: /(деплой|deploy|ci\/cd|релизный цикл|оркестраци|масштабир)/i
    },
    frontend: {
      paths: /\.(vue|jsx|tsx|svelte)$|(^|\/)components?\//i,
      deps: /^(react|vue|svelte|@angular\/core|nuxt|next|solid-js|preact)$/,
      docs: /(фронтенд|frontend|интерфейс|ui|ux|верстк)/i
    },
    testing: {
      paths: /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|e2e|spec)\/)/i,
      deps: /^(jest|vitest|mocha|pytest|playwright|cypress|@testing-library\/.+|rspec|minitest|phpunit|pest|testify|junit|junit-jupiter)$/,
      docs: /(?<![\p{L}\d])(тест|test coverage|покрыти)/iu
    },
    performance: {
      deps: /^(lighthouse|web-vitals|webpack-bundle-analyzer|autocannon|k6)$/,
      docs: /(быстр|производительн|оптимизаци|performance|latency|скорост)/i
    },
    observability: {
      deps: /^(pino|winston|@sentry\/.+|prom-client|opentelemetry.*)$/,
      docs: /(монитор|логирован|observab|телеметри|метрик)/i
    },
    a11y: {
      deps: /(axe-core|a11y|@axe-core\/.+)/,
      docs: /(?<![\p{L}\d])(доступност|a11y|accessibility|wcag)/iu
    },
    compat: {
      paths: /(^|\/)\.browserslistrc$/i,
      deps: /^browserslist$/,
      docs: /(кроссбраузер|browser support|ie11|webview|слаб(ые|ых) устройств|совместимост)/i
    },
    privacy: {
      docs: /(персональн[а-яё]* данн|приватност|privacy|gdpr|hipaa|конфиденциал)/i
    },
    legacy: {
      paths: /(^|\/)(legacy|deprecated|vendor|third[_-]?party|old)\//i,
      docs: /(\blegacy\b|\bdeprecated\b|устаревш|не развива|заморож)/i
    },
    security: {
      paths: /(^|\/)(nginx[^/]*\.conf|security\.md|\.env\.example|content-security-policy[^/]*)$/i,
      deps: /^(helmet|zod|joi|yup|validator|csurf|jsonwebtoken|bcrypt.*|argon2|express-rate-limit)$/,
      docs: /(безопасн|уязвим|security|owasp|csp|xss|инъекци)/i
    }
  };
});

// src/passport/constitution-derive.ts
var exports_constitution_derive = {};
__export(exports_constitution_derive, {
  parseCommitLog: () => parseCommitLog,
  deriveSignals: () => deriveSignals,
  deriveConstitutionFacts: () => deriveConstitutionFacts
});
function parseCommitLog(text) {
  const commits = [];
  let cur = null;
  for (const raw of text.split(`
`)) {
    if (raw.startsWith("@")) {
      if (cur)
        commits.push(cur);
      const tab = raw.indexOf("\t");
      cur = { subject: tab >= 0 ? raw.slice(tab + 1) : "", files: [] };
      continue;
    }
    const line = raw.trim();
    if (line && cur)
      cur.files.push(line.replaceAll("\\", "/"));
  }
  if (cur)
    commits.push(cur);
  return commits;
}
function zoneOf(file) {
  const parts = file.split("/");
  if (parts.length <= 1)
    return "(корень)";
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
}
function countValueMentions(subjects) {
  const out = {};
  for (const subj of subjects) {
    for (const [name, sig] of Object.entries(SIGNALS)) {
      if (sig.docs && sig.docs.test(subj))
        out[name] = (out[name] ?? 0) + 1;
    }
  }
  return out;
}
function deriveSignals(commits) {
  const commitTypes = {};
  const fixZones = {};
  let reverts = 0;
  for (const c of commits) {
    const subj = c.subject.trim();
    if (REVERT.test(subj))
      reverts++;
    const m = subj.match(CONVENTIONAL);
    const type = m ? m[1].toLowerCase() : null;
    if (type)
      commitTypes[type] = (commitTypes[type] ?? 0) + 1;
    if (type === "fix" || REVERT.test(subj)) {
      const zones = new Set(c.files.map(zoneOf));
      for (const z of zones)
        fixZones[z] = (fixZones[z] ?? 0) + 1;
    }
  }
  return {
    commitTypes,
    reverts,
    fixZones,
    totalCommits: commits.length,
    valueMentions: countValueMentions(commits.map((c) => c.subject))
  };
}
function deriveConstitutionFacts(signals, profile) {
  const facts = [];
  const push = (statement2, positive, total, tier2) => {
    facts.push({ area: "конституция", statement: statement2, positive, total: Math.max(total, positive, 1), prevalence: 1, tier: tier2 });
  };
  const topAxes = profile.filter((p) => p.axis !== "безопасность").sort((a, b) => b.evidence.length - a.evidence.length).slice(0, 2);
  for (const a of topAxes) {
    push(`приоритет: ${a.axis} — ось качества с наибольшим числом сигналов в проекте`, a.evidence.length, a.evidence.length, a.evidence.length >= 2 ? "привычка" : "гипотеза");
  }
  const types = Object.entries(signals.commitTypes).sort((a, b) => b[1] - a[1]);
  if (types.length > 0 && signals.totalCommits >= 20) {
    const [type, n] = types[0];
    const label = AXIS_LABEL[type] ?? type;
    if (n / signals.totalCommits >= 0.25) {
      push(`фокус работы: ${label} — преобладающий тип коммитов (${n} из ${signals.totalCommits})`, n, signals.totalCommits, "привычка");
    }
  }
  const VALUE_LABEL = {
    performance: "производительность",
    security: "безопасность",
    seo: "поисковая видимость",
    a11y: "доступность",
    testing: "проверяемость",
    db: "целостность данных",
    deploy: "поставляемость",
    privacy: "приватность",
    observability: "наблюдаемость"
  };
  const VALUE_MIN_SHARE = 0.12;
  const values = Object.entries(signals.valueMentions ?? {}).filter((e) => VALUE_LABEL[e[0]] !== undefined && e[1] >= 3 && e[1] / Math.max(signals.totalCommits, 1) >= VALUE_MIN_SHARE).sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const v of values) {
    push(`ценность: ${VALUE_LABEL[v[0]]} — владелец возвращается к ней в формулировках работы (${v[1]} из ${signals.totalCommits} коммитов)`, v[1], signals.totalCommits, v[1] >= 6 ? "привычка" : "гипотеза");
  }
  const fragile = Object.entries(signals.fixZones).filter(([, n]) => n >= CONSTRAINT_MIN_FIXES).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [zone, n] of fragile) {
    push(`ограничение: зона ${zone} — хрупкая (${n} правок-починок в истории), менять осторожно и с проверкой`, n, signals.totalCommits, n >= CONSTRAINT_MIN_FIXES * 2 ? "привычка" : "гипотеза");
  }
  if (signals.reverts >= 2) {
    push(`ограничение: в истории есть откаты (${signals.reverts}) — рискованные правки проверять до коммита (регрессии тут случались)`, signals.reverts, signals.totalCommits, "гипотеза");
  }
  const sec = profile.find((p) => p.axis === "безопасность");
  if (sec && sec.evidence.length > 0) {
    push(`ограничение: защитные слои (${sec.evidence.slice(0, 4).join(", ")}) не ослаблять без явного решения владельца`, sec.evidence.length, sec.evidence.length, "привычка");
  }
  return facts;
}
var CONVENTIONAL, REVERT, labelEn = (ru) => ({
  "развитие функций": "feature development",
  "надёжность и устранение дефектов": "reliability and defect fixing",
  "поисковая видимость": "search visibility",
  "чистота архитектуры": "architectural cleanliness",
  проверяемость: "testability"
})[ru] ?? axisName(ru), CONSTRAINT_MIN_FIXES = 4, AXIS_LABEL;
var init_constitution_derive = __esm(() => {
  init_signals();
  init_i18n();
  CONVENTIONAL = /^(feat|fix|perf|seo|refactor|docs|test|chore|style|build|ci)(\([^)]*\))?!?:/i;
  REVERT = /^revert|откат|\brollback\b/i;
  pattern(/^приоритет: (.+) — ось качества с наибольшим числом сигналов в проекте$/, (m) => `priority: ${axisName(m[1])} — the quality axis with the most signals in this project`);
  pattern(/^фокус работы: (.+) — преобладающий тип коммитов \((\d+) из (\d+)\)$/, (m) => `focus of work: ${labelEn(m[1])} — the prevailing commit type (${m[2]} of ${m[3]})`);
  pattern(/^ценность: (.+) — владелец возвращается к ней в формулировках работы \((\d+) из (\d+) коммитов\)$/, (m) => `value: ${labelEn(m[1])} — the owner keeps returning to it when describing the work (${m[2]} of ${m[3]} commits)`);
  pattern(/^ограничение: зона (.+) — хрупкая \((\d+) правок-починок в истории\), менять осторожно и с проверкой$/, (m) => `constraint: the ${m[1]} area is fragile (${m[2]} fix commits in history) — change it carefully and with verification`);
  pattern(/^ограничение: в истории есть откаты \((\d+)\) — рискованные правки проверять до коммита \(регрессии тут случались\)$/, (m) => `constraint: history contains reverts (${m[1]}) — verify risky changes before committing (regressions have happened here)`);
  pattern(/^ограничение: защитные слои \((.+)\) не ослаблять без явного решения владельца$/, (m) => `constraint: protective layers (${m[1]}) must not be weakened without the owner's explicit decision`);
  AXIS_LABEL = {
    feat: "развитие функций",
    fix: "надёжность и устранение дефектов",
    perf: "производительность",
    seo: "поисковая видимость",
    refactor: "чистота архитектуры",
    test: "проверяемость"
  };
});

// src/miner/walk.ts
var exports_walk = {};
__export(exports_walk, {
  walkFiles: () => walkFiles,
  inDerivedZone: () => inDerivedZone,
  codeFiles: () => codeFiles,
  JS_EXT: () => JS_EXT,
  CODE_EXT: () => CODE_EXT
});
import { readdirSync, readFileSync as readFileSync4, statSync } from "node:fs";
import { extname, join as join4 } from "node:path";
function inDerivedZone(rel) {
  return rel.split("/").some((seg) => SKIP_DIRS.has(seg));
}
function declaredSkips(root) {
  const names = new Set;
  const prefixes = new Set;
  let text = "";
  try {
    text = readFileSync4(join4(root, ".gitignore"), "utf8");
  } catch {}
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /[*?![\]]/.test(line))
      continue;
    const clean = line.replace(/\/+$/, "");
    if (!clean)
      continue;
    if (clean.includes("/"))
      prefixes.add(clean.replace(/^\/+/, ""));
    else
      names.add(clean);
  }
  return { names, prefixes };
}
function walkFiles(root) {
  const skips = declaredSkips(root);
  const out = [];
  const stack = [{ abs: root, rel: "" }];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const { abs: dir, rel } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".") || skips.names.has(e.name))
          continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (skips.prefixes.has(childRel))
          continue;
        stack.push({ abs: join4(dir, e.name), rel: childRel });
        continue;
      }
      const p = join4(dir, e.name);
      const ext = extname(e.name).toLowerCase();
      let size = 0;
      let mtimeMs = 0;
      if (CODE_EXT.has(ext)) {
        try {
          const st = statSync(p);
          size = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          continue;
        }
      }
      out.push({ path: p, ext, size, mtimeMs });
    }
  }
  return out;
}
function codeFiles(files) {
  return files.filter((f) => CODE_EXT.has(f.ext) && f.size <= MAX_FILE_SIZE);
}
var SKIP_DIRS, MAX_FILE_SIZE = 1e6, MAX_FILES = 20000, JS_EXT, CODE_EXT;
var init_walk = __esm(() => {
  SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    "coverage",
    "vendor",
    "tmp",
    "temp",
    "plugin",
    "build",
    "out",
    ".output",
    ".nuxt",
    ".next",
    "target",
    "venv",
    "site-packages",
    "__pycache__",
    ".tox",
    "bower_components",
    "Pods",
    "vendors",
    "third_party",
    "thirdparty"
  ]);
  JS_EXT = new Set([".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".vue"]);
  CODE_EXT = new Set([
    ...JS_EXT,
    ".py",
    ".go",
    ".php",
    ".rb",
    ".java",
    ".cs",
    ".kt",
    ".rs",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".swift",
    ".scala",
    ".lua",
    ".pl",
    ".r",
    ".dart"
  ]);
});

// src/core/runtime.ts
init_i18n();
import { createRequire } from "node:module";
var NODE_SQLITE_MIN = "22.13";
var requireDriver = createRequire(import.meta.url);
function loadSqliteDriver(runtime) {
  try {
    return requireDriver(`${runtime}:sqlite`);
  } catch {
    return null;
  }
}
function inspectRuntime(env = {
  bun: globalThis.Bun?.version,
  node: typeof process !== "undefined" ? process.versions?.node : undefined
}, hasDriver = (runtime) => loadSqliteDriver(runtime) !== null) {
  const problems = [];
  if (env.bun) {
    return { runtime: "bun", version: env.bun, hasStorage: true, problems };
  }
  if (env.node) {
    const hasStorage = hasDriver("node");
    if (!hasStorage) {
      problems.push(`Node ${env.node}: встроенного хранилища нет (нужен Node ${NODE_SQLITE_MIN}+ или bun) — паспорт сохранять негде`);
    }
    return { runtime: "node", version: env.node, hasStorage, problems };
  }
  problems.push("рантайм не опознан: ни bun, ни node не обнаружены");
  return { runtime: "неизвестно", version: "", hasStorage: false, problems };
}
function renderRuntimeWarning(r) {
  if (r.problems.length === 0)
    return "";
  return [
    "- ⚠ Symbiont не может работать в этом окружении:",
    ...r.problems.map((p) => `  ${p}`),
    "  Плагин ничего не сломает, но паспорт проекта собран не будет."
  ].join(`
`);
}
function runtimeBlocker(report = inspectRuntime()) {
  if (report.hasStorage)
    return null;
  const have = report.runtime === "неизвестно" ? t("ни Node, ни Bun не обнаружены", "neither Node nor Bun was found") : `${report.runtime} ${report.version}`;
  return [
    t("Symbiont: это окружение не поддерживается — работа не начата.", "Symbiont: this environment is not supported — no work was started."),
    t(`  на машине: ${have}`, `  on this machine: ${have}`),
    t(`  требуется: Node ${NODE_SQLITE_MIN}+ (в нём node:sqlite встроен) или Bun любой версии`, `  required: Node ${NODE_SQLITE_MIN}+ (it has node:sqlite built in) or Bun, any version`),
    t("  Ничего не сломано и не изменено: паспорт хранить негде, поэтому плагин молча уступает.", "  Nothing is broken and nothing was changed: there is nowhere to keep the passport, so the plugin steps aside.")
  ].join(`
`);
}
function silentSpawnOptions(detached = true) {
  return { detached, stdio: "ignore", windowsHide: true };
}

// src/core/db.ts
var bunSqlite = null;
var nodeSqlite = null;
function silenceSqliteExperimentalWarning() {
  const previous = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message))
      return;
    for (const listener of previous)
      listener(w);
  });
}
function driverKind() {
  return inspectRuntime().runtime === "bun" ? "bun" : "node";
}
function normalize(params) {
  return params.map((p) => {
    if (p === undefined)
      return null;
    if (typeof p === "boolean")
      return p ? 1 : 0;
    return p;
  });
}

class NodeStatementAdapter {
  stmt;
  constructor(stmt) {
    this.stmt = stmt;
  }
  all(...params) {
    return this.stmt.all(...normalize(params));
  }
  get(...params) {
    const row = this.stmt.get(...normalize(params));
    return row === undefined ? null : row;
  }
  run(...params) {
    const r = this.stmt.run(...normalize(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

class NodeDatabaseAdapter {
  db;
  prepared = new Map;
  constructor(db) {
    this.db = db;
  }
  query(sql) {
    const hit = this.prepared.get(sql);
    if (hit)
      return hit;
    const stmt = new NodeStatementAdapter(this.db.prepare(sql));
    this.prepared.set(sql, stmt);
    return stmt;
  }
  run(sql, ...params) {
    return this.query(sql).run(...params);
  }
  close() {
    this.prepared.clear();
    this.db.close();
  }
}
var BUSY_TIMEOUT_MS = 2000;
function openDb(path, options = {}) {
  const db = openDriver(path, options);
  try {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  } catch {}
  return db;
}
function openDriver(path, options) {
  if (driverKind() === "bun") {
    if (!bunSqlite)
      bunSqlite = mustLoad("bun", "драйвер bun:sqlite");
    return new bunSqlite.Database(path, options.readonly ? { readonly: true } : undefined);
  }
  if (!nodeSqlite) {
    silenceSqliteExperimentalWarning();
    nodeSqlite = mustLoad("node", "встроенное хранилище node:sqlite (нужен Node 22.13+ или bun)");
  }
  return new NodeDatabaseAdapter(new nodeSqlite.DatabaseSync(path, options.readonly ? { readOnly: true } : {}));
}
function mustLoad(runtime, what) {
  const driver = loadSqliteDriver(runtime);
  if (!driver) {
    throw new Error(runtimeBlocker() ?? `Symbiont: в этом рантайме недоступен ${what}`);
  }
  return driver;
}

// src/gardener/truth.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/core/store.ts
init_i18n();

// src/core/ratings.ts
var clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
function initRating(source, prevalence, total) {
  if (source.startsWith("llm:")) {
    return { rating: Math.min(prevalence, 0.94), deviation: 0.22 };
  }
  return { rating: prevalence, deviation: clamp(1 / Math.sqrt(Math.max(total, 1)), 0.03, 0.35) };
}
var SURPRISE_GAP = 0.1;
function isSurprise(prev, newPrevalence) {
  return Math.abs(newPrevalence - prev.rating) > SURPRISE_GAP;
}
function confirmRating(prev, newPrevalence) {
  if (isSurprise(prev, newPrevalence)) {
    const deviation = Math.min(prev.deviation + Math.abs(newPrevalence - prev.rating), 0.35);
    const w2 = Math.min(deviation * 2, 0.5);
    return { rating: prev.rating * (1 - w2) + newPrevalence * w2, deviation };
  }
  const w = Math.min(prev.deviation * 2, 0.5);
  return {
    rating: prev.rating * (1 - w) + newPrevalence * w,
    deviation: Math.max(prev.deviation * 0.85, 0.02)
  };
}
var MONTH_MS = 30 * 24 * 3600000;
var AGING_PER_MONTH = 0.05;
var DEVIATION_CAP = 0.5;
function effectiveDeviation(deviation, seenAtIso, nowMs = Date.now()) {
  const months = Math.max(0, (nowMs - Date.parse(seenAtIso)) / MONTH_MS);
  if (!Number.isFinite(months))
    return DEVIATION_CAP;
  return Math.min(deviation + AGING_PER_MONTH * months, DEVIATION_CAP);
}
function liveTier(rating, effDeviation, total) {
  if (rating >= 0.95 && effDeviation <= 0.19 && total >= 30)
    return "закон";
  if (rating >= 0.7 && effDeviation <= 0.32 && total >= 3)
    return "привычка";
  if (rating >= 0.55)
    return "гипотеза";
  return "нет консенсуса";
}

// src/core/schedule.ts
var RETENTION_THRESHOLD = 0.9;
var DECAY = -0.5;
var FACTOR = 19 / 81;
function initialStability(source) {
  if (source.startsWith("llm:corrections:"))
    return 7;
  if (source.startsWith("llm:"))
    return 14;
  return null;
}
function retrievability(stabilityDays, seenAtIso, nowMs = Date.now()) {
  const days = (nowMs - Date.parse(seenAtIso)) / 86400000;
  if (!Number.isFinite(days) || days <= 0)
    return 1;
  return Math.pow(1 + FACTOR * (days / Math.max(stabilityDays, 0.1)), DECAY);
}
function confirmStability(stabilityDays, r) {
  const growth = 1.6 + 1.4 * (1 - Math.min(Math.max(r, 0), 1));
  return Math.min(stabilityDays * growth, 365);
}
function isDue(stabilityDays, seenAtIso, nowMs = Date.now()) {
  if (stabilityDays === null)
    return false;
  return retrievability(stabilityDays, seenAtIso, nowMs) < RETENTION_THRESHOLD;
}

// src/core/store.ts
function factBasis(fact) {
  const pct = Math.round(fact.prevalence * 100);
  if (typeof fact.source === "string" && fact.source.startsWith("llm:")) {
    return t(`выведено по ${fact.total} образцам (уверенность ${pct}%, не измерено)`, `inferred from ${fact.total} samples (confidence ${pct}%, not measured)`);
  }
  return `${fact.positive} ${t("из", "of")} ${fact.total} (${pct}%)`;
}
function keyOf(fact) {
  const subject = fact.statement.split("—")[0].trim();
  return `${fact.area}|${subject}`;
}

class FactStore {
  db;
  constructor(db) {
    this.db = db;
    try {
      db.run(`CREATE TABLE IF NOT EXISTS fact_journal(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          area TEXT NOT NULL,
          statement TEXT NOT NULL,
          tier TEXT NOT NULL,
          prevalence REAL NOT NULL,
          positive INTEGER NOT NULL,
          total INTEGER NOT NULL,
          source TEXT NOT NULL,
          asserted_at TEXT NOT NULL,
          seen_at TEXT NOT NULL,
          superseded_by INTEGER
        )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_fact_key ON fact_journal(key)");
      const cols = db.query("PRAGMA table_info(fact_journal)").all().map((c) => c.name);
      if (!cols.includes("rating")) {
        db.run("ALTER TABLE fact_journal ADD COLUMN rating REAL");
        db.run("ALTER TABLE fact_journal ADD COLUMN deviation REAL");
        db.run("ALTER TABLE fact_journal ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0");
      }
      const legacy = db.query("SELECT id, source, prevalence, total FROM fact_journal WHERE rating IS NULL").all();
      if (legacy.length > 0) {
        const upd = db.query("UPDATE fact_journal SET rating=?, deviation=? WHERE id=?");
        for (const r of legacy) {
          const init = initRating(r.source, r.prevalence, r.total);
          upd.run(init.rating, init.deviation, r.id);
        }
      }
      if (!cols.includes("stability")) {
        db.run("ALTER TABLE fact_journal ADD COLUMN stability REAL");
        const llm = db.query("SELECT id, source FROM fact_journal WHERE source LIKE 'llm:%'").all();
        const upd = db.query("UPDATE fact_journal SET stability=? WHERE id=?");
        for (const r of llm)
          upd.run(initialStability(r.source), r.id);
      }
    } catch {}
  }
  active(nowMs = Date.now()) {
    const rows = this.db.query("SELECT * FROM fact_journal WHERE superseded_by IS NULL ORDER BY area, statement").all();
    for (const r of rows) {
      if (typeof r.rating === "number" && typeof r.deviation === "number") {
        r.tier = liveTier(r.rating, effectiveDeviation(r.deviation, r.seen_at, nowMs), r.total);
      }
    }
    return rows;
  }
  journalSize() {
    return this.db.query("SELECT COUNT(*) AS n FROM fact_journal").get().n;
  }
  assertAll(facts, source, now = new Date().toISOString()) {
    let born = 0;
    let updated = 0;
    let superseded = 0;
    for (const f of facts) {
      const key = keyOf(f);
      const current2 = this.db.query("SELECT * FROM fact_journal WHERE key=? AND superseded_by IS NULL").get(key);
      if (!current2) {
        this.insert(f, key, source, now);
        born++;
        continue;
      }
      if (current2.statement === f.statement) {
        const prev = {
          rating: current2.rating ?? initRating(current2.source, current2.prevalence, current2.total).rating,
          deviation: current2.deviation ?? initRating(current2.source, current2.prevalence, current2.total).deviation
        };
        const next = confirmRating(prev, f.prevalence);
        const prevStability = current2.stability ?? initialStability(current2.source);
        const nextStability = prevStability === null ? null : isSurprise(prev, f.prevalence) ? prevStability : confirmStability(prevStability, retrievability(prevStability, current2.seen_at, Date.parse(now)));
        this.db.query("UPDATE fact_journal SET prevalence=?, positive=?, total=?, seen_at=?, rating=?, deviation=?, stability=?, confirmations=confirmations+1 WHERE id=?").run(f.prevalence, f.positive, f.total, now, next.rating, next.deviation, nextStability, current2.id);
        updated++;
        continue;
      }
      const newId = this.insert(f, key, source, now);
      this.db.query("UPDATE fact_journal SET superseded_by=? WHERE id=?").run(newId, current2.id);
      superseded++;
    }
    return { born, updated, superseded };
  }
  insert(f, key, source, now) {
    const init = initRating(source, f.prevalence, f.total);
    const res = this.db.query(`INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by, rating, deviation, confirmations, stability)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,0,?)`).run(key, f.area, f.statement, f.tier, f.prevalence, f.positive, f.total, source, now, now, init.rating, init.deviation, initialStability(source));
    return Number(res.lastInsertRowid);
  }
  dueForReview(nowMs = Date.now()) {
    const rows = this.db.query("SELECT * FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' AND stability IS NOT NULL").all();
    return rows.filter((r) => isDue(r.stability, r.seen_at, nowMs));
  }
  touchAll(now = new Date().toISOString()) {
    this.db.query("UPDATE fact_journal SET seen_at=? WHERE superseded_by IS NULL AND source NOT LIKE 'llm:%'").run(now);
  }
  retractMissingBySource(source, presentKeys) {
    const rows = this.db.query("SELECT id, key FROM fact_journal WHERE superseded_by IS NULL AND source=?").all(source);
    let retracted = 0;
    const upd = this.db.query("UPDATE fact_journal SET superseded_by=0 WHERE id=?");
    for (const r of rows) {
      if (presentKeys.has(r.key))
        continue;
      upd.run(r.id);
      retracted++;
    }
    return retracted;
  }
  history(key) {
    return this.db.query("SELECT * FROM fact_journal WHERE key=? ORDER BY id DESC").all(key);
  }
}

// src/gardener/truth.ts
var tableExists = (db, name) => {
  try {
    return db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;
  } catch {
    return false;
  }
};
var deadOf = (db, table, column, root) => {
  if (!tableExists(db, table))
    return [];
  try {
    const rows = db.query(`SELECT ${column} AS f FROM ${table}`).all();
    return rows.filter((r) => typeof r.f === "string" && !existsSync2(join2(root, r.f))).map((r) => r.f);
  } catch {
    return [];
  }
};
function deadLessonZones(db, root) {
  if (!tableExists(db, "lessons"))
    return [];
  try {
    const rows = db.query("SELECT DISTINCT zone FROM lessons").all();
    return rows.filter((r) => r.zone && r.zone !== "(корень)" && !existsSync2(join2(root, r.zone))).map((r) => r.zone);
  } catch {
    return [];
  }
}
function staleSummaryLines(summary, activeStatements) {
  const out = [];
  let inFactSection = false;
  for (const raw of summary.split(`
`)) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      inFactSection = /(Законы стиля|Преобладающий стиль|Профиль качества)/i.test(line);
      continue;
    }
    if (!inFactSection || !line.startsWith("- "))
      continue;
    const body = line.slice(2).trim();
    if (!activeStatements.some((s) => body.startsWith(s)))
      out.push(body.slice(0, 120));
  }
  return out;
}
function auditTruth(db, root, dataDir) {
  const issues = [];
  const push = (kind, dead, healable = true) => {
    if (dead.length > 0) {
      issues.push({ kind, detail: dead.slice(0, 3).join(", ") + (dead.length > 3 ? ", …" : ""), count: dead.length, healable });
    }
  };
  push("узлы графа без файла", deadOf(db, "graph_nodes", "file", root));
  push("сущности контент-графа без файла", deadOf(db, "entity_nodes", "file", root));
  push("роли удалённых файлов", deadOf(db, "node_summary", "file", root));
  push("тепло удалённых файлов", deadOf(db, "node_heat", "file", root));
  push("уроки по несуществующим зонам", deadLessonZones(db, root));
  try {
    const summary = readFileSync2(join2(dataDir, "SUMMARY.md"), "utf8");
    const active = new FactStore(db).active().map((f) => f.statement);
    const stale = staleSummaryLines(summary, active);
    if (stale.length > 0) {
      issues.push({
        kind: "строки сводки без активного факта",
        detail: stale.slice(0, 2).join(" · "),
        count: stale.length,
        healable: false
      });
    }
  } catch {}
  return issues;
}
function healProjections(db, root) {
  const report = { removed: 0, tables: [] };
  const clean = (table, column, dead) => {
    if (dead.length === 0)
      return;
    try {
      const del = db.query(`DELETE FROM ${table} WHERE ${column} = ?`);
      for (const f of dead)
        del.run(f);
      report.removed += dead.length;
      report.tables.push(table);
    } catch {}
  };
  clean("graph_nodes", "file", deadOf(db, "graph_nodes", "file", root));
  clean("entity_nodes", "file", deadOf(db, "entity_nodes", "file", root));
  clean("node_summary", "file", deadOf(db, "node_summary", "file", root));
  clean("node_heat", "file", deadOf(db, "node_heat", "file", root));
  clean("lessons", "zone", deadLessonZones(db, root));
  if (tableExists(db, "graph_edges") && tableExists(db, "graph_nodes")) {
    try {
      const before = db.query("SELECT COUNT(*) n FROM graph_edges").get().n;
      db.run("DELETE FROM graph_edges WHERE from_file NOT IN (SELECT file FROM graph_nodes) OR to_file NOT IN (SELECT file FROM graph_nodes)");
      const after = db.query("SELECT COUNT(*) n FROM graph_edges").get().n;
      if (before > after) {
        report.removed += before - after;
        report.tables.push("graph_edges");
      }
    } catch {}
  }
  return report;
}
function renderTruth(issues) {
  if (issues.length === 0)
    return " Само-образ      паспорт честен: подаётся только живое";
  const lines = [" Само-образ — паспорт подаёт то, чего нет:"];
  for (const i of issues) {
    lines.push(`   ${i.kind}: ${i.count} · ${i.detail}${i.healable ? "" : " (пересборка уже назначена фоном)"}`);
  }
  return lines.join(`
`);
}

// src/gardener/drift.ts
init_i18n();
var num = (db, sql) => {
  try {
    const r = db.query(sql).get();
    return r && r.v != null ? r.v : 0;
  } catch {
    return 0;
  }
};
var hasTable = (db, name) => db.query("SELECT COUNT(*) v FROM sqlite_master WHERE type='table' AND name=?").get(name).v > 0;
function computeHealth(db) {
  const lawCount = num(db, "SELECT COUNT(*) v FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'");
  const lawPrevalence = num(db, "SELECT AVG(prevalence) v FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'");
  const activeFacts = num(db, "SELECT COUNT(*) v FROM fact_journal WHERE superseded_by IS NULL");
  const graphNodes = hasTable(db, "graph_nodes") ? num(db, "SELECT COUNT(*) v FROM graph_nodes") : 0;
  const graphEdges = hasTable(db, "graph_edges") ? num(db, "SELECT COUNT(*) v FROM graph_edges") : 0;
  const orphans = hasTable(db, "entity_nodes") ? num(db, "SELECT COUNT(*) v FROM entity_nodes WHERE in_deg=0 AND is_hub=0") : 0;
  const broken = hasTable(db, "entity_broken") ? num(db, "SELECT COUNT(*) v FROM entity_broken") : 0;
  const gateCatches = hasTable(db, "gate_log") ? num(db, "SELECT COUNT(*) v FROM gate_log") : 0;
  return {
    lawCount,
    lawPrevalence,
    activeFacts,
    graphNodes,
    graphEdges,
    density: graphNodes > 0 ? graphEdges / graphNodes : 0,
    orphans,
    broken,
    gateCatches
  };
}
function ensureSnapshots(db) {
  db.run("CREATE TABLE IF NOT EXISTS health_snapshot(commit_hash TEXT PRIMARY KEY, ts TEXT NOT NULL, metrics TEXT NOT NULL)");
}
function captureHealth(db, commit, now) {
  if (!commit || commit === "no-git")
    return;
  try {
    ensureSnapshots(db);
    const m = computeHealth(db);
    db.query("INSERT INTO health_snapshot(commit_hash, ts, metrics) VALUES(?,?,?) ON CONFLICT(commit_hash) DO UPDATE SET ts=excluded.ts, metrics=excluded.metrics").run(commit, now, JSON.stringify(m));
  } catch {}
}
function computeDrift(db, baseWindow = 8) {
  try {
    if (!hasTable(db, "health_snapshot"))
      return null;
    const rows = db.query("SELECT metrics FROM health_snapshot ORDER BY ts DESC").all();
    if (rows.length < 2)
      return null;
    const latest = JSON.parse(rows[0].metrics);
    const baseIdx = Math.min(baseWindow, rows.length - 1);
    const base = JSON.parse(rows[baseIdx].metrics);
    return { span: baseIdx, latest, base };
  } catch {
    return null;
  }
}
function renderDrift(d) {
  if (!d)
    return "";
  const worse = [];
  const prevDrop = d.base.lawPrevalence - d.latest.lawPrevalence;
  if (prevDrop >= 0.03)
    worse.push(t(`конвенции −${Math.round(prevDrop * 100)}% (уползание от своей нормы)`, `conventions −${Math.round(prevDrop * 100)}% (drifting from the project's own norm)`));
  if (d.latest.orphans - d.base.orphans >= 3)
    worse.push(t(`сироты +${d.latest.orphans - d.base.orphans}`, `orphans +${d.latest.orphans - d.base.orphans}`));
  if (d.latest.broken - d.base.broken >= 1)
    worse.push(t(`битые ссылки +${d.latest.broken - d.base.broken}`, `broken links +${d.latest.broken - d.base.broken}`));
  if (d.base.density > 0 && d.latest.density - d.base.density >= 0.5)
    worse.push(t(`плотность графа +${(d.latest.density - d.base.density).toFixed(1)}/узел (оплотнение)`, `graph density +${(d.latest.density - d.base.density).toFixed(1)}/node (tightening)`));
  if (d.latest.gateCatches - d.base.gateCatches >= 10)
    worse.push(t(`гейт-поимки +${d.latest.gateCatches - d.base.gateCatches}`, `gate catches +${d.latest.gateCatches - d.base.gateCatches}`));
  if (worse.length === 0)
    return "";
  return t(` Уползание (за ${d.span} замеров, только ухудшения): ${worse.join(" · ")}`, ` Drift (over ${d.span} snapshots, regressions only): ${worse.join(" · ")}`);
}
var FIX_SUBJECT = /^fix(\(|!|:)|^revert|откат/i;
function computeHotspots(commits, sizeByFile, k = 8) {
  const fixFreq = new Map;
  for (const c of commits) {
    if (!FIX_SUBJECT.test(c.subject.trim()))
      continue;
    for (const f of new Set(c.files))
      fixFreq.set(f, (fixFreq.get(f) ?? 0) + 1);
  }
  return [...fixFreq.entries()].filter((e) => e[1] >= 2 && sizeByFile.has(e[0])).map((e) => ({ file: e[0], fixes: e[1], size: sizeByFile.get(e[0]), score: e[1] * sizeByFile.get(e[0]) })).sort((a, b) => b.score - a.score).slice(0, k);
}
function renderDriftReport(health, drift, hotspots) {
  const L = [t("Symbiont · здоровье проекта и куда оно движется", "Symbiont · project health and where it is heading"), ""];
  L.push(t(" Здоровье сейчас", " Health right now"));
  L.push(t(`   законов ${health.lawCount} · ср.распространённость ${Math.round(health.lawPrevalence * 100)}% · активных фактов ${health.activeFacts}`, `   laws ${health.lawCount} · avg prevalence ${Math.round(health.lawPrevalence * 100)}% · active facts ${health.activeFacts}`));
  L.push(t(`   граф ${health.graphNodes} узлов / ${health.graphEdges} рёбер (плотность ${health.density.toFixed(2)}/узел)`, `   graph ${health.graphNodes} nodes / ${health.graphEdges} edges (density ${health.density.toFixed(2)}/node)`));
  if (health.orphans > 0 || health.broken > 0)
    L.push(t(`   контент: сирот ${health.orphans} · битых ссылок ${health.broken}`, `   content: orphans ${health.orphans} · broken links ${health.broken}`));
  L.push("");
  const dl = renderDrift(drift);
  L.push(t(" Тренд (против прошлых замеров)", " Trend (against previous snapshots)"));
  L.push(dl ? "  " + dl.trim() : drift ? t("   стабильно или лучше — уползания нет", "   stable or better — no drift") : t("   снимков мало — тренд появится за несколько коммитов", "   too few snapshots — the trend appears after a few commits"));
  L.push("");
  L.push(t(" Где чаще всего чинят (частота починок × размер файла — там копится беспорядок; кандидаты на рефакторинг)", " Most-repaired places (fix frequency × file size — where mess accumulates; refactoring candidates)"));
  if (hotspots.length === 0)
    L.push(t("   выраженных зон нет — история починок ровная", "   no pronounced areas — the repair history is even"));
  else
    for (const h of hotspots)
      L.push(t(`   ${h.file} · фиксов ${h.fixes} · ${h.size} строк`, `   ${h.file} · fixes ${h.fixes} · ${h.size} lines`));
  return L.join(`
`);
}
function hotspotsFromGit(projectRoot) {
  const { spawnSync: spawnSync2 } = __require("node:child_process");
  const { readFileSync: readFileSync5 } = __require("node:fs");
  const { join: join5, extname: extname2 } = __require("node:path");
  const { parseCommitLog: parseCommitLog2 } = (init_constitution_derive(), __toCommonJS(exports_constitution_derive));
  const { CODE_EXT: CODE_EXT2 } = (init_walk(), __toCommonJS(exports_walk));
  const r = spawnSync2("git", ["log", "--name-only", "--pretty=format:@%H%x09%s", "-n", "400"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (r.status !== 0 || typeof r.stdout !== "string" || !r.stdout)
    return [];
  const commits = parseCommitLog2(r.stdout);
  const touched = new Set;
  for (const c of commits)
    if (FIX_SUBJECT.test(c.subject.trim()))
      for (const f of c.files)
        touched.add(f);
  const sizeByFile = new Map;
  for (const rel of touched) {
    if (!CODE_EXT2.has(extname2(rel).toLowerCase()))
      continue;
    try {
      sizeByFile.set(rel, readFileSync5(join5(projectRoot, rel), "utf8").split(`
`).length);
    } catch {}
  }
  return computeHotspots(commits, sizeByFile);
}

// src/passport/build.ts
import { readFileSync as readFileSync10, writeFileSync as writeFileSync3, mkdirSync, existsSync as existsSync6 } from "node:fs";
import { basename, join as join11, relative, dirname as dirname3 } from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";

// src/graph/cochange.ts
init_walk();
import { extname as extname2 } from "node:path";
var CODE_EXT2 = new Set([...CODE_EXT, ".sql"]);
var MAX_FILES_PER_COMMIT = 30;
function parseNameOnlyLog(text) {
  const commits = [];
  let current2 = null;
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (line.startsWith("@")) {
      if (current2 && current2.length > 0)
        commits.push(current2);
      current2 = [];
      continue;
    }
    if (!line || current2 === null)
      continue;
    const f = line.replaceAll("\\", "/");
    if (CODE_EXT2.has(extname2(f).toLowerCase()))
      current2.push(f);
  }
  if (current2 && current2.length > 0)
    commits.push(current2);
  return commits;
}
function pairCounts(commits, maxPerCommit = MAX_FILES_PER_COMMIT) {
  const pairs = new Map;
  const totals = new Map;
  for (const files of commits) {
    const uniq = [...new Set(files)];
    if (uniq.length < 1 || uniq.length > maxPerCommit)
      continue;
    for (const f of uniq)
      totals.set(f, (totals.get(f) ?? 0) + 1);
    for (let i = 0;i < uniq.length; i++) {
      for (let j = i + 1;j < uniq.length; j++) {
        const [a, b] = uniq[i] < uniq[j] ? [uniq[i], uniq[j]] : [uniq[j], uniq[i]];
        pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
  }
  return { pairs, totals };
}

// src/core/salsa.ts
import { createHash } from "node:crypto";
var sha1 = (s) => createHash("sha1").update(s).digest("hex");

class Engine {
  db;
  queries = new Map;
  execCount = new Map;
  constructor(dbPath) {
    this.db = openDb(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.run("CREATE TABLE IF NOT EXISTS inputs(key TEXT PRIMARY KEY, hash TEXT NOT NULL, changed_at INTEGER NOT NULL)");
    this.db.run("CREATE TABLE IF NOT EXISTS memo(query TEXT PRIMARY KEY, value TEXT NOT NULL, value_hash TEXT NOT NULL, verified_at INTEGER NOT NULL, changed_at INTEGER NOT NULL)");
    this.db.run("CREATE TABLE IF NOT EXISTS deps(query TEXT NOT NULL, dep TEXT NOT NULL, PRIMARY KEY(query, dep))");
    this.db.run("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    this.db.run("INSERT OR IGNORE INTO meta VALUES('rev', 0)");
  }
  invalidateIfCodeChanged(codeVersion) {
    this.db.run("CREATE TABLE IF NOT EXISTS code_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const row = this.db.query("SELECT v FROM code_meta WHERE k='projection_version'").get();
    if (row && row.v === codeVersion)
      return false;
    this.db.run("DELETE FROM memo");
    this.db.run("DELETE FROM deps");
    this.db.query("INSERT INTO code_meta(k,v) VALUES('projection_version',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(codeVersion);
    return true;
  }
  get rev() {
    return this.db.query("SELECT v FROM meta WHERE k='rev'").get().v;
  }
  bumpRev() {
    this.db.run("UPDATE meta SET v = v + 1 WHERE k='rev'");
    return this.rev;
  }
  setInput(key, hash) {
    const row = this.db.query("SELECT hash FROM inputs WHERE key=?").get(key);
    if (row && row.hash === hash)
      return;
    const rev = this.bumpRev();
    this.db.query("INSERT INTO inputs(key,hash,changed_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash, changed_at=excluded.changed_at").run(key, hash, rev);
  }
  register(name, fn) {
    this.queries.set(name, fn);
  }
  executions(name) {
    return this.execCount.get(name) ?? 0;
  }
  changedAtOf(dep) {
    if (dep.startsWith("input:")) {
      const row2 = this.db.query("SELECT changed_at FROM inputs WHERE key=?").get(dep.slice(6));
      return row2 ? row2.changed_at : Number.POSITIVE_INFINITY;
    }
    this.get(dep);
    const row = this.db.query("SELECT changed_at FROM memo WHERE query=?").get(dep);
    return row ? row.changed_at : Number.POSITIVE_INFINITY;
  }
  get(name) {
    const rev = this.rev;
    const memo = this.db.query("SELECT * FROM memo WHERE query=?").get(name);
    if (memo && memo.verified_at === rev)
      return JSON.parse(memo.value);
    if (memo) {
      const deps2 = this.db.query("SELECT dep FROM deps WHERE query=?").all(name).map((d) => d.dep);
      const clean = deps2.length > 0 && deps2.every((d) => this.changedAtOf(d) <= memo.verified_at);
      if (clean) {
        this.db.query("UPDATE memo SET verified_at=? WHERE query=?").run(rev, name);
        return JSON.parse(memo.value);
      }
    }
    const fn = this.queries.get(name);
    if (!fn)
      throw new Error(`Запрос не зарегистрирован: ${name}`);
    const deps = new Set;
    const ctx = {
      input: (key) => {
        deps.add("input:" + key);
        const row = this.db.query("SELECT hash FROM inputs WHERE key=?").get(key);
        return row ? row.hash : null;
      },
      get: (q) => {
        deps.add(q);
        return this.get(q);
      }
    };
    this.execCount.set(name, (this.execCount.get(name) ?? 0) + 1);
    const value = fn(ctx);
    const valueText = JSON.stringify(value ?? null);
    const valueHash = sha1(valueText);
    const changedAt = memo && memo.value_hash === valueHash ? memo.changed_at : rev;
    this.db.query("INSERT INTO memo(query,value,value_hash,verified_at,changed_at) VALUES(?,?,?,?,?) ON CONFLICT(query) DO UPDATE SET value=excluded.value, value_hash=excluded.value_hash, verified_at=excluded.verified_at, changed_at=excluded.changed_at").run(name, valueText, valueHash, rev, changedAt);
    this.db.query("DELETE FROM deps WHERE query=?").run(name);
    const insDep = this.db.query("INSERT OR IGNORE INTO deps(query,dep) VALUES(?,?)");
    for (const d of deps)
      insDep.run(name, d);
    return value;
  }
  close() {
    this.db.close();
  }
}

// src/passport/build.ts
init_walk();

// src/miner/packs.ts
init_i18n();
var AXES = [
  {
    id: "py-strings",
    exts: [".py", ".pyi"],
    area: "строки",
    all: /\bf["'][^"'\n]*["']|\.format\s*\(|["'][^"'\n]*%[sdrf]\b/g,
    isA: /^f["']/,
    labelA: pair("подстановка в строки — f-строки", "string interpolation — f-strings"),
    labelB: pair("подстановка в строки — .format() и %", "string interpolation — .format() and %"),
    min: 10,
    inStrings: true
  },
  {
    id: "py-typing",
    exts: [".py", ".pyi"],
    area: "сигнатуры",
    all: /^[ \t]*(?:async\s+)?def\s+\w+\s*\([^)]*\)[^\n:]*:/gm,
    isA: /->|\([^)]*\w\s*:\s*[A-Za-z]/,
    labelA: pair("сигнатуры функций — с аннотациями типов", "function signatures — with type annotations"),
    labelB: pair("сигнатуры функций — без аннотаций типов", "function signatures — without type annotations"),
    min: 10
  },
  {
    id: "php-array",
    exts: [".php", ".phtml", ".inc"],
    area: "массивы",
    all: /\barray\s*\(|(?<![\w\])'"$])\[\s*(?:['"\d]|\]|\[)/g,
    isA: /^\[/,
    labelA: pair("массивы — короткий синтаксис []", "arrays — short syntax []"),
    labelB: pair("массивы — array()", "arrays — array()"),
    min: 15
  },
  {
    id: "php-eq",
    exts: [".php", ".phtml", ".inc"],
    area: "сравнения",
    all: /(?<![=!<>])(?:===|!==|==(?!=)|!=(?!=))/g,
    isA: /===|!==/,
    labelA: pair("сравнение — строгое (=== / !==)", "comparison — strict (=== / !==)"),
    labelB: pair("сравнение — нестрогое (== / !=)", "comparison — loose (== / !=)"),
    min: 20
  },
  {
    id: "go-decl",
    exts: [".go"],
    area: "объявления",
    all: /:=|\bvar\s+\w+\s*(?:=|\w)/g,
    isA: /:=/,
    labelA: pair("объявления — короткая форма :=", "declarations — short form :="),
    labelB: pair("объявления — var", "declarations — var"),
    min: 15
  },
  {
    id: "go-receiver",
    exts: [".go"],
    area: "методы",
    all: /\bfunc\s*\(\s*\w+\s+\*?\w+\s*\)/g,
    isA: /\*/,
    labelA: pair("методы — на указателе (*T)", "methods — on pointer receiver (*T)"),
    labelB: pair("методы — на значении (T)", "methods — on value receiver (T)"),
    min: 10
  },
  {
    id: "kt-binding",
    exts: [".kt", ".kts"],
    area: "объявления",
    all: /\b(?:val|var)\s+\w+/g,
    isA: /\bval\b/,
    labelA: pair("привязки — неизменяемые (val)", "bindings — immutable (val)"),
    labelB: pair("привязки — изменяемые (var)", "bindings — mutable (var)"),
    min: 15
  },
  {
    id: "rs-binding",
    exts: [".rs"],
    area: "объявления",
    all: /\blet\s+(?:mut\s+)?\w+/g,
    isA: /\bmut\b/,
    labelA: pair("привязки — изменяемые (let mut)", "bindings — mutable (let mut)"),
    labelB: pair("привязки — неизменяемые (let)", "bindings — immutable (let)"),
    min: 15
  },
  {
    id: "clike-local-type",
    exts: [".cs", ".java"],
    area: "объявления",
    all: /^[ \t]*(?:var\s+\w+\s*=|(?:[A-Z]\w*(?:<[^>\n]*>)?|int|long|double|float|bool|boolean|string|char)(?:\[\])?\s+\w+\s*=)/gm,
    isA: /^[ \t]*var\b/,
    labelA: pair("локальные переменные — var (тип выводится)", "local variables — var (type inferred)"),
    labelB: pair("локальные переменные — с явным типом", "local variables — explicit type"),
    min: 15
  }
];
var BY_EXT = new Map;
for (const a of AXES) {
  for (const e of a.exts) {
    const list = BY_EXT.get(e);
    if (list)
      list.push(a);
    else
      BY_EXT.set(e, [a]);
  }
}
var HASH_COMMENT = new Set([".py", ".pyi", ".php", ".phtml", ".inc", ".rb", ".rake", ".pl", ".r", ".sh", ".yml", ".yaml"]);
var PHP_EXT = new Set([".php", ".phtml", ".inc"]);
function codeOnly(source, ext) {
  return splitCode(source, ext).code;
}
function splitCode(source, ext) {
  const php = PHP_EXT.has(ext);
  const hash = HASH_COMMENT.has(ext);
  const out = [];
  const notes = [];
  let i = 0;
  let inHtml = php;
  while (i < source.length) {
    const c = source[i];
    if (inHtml) {
      const open = source.indexOf("<?", i);
      if (open === -1)
        break;
      i = source.startsWith("<?php", open) ? open + 5 : open + 2;
      inHtml = false;
      continue;
    }
    if (php && c === "?" && source[i + 1] === ">") {
      inHtml = true;
      i += 2;
      continue;
    }
    if (c === "/" && source[i + 1] === "/" || hash && c === "#") {
      const nl = source.indexOf(`
`, i);
      notes.push(source.slice(i, nl === -1 ? source.length : nl), `
`);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      notes.push(source.slice(i, end === -1 ? source.length : end + 2), `
`);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      out.push(c, c);
      i++;
      while (i < source.length) {
        const s = source[i];
        if (s === "\\") {
          i += 2;
          continue;
        }
        if (s === `
` && c !== "`")
          break;
        i++;
        if (s === c)
          break;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return { code: out.join(""), comments: notes.join("") };
}
function countAxes(ext, content) {
  const out = {};
  const axes = BY_EXT.get(ext) ?? [];
  const code = axes.some((a) => !a.inStrings) ? codeOnly(content, ext) : content;
  for (const axis of axes) {
    let a = 0;
    let b = 0;
    for (const m of (axis.inStrings ? content : code).matchAll(axis.all)) {
      if (axis.isA.test(m[0]))
        a++;
      else
        b++;
    }
    if (a + b > 0)
      out[axis.id] = { a, b };
  }
  return out;
}
function addAxes(into, from) {
  for (const [id, c] of Object.entries(from)) {
    const acc = into[id];
    if (acc) {
      acc.a += c.a;
      acc.b += c.b;
    } else
      into[id] = { a: c.a, b: c.b };
  }
}

// src/miner/analyze.ts
init_i18n();
var emptyJsStats = () => ({
  decl: { var: 0, let: 0, const: 0 },
  fn: { arrow: 0, decl: 0 },
  fmr: { filter: 0, map: 0, reduce: 0, forLoops: 0 },
  naming: { camel: 0, snake: 0, upper: 0, pascal: 0, plain: 0 },
  hungarianPrefixes: {},
  hungarianBase: 0,
  params: { underscore: 0, plain: 0 },
  destructuredParams: 0,
  quotes: { single: 0, double: 0 },
  semiLines: { with: 0, without: 0 }
});
var count = (s, re) => (s.match(re) ?? []).length;
function classifyIdentifier(raw, stats, isVariable) {
  const id = raw.replace(/^_+|_+$/g, "");
  if (!id)
    return;
  if (/^[A-Z][A-Z0-9_]*$/.test(id) && id.length > 1)
    stats.naming.upper++;
  else if (id.includes("_"))
    stats.naming.snake++;
  else if (/^[A-Z]/.test(id))
    stats.naming.pascal++;
  else if (/[A-Z]/.test(id))
    stats.naming.camel++;
  else
    stats.naming.plain++;
  if (isVariable && id.length >= 3 && /^[a-z]/.test(id)) {
    stats.hungarianBase++;
    const m = id.match(/^([a-z]{1,2})[A-Z]/);
    if (m)
      stats.hungarianPrefixes[m[1]] = (stats.hungarianPrefixes[m[1]] ?? 0) + 1;
  }
}
function uniqueClassifier(stats) {
  const seen = new Set;
  return (id, isVariable) => {
    if (seen.has(id))
      return;
    seen.add(id);
    classifyIdentifier(id, stats, isVariable);
  };
}
function splitParams(list) {
  const out = [];
  let depth = 0;
  let angle = 0;
  let quote = "";
  let start = 0;
  for (let i = 0;i < list.length; i++) {
    const c = list[i];
    if (quote) {
      if (c === quote && list[i - 1] !== "\\")
        quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`")
      quote = c;
    else if (c === "(" || c === "[" || c === "{")
      depth++;
    else if (c === ")" || c === "]" || c === "}")
      depth = Math.max(0, depth - 1);
    else if (c === "<")
      angle++;
    else if (c === ">" && list[i - 1] !== "=")
      angle = Math.max(0, angle - 1);
    else if (c === "," && depth === 0 && angle === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.filter((p) => p.trim().length > 0);
}
function paramLists(code) {
  const out = [];
  const open = [];
  for (let i = 0;i < code.length; i++) {
    const c = code[i];
    if (c === "(") {
      open.push(i);
      continue;
    }
    if (c !== ")")
      continue;
    const start = open.pop();
    if (start === undefined)
      continue;
    const before = code.slice(Math.max(0, start - 40), start);
    const after = code.slice(i + 1, i + 5);
    if (/\bfunction\s*[\w$]*\s*$/.test(before) || /^\s*=>/.test(after))
      out.push(code.slice(start + 1, i));
  }
  return out;
}
function analyzeParams(paramList, stats) {
  for (const raw of splitParams(paramList)) {
    const p = raw.trim();
    if (!p)
      continue;
    if (p.startsWith("{") || p.startsWith("[")) {
      stats.destructuredParams++;
      continue;
    }
    const id = p.match(/^([A-Za-z_$][\w$]*)/)?.[1];
    if (!id)
      continue;
    if (id.startsWith("_"))
      stats.params.underscore++;
    else
      stats.params.plain++;
  }
}
function analyzeJs(content) {
  const stats = emptyJsStats();
  const noComments = content.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  stats.decl.var = count(noComments, /\bvar\s+[A-Za-z_$]/g);
  stats.decl.let = count(noComments, /\blet\s+[A-Za-z_$]/g);
  stats.decl.const = count(noComments, /\bconst\s+[A-Za-z_$]/g);
  stats.fn.arrow = count(noComments, /=>/g);
  stats.fn.decl = count(noComments, /\bfunction\b/g);
  stats.fmr.filter = count(noComments, /\.filter\s*\(/g);
  stats.fmr.map = count(noComments, /\.map\s*\(/g);
  stats.fmr.reduce = count(noComments, /\.reduce\s*\(/g);
  stats.fmr.forLoops = count(noComments, /\bfor\s*\(/g);
  const classify = uniqueClassifier(stats);
  for (const m of noComments.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
    classify(m[1], true);
  }
  for (const m of noComments.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    classify(m[1], false);
  }
  for (const list of paramLists(noComments))
    analyzeParams(list, stats);
  stats.quotes.single = count(noComments, /'(?:[^'\\\n]|\\.)*'/g);
  stats.quotes.double = count(noComments, /"(?:[^"\\\n]|\\.)*"/g);
  for (const line of noComments.split(`
`)) {
    const t2 = line.trim();
    if (!/^(?:var|let|const|return|throw|break|continue)\b/.test(t2))
      continue;
    if (/;$/.test(t2))
      stats.semiLines.with++;
    else if (/[\w$)\]'"`]$/.test(t2))
      stats.semiLines.without++;
  }
  return stats;
}
function detectIndent(content) {
  const lines = content.split(`
`);
  let tabLed = 0;
  const deltas = {};
  let prev = 0;
  let indented = 0;
  for (const line of lines) {
    if (!line.trim())
      continue;
    if (/^\t/.test(line)) {
      tabLed++;
      indented++;
      continue;
    }
    const lead = line.match(/^ */)[0].length;
    if (lead > 0)
      indented++;
    const d = lead - prev;
    if (d > 0 && d <= 8)
      deltas[d] = (deltas[d] ?? 0) + 1;
    prev = lead;
  }
  if (indented < 5)
    return null;
  if (tabLed > indented / 2)
    return "tab";
  const two = deltas[2] ?? 0;
  const four = deltas[4] ?? 0;
  if (two === 0 && four === 0)
    return null;
  if (two >= four * 2)
    return "s2";
  if (four >= two * 2)
    return "s4";
  return "other";
}
function analyzeUniversalNaming(content, ext, stats) {
  const noComments = codeOnly(content, ext);
  const classify = uniqueClassifier(stats);
  for (const m of noComments.matchAll(/(?:^|[\s(,])\$?([A-Za-z_][A-Za-z0-9_]{2,})\s*:?=(?!=)/gm)) {
    classify(m[1], false);
  }
  for (const m of noComments.matchAll(/\b(?:def|function|func|fn)\s+&?\$?([A-Za-z_][\w]*)/g)) {
    classify(m[1], false);
  }
}
var VUE_SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/g;
var JS_FAMILY = new Set([".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".vue"]);
var GENERATED_LINE_CHARS = 200;
function looksGenerated(content) {
  let chars = 0;
  let lines = 0;
  for (const line of content.split(`
`)) {
    if (!line.trim())
      continue;
    chars += line.length;
    lines++;
  }
  return lines > 0 && chars / lines > GENERATED_LINE_CHARS;
}
function analyzeFile(path, ext, content) {
  if (looksGenerated(content)) {
    return {
      path,
      ext,
      lines: content.split(`
`).length,
      indent: null,
      quoteVerdict: null,
      semiVerdict: null,
      vue: null,
      js: emptyJsStats(),
      axes: {},
      comments: { cyr: 0, lat: 0 }
    };
  }
  let jsContent = content;
  let vue = null;
  if (ext === ".vue") {
    const blocks = [...content.matchAll(VUE_SCRIPT_RE)];
    jsContent = blocks.map((b) => b[1]).join(`
`);
    if (/<script[^>]*\bsetup\b/.test(content))
      vue = "setup";
    else if (blocks.length > 0)
      vue = "options";
  }
  const js = JS_FAMILY.has(ext) ? analyzeJs(jsContent) : emptyJsStats();
  if (!JS_FAMILY.has(ext))
    analyzeUniversalNaming(content, ext, js);
  const q = js.quotes;
  const s = js.semiLines;
  return {
    path,
    ext,
    lines: content.split(`
`).length,
    indent: detectIndent(content),
    quoteVerdict: q.single + q.double < 5 ? null : q.single >= q.double * 2 ? "single" : q.double >= q.single * 2 ? "double" : null,
    semiVerdict: s.with + s.without < 8 ? null : s.with >= s.without * 2 ? "with" : s.without >= s.with * 2 ? "without" : null,
    vue,
    js,
    axes: countAxes(ext, JS_FAMILY.has(ext) ? jsContent : content),
    comments: letters(splitCode(jsContent, ext).comments)
  };
}
function aggregate(obs, allExts) {
  const agg = {
    codeFiles: obs.length,
    totalLines: 0,
    indent: {},
    quotes: {},
    semis: {},
    vue: {},
    decl: { var: 0, let: 0, const: 0 },
    fn: { arrow: 0, decl: 0 },
    fmr: { filter: 0, map: 0, reduce: 0, forLoops: 0 },
    naming: { camel: 0, snake: 0, upper: 0, pascal: 0, plain: 0 },
    hungarianPrefixes: {},
    hungarianBase: 0,
    params: { underscore: 0, plain: 0 },
    destructuredParams: 0,
    extHist: {},
    axes: {},
    comments: { cyr: 0, lat: 0 }
  };
  for (const ext of allExts)
    agg.extHist[ext || "(без расширения)"] = (agg.extHist[ext || "(без расширения)"] ?? 0) + 1;
  for (const o of obs) {
    agg.totalLines += o.lines;
    if (o.indent)
      agg.indent[o.indent] = (agg.indent[o.indent] ?? 0) + 1;
    if (o.quoteVerdict)
      agg.quotes[o.quoteVerdict] = (agg.quotes[o.quoteVerdict] ?? 0) + 1;
    if (o.semiVerdict)
      agg.semis[o.semiVerdict] = (agg.semis[o.semiVerdict] ?? 0) + 1;
    if (o.vue)
      agg.vue[o.vue] = (agg.vue[o.vue] ?? 0) + 1;
    for (const k of ["var", "let", "const"])
      agg.decl[k] += o.js.decl[k];
    agg.fn.arrow += o.js.fn.arrow;
    agg.fn.decl += o.js.fn.decl;
    for (const k of ["filter", "map", "reduce", "forLoops"])
      agg.fmr[k] += o.js.fmr[k];
    for (const k of ["camel", "snake", "upper", "pascal", "plain"])
      agg.naming[k] += o.js.naming[k];
    for (const [p, n] of Object.entries(o.js.hungarianPrefixes)) {
      agg.hungarianPrefixes[p] = (agg.hungarianPrefixes[p] ?? 0) + n;
    }
    agg.hungarianBase += o.js.hungarianBase;
    agg.params.underscore += o.js.params.underscore;
    agg.params.plain += o.js.params.plain;
    agg.destructuredParams += o.js.destructuredParams;
    addAxes(agg.axes, o.axes);
    agg.comments.cyr += o.comments.cyr;
    agg.comments.lat += o.comments.lat;
  }
  return agg;
}

// src/miner/facts.ts
init_i18n();
function tierOf(prevalence, total) {
  if (prevalence >= 0.95 && total >= 30)
    return "закон";
  if (prevalence >= 0.7 && total >= 10)
    return "привычка";
  if (prevalence >= 0.55)
    return "гипотеза";
  return "нет консенсуса";
}
function dominant(rec) {
  const entries = Object.entries(rec);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0)
    return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { key: entries[0][0], positive: entries[0][1], total };
}
function pushDominant(facts, area2, rec, label) {
  const d = dominant(rec);
  if (!d)
    return;
  const prevalence = d.positive / d.total;
  facts.push({
    area: area2,
    statement: label(d.key),
    positive: d.positive,
    total: d.total,
    prevalence,
    tier: tierOf(prevalence, d.total)
  });
}
var L = {
  L0: pair("отступы — 2 пробела", "indentation — 2 spaces"),
  L1: pair("отступы — 4 пробела", "indentation — 4 spaces"),
  L2: pair("отступы — табы", "indentation — tabs"),
  L3: pair("отступы — нестандартный шаг", "indentation — non-standard step"),
  L4: pair("кавычки — одинарные", "quotes — single"),
  L5: pair("кавычки — двойные", "quotes — double"),
  L6: pair("точки с запятой — используются", "semicolons — used"),
  L7: pair("точки с запятой — не используются", "semicolons — not used"),
  L8: pair("переменные — только var", "variables — var only"),
  L9: pair("переменные — const/let (var не используется)", "variables — const/let (no var)"),
  L10: pair("стрелочные функции — не используются", "arrow functions — not used"),
  L11: pair("стрелочные функции — используются свободно", "arrow functions — used freely"),
  L12: pair("filter/map/reduce — не используются (только циклы)", "filter/map/reduce — not used (loops only)"),
  L13: pair("filter/map/reduce — используются свободно", "filter/map/reduce — used freely"),
  L14: pair("идентификаторы — snake_case", "identifiers — snake_case"),
  L15: pair("идентификаторы — camelCase", "identifiers — camelCase"),
  L16: pair("параметры функций — с префиксом _", "function parameters — prefixed with _"),
  L17: pair("деструктуризация в параметрах — не используется", "destructuring in parameters — not used"),
  L18: pair("Vue-компоненты — <script setup>", "Vue components — <script setup>"),
  L19: pair("Vue-компоненты — Options API", "Vue components — Options API")
};
var INDENT_LABEL = {
  s2: L.L0,
  s4: L.L1,
  tab: L.L2,
  other: L.L3
};
function deriveFacts(agg) {
  const facts = [];
  pushDominant(facts, "форматирование", agg.indent, (k) => INDENT_LABEL[k] ?? k);
  pushDominant(facts, "форматирование", agg.quotes, (k) => k === "single" ? L.L4 : L.L5);
  pushDominant(facts, "форматирование", agg.semis, (k) => k === "with" ? L.L6 : L.L7);
  const declTotal = agg.decl.var + agg.decl.let + agg.decl.const;
  if (declTotal > 0) {
    const modern = agg.decl.let + agg.decl.const;
    const varShare = agg.decl.var / declTotal;
    if (varShare >= 0.5) {
      facts.push({
        area: "объявления",
        statement: L.L8,
        positive: agg.decl.var,
        total: declTotal,
        prevalence: varShare,
        tier: tierOf(varShare, declTotal)
      });
    } else {
      const p = modern / declTotal;
      facts.push({
        area: "объявления",
        statement: L.L9,
        positive: modern,
        total: declTotal,
        prevalence: p,
        tier: tierOf(p, declTotal)
      });
    }
  }
  const fnTotal = agg.fn.arrow + agg.fn.decl;
  if (fnTotal >= 20) {
    const arrowShare = agg.fn.arrow / fnTotal;
    if (arrowShare <= 0.05) {
      facts.push({
        area: "функции",
        statement: L.L10,
        positive: agg.fn.decl,
        total: fnTotal,
        prevalence: 1 - arrowShare,
        tier: tierOf(1 - arrowShare, fnTotal)
      });
    } else {
      facts.push({
        area: "функции",
        statement: L.L11,
        positive: agg.fn.arrow,
        total: fnTotal,
        prevalence: arrowShare,
        tier: tierOf(arrowShare, fnTotal)
      });
    }
  }
  const fmr = agg.fmr.filter + agg.fmr.map + agg.fmr.reduce;
  const iter = fmr + agg.fmr.forLoops;
  if (iter >= 20) {
    if (fmr / iter <= 0.05) {
      facts.push({
        area: "итерации",
        statement: L.L12,
        positive: agg.fmr.forLoops,
        total: iter,
        prevalence: 1 - fmr / iter,
        tier: tierOf(1 - fmr / iter, iter)
      });
    } else {
      facts.push({
        area: "итерации",
        statement: L.L13,
        positive: fmr,
        total: iter,
        prevalence: fmr / iter,
        tier: tierOf(fmr / iter, iter)
      });
    }
  }
  const namingTotal = agg.naming.camel + agg.naming.snake + agg.naming.plain + agg.naming.pascal;
  if (namingTotal >= 20) {
    const camelish = agg.naming.camel + agg.naming.plain;
    const p = camelish / namingTotal;
    if (agg.naming.snake > camelish) {
      facts.push({
        area: "именование",
        statement: L.L14,
        positive: agg.naming.snake,
        total: namingTotal,
        prevalence: agg.naming.snake / namingTotal,
        tier: tierOf(agg.naming.snake / namingTotal, namingTotal)
      });
    } else {
      facts.push({
        area: "именование",
        statement: L.L15,
        positive: camelish,
        total: namingTotal,
        prevalence: p,
        tier: tierOf(p, namingTotal)
      });
    }
  }
  const hungarianTotal = Object.values(agg.hungarianPrefixes).reduce((s, n) => s + n, 0);
  if (agg.hungarianBase >= 30) {
    const share = hungarianTotal / agg.hungarianBase;
    if (share >= 0.3) {
      const top = Object.entries(agg.hungarianPrefixes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => `${p}* (${n})`).join(", ");
      facts.push({
        area: "именование",
        statement: `венгерская нотация — префиксы типа: ${top}`,
        positive: hungarianTotal,
        total: agg.hungarianBase,
        prevalence: share,
        tier: tierOf(share, agg.hungarianBase)
      });
    }
  }
  const paramsTotal = agg.params.underscore + agg.params.plain;
  if (paramsTotal >= 30) {
    const share = agg.params.underscore / paramsTotal;
    if (share >= 0.5) {
      facts.push({
        area: "параметры",
        statement: L.L16,
        positive: agg.params.underscore,
        total: paramsTotal,
        prevalence: share,
        tier: tierOf(share, paramsTotal)
      });
    }
    const destrTotal = paramsTotal + agg.destructuredParams;
    const destrShare = agg.destructuredParams / destrTotal;
    if (destrShare <= 0.02 && destrTotal >= 50) {
      facts.push({
        area: "параметры",
        statement: L.L17,
        positive: destrTotal - agg.destructuredParams,
        total: destrTotal,
        prevalence: 1 - destrShare,
        tier: tierOf(1 - destrShare, destrTotal)
      });
    }
  }
  pushDominant(facts, "vue", agg.vue, (k) => k === "setup" ? L.L18 : L.L19);
  for (const axis of AXES) {
    const c = agg.axes[axis.id];
    if (!c)
      continue;
    const total = c.a + c.b;
    if (total < axis.min)
      continue;
    const positive = Math.max(c.a, c.b);
    const prevalence = positive / total;
    facts.push({
      area: axis.area,
      statement: c.a >= c.b ? axis.labelA : axis.labelB,
      positive,
      total,
      prevalence,
      tier: tierOf(prevalence, total)
    });
  }
  return facts;
}

// src/graph/imports.ts
import { dirname, join as join5, normalize as normalize2 } from "node:path/posix";
var defaults = {
  targets: [],
  indexes: [],
  sep: /[./\\]/,
  nsDecl: null,
  typeDecl: null,
  refPatterns: [],
  packageDir: false,
  leadingDrop: false,
  trailingDrop: false
};
var pack = (p) => ({ ...defaults, ...p });
var names = (list) => list.split(",").map((s) => s.trim().split(/\s+as\s+/i)[0].trim()).filter((s) => /^[\w$]/.test(s));
var JS_TARGETS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"];
var PACKS = [
  pack({
    id: "js",
    exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    patterns: [
      { re: /import\s+[^'"()]*?from\s+['"]([^'"]+)['"]/g, form: "path" },
      { re: /export\s+[^'"()]*?from\s+['"]([^'"]+)['"]/g, form: "path" },
      { re: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, form: "path" },
      { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, form: "path" },
      { re: /import\s+['"]([^'"]+)['"]/g, form: "path" },
      {
        re: /\b(?:define|require)\s*\(\s*\[([^\]]*)\]/g,
        form: "path",
        expand: (m) => [...m[1].matchAll(/['"]([^'"\n]+)['"]/g)].map((x) => x[1])
      },
      { re: /\/\/\/?\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]/g, form: "path", inComment: true }
    ],
    targets: JS_TARGETS,
    indexes: JS_TARGETS.map((e) => `index${e}`),
    leadingDrop: true
  }),
  pack({
    id: "py",
    exts: [".py", ".pyi"],
    patterns: [
      {
        re: /^[ \t]*from\s+(\.+)\s+import\s+([^\n#]+)/gm,
        form: "symbol",
        expand: (m) => names(m[2]).map((n) => m[1] + n)
      },
      { re: /^[ \t]*from\s+([.\w]+)\s+import\s/gm, form: "symbol" },
      { re: /^[ \t]*import\s+([.\w]+)/gm, form: "symbol" }
    ],
    targets: [".py", ".pyi"],
    indexes: ["__init__.py"],
    sep: /\./,
    leadingDrop: true
  }),
  pack({
    id: "php",
    exts: [".php", ".phtml", ".inc"],
    patterns: [
      { re: /\b(?:require|include)(?:_once)?\s*\(?[^;\n]*['"]([^'"\n]+)['"]/g, form: "path" },
      {
        re: /^[ \t]*use\s+([\w\\]+)\\\{([^}]+)\}/gm,
        form: "decl",
        expand: (m) => names(m[2]).map((n) => `${m[1]}\\${n}`)
      },
      { re: /^[ \t]*use\s+(?:function\s+|const\s+)?([\w\\]+)/gm, form: "decl" }
    ],
    targets: [".php", ".phtml", ".inc"],
    sep: /[\\/]/,
    nsDecl: /^[ \t]*(?:<\?php\s+)?namespace\s+([\w\\]+)/m,
    typeDecl: /^[ \t]*(?:<\?php\s+)?(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm,
    refPatterns: [
      { re: /\bextends\s+(\\?\w+(?:\\\w+)*(?:\s*,\s*\\?\w+(?:\\\w+)*)*)/g, form: "name", expand: (m) => m[1].split(",") },
      { re: /\bimplements\s+(\\?\w+(?:\\\w+)*(?:\s*,\s*\\?\w+(?:\\\w+)*)*)/g, form: "name", expand: (m) => m[1].split(",") },
      { re: /\bnew\s+(\\?[A-Za-z_][\w\\]*)/g, form: "name" },
      { re: /(?<![\w$>\\])(\\?[A-Za-z_][\w\\]*)\s*::/g, form: "name" },
      { re: /\binstanceof\s+(\\?[A-Za-z_][\w\\]*)/g, form: "name" },
      { re: /\bcatch\s*\(\s*(\\?[\w\\]+(?:\s*\|\s*\\?[\w\\]+)*)/g, form: "name", expand: (m) => m[1].split("|") },
      { re: /[(,]\s*\??(\\?[A-Za-z_][\w\\]*)\s+\$\w/g, form: "name" },
      { re: /\)\s*:\s*\??(\\?[A-Za-z_][\w\\]*)/g, form: "name" },
      { re: /['"](\\?[A-Za-z_]\w*(?:\\+[A-Za-z_]\w*)*)['"]/g, form: "name", bare: true },
      { re: /['"](?:[a-z]\w*\.)+([A-Z]\w*)['"]/g, form: "name", bare: true }
    ],
    leadingDrop: true
  }),
  pack({
    id: "go",
    exts: [".go"],
    patterns: [
      {
        re: /\bimport\s*\(([\s\S]*?)\)/g,
        form: "symbol",
        expand: (m) => [...m[1].matchAll(/"([^"\n]+)"/g)].map((x) => x[1])
      },
      { re: /\bimport\s+(?:[\w.]+\s+)?"([^"\n]+)"/g, form: "symbol" }
    ],
    targets: [".go"],
    sep: /\//,
    packageDir: true,
    leadingDrop: true
  }),
  pack({
    id: "jvm",
    exts: [".java", ".kt", ".kts", ".scala", ".groovy"],
    patterns: [{ re: /^[ \t]*import\s+(?:static\s+)?([\w.*]+)/gm, form: "decl" }],
    targets: [".java", ".kt", ".kts", ".scala", ".groovy"],
    sep: /\./,
    nsDecl: /^[ \t]*package\s+([\w.]+)/m
  }),
  pack({
    id: "cs",
    exts: [".cs"],
    patterns: [
      { re: /^[ \t]*using\s+(?:static\s+)?([\w.]+)\s*;/gm, form: "decl" },
      { re: /^[ \t]*using\s+[\w]+\s*=\s*([\w.]+)\s*;/gm, form: "decl" }
    ],
    targets: [".cs"],
    sep: /\./,
    nsDecl: /^[ \t]*namespace\s+([\w.]+)/m
  }),
  pack({
    id: "rust",
    exts: [".rs"],
    patterns: [
      { re: /^[ \t]*(?:pub\s+)?mod\s+([\w]+)\s*;/gm, form: "symbol", expand: (m) => [`self::${m[1]}`] },
      { re: /^[ \t]*(?:pub\s+)?use\s+([\w:]+)/gm, form: "symbol" }
    ],
    targets: [".rs"],
    indexes: ["mod.rs"],
    sep: /::/,
    leadingDrop: true,
    trailingDrop: true
  }),
  pack({
    id: "ruby",
    exts: [".rb", ".rake"],
    patterns: [
      {
        re: /\brequire_relative\s*\(?\s*['"]([^'"\n]+)['"]/g,
        form: "path",
        expand: (m) => [/^\.{1,2}\//.test(m[1]) ? m[1] : `./${m[1]}`]
      },
      { re: /\brequire\s*\(?\s*['"]([^'"\n]+)['"]/g, form: "path" }
    ],
    targets: [".rb", ".rake"],
    sep: /::|[./\\]/,
    typeDecl: /^[ \t]*(?:class|module)\s+(?:\w+::)*([A-Z]\w*)/gm,
    refPatterns: [
      { re: /^[ \t]*class\s+(?:\w+::)*\w+\s*<\s*((?:\w+::)*[A-Z]\w*)/gm, form: "name" },
      { re: /\b(?:include|extend|prepend)\s+((?:\w+::)*[A-Z]\w*)/g, form: "name" },
      { re: /\b([A-Z]\w*(?:::[A-Z]\w*)+)/g, form: "name" },
      { re: /\b([A-Z]\w*)(?=\.[a-z_])/g, form: "name" }
    ],
    leadingDrop: true
  }),
  pack({
    id: "c",
    exts: [".c", ".h", ".cpp", ".hpp", ".cc", ".hh", ".cxx"],
    patterns: [{ re: /^[ \t]*#\s*include\s+"([^"\n]+)"/gm, form: "path", inComment: true }],
    targets: [".h", ".hpp", ".hh", ".c", ".cpp", ".cc", ".cxx"],
    leadingDrop: true
  }),
  pack({
    id: "dart",
    exts: [".dart"],
    patterns: [{ re: /^[ \t]*(?:import|part|export)\s+['"]([^'"\n]+)['"]/gm, form: "path" }],
    targets: [".dart"],
    leadingDrop: true
  }),
  pack({
    id: "lua",
    exts: [".lua"],
    patterns: [{ re: /\brequire\s*\(?\s*['"]([^'"\n]+)['"]/g, form: "symbol" }],
    targets: [".lua"],
    indexes: ["init.lua"],
    sep: /[./]/,
    leadingDrop: true
  })
];
var BY_EXT2 = new Map;
for (const p of PACKS)
  for (const e of p.exts)
    BY_EXT2.set(e, p);
var extOf = (rel) => {
  const dot = rel.lastIndexOf(".");
  const slash = rel.lastIndexOf("/");
  return dot === -1 || dot < slash ? "" : rel.slice(dot).toLowerCase();
};
var packOf = (rel) => BY_EXT2.get(extOf(rel)) ?? null;
var COMMENTED = /(?:^|\n)[ \t]*(?:\/\/|\/\*|\*|#|--)[^\n]*$/;
var REF_STOP = new Set([
  "self",
  "parent",
  "static",
  "class",
  "function",
  "fn",
  "new",
  "clone",
  "return",
  "string",
  "int",
  "float",
  "bool",
  "array",
  "object",
  "mixed",
  "void",
  "never",
  "null",
  "true",
  "false",
  "callable",
  "iterable",
  "this",
  "match",
  "list",
  "if",
  "else",
  "elseif",
  "for",
  "foreach",
  "while",
  "switch",
  "case",
  "default",
  "throw",
  "try",
  "catch",
  "finally",
  "global",
  "echo",
  "print",
  "use",
  "const",
  "abstract",
  "final",
  "readonly",
  "public",
  "private",
  "protected",
  "var",
  "extends",
  "implements",
  "interface",
  "trait",
  "enum",
  "instanceof",
  "insteadof",
  "namespace",
  "require",
  "include",
  "require_once",
  "include_once",
  "and",
  "or",
  "xor",
  "yield"
]);
function extractSpecs(content, rel) {
  const p = packOf(rel);
  if (!p)
    return [];
  const seen = new Set;
  const out = [];
  const add = (form, spec) => {
    const key = `${form}
${spec}`;
    if (seen.has(key))
      return;
    seen.add(key);
    out.push({ spec, form });
  };
  const commented = (sp, m) => !sp.inComment && m.index !== undefined && COMMENTED.test(content.slice(Math.max(0, content.lastIndexOf(`
`, m.index)), m.index + 1));
  for (const sp of p.patterns) {
    for (const m of content.matchAll(sp.re)) {
      if (commented(sp, m))
        continue;
      for (const spec of sp.expand ? sp.expand(m) : [m[1]]) {
        if (spec)
          add(sp.form, spec);
      }
    }
  }
  if (p.refPatterns.length > 0) {
    const ns = p.nsDecl ? content.match(p.nsDecl)?.[1] ?? null : null;
    for (const sp of p.refPatterns) {
      for (const m of content.matchAll(sp.re)) {
        if (commented(sp, m))
          continue;
        for (const raw of sp.expand ? sp.expand(m) : [m[1]]) {
          const name = (raw ?? "").trim();
          if (!name)
            continue;
          const rooted = name.startsWith("\\");
          const body = rooted ? name.replace(/^\\+/, "") : name;
          if (!body || REF_STOP.has(body.toLowerCase()))
            continue;
          const spec = !rooted && !sp.bare && ns !== null && !body.includes("\\") ? `${ns}\\${body}` : body;
          add("name", spec);
        }
      }
    }
  }
  return out;
}
var push = (map, key, value) => {
  const list = map.get(key);
  if (list)
    list.push(value);
  else
    map.set(key, [value]);
};
var baseOf = (rel) => {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};
var nsKey = (s) => s.replace(/[\\/]+/g, ".").replace(/^\.+|\.+$/g, "");
function buildImportIndex(files) {
  const index = {
    files: new Set(files.map((f) => f.rel)),
    byBase: new Map,
    byDirName: new Map,
    dirFiles: new Map,
    byNs: new Map,
    byType: new Map,
    rootDirs: new Set,
    total: files.length,
    memo: new Map,
    tailMemo: new Map
  };
  const dirs = new Set;
  for (const f of files) {
    const ext = extOf(f.rel);
    push(index.byBase, baseOf(f.rel), { path: f.rel, noExt: ext ? f.rel.slice(0, -ext.length) : f.rel, ext });
    const slash = f.rel.lastIndexOf("/");
    const dir = slash === -1 ? "" : f.rel.slice(0, slash);
    push(index.dirFiles, dir, f.rel);
    if (dir) {
      dirs.add(dir);
      index.rootDirs.add(dir.split("/")[0]);
    }
    const p = packOf(f.rel);
    if (p && f.content) {
      const ns = p.nsDecl ? f.content.match(p.nsDecl)?.[1] ?? null : null;
      if (ns !== null)
        push(index.byNs, nsKey(ns), f.rel);
      if (p.typeDecl) {
        for (const m of f.content.matchAll(p.typeDecl))
          push(index.byType, m[1], { path: f.rel, ns });
      }
    }
  }
  for (const d of dirs)
    push(index.byDirName, d.slice(d.lastIndexOf("/") + 1), d);
  return index;
}
var DIR_SEGS = new Map;
var dirSegs = (path) => {
  const cached = DIR_SEGS.get(path);
  if (cached)
    return cached;
  const segs = path.split("/").slice(0, -1);
  if (DIR_SEGS.size < 1e5)
    DIR_SEGS.set(path, segs);
  return segs;
};
function nearest(fromRel, candidates) {
  if (candidates.length === 0)
    return null;
  if (candidates.length === 1)
    return candidates[0];
  const a = dirSegs(fromRel);
  let best = null;
  let bestDist = Infinity;
  let tie = false;
  for (const c of candidates) {
    const b = dirSegs(c);
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s])
      s++;
    const dist = a.length - s + (b.length - s);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
      tie = false;
    } else if (dist === bestDist)
      tie = true;
  }
  return tie ? null : best;
}
var MAX_SAME_NAME = 64;
var INDEX_BASES = new Map;
var indexBases = (p) => {
  const cached = INDEX_BASES.get(p.id);
  if (cached)
    return cached;
  const bases = [...new Set(p.indexes.map(baseOf))];
  INDEX_BASES.set(p.id, bases);
  return bases;
};
function matchTail(tail, p, index) {
  if (!tail)
    return [];
  const memoKey = `${p.id}
${tail}`;
  const cached = index.tailMemo.get(memoKey);
  if (cached)
    return cached;
  const found = matchTailUncached(tail, p, index);
  index.tailMemo.set(memoKey, found);
  return found;
}
function matchTailUncached(tail, p, index) {
  const out = new Set;
  const last = tail.slice(tail.lastIndexOf("/") + 1);
  if ((index.byBase.get(last)?.length ?? 0) > MAX_SAME_NAME)
    return [];
  const dot = last.lastIndexOf(".");
  const hasExt = dot > 0 && /^[A-Za-z0-9]+$/.test(last.slice(dot + 1));
  for (const c of index.byBase.get(hasExt ? last.slice(0, dot) : last) ?? []) {
    if (!hasExt && !p.targets.includes(c.ext))
      continue;
    const side = hasExt ? c.path : c.noExt;
    if (side === tail || side.endsWith(`/${tail}`))
      out.add(c.path);
  }
  for (const base of indexBases(p)) {
    const want = `${tail}/${base}`;
    for (const c of index.byBase.get(base) ?? []) {
      if (!p.targets.includes(c.ext))
        continue;
      if (c.noExt === want || c.noExt.endsWith(`/${want}`))
        out.add(c.path);
    }
  }
  return [...out];
}
function matchPackageDir(tail, p, index) {
  const last = tail.slice(tail.lastIndexOf("/") + 1);
  const groups = [];
  for (const dir of index.byDirName.get(last) ?? []) {
    if (dir !== tail && !dir.endsWith(`/${tail}`))
      continue;
    const inside = (index.dirFiles.get(dir) ?? []).filter((f) => p.targets.includes(extOf(f)));
    if (inside.length > 0)
      groups.push(inside);
  }
  return groups;
}
function tails(segs, p) {
  const out = [];
  const maxLead = p.leadingDrop ? segs.length - 1 : 0;
  const maxTrail = p.trailingDrop ? Math.min(2, segs.length - 1) : 0;
  for (let len = segs.length;len >= 1; len--) {
    for (let start = 0;start <= maxLead; start++) {
      const end = start + len;
      if (end > segs.length)
        continue;
      if (segs.length - end > maxTrail)
        continue;
      out.push(segs.slice(start, end).join("/"));
    }
  }
  return [...new Set(out)];
}
var SIGIL = /^(?:~~\/|~\/|@\/|#\/|\$\/)/;
var bareAllowed = (segs, rooted) => segs.length >= 2 || rooted;
function resolvePath(fromRel, spec, p, index) {
  const clean = spec.replace(/^package:/, "").replace(/[?#].*$/, "");
  if (clean.startsWith("./") || clean.startsWith("../")) {
    const base = normalize2(join5(dirname(fromRel), clean));
    if (base.startsWith(".."))
      return [];
    const hit = matchTail(base, p, index).filter((f) => f === base || f.startsWith(`${base}.`) || f.startsWith(`${base}/`));
    const exact = nearest(fromRel, hit);
    return exact ? [exact] : [];
  }
  const sigil = SIGIL.test(clean);
  const rest = normalize2(clean.replace(SIGIL, "")).replace(/^(?:\.\.\/)+/, "");
  if (!rest || rest === ".")
    return [];
  const segs = rest.split("/").filter((s) => s && s !== ".");
  if (segs.length === 0)
    return [];
  const named = p.targets.includes(extOf(segs[segs.length - 1]));
  if (!sigil && !named && !index.rootDirs.has(segs[0]))
    return [];
  if (!bareAllowed(segs, sigil || named))
    return [];
  for (const tail of tails(segs, p)) {
    const hit = nearest(fromRel, matchTail(tail, p, index));
    if (hit)
      return [hit];
  }
  return [];
}
function resolveSymbol(fromRel, spec, p, index) {
  let rel = 0;
  let body = spec;
  if (p.id === "py") {
    rel = body.length - body.replace(/^\.+/, "").length;
    body = body.slice(rel);
  } else if (p.id === "rust") {
    const m = body.match(/^(crate|self|super)::/);
    if (m) {
      rel = m[1] === "super" ? 2 : m[1] === "self" ? 1 : 0;
      body = body.slice(m[0].length);
      if (m[1] === "crate") {
        const segs2 = body.split(p.sep).filter(Boolean);
        for (const tail of tails(segs2, p)) {
          const hit = nearest(fromRel, matchTail(tail, p, index));
          if (hit)
            return [hit];
        }
        return [];
      }
    }
  }
  const segs = body.split(p.sep).filter(Boolean);
  if (segs.length === 0)
    return [];
  if (rel > 0) {
    const up = Array.from({ length: rel - 1 }, () => "..").join("/");
    const base = normalize2(join5(dirname(fromRel), up, segs.join("/")));
    if (base.startsWith(".."))
      return [];
    const hit = matchTail(base, p, index).filter((f) => f === base || f.startsWith(`${base}.`) || f.startsWith(`${base}/`));
    const exact = nearest(fromRel, hit);
    return exact ? [exact] : [];
  }
  if (p.packageDir) {
    if (!bareAllowed(segs, false))
      return [];
    for (const tail of tails(segs, p)) {
      const groups = matchPackageDir(tail, p, index);
      if (groups.length === 1)
        return groups[0];
      if (groups.length > 1)
        return [];
    }
    return [];
  }
  if (p.id === "py") {
    const sibling = normalize2(join5(dirname(fromRel), segs.join("/")));
    if (!sibling.startsWith("..")) {
      const hit = matchTail(sibling, p, index).filter((f) => f === sibling || f.startsWith(`${sibling}.`) || f.startsWith(`${sibling}/`));
      const exact = nearest(fromRel, hit);
      if (exact)
        return [exact];
    }
  }
  if (!bareAllowed(segs, false))
    return [];
  for (const tail of tails(segs, p)) {
    const hit = nearest(fromRel, matchTail(tail, p, index));
    if (hit)
      return [hit];
  }
  return [];
}
function resolveDecl(fromRel, spec, p, index) {
  const key = nsKey(spec);
  if (!key)
    return [];
  const segs = key.split(".");
  const wide = Math.max(8, Math.floor(index.total * 0.1));
  const wholeNs = segs[segs.length - 1] === "*" ? segs.slice(0, -1).join(".") : key;
  const whole = index.byNs.get(wholeNs) ?? [];
  if (whole.length > 0 && (p.id === "cs" || segs[segs.length - 1] === "*")) {
    if (whole.length > wide)
      return [];
    return whole;
  }
  if (segs.length >= 2) {
    const owner = index.byNs.get(segs.slice(0, -1).join(".")) ?? [];
    const name = segs[segs.length - 1];
    const hit = nearest(fromRel, owner.filter((f) => baseOf(f) === name));
    if (hit)
      return [hit];
  }
  if (whole.length === 1)
    return whole;
  const direct = nearest(fromRel, matchTail(segs.join("/"), p, index));
  return direct ? [direct] : [];
}
function resolveName(fromRel, spec, p, index) {
  const segs = spec.split(p.sep).filter(Boolean);
  if (segs.length === 0)
    return [];
  const name = segs[segs.length - 1];
  if (name.length < 2)
    return [];
  const all = index.byType.get(name) ?? [];
  if (all.length === 0 || all.length > MAX_SAME_NAME)
    return [];
  const ns = segs.length > 1 && p.nsDecl !== null ? nsKey(segs.slice(0, -1).join(".")) : null;
  const candidates = all.filter((t2) => ns !== null ? t2.ns !== null && nsKey(t2.ns) === ns : p.nsDecl === null || t2.ns === null).map((t2) => t2.path);
  const hit = nearest(fromRel, candidates);
  return hit ? [hit] : [];
}
function resolveSpec(fromRel, spec, index) {
  const p = packOf(fromRel);
  if (!p)
    return [];
  const key = `${dirname(fromRel)}
${spec.form}
${spec.spec}`;
  const memo = index.memo.get(key);
  if (memo)
    return memo.filter((f) => f !== fromRel);
  const hit = spec.form === "path" ? resolvePath(fromRel, spec.spec, p, index) : spec.form === "symbol" ? resolveSymbol(fromRel, spec.spec, p, index) : spec.form === "name" ? resolveName(fromRel, spec.spec, p, index) : resolveDecl(fromRel, spec.spec, p, index);
  index.memo.set(key, hit);
  return hit.filter((f) => f !== fromRel);
}
var indexCache = new WeakMap;

// src/graph/graph.ts
function buildEdges(files) {
  const nodes = files.map((f) => f.rel);
  const edges = [];
  const seen = new Set;
  const index = buildImportIndex(files);
  for (const f of files) {
    for (const spec of extractSpecs(f.content, f.rel)) {
      for (const to of resolveSpec(f.rel, spec, index)) {
        if (to === f.rel)
          continue;
        const key = `${f.rel}\x00${to}`;
        if (seen.has(key))
          continue;
        seen.add(key);
        edges.push({ from: f.rel, to });
      }
    }
  }
  return { nodes, edges };
}
function pagerank(nodes, edges, damping = 0.85, iterations = 40) {
  const n = nodes.length;
  if (n === 0)
    return new Map;
  const idx = new Map(nodes.map((node, i) => [node, i]));
  const out = nodes.map(() => []);
  for (const e of edges) {
    const f = idx.get(e.from);
    const t2 = idx.get(e.to);
    if (f !== undefined && t2 !== undefined && f !== t2)
      out[f].push(t2);
  }
  let rank = new Array(n).fill(1 / n);
  for (let it = 0;it < iterations; it++) {
    const next = new Array(n).fill((1 - damping) / n);
    let danglingSum = 0;
    for (let i = 0;i < n; i++) {
      if (out[i].length === 0) {
        danglingSum += rank[i];
        continue;
      }
      const share = rank[i] * damping / out[i].length;
      for (const t2 of out[i])
        next[t2] += share;
    }
    const danglingShare = danglingSum * damping / n;
    for (let i = 0;i < n; i++)
      next[i] += danglingShare;
    rank = next;
  }
  return new Map(nodes.map((node, i) => [node, rank[i]]));
}
function personalizedPagerank(nodes, edges, seeds, damping = 0.85, iterations = 50, selfLoop = 0.1) {
  const n = nodes.length;
  if (n === 0)
    return new Map;
  const idx = new Map(nodes.map((node, i) => [node, i]));
  const seedW = new Map(seeds.map((s) => [s.file, s.weight]));
  const pers = nodes.map((node) => seedW.get(node) ?? 1);
  const persSum = pers.reduce((a, b) => a + b, 0);
  const p = pers.map((w) => w / persSum);
  const outList = nodes.map(() => []);
  const outW = new Array(n).fill(selfLoop);
  for (const e of edges) {
    const f = idx.get(e.from);
    const t2 = idx.get(e.to);
    if (f !== undefined && t2 !== undefined && f !== t2) {
      outList[f].push([t2, 1]);
      outW[f] += 1;
    }
  }
  let rank = p.slice();
  for (let it = 0;it < iterations; it++) {
    const next = p.map((pi) => (1 - damping) * pi);
    for (let i = 0;i < n; i++) {
      const flow = rank[i] * damping / outW[i];
      next[i] += flow * selfLoop;
      for (const [t2, w] of outList[i])
        next[t2] += flow * w;
    }
    rank = next;
  }
  return new Map(nodes.map((node, i) => [node, rank[i]]));
}
function taskRelevantNeighbors(nodes, edges, seeds, neighborhood, k = 3, minLift = 1.3) {
  const perso = personalizedPagerank(nodes, edges, seeds);
  const global = personalizedPagerank(nodes, edges, []);
  return [...neighborhood].map((file) => ({ file, lift: (perso.get(file) ?? 0) / (global.get(file) || 0.000000001) })).filter((x) => x.lift >= minLift).sort((a, b) => b.lift - a.lift).slice(0, k);
}
function reachableUndirected(edges, seedFiles, hops) {
  const adj = new Map;
  const link = (a, b) => {
    const list = adj.get(a);
    if (list)
      list.push(b);
    else
      adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const visited = new Set(seedFiles);
  let frontier = [...seedFiles];
  for (let h = 0;h < hops && frontier.length > 0; h++) {
    const next = [];
    for (const node of frontier) {
      for (const nb of adj.get(node) ?? []) {
        if (visited.has(nb))
          continue;
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  for (const s of seedFiles)
    visited.delete(s);
  return visited;
}
function nodeStats(g) {
  const pr = pagerank(g.nodes, g.edges);
  const inDeg = new Map;
  const outDeg = new Map;
  for (const e of g.edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  return g.nodes.map((file) => ({
    file,
    rank: pr.get(file) ?? 0,
    inDeg: inDeg.get(file) ?? 0,
    outDeg: outDeg.get(file) ?? 0
  })).sort((a, b) => b.rank - a.rank);
}

// src/graph/entities.ts
init_i18n();
import { dirname as dirname2, join as join6, normalize as normalize3 } from "node:path/posix";
var ENTITY_EXT = new Set([".md", ".mdx", ".markdown", ".html", ".htm", ".yaml", ".yml"]);
var EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
var MD_LINK_RE = /(^|[^!])\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
var MD_DEF_RE = /^\[([^\]^]+)\]:\s+(\S+)/gm;
var WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
var HREF_RE = /href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([^<]*)/gi;
var YAML_VALUE_RE = /^[ \t]*(?:-[ \t]+)?(?:([\w.-]+):[ \t]+)?["']?([^"'\n#]+?)["']?[ \t]*$/gm;
var hasEntityExt = (target) => {
  const dot = target.lastIndexOf(".");
  return dot !== -1 && ENTITY_EXT.has(target.slice(dot).toLowerCase());
};
var looksPathish = (v) => v.includes("/") || hasEntityExt(v);
function extractContentLinks(ext, content) {
  const out = [];
  const push2 = (anchor, target, explicit) => {
    const t2 = target.trim();
    if (t2.length === 0 || t2.startsWith("#"))
      return;
    out.push({ anchor: anchor.trim().toLowerCase().replace(/\s+/g, " "), target: t2, explicit });
  };
  for (const m of content.matchAll(MD_LINK_RE))
    push2(m[2], m[3], true);
  for (const m of content.matchAll(MD_DEF_RE))
    push2(m[1], m[2], true);
  for (const m of content.matchAll(WIKI_LINK_RE))
    push2(m[2] ?? m[1], m[1].trim(), true);
  for (const m of content.matchAll(HREF_RE))
    push2(m[2], m[1], true);
  if (ext === ".yaml" || ext === ".yml") {
    for (const m of content.matchAll(YAML_VALUE_RE)) {
      const value = (m[2] ?? "").trim();
      if (looksPathish(value) && !value.includes(" ") && !value.includes("]("))
        push2(m[1] ?? "", value, false);
    }
  }
  return out;
}
var stripExt = (rel) => {
  const dot = rel.lastIndexOf(".");
  const slash = rel.lastIndexOf("/");
  return dot > slash ? rel.slice(0, dot) : rel;
};
function buildResolveIndex(rels) {
  const byPath = new Map;
  const noExt = new Map;
  const add = (key, rel) => {
    const list = noExt.get(key);
    if (list)
      list.push(rel);
    else
      noExt.set(key, [rel]);
  };
  for (const rel of rels) {
    byPath.set(rel.toLowerCase(), rel);
    const bare = stripExt(rel).toLowerCase();
    add(bare, rel);
    if (bare.endsWith("/index"))
      add(bare.slice(0, -"/index".length), rel);
  }
  return { byPath, noExt };
}
function suffixMatch(index, key) {
  const exact = index.noExt.get(key);
  if (exact)
    return best(exact);
  const candidates = [];
  for (const [k, rels] of index.noExt) {
    if (k.endsWith("/" + key))
      candidates.push(...rels);
  }
  return candidates.length > 0 ? best(candidates) : null;
}
var best = (rels) => [...rels].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
function resolveContentTarget(fromRel, rawTarget, index) {
  if (EXTERNAL_RE.test(rawTarget))
    return { kind: "external" };
  let t2 = rawTarget.split("#")[0].split("?")[0].trim().replaceAll("\\", "/");
  if (t2.endsWith("/"))
    t2 = t2.slice(0, -1);
  if (t2.length === 0)
    return { kind: "external" };
  const lower = t2.toLowerCase();
  const tryKeys = (base) => {
    const direct = index.byPath.get(base);
    if (direct)
      return direct;
    const bare = index.noExt.get(hasEntityExt(base) ? stripExt(base) : base);
    return bare ? best(bare) : null;
  };
  if (lower.startsWith("/")) {
    const hit = tryKeys(lower.slice(1)) ?? suffixMatch(index, hasEntityExt(lower) ? stripExt(lower.slice(1)) : lower.slice(1));
    if (hit)
      return { kind: "entity", rel: hit };
    return hasEntityExt(lower) ? { kind: "broken" } : { kind: "unresolved" };
  }
  const joined = normalize3(join6(dirname2(fromRel.toLowerCase()), lower));
  if (!joined.startsWith("..")) {
    const hit = tryKeys(joined);
    if (hit)
      return { kind: "entity", rel: hit };
  }
  const slug = suffixMatch(index, hasEntityExt(lower) ? stripExt(lower) : lower);
  if (slug)
    return { kind: "entity", rel: slug };
  return hasEntityExt(lower) ? { kind: "broken" } : { kind: "unresolved" };
}
var kindOf = (ext) => ext === ".yaml" || ext === ".yml" ? "yaml" : ext === ".html" || ext === ".htm" ? "html" : "md";
var HUB_MIN_OUT = 5;
var HUB_NAMES = new Set(["index", "readme", "home"]);
function buildEntityGraph(files) {
  const rels = files.map((f) => f.rel);
  const index = buildResolveIndex(rels);
  const edges = [];
  const edgeSeen = new Set;
  const broken = [];
  const brokenSeen = new Set;
  let unresolved = 0;
  const anchorTargets = new Map;
  for (const f of files) {
    for (const link of extractContentLinks(f.ext, f.content)) {
      const res = resolveContentTarget(f.rel, link.target, index);
      if (res.kind === "external")
        continue;
      if (res.kind === "unresolved") {
        unresolved++;
        continue;
      }
      if (res.kind === "broken") {
        if (!link.explicit)
          continue;
        const key2 = `${f.rel}|${link.target}`;
        if (!brokenSeen.has(key2)) {
          brokenSeen.add(key2);
          broken.push({ from: f.rel, target: link.target });
        }
        continue;
      }
      if (res.rel === f.rel)
        continue;
      const key = `${f.rel}|${res.rel}|${link.anchor}`;
      if (edgeSeen.has(key))
        continue;
      edgeSeen.add(key);
      edges.push({ from: f.rel, to: res.rel, anchor: link.anchor });
      if (link.anchor.length > 0) {
        const set = anchorTargets.get(link.anchor) ?? new Set;
        set.add(res.rel);
        anchorTargets.set(link.anchor, set);
      }
    }
  }
  const inSets = new Map;
  const outSets = new Map;
  for (const e of edges) {
    let out = outSets.get(e.from);
    if (!out) {
      out = new Set;
      outSets.set(e.from, out);
    }
    out.add(e.to);
    let into = inSets.get(e.to);
    if (!into) {
      into = new Set;
      inSets.set(e.to, into);
    }
    into.add(e.from);
  }
  const hubs = rels.filter((rel) => {
    const out = outSets.get(rel)?.size ?? 0;
    const base = stripExt(rel).split("/").pop() ?? "";
    return out >= HUB_MIN_OUT || HUB_NAMES.has(base.toLowerCase()) && out > 0;
  });
  const depth = new Map;
  let frontier = hubs;
  for (const h of hubs)
    depth.set(h, 0);
  let d = 0;
  while (frontier.length > 0) {
    d++;
    const next = [];
    for (const node of frontier) {
      for (const to of outSets.get(node) ?? []) {
        if (depth.has(to))
          continue;
        depth.set(to, d);
        next.push(to);
      }
    }
    frontier = next;
  }
  const nodes = files.map((f) => ({
    file: f.rel,
    kind: kindOf(f.ext),
    inDeg: inSets.get(f.rel)?.size ?? 0,
    outDeg: outSets.get(f.rel)?.size ?? 0,
    depth: depth.get(f.rel) ?? null,
    isHub: false
  })).sort((a, b) => b.inDeg - a.inDeg || (a.file < b.file ? -1 : 1));
  const hubSet = new Set(hubs);
  for (const n of nodes)
    n.isHub = hubSet.has(n.file);
  const orphans = nodes.filter((n) => n.inDeg === 0 && !n.isHub).map((n) => n.file);
  const orphanSet = new Set(orphans);
  const unreachable = hubs.length === 0 ? [] : nodes.filter((n) => n.depth === null && !orphanSet.has(n.file)).map((n) => n.file);
  const dupAnchors = [...anchorTargets.entries()].filter((pair2) => pair2[1].size >= 2).map((pair2) => ({ anchor: pair2[0], targets: [...pair2[1]].sort() })).sort((a, b) => b.targets.length - a.targets.length);
  return { nodes, edges, broken, unresolved, hubs, unreachable, orphans, dupAnchors };
}
function renderEntityBlock(g) {
  if (g.nodes.length < 5 || g.edges.length < 3)
    return "";
  const lines = [
    t("## Контент-граф (сущности и перелинковка; детали: passport_orphans / passport_reach)", "## Content graph (entities and interlinking; details: passport_orphans / passport_reach)"),
    "",
    `- ${t("сущностей", "entities")}: ${g.nodes.length} · ${t("перелинковок", "links")}: ${g.edges.length} · ${t("хабов", "hubs")}: ${g.hubs.length}`
  ];
  const issues = [];
  if (g.orphans.length > 0)
    issues.push(`${t("сироты (0 входящих)", "orphans (0 inbound)")}: ${g.orphans.length}`);
  if (g.unreachable.length > 0)
    issues.push(`${t("недостижимы из хабов", "unreachable from hubs")}: ${g.unreachable.length}`);
  if (g.broken.length > 0)
    issues.push(`${t("битые внутренние ссылки", "broken internal links")}: ${g.broken.length}`);
  if (g.dupAnchors.length > 0)
    issues.push(`${t("анкоры на разные цели", "anchors pointing to different targets")}: ${g.dupAnchors.length}`);
  if (issues.length > 0)
    lines.push(`- ⚠ ${issues.join(" · ")}`);
  lines.push("");
  return lines.join(`
`);
}

// src/passport/profile.ts
init_signals();
init_i18n();
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "node:fs";
import { join as join7 } from "node:path";
var evidenceEn = (ru) => ru === "заявлено в доках" ? "declared in the docs" : ru.startsWith("тестовых файлов: ") ? `test files: ${ru.slice("тестовых файлов: ".length)}` : ru;
var evidenceListEn = (ru, sep) => ru.split(sep).map(evidenceEn).join(sep);
pattern(/^безопасность — защитные слои: (.+) \(их ослабление — не рядовая правка\)$/, (m) => `security — protective layers: ${m[1]} (weakening them is not an ordinary change)`);
pattern(/^безопасность — явных защитных слоёв не обнаружено \(появятся — станут неприкосновенными\)$/, () => "security — no explicit protective layers found (once they appear, they become inviolable)");
pattern(/^(.+) — заявлена в доках, в коде проекта не обнаружена$/, (m) => `${axisName(m[1])} — declared in the docs, not found in the project's code`);
pattern(/^(.+) — ось качества здесь \((.+)\)$/, (m) => `${axisName(m[1])} — a quality axis here (${evidenceListEn(m[2], "; ")})`);
var DETECTORS = [
  { axis: "корректность", signal: "testing" },
  { axis: "производительность", signal: "performance" },
  { axis: "SEO", signal: "seo" },
  { axis: "целостность данных", signal: "db" },
  { axis: "поставляемость", signal: "deploy" },
  { axis: "наблюдаемость", signal: "observability" },
  { axis: "доступность", signal: "a11y" },
  { axis: "совместимость", signal: "compat" },
  { axis: "приватность", signal: "privacy" }
];
var README_LIMIT = 40000;
function readConceptText(root, relPaths) {
  const parts = [];
  for (const name of ["README.md", "readme.md", "README.rst", "CONCEPT.md", "AGENTS.md", "CLAUDE.md"]) {
    try {
      parts.push(readFileSync5(join7(root, name), "utf8").slice(0, README_LIMIT));
    } catch {}
  }
  const docFiles = relPaths.filter((p) => /^(docs|\.docs|doc)\//i.test(p) && p.endsWith(".md")).slice(0, 12);
  for (const rel of docFiles) {
    try {
      parts.push(readFileSync5(join7(root, rel), "utf8").slice(0, 8000));
    } catch {}
  }
  return parts.join(`
`);
}
function readPackageSignals(root) {
  const { all } = readManifestDeps(root);
  let scripts = "";
  try {
    const pkg = JSON.parse(readFileSync5(join7(root, "package.json"), "utf8"));
    scripts = Object.values(pkg.scripts ?? {}).join(" ");
  } catch {}
  return { deps: all, scripts };
}
function probeProfile(root, relPaths) {
  const { deps } = readPackageSignals(root);
  const docsText = readConceptText(root, relPaths);
  if (relPaths.length === 0 && deps.length === 0 && docsText.trim().length === 0)
    return [];
  const probes = [];
  const ciPresent = [".github/workflows", ".gitlab-ci.yml", "Jenkinsfile"].filter((p) => existsSync3(join7(root, p)));
  for (const d of DETECTORS) {
    const sig = SIGNALS[d.signal];
    const evidence = [];
    if (sig.paths) {
      const hits = relPaths.filter((p) => sig.paths.test(p));
      if (hits.length > 0) {
        evidence.push(d.axis === "корректность" ? `тестовых файлов: ${hits.length}` : hits.slice(0, 2).join(", "));
      }
    }
    if (d.axis === "поставляемость" && ciPresent.length > 0)
      evidence.push(ciPresent.join(", "));
    if (d.axis === "корректность" && ciPresent.length > 0 && evidence.length > 0)
      evidence.push("CI");
    if (sig.deps) {
      const hits = deps.filter((x) => sig.deps.test(x)).slice(0, 3);
      if (hits.length > 0)
        evidence.push(hits.join(", "));
    }
    if (sig.docs && sig.docs.test(docsText))
      evidence.push("заявлено в доках");
    if (evidence.length > 0)
      probes.push({ axis: d.axis, evidence });
  }
  const sec = SIGNALS.security;
  const layers = [
    ...deps.filter((x) => sec.deps.test(x)).slice(0, 4),
    ...relPaths.filter((p) => sec.paths.test(p)).slice(0, 3)
  ];
  probes.push({ axis: "безопасность", evidence: layers });
  return probes;
}
function profileFacts(probes) {
  return probes.map((p) => {
    const n = p.evidence.length;
    if (p.axis === "безопасность") {
      return {
        area: "профиль качества",
        statement: n > 0 ? `безопасность — защитные слои: ${p.evidence.join(", ")} (их ослабление — не рядовая правка)` : "безопасность — явных защитных слоёв не обнаружено (появятся — станут неприкосновенными)",
        positive: Math.max(n, 1),
        total: Math.max(n, 1),
        prevalence: 1,
        tier: n > 0 ? "привычка" : "гипотеза"
      };
    }
    const onlyDocs = p.evidence.length === 1 && p.evidence[0] === "заявлено в доках";
    return {
      area: "профиль качества",
      statement: onlyDocs ? `${p.axis} — заявлена в доках, в коде проекта не обнаружена` : `${p.axis} — ось качества здесь (${p.evidence.join("; ")})`,
      positive: n,
      total: n,
      prevalence: 1,
      tier: n >= 2 ? "привычка" : "гипотеза"
    };
  });
}

// src/passport/build.ts
init_constitution_derive();

// src/passport/cascade.ts
init_signals();
import { readFileSync as readFileSync6 } from "node:fs";
import { join as join8 } from "node:path";
var ZONE_AXES = [
  { axis: "корректность", signal: "testing" },
  { axis: "целостность данных", signal: "db" },
  { axis: "SEO", signal: "seo" },
  { axis: "поставляемость", signal: "deploy" },
  { axis: "доступность", signal: "a11y" },
  { axis: "безопасность", signal: "security" },
  { axis: "фронтенд", signal: "frontend" }
];
var FRAGILE_MIN_FIXES = 4;
var ZONE_MIN_FILES = 2;
var LOCAL_DOC_LIMIT = 400;
function zoneAncestors(file) {
  const parts = file.replaceAll("\\", "/").split("/");
  if (parts.length <= 1)
    return [];
  const out = [];
  for (let i = 1;i < parts.length; i++)
    out.push(parts.slice(0, i).join("/"));
  return out;
}
function localDocs(root, zone, zonePaths) {
  const docs = zonePaths.filter((p) => /\.(md|mdx|rst|txt)$/i.test(p)).slice(0, 6);
  const parts = [];
  for (const rel of docs) {
    try {
      parts.push(readFileSync6(join8(root, rel), "utf8").slice(0, LOCAL_DOC_LIMIT));
    } catch {}
  }
  return parts.join(`
`);
}
function computeZoneProfiles(root, relPaths, fixZones = {}) {
  const byZone = new Map;
  for (const p of relPaths) {
    for (const z of zoneAncestors(p)) {
      const list = byZone.get(z);
      if (list)
        list.push(p);
      else
        byZone.set(z, [p]);
    }
  }
  const out = [];
  for (const entry of byZone) {
    const zone = entry[0];
    const paths = entry[1];
    if (paths.length < ZONE_MIN_FILES)
      continue;
    const docs = localDocs(root, zone, paths);
    const axes = [];
    for (const d of ZONE_AXES) {
      if (matchSignal(SIGNALS[d.signal], { paths, docs }))
        axes.push(d.axis);
    }
    const constraints = [];
    if (matchSignal(SIGNALS.legacy, { paths, docs })) {
      constraints.push("зона объявлена устаревшей — менять минимально, улучшения сверх задачи не вносить");
    }
    const fixes = fixZones[zone] ?? 0;
    if (fixes >= FRAGILE_MIN_FIXES) {
      constraints.push(`зона хрупкая (${fixes} правок-починок в истории) — менять осторожно и с проверкой`);
    }
    if (axes.length > 0 || constraints.length > 0)
      out.push({ zone, axes, constraints });
  }
  out.sort((a, b) => a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0);
  return out;
}
function effectiveProfile(file, rootAxes, profiles) {
  const byZone = new Map(profiles.map((p) => [p.zone, p]));
  const rootSet = new Set(rootAxes);
  const added = [];
  const constraints = [];
  let deepest = null;
  for (const z of zoneAncestors(file)) {
    const p = byZone.get(z);
    if (!p)
      continue;
    deepest = z;
    for (const a of p.axes) {
      if (!rootSet.has(a) && !added.includes(a))
        added.push(a);
    }
    for (const c of p.constraints) {
      if (!constraints.includes(c))
        constraints.push(c);
    }
  }
  if (!deepest || added.length === 0 && constraints.length === 0)
    return null;
  return { zone: deepest, addedAxes: added, constraints };
}
function rootAxesFromFacts(statements) {
  const out = [];
  for (const s of statements) {
    const axis = s.split("—")[0].trim();
    if (axis.length > 0 && !out.includes(axis))
      out.push(axis);
  }
  return out;
}
function renderEffective(eff) {
  const parts = [];
  if (eff.addedAxes.length > 0)
    parts.push(`дополнительно важно здесь: ${eff.addedAxes.join(", ")}`);
  for (const c of eff.constraints)
    parts.push(c);
  return `Symbiont · условия каталога ${eff.zone} (унаследованы от родительских): ${parts.join(" · ")}`;
}
function ensureZoneTable(db) {
  db.run("CREATE TABLE IF NOT EXISTS zone_profile(zone TEXT PRIMARY KEY, axes TEXT NOT NULL, constraints TEXT NOT NULL)");
}
function storeZoneProfiles(db, profiles) {
  ensureZoneTable(db);
  db.run("DELETE FROM zone_profile");
  const ins = db.query("INSERT INTO zone_profile(zone, axes, constraints) VALUES(?,?,?)");
  for (const p of profiles)
    ins.run(p.zone, JSON.stringify(p.axes), JSON.stringify(p.constraints));
}
function readZoneProfiles(db) {
  try {
    ensureZoneTable(db);
    return db.query("SELECT zone, axes, constraints FROM zone_profile").all().map((r) => ({ zone: r.zone, axes: JSON.parse(r.axes), constraints: JSON.parse(r.constraints) }));
  } catch {
    return [];
  }
}

// src/gardener/rename.ts
function migrateRenames(db, current2) {
  try {
    if (current2.size === 0)
      return 0;
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='node_summary'").get().n > 0;
    if (!has)
      return 0;
    const rows = db.query("SELECT file, content_hash FROM node_summary").all();
    if (rows.length === 0)
      return 0;
    const summarized = new Set(rows.map((r) => r.file));
    const byHash = new Map;
    for (const [f, h] of current2) {
      const list = byHash.get(h) ?? [];
      list.push(f);
      byHash.set(h, list);
    }
    let migrated = 0;
    for (const r of rows) {
      if (current2.has(r.file))
        continue;
      const candidates = byHash.get(r.content_hash) ?? [];
      if (candidates.length !== 1)
        continue;
      const to = candidates[0];
      if (summarized.has(to))
        continue;
      db.query("UPDATE node_summary SET file=? WHERE file=?").run(to, r.file);
      summarized.add(to);
      for (const table of ["node_heat", "node_visits"]) {
        try {
          const exists = db.query(`SELECT 1 x FROM ${table} WHERE file=?`).get(to);
          if (exists)
            db.query(`DELETE FROM ${table} WHERE file=?`).run(r.file);
          else
            db.query(`UPDATE ${table} SET file=? WHERE file=?`).run(to, r.file);
        } catch {}
      }
      migrated++;
    }
    return migrated;
  } catch {
    return 0;
  }
}

// src/env/config-graph.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { extname as extname3 } from "node:path";
var CONFIG_EXT = new Set([".json", ".yml", ".yaml", ".toml", ".ini", ".conf", ".env", ".cfg", ".properties"]);
var CONFIG_NAME = /(^|\/)(\.env[\w.-]*|[\w.-]*\.?config\.[tj]s|nginx[\w.-]*\.conf|docker-compose[\w.-]*\.ya?ml|Dockerfile|\.htaccess|[\w-]*\.tf|Caddyfile|\.npmrc|Procfile)$/i;
function isConfigFile(rel) {
  if (CONFIG_EXT.has(extname3(rel).toLowerCase()))
    return true;
  return CONFIG_NAME.test(rel.replaceAll("\\", "/"));
}
var KV_PATTERNS = [
  /^\s*["']?([\w.-]{2,60})["']?\s*[:=]\s*["']?([^\n"',;{}]{1,300})/gm,
  /^\s*(?:add_header|set|proxy_set_header)\s+([\w-]{2,60})\s+["']?([^;\n]{1,300})/gim,
  /^\s*([A-Z][A-Z0-9_]{2,60})\s+(.{1,300})$/gm,
  /"([\w.-]{2,60})"\s*:\s*"?([^",}\n]{1,300})/g,
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,60})\s*=\s*(.{0,300})$/gm
];
var STOP_TOKENS = new Set([
  "true",
  "false",
  "null",
  "none",
  "self",
  "default",
  "name",
  "type",
  "value",
  "version",
  "path",
  "url",
  "host",
  "port",
  "image",
  "build",
  "test",
  "main",
  "index",
  "src",
  "dist",
  "public",
  "app",
  "http",
  "https",
  "localhost",
  "latest",
  "production",
  "development",
  "string",
  "number",
  "object"
]);
function significantTokens(key, value, strict = false) {
  const out = new Set;
  const consider = (raw) => {
    const t2 = raw.trim().replace(/^['"`]|['"`]$/g, "");
    if (t2.length < 3 || t2.length > 60)
      return;
    const low = t2.toLowerCase();
    if (STOP_TOKENS.has(low))
      return;
    const strongForm = /^[A-Z][A-Z0-9_]{2,}$/.test(t2) || /^[a-z]+-[a-z-]+$/.test(low) || /^[a-z][\w.-]*\.[a-z]{2,}$/.test(low) || /^[a-z]+:$/.test(low) || /^\d{2,5}$/.test(t2);
    const weakForm = /^[a-z][\w-]{4,}$/.test(low);
    if (strongForm || !strict && weakForm)
      out.add(t2);
  };
  consider(key);
  for (const part of value.split(/[\s,;|]+/))
    consider(part);
  return [...out];
}
function parseConfigFile(rel, content) {
  const out = [];
  const seen = new Set;
  for (const re of KV_PATTERNS) {
    for (const m of content.matchAll(re)) {
      const key = m[1].trim();
      const value = (m[2] ?? "").trim();
      const id = `${key}=${value}`;
      if (seen.has(id))
        continue;
      seen.add(id);
      const tokens = significantTokens(key, value);
      if (tokens.length === 0)
        continue;
      const valueTokens = significantTokens(key, value, true);
      out.push({ file: rel, key, value: value.slice(0, 300), tokens, valueTokens });
      if (out.length >= 400)
        return out;
    }
  }
  return out;
}
function lexicalLinks(entries, codeFiles2) {
  const out = [];
  const byToken = new Map;
  for (const e of entries) {
    for (const t2 of e.valueTokens) {
      const list = byToken.get(t2) ?? [];
      list.push(e);
      byToken.set(t2, list);
    }
  }
  const tooCommon = new Set([...byToken.entries()].filter((p) => p[1].length > 8).map((p) => p[0]));
  const CODE_SHARE_LIMIT = 0.12;
  const maxFiles = Math.max(3, Math.floor(codeFiles2.length * CODE_SHARE_LIMIT));
  const hitCount = new Map;
  for (const f of codeFiles2) {
    const lower = f.content.toLowerCase();
    for (const token of byToken.keys()) {
      if (lower.includes(token.toLowerCase()))
        hitCount.set(token, (hitCount.get(token) ?? 0) + 1);
    }
  }
  const seen = new Set;
  for (const f of codeFiles2) {
    const lower = f.content.toLowerCase();
    for (const entry of byToken) {
      const token = entry[0];
      if (tooCommon.has(token) || (hitCount.get(token) ?? 0) > maxFiles)
        continue;
      if (!lower.includes(token.toLowerCase()))
        continue;
      for (const e of entry[1]) {
        if (e.file === f.rel)
          continue;
        const id = `${e.file}|${f.rel}|${token}`;
        if (seen.has(id))
          continue;
        seen.add(id);
        out.push({ configFile: e.file, key: e.key, codeFile: f.rel, via: "лексика", token });
      }
    }
  }
  return out;
}
function historicalLinks(cochange, minPairs = 2) {
  const out = [];
  for (const c of cochange) {
    if (c.n < minPairs)
      continue;
    const aIsConfig = isConfigFile(c.a);
    const bIsConfig = isConfigFile(c.b);
    if (aIsConfig === bIsConfig)
      continue;
    out.push({
      configFile: aIsConfig ? c.a : c.b,
      key: "(файл целиком)",
      codeFile: aIsConfig ? c.b : c.a,
      via: "история",
      token: null
    });
  }
  return out;
}
function readConfigEntries(root, relPaths, read = (p) => readFileSync7(p, "utf8")) {
  const out = [];
  for (const rel of relPaths) {
    if (!isConfigFile(rel))
      continue;
    try {
      out.push(...parseConfigFile(rel, read(`${root}/${rel}`)));
    } catch {}
  }
  return out;
}

// src/env/links.ts
init_i18n();
var MAX_CODE_PER_CONFIG = 12;
function ensureConfigEdgeTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS config_edges(
       config_file TEXT NOT NULL, code_file TEXT NOT NULL, via TEXT NOT NULL,
       config_key TEXT NOT NULL, token TEXT,
       PRIMARY KEY(config_file, code_file, config_key))`);
}
function storeConfigEdges(db, links) {
  ensureConfigEdgeTable(db);
  db.run("DELETE FROM config_edges");
  const perConfig = new Map;
  for (const l of links) {
    const list = perConfig.get(l.configFile) ?? [];
    list.push(l);
    perConfig.set(l.configFile, list);
  }
  const ins = db.query("INSERT OR IGNORE INTO config_edges(config_file, code_file, via, config_key, token) VALUES(?,?,?,?,?)");
  let stored = 0;
  for (const entry of perConfig) {
    const list = entry[1];
    list.sort((a, b) => a.via === b.via ? 0 : a.via === "история" ? -1 : 1);
    for (const l of list.slice(0, MAX_CODE_PER_CONFIG)) {
      ins.run(l.configFile, l.codeFile, l.via, l.key, l.token);
      stored++;
    }
  }
  return stored;
}
function readConfigEdges(db, codeFile) {
  try {
    ensureConfigEdgeTable(db);
    const rows = codeFile ? db.query("SELECT config_file, code_file, via, config_key, token FROM config_edges WHERE code_file=?").all(codeFile) : db.query("SELECT config_file, code_file, via, config_key, token FROM config_edges").all();
    return rows.map((r) => ({
      configFile: String(r.config_file),
      codeFile: String(r.code_file),
      via: String(r.via),
      key: String(r.config_key),
      token: r.token === null ? null : String(r.token)
    }));
  } catch {
    return [];
  }
}
function collectConfigLinks(entries, codeFiles2, cochange) {
  const lex = lexicalLinks(entries, codeFiles2);
  const hist = historicalLinks(cochange);
  const seen = new Set;
  const out = [];
  for (const l of [...hist, ...lex]) {
    const id = `${l.configFile}|${l.codeFile}|${l.key}`;
    if (seen.has(id))
      continue;
    seen.add(id);
    out.push(l);
  }
  return out;
}
function renderConfigInfluence(rows) {
  if (rows.length === 0)
    return "";
  const parts = rows.slice(0, 3).map((r) => {
    const why = r.via === "история" ? t("правились вместе", "changed together") : r.token ? t(`упоминание «${r.token}»`, `mention of “${r.token}”`) : t("связь по содержимому", "linked by content");
    const key = r.key !== "(файл целиком)" ? ` · ${r.key}` : "";
    return `${r.configFile}${key} (${why})`;
  });
  return `Symbiont · ${t("этим кодом управляет конфигурация", "this code is governed by configuration")}: ${parts.join(" · ")}`;
}
var configPathsOf = (relPaths) => relPaths.filter(isConfigFile);

// src/passport/artifacts.ts
init_i18n();
var EXT_CLASS = {
  ".ts": "код",
  ".js": "код",
  ".mjs": "код",
  ".cjs": "код",
  ".tsx": "код",
  ".jsx": "код",
  ".vue": "код",
  ".py": "код",
  ".go": "код",
  ".php": "код",
  ".rb": "код",
  ".java": "код",
  ".cs": "код",
  ".kt": "код",
  ".rs": "код",
  ".c": "код",
  ".cpp": "код",
  ".h": "код",
  ".hpp": "код",
  ".swift": "код",
  ".scala": "код",
  ".lua": "код",
  ".dart": "код",
  ".sh": "код",
  ".ps1": "код",
  ".sql": "код",
  ".r": "код",
  ".pl": "код",
  ".md": "контент",
  ".mdx": "контент",
  ".txt": "контент",
  ".rst": "контент",
  ".adoc": "контент",
  ".html": "разметка-стили",
  ".htm": "разметка-стили",
  ".css": "разметка-стили",
  ".scss": "разметка-стили",
  ".sass": "разметка-стили",
  ".less": "разметка-стили",
  ".svg": "разметка-стили",
  ".json": "данные",
  ".yaml": "данные",
  ".yml": "данные",
  ".csv": "данные",
  ".tsv": "данные",
  ".xml": "данные",
  ".toml": "данные",
  ".ndjson": "данные",
  ".parquet": "данные",
  ".env": "конфиг-инфра",
  ".ini": "конфиг-инфра",
  ".conf": "конфиг-инфра",
  ".dockerfile": "конфиг-инфра",
  ".fig": "дизайн",
  ".sketch": "дизайн",
  ".psd": "дизайн",
  ".ai": "дизайн",
  ".xd": "дизайн",
  ".png": "дизайн",
  ".jpg": "дизайн",
  ".jpeg": "дизайн",
  ".webp": "дизайн",
  ".gif": "дизайн",
  ".ico": "дизайн",
  ".docx": "офис",
  ".doc": "офис",
  ".pptx": "офис",
  ".ppt": "офис",
  ".xlsx": "офис",
  ".xls": "офис",
  ".pdf": "офис",
  ".mp4": "медиа",
  ".mov": "медиа",
  ".webm": "медиа",
  ".mp3": "медиа",
  ".wav": "медиа",
  ".avif": "медиа"
};
function classify(fileName, ext) {
  const lower = fileName.toLowerCase();
  if (/(^|\/)(dockerfile|makefile|jenkinsfile)$/.test(lower) || /^\.(gitignore|npmrc|editorconfig|dockerignore)$/.test(lower)) {
    return "конфиг-инфра";
  }
  if (/docker-compose[.-]/.test(lower) || /(^|\/)\.github\//.test(lower))
    return "конфиг-инфра";
  return EXT_CLASS[ext] ?? "прочее";
}
function artifactProfile(relPaths) {
  const counts = {};
  for (const { name, ext } of relPaths) {
    const c = classify(name, ext);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const total = relPaths.length;
  let dominant2 = null;
  let max = 0;
  for (const [c, n] of Object.entries(counts)) {
    if (c !== "прочее" && n > max) {
      max = n;
      dominant2 = c;
    }
  }
  const present = Object.entries(counts).filter(([c, n]) => c !== "прочее" && n >= 3 && n / Math.max(total, 1) >= 0.01).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { counts, total, dominant: dominant2, present };
}
var CLASS_AXES = {
  "код": ["корректность", "производительность", "поддерживаемость", "отказоустойчивость", "наблюдаемость"],
  "контент": ["находимость/SEO", "связность/перелинковка", "полнота/покрытие", "доступность", "легитимность/контекст"],
  "разметка-стили": ["доступность", "производительность", "совместимость", "находимость/SEO"],
  "данные": ["целостность данных", "корректность", "полнота/покрытие"],
  "конфиг-инфра": ["отказоустойчивость", "безопасность", "поставляемость", "масштабируемость (горизонт+вертикаль)"],
  "дизайн": ["доступность", "согласованность", "UX/эргономика"],
  "офис": ["полнота/покрытие", "согласованность", "доступность"],
  "медиа": ["производительность", "доступность", "стоимость"],
  "прочее": []
};
function activeAxes(profile) {
  const axes = new Set(["безопасность", "корректность"]);
  for (const c of profile.present)
    for (const a of CLASS_AXES[c])
      axes.add(a);
  return [...axes];
}
var classLabel = (c) => ({
  "код": t("код", "code"),
  "контент": t("контент/тексты", "content/texts"),
  "разметка-стили": t("разметка/стили", "markup/styles"),
  "данные": t("данные", "data"),
  "конфиг-инфра": t("конфиг/инфра", "config/infra"),
  "дизайн": t("дизайн/графика", "design/graphics"),
  "офис": t("офис-документы", "office documents"),
  "медиа": t("медиа", "media"),
  "прочее": t("прочее", "other")
})[c];
function renderQualityStance(profile) {
  if (profile.present.length === 0)
    return "";
  const axes = activeAxes(profile);
  return [
    t("## Стойка качества (стоячая; действует без повторения в промптах)", "## Quality stance (standing; applies without being repeated in prompts)"),
    "",
    `- ${t("цель", "goal")}: ${t("топ-1 по осям, применимым к этому проекту", "best in class on the axes that apply to this project")} — ${axisList(axes)}`,
    `- ${t("ограничение", "constraint")}: ${t("улучшения сверх задачи — предлагать, не делать; если правка описывается одним предложением — без церемоний", "improvements beyond the task — propose, do not perform; if a change fits in one sentence, no ceremony")}`
  ].join(`
`);
}
function renderArtifacts(profile) {
  if (profile.total === 0 || profile.present.length === 0)
    return "";
  const lines = [t("## Состав проекта (из чего сделан; универсальные оси активируются по материалу)", "## What this project is made of (universal quality axes switch on by material)"), ""];
  for (const c of profile.present) {
    const n = profile.counts[c];
    const pct = Math.round(n / profile.total * 100);
    lines.push(`- ${classLabel(c)} — ${n} ${t("файлов", "files")} (${pct}%)`);
  }
  lines.push(`- ${t("активные оси качества", "active quality axes")}: ${axisList(activeAxes(profile))}`);
  return lines.join(`
`);
}

// src/passport/stack.ts
init_signals();
init_i18n();
import { existsSync as existsSync4 } from "node:fs";
import { join as join9 } from "node:path";
var DETECTORS2 = [
  { name: "nuxt", kind: "framework", deps: /^nuxt$/, files: ["nuxt.config.ts", "nuxt.config.js"] },
  { name: "next.js", kind: "framework", deps: /^next$/, files: ["next.config.js", "next.config.mjs"] },
  { name: "react", kind: "framework", deps: /^react$/ },
  { name: "vue", kind: "framework", deps: /^vue$/ },
  { name: "svelte", kind: "framework", deps: /^svelte$/ },
  { name: "angular", kind: "framework", deps: /^@angular\/core$/ },
  { name: "express", kind: "framework", deps: /^express$/ },
  { name: "fastify", kind: "framework", deps: /^fastify$/ },
  { name: "nestjs", kind: "framework", deps: /^@nestjs\/core$/ },
  { name: "nitro", kind: "framework", deps: /^nitropack$/ },
  { name: "django", kind: "framework", paths: /(^|\/)manage\.py$|(^|\/)settings\.py$/ },
  { name: "laravel", kind: "framework", paths: /(^|\/)artisan$/, files: ["artisan"] },
  { name: "rails", kind: "framework", files: ["Gemfile"], paths: /(^|\/)config\/routes\.rb$/ },
  { name: "unity", kind: "framework", paths: /\.unity$|(^|\/)Assets\// },
  { name: "nginx", kind: "infra", paths: /nginx[^/]*\.conf$|(^|\/)nginx\// },
  { name: "docker", kind: "infra", paths: /(^|\/)dockerfile$|docker-compose[.-]/i, files: ["Dockerfile"] },
  { name: "kubernetes", kind: "infra", paths: /(^|\/)(k8s|kube|manifests)\/|(^|\/)(deployment|statefulset|daemonset|ingress|hpa)[^/]*\.ya?ml$/i, deps: /^@kubernetes\/client-node$/ },
  { name: "helm", kind: "infra", paths: /(^|\/)(charts?)\/|(^|\/)Chart\.ya?ml$|(^|\/)values\.ya?ml$/i },
  { name: "terraform", kind: "infra", paths: /\.tf$|(^|\/)\.terraform\// },
  { name: "pm2", kind: "infra", paths: /(^|\/)ecosystem\.config\.(js|cjs|ts)$/, deps: /^pm2$/ },
  { name: "systemd", kind: "infra", paths: /\.service$|(^|\/)systemd\// },
  { name: "serverless/lambda", kind: "infra", paths: /(^|\/)serverless\.ya?ml$|(^|\/)(template\.ya?ml|sam\.ya?ml)$/i, deps: /^(aws-lambda|@aws-sdk\/.+|serverless)$/ },
  { name: "postgres", kind: "infra", deps: /^(pg|postgres|postgres\.js|@prisma\/client|drizzle-orm|typeorm|knex)$/ },
  { name: "mysql", kind: "infra", deps: /^(mysql|mysql2)$/ },
  { name: "mongodb", kind: "infra", deps: /^(mongodb|mongoose)$/ },
  { name: "redis", kind: "infra", deps: /^(redis|ioredis)$/ },
  { name: "kafka", kind: "infra", deps: /^(kafkajs|node-rdkafka)$/ },
  { name: "ci", kind: "infra", paths: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$/ }
];
var DOMAIN_DETECTORS = [
  { name: "база данных", kind: "domain", signal: "db" },
  { name: "SEO", kind: "domain", signal: "seo" },
  { name: "фронтенд", kind: "domain", signal: "frontend" },
  { name: "тестирование", kind: "domain", signal: "testing" },
  { name: "деплой/инфра", kind: "domain", signal: "deploy" },
  { name: "веб-сервер", kind: "domain", paths: /nginx[^/]*\.conf$|(^|\/)nginx\/|(^|\/)(caddyfile|apache2?\.conf)$/i },
  { name: "фоновые задачи", kind: "domain", paths: /(^|\/)(cron|jobs?|workers?|queues?|schedulers?)\//i, deps: /^(bullmq|bull|agenda|node-cron|node-schedule)$/ },
  { name: "API", kind: "domain", paths: /(^|\/)(api|routes?|controllers?|endpoints?)\//i },
  { name: "платежи", kind: "domain", paths: /(^|\/)(payment|billing|checkout|orders?)\//i, deps: /^(stripe|@stripe\/.+)$/ },
  { name: "аутентификация", kind: "domain", paths: /(^|\/)(auth|identity|session)\//i, deps: /^(passport|jsonwebtoken|next-auth|@auth\/.+|lucia)$/ },
  { name: "оркестрация/масштабирование", kind: "domain", paths: /(^|\/)(k8s|kube|manifests)\/|(deployment|statefulset|hpa|ingress)[^/]*\.ya?ml$|(^|\/)ecosystem\.config\.|\.service$/i, deps: /^(pm2|@kubernetes\/client-node)$/ },
  { name: "дизайн-ассеты", kind: "domain", paths: /\.(fig|sketch|psd|ai|xd)$/i },
  { name: "документы", kind: "domain", paths: /\.(docx|pptx|xlsx)$/i }
];
var readDeps = readManifestDeps;
function detectStack(projectRoot, relPaths) {
  const { all: deps, prod: prodDeps } = readDeps(projectRoot);
  const hasDep = (re) => deps.some((d) => re.test(d));
  const hasPath = (re) => relPaths.some((p) => re.test(p));
  const hasFile = (files) => files ? files.some((f) => existsSync4(join9(projectRoot, f))) : false;
  const reason = (d) => {
    if (d.signal)
      return matchSignal(SIGNALS[d.signal], { paths: relPaths, deps }) ? "сигнал направления" : null;
    if (d.deps && hasDep(d.deps))
      return "зависимость в манифесте";
    if (hasFile(d.files))
      return "файл конфигурации в корне";
    if (d.paths && hasPath(d.paths))
      return "пути файлов проекта";
    return null;
  };
  const frameworks = [];
  const infra = [];
  const domains = [];
  const evidence = {};
  for (const d of DETECTORS2) {
    const why = reason(d);
    if (!why)
      continue;
    evidence[d.name] = why;
    if (d.kind === "framework")
      frameworks.push(d.name);
    else
      infra.push(d.name);
  }
  for (const d of DOMAIN_DETECTORS) {
    const why = reason(d);
    if (!why)
      continue;
    evidence[d.name] = why;
    domains.push(d.name);
  }
  const namedDepRes = DETECTORS2.filter((d) => d.deps).map((d) => d.deps);
  const otherDeps = prodDeps.filter((dep) => !namedDepRes.some((re) => re.test(dep))).filter((dep) => !/^@types\//.test(dep)).slice(0, 25);
  return { frameworks, infra, domains, otherDeps, evidence };
}
function fileDomains(rel) {
  return DOMAIN_DETECTORS.filter((d) => d.signal ? SIGNALS[d.signal].paths?.test(rel) : d.paths?.test(rel)).map((d) => d.name);
}
var domainName = (ru) => t(ru, {
  "база данных": "database",
  фронтенд: "frontend",
  тестирование: "testing",
  "деплой/инфра": "deploy/infra",
  "веб-сервер": "web server",
  "фоновые задачи": "background jobs",
  платежи: "payments",
  аутентификация: "authentication",
  "оркестрация/масштабирование": "orchestration/scaling",
  "дизайн-ассеты": "design assets",
  документы: "documents"
}[ru] ?? ru);
var whyName = (ru) => t(ru, {
  "сигнал направления": "direction signal",
  "зависимость в манифесте": "dependency in the manifest",
  "файл конфигурации в корне": "config file in the root",
  "пути файлов проекта": "project file paths"
}[ru] ?? ru);
function renderStack(s) {
  if (s.frameworks.length === 0 && s.infra.length === 0 && s.domains.length === 0 && s.otherDeps.length === 0)
    return "";
  const withWhy = (names2) => names2.map((n) => s.evidence?.[n] ? `${domainName(n)} (${whyName(s.evidence[n])})` : domainName(n)).join(", ");
  const lines = [t("## Стек и направления (обнаружено по сигналам; активирует доменную экспертизу)", "## Stack and directions (detected by signals; switches on domain expertise)"), ""];
  if (s.frameworks.length > 0)
    lines.push(`- ${t("фреймворки", "frameworks")}: ${withWhy(s.frameworks)}`);
  if (s.infra.length > 0)
    lines.push(`- ${t("инфра/хранилища", "infra/storage")}: ${withWhy(s.infra)}`);
  if (s.domains.length > 0)
    lines.push(`- ${t("направления", "directions")}: ${withWhy(s.domains)}`);
  if (s.otherDeps.length > 0)
    lines.push(`- ${t("прочие ключевые зависимости", "other key dependencies")}: ${s.otherDeps.slice(0, 15).join(", ")}`);
  return lines.join(`
`);
}

// src/passport/maturity.ts
init_i18n();
var clamp01 = (x) => Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
function binaryEntropy(p) {
  if (p <= 0 || p >= 1)
    return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}
function canonCertainty(prevalences) {
  if (prevalences.length === 0)
    return 0;
  const mean = prevalences.reduce((s, p) => s + binaryEntropy(clamp01(p)), 0) / prevalences.length;
  return clamp01(1 - mean);
}
var MASS_HALF_FILES = 40;
var MASS_HALF_COMMITS = 60;
function massScore(codeFiles2, commits) {
  const f = Math.max(0, codeFiles2) / (Math.max(0, codeFiles2) + MASS_HALF_FILES);
  const c = Math.max(0, commits) / (Math.max(0, commits) + MASS_HALF_COMMITS);
  return clamp01((clamp01(f) + clamp01(c)) / 2);
}
function verifiabilityScore(codeFiles2, testFiles, hasCi) {
  if (codeFiles2 === 0)
    return 0;
  const ratio = clamp01(testFiles / (codeFiles2 / 3));
  return clamp01(ratio * 0.8 + (hasCi ? 0.2 : 0));
}
function contentIntegrityScore(c) {
  if (c.entities === 0)
    return 0;
  const brokenShare = clamp01(c.broken / c.entities);
  const orphanShare = clamp01(c.orphans / c.entities);
  return clamp01(1 - brokenShare * 1.5 - orphanShare * 0.5);
}
function stabilityScore(commits, fixCommits, reverts) {
  if (commits === 0)
    return 0;
  const fixShare = clamp01(fixCommits / commits);
  const revertPenalty = clamp01(reverts / Math.max(commits, 1)) * 2;
  return clamp01(1 - fixShare - revertPenalty);
}
function harmonicMean(values) {
  if (values.length === 0)
    return 0;
  const floored = values.map((v) => Math.max(v, 0.02));
  const sumInverse = floored.reduce((s, v) => s + 1 / v, 0);
  return clamp01(floored.length / sumInverse);
}
function levelOf(score) {
  if (score >= 0.62)
    return "зрелый";
  if (score >= 0.3)
    return "растущий";
  return "молодой";
}
function verifiabilityDimension(input) {
  const nature = input.nature ?? (input.codeFiles > 0 ? "код" : "контент");
  if (nature === "контент" && input.content && input.content.entities > 0) {
    const c = input.content;
    return {
      name: "целостность контента",
      value: contentIntegrityScore(c),
      known: true,
      detail: t(`${c.entities} сущностей, битых ссылок ${c.broken}, сирот ${c.orphans}`, `${c.entities} entities, ${c.broken} broken links, ${c.orphans} orphans`)
    };
  }
  return {
    name: "проверяемость",
    value: verifiabilityScore(input.codeFiles, input.testFiles, input.hasCi),
    known: input.codeFiles > 0,
    detail: t(`${input.testFiles} тестов${input.hasCi ? ", CI настроен" : ", CI не найден"}`, `${input.testFiles} test files${input.hasCi ? ", CI configured" : ", no CI found"}`)
  };
}
function assessMaturity(input) {
  const empty = input.codeFiles === 0 && input.commits === 0;
  const dimensions = [
    {
      name: "определённость канона",
      value: canonCertainty(input.prevalences),
      known: input.prevalences.length > 0,
      detail: input.prevalences.length === 0 ? t("конвенций пока не выведено", "no conventions derived yet") : t(`${input.prevalences.length} конвенций, средняя неопределённость ${(1 - canonCertainty(input.prevalences)).toFixed(2)} бит`, `${input.prevalences.length} conventions, average uncertainty ${(1 - canonCertainty(input.prevalences)).toFixed(2)} bits`)
    },
    {
      name: "масса",
      value: massScore(input.codeFiles, input.commits),
      known: true,
      detail: t(`${input.codeFiles} файлов кода, ${input.commits} коммитов`, `${input.codeFiles} code files, ${input.commits} commits`)
    },
    verifiabilityDimension(input),
    {
      name: "стабильность",
      value: stabilityScore(input.commits, input.fixCommits, input.reverts),
      known: input.commits > 0,
      detail: input.commits === 0 ? t("истории ещё нет", "no history yet") : t(`починок ${input.fixCommits} из ${input.commits}${input.reverts > 0 ? `, откатов ${input.reverts}` : ""}`, `${input.fixCommits} fixes out of ${input.commits}${input.reverts > 0 ? `, ${input.reverts} reverts` : ""}`)
    }
  ];
  const measured = dimensions.filter((d) => d.known);
  const score = empty || measured.length === 0 ? 0 : harmonicMean(measured.map((d) => d.value));
  const weakest = measured.length === 0 ? null : measured.reduce((a, b) => b.value < a.value ? b : a);
  return { score, level: levelOf(score), dimensions, weakest, empty };
}
function maturityStance(level) {
  if (level === "зрелый") {
    return [
      t("канон проекта сложился: типовая работа делается по прецеденту, а не изобретается заново", "the canon here is settled: routine work follows precedent instead of being reinvented"),
      t("отклонение от конвенции здесь — осознанное решение, которое стоит назвать вслух", "departing from a convention here is a deliberate decision worth saying out loud"),
      t("ограничение: массовые переделки работающего кода не входят в задачу", "constraint: sweeping rewrites of working code are out of scope")
    ];
  }
  if (level === "растущий") {
    return [
      t("канон ещё складывается: удачное решение стоит закреплять, повторяя его", "the canon is still forming: a good decision is worth cementing by repeating it"),
      t("противоречие с уже принятым решением — повод выбрать одно, а не держать оба", "a contradiction with an earlier decision is a reason to pick one, not to keep both"),
      t("ограничение: единообразие важнее локальной элегантности", "constraint: consistency outweighs local elegance")
    ];
  }
  return [
    t("канона ещё нет: решения принимаются впервые и станут прецедентом для всего проекта", "there is no canon yet: decisions are being made for the first time and will become precedent"),
    t("планка задаётся сразу — структура, обработка ошибок, границы модулей и проверяемость закладываются с первой строки, а не «потом»", "the bar is set now — structure, error handling, module boundaries and testability start with the first line, not “later”"),
    t("подражать текущему коду нечему: несколько файлов — это случайность, а не конвенция", "there is nothing to imitate yet: a handful of files is an accident, not a convention"),
    t("ограничение: сложность вводится только под названную задачу, архитектура «на вырост» без потребности запрещена", "constraint: complexity only for a named task; architecture “for future growth” without a need is out")
  ];
}
function maturityFact(m) {
  const dims = m.dimensions.filter((d) => d.known).map((d) => `${d.name} ${d.value.toFixed(2)}`).join(", ");
  return {
    area: "зрелость проекта",
    statement: `зрелость проекта — ${m.score.toFixed(2)} (${m.level}): ${dims}`,
    positive: 1,
    total: 1,
    prevalence: 1,
    tier: "привычка"
  };
}
var dimName = (ru) => t(ru, { "определённость канона": "canon certainty", масса: "mass", проверяемость: "testability", стабильность: "stability" }[ru] ?? ru);
var levelName = (ru) => t(ru, { зрелый: "mature", растущий: "growing", молодой: "young", "только начат": "just started" }[ru] ?? ru);
pattern(/^зрелость проекта — ([\d.]+) \((.+?)\): (.+)$/, (m) => {
  const dims = m[3].split(", ").map((part) => {
    const cut = part.lastIndexOf(" ");
    return cut > 0 ? `${dimName(part.slice(0, cut))} ${part.slice(cut + 1)}` : part;
  }).join(", ");
  return `project maturity — ${m[1]} (${levelName(m[2])}): ${dims}`;
});
function renderMaturity(m) {
  if (m.empty)
    return "";
  const dims = m.dimensions.map((d) => d.known ? `${dimName(d.name)} ${d.value.toFixed(2)}` : `${dimName(d.name)}${t(" — нет данных", " — no data")}`).join(" · ");
  const lines = [t(`## Зрелость проекта: ${m.score.toFixed(2)} из 1 — ${m.level}`, `## Project maturity: ${m.score.toFixed(2)} of 1 — ${levelName(m.level)}`), "", t(`- измерения: ${dims}`, `- dimensions: ${dims}`)];
  if (m.weakest && m.weakest.value < 0.5) {
    lines.push(t(`- слабее всего: ${m.weakest.name} (${m.weakest.value.toFixed(2)}) — ${m.weakest.detail}`, `- weakest: ${dimName(m.weakest.name)} (${m.weakest.value.toFixed(2)}) — ${m.weakest.detail}`));
  }
  lines.push("");
  for (const s of maturityStance(m.level))
    lines.push(`- ${s}`);
  return lines.join(`
`);
}

// src/layer2/prompt.ts
function jsonOnly(shape) {
  const array = shape.trimStart().startsWith("[");
  const head = array ? "Ответ целиком — один JSON-массив: первый символ «[», последний «]». Форма элемента:" : "Ответ целиком — один JSON-объект: первый символ «{», последний «}». Форма:";
  return `${head}
${shape}`;
}
var OUR_TAGS = /<\/(documents|document_content|document|source|revisions|revision|model_wrote|owner_corrected_to)\b/g;
var neutralize = (text) => text.replace(OUR_TAGS, "<\\/$1");
function documentsBlock(samples) {
  if (samples.length === 0)
    return "";
  const lines = ["<documents>"];
  for (let i = 0;i < samples.length; i++) {
    lines.push(`<document index="${i + 1}">`, "<source>", samples[i].file, "</source>", "<document_content>", neutralize(samples[i].content), "</document_content>", "</document>");
  }
  lines.push("</documents>");
  return lines.join(`
`);
}
function revisionsBlock(items) {
  if (items.length === 0)
    return "";
  const lines = ["<revisions>"];
  for (let i = 0;i < items.length; i++) {
    lines.push(`<revision index="${i + 1}">`, "<source>", items[i].file, "</source>", "<model_wrote>", neutralize(items[i].before), "</model_wrote>", "<owner_corrected_to>", neutralize(items[i].after), "</owner_corrected_to>", "</revision>");
  }
  lines.push("</revisions>");
  return lines.join(`
`);
}

// src/miner/unknown.ts
var MIN_FILES = 5;
var MIN_SHARE = 0.04;
function findUnknownMaterial(extensions, covered) {
  const total = extensions.length;
  if (total === 0)
    return { kinds: [], totalShare: 0 };
  const counts = new Map;
  for (const raw of extensions) {
    const ext = (raw || "").toLowerCase();
    if (covered.code.has(ext) || covered.entity.has(ext) || covered.office.has(ext))
      continue;
    if (/^\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp[34]|mov|zip|gz|lock|map|min\.js)$/.test(ext))
      continue;
    const key = ext || "(без расширения)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kinds = [...counts.entries()].map((e) => ({ ext: e[0], files: e[1], share: e[1] / total })).filter((k) => k.files >= MIN_FILES && k.share >= MIN_SHARE).sort((a, b) => b.files - a.files).slice(0, 5);
  const totalShare = kinds.reduce((s, k) => s + k.share, 0);
  return { kinds, totalShare };
}
function buildUnknownPrompt(kind, samples) {
  return [
    `В проекте есть ${samples.length} файлов вида «${kind}», и они составляют заметную часть работы.`,
    "",
    "Задача: определить, КАК В ЭТОМ ПРОЕКТЕ принято работать с такими файлами. Нужны наблюдения по образцам, а не общие сведения о формате.",
    "",
    "Что интересует: устойчивая структура (обязательные части, порядок), соглашения об именовании, единицы измерения и форматы значений, что здесь считается полным и законченным файлом, что повторяется из файла в файл.",
    "",
    "Образцы:",
    documentsBlock(samples),
    "",
    jsonOnly('[{"area": "область наблюдения", "statement": "предмет — вердикт", "evidence": ["файл1", "файл2"], "confidence": 0.8}]'),
    "",
    "Правила: только то, что подтверждается минимум двумя образцами; формулировка фактом («имена файлов — дата в начале»), а не советом; если устойчивых правил не видно — верни пустой массив, это честный ответ."
  ].join(`
`);
}
function unknownFact(u) {
  if (u.kinds.length === 0)
    return null;
  const list = u.kinds.map((k) => `${k.ext} (${k.files})`).join(", ");
  return {
    area: "состав проекта",
    statement: `материал без готового анализатора — ${list}: правила по нему выводятся из образцов, а не из знания формата`,
    positive: u.kinds.reduce((s, k) => s + k.files, 0),
    total: u.kinds.reduce((s, k) => s + k.files, 0),
    prevalence: 1,
    tier: "привычка"
  };
}

// src/core/learned.ts
import { existsSync as existsSync5, readFileSync as readFileSync8, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join10 } from "node:path";
var FILE2 = "learned-materials.json";
var MIN_PROJECTS = 2;
var MAX_ENTRIES = 200;
var isSafeExt = (s) => /^\.[a-z0-9][a-z0-9._-]{0,20}$/i.test(s) || s === "(без расширения)";
function sanitize(entry) {
  if (typeof entry !== "object" || entry === null)
    return null;
  const e = entry;
  if (typeof e.ext !== "string" || !isSafeExt(e.ext))
    return null;
  const pairs = Array.isArray(e.pairsWith) ? e.pairsWith.filter((p) => typeof p === "string" && isSafeExt(p)) : [];
  const lines = typeof e.typicalLines === "number" && Number.isFinite(e.typicalLines) ? Math.max(0, Math.round(e.typicalLines)) : 0;
  const seen = typeof e.seenIn === "number" && Number.isFinite(e.seenIn) ? Math.max(1, Math.round(e.seenIn)) : 1;
  return {
    ext: e.ext,
    pairsWith: [...new Set(pairs)].slice(0, 6),
    typicalLines: lines,
    seenIn: Math.min(seen, 999),
    updatedAt: typeof e.updatedAt === "string" ? e.updatedAt.slice(0, 30) : new Date().toISOString()
  };
}
function readLearnedMaterials(root) {
  try {
    const p = join10(root, FILE2);
    if (!existsSync5(p))
      return [];
    const raw = JSON.parse(readFileSync8(p, "utf8"));
    if (!Array.isArray(raw))
      return [];
    return raw.map(sanitize).filter((x) => x !== null);
  } catch {
    return [];
  }
}
function mergeLearnedMaterials(root, observations, projectKey, nowIso = new Date().toISOString()) {
  try {
    const existing = readLearnedMaterials(root);
    const byExt = new Map(existing.map((e) => [e.ext, e]));
    const seenPath = join10(root, "learned-seen.json");
    let seen = {};
    try {
      seen = existsSync5(seenPath) ? JSON.parse(readFileSync8(seenPath, "utf8")) : {};
    } catch {
      seen = {};
    }
    let changed = 0;
    for (const o of observations) {
      const safe = sanitize({ ext: o.ext, pairsWith: o.pairsWith, typicalLines: o.medianLines, seenIn: 1, updatedAt: nowIso });
      if (!safe)
        continue;
      const prev = byExt.get(safe.ext);
      const projects = new Set(seen[safe.ext] ?? []);
      const isNewProject = !projects.has(projectKey);
      projects.add(projectKey);
      seen[safe.ext] = [...projects].slice(-50);
      if (!prev) {
        byExt.set(safe.ext, safe);
      } else {
        prev.pairsWith = [...new Set([...prev.pairsWith, ...safe.pairsWith])].slice(0, 6);
        prev.typicalLines = safe.typicalLines > 0 ? Math.round((prev.typicalLines + safe.typicalLines) / 2) : prev.typicalLines;
        if (isNewProject)
          prev.seenIn = Math.min(prev.seenIn + 1, 999);
        prev.updatedAt = nowIso;
      }
      changed++;
    }
    const out = [...byExt.values()].sort((a, b) => b.seenIn - a.seenIn).slice(0, MAX_ENTRIES);
    writeFileSync2(join10(root, FILE2), JSON.stringify(out, null, 1), "utf8");
    writeFileSync2(seenPath, JSON.stringify(seen, null, 1), "utf8");
    return changed;
  } catch {
    return 0;
  }
}
function hintsForMaterials(root, exts) {
  const known = readLearnedMaterials(root);
  const wanted = new Set(exts);
  const out = [];
  for (const k of known) {
    if (!wanted.has(k.ext) || k.seenIn < MIN_PROJECTS)
      continue;
    const parts = [];
    if (k.pairsWith.length > 0)
      parts.push(`обычно ходит парой с ${k.pairsWith.join(", ")}`);
    if (k.typicalLines > 0)
      parts.push(`характерный размер ~${k.typicalLines} строк`);
    if (parts.length > 0)
      out.push(`${k.ext}: ${parts.join(", ")} (по опыту ${k.seenIn} проектов)`);
  }
  return out.slice(0, 5);
}

// src/miner/noncode.ts
import { inflateRawSync } from "node:zlib";
import { readFileSync as readFileSync9 } from "node:fs";
function mineCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0] ?? "";
  const counts = [
    [",", (header.match(/,/g) ?? []).length],
    [";", (header.match(/;/g) ?? []).length],
    ["\t", (header.match(/\t/g) ?? []).length]
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][1] > 0 ? counts[0][0] : ",";
  const columns = header.split(delimiter).map((c) => c.trim()).filter(Boolean);
  return { kind: "csv", delimiter, columns, rows: Math.max(0, lines.length - 1) };
}
function mineText(content) {
  const lines = content.split(/\r?\n/);
  const headings = lines.filter((l) => /^#{1,6}\s+\S/.test(l) || /^={3,}\s*$/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, "").trim()).filter(Boolean).slice(0, 20);
  const words = (content.match(/\S+/g) ?? []).length;
  return { kind: "text", lines: lines.length, words, headings };
}
function readZipEntries(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 67324752)
      break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (compSize === 0 || dataStart + compSize > buf.length)
      break;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    } catch {}
    i = dataStart + compSize;
  }
  return out;
}
var stripXml = (xml) => xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
function mineOffice(buf, ext) {
  const format = ext === ".docx" ? "docx" : ext === ".pptx" ? "pptx" : ext === ".xlsx" ? "xlsx" : "unknown";
  const entries = readZipEntries(buf);
  const pick = (re) => entries.filter((e) => re.test(e.name)).map((e) => e.data.toString("utf8"));
  let parts = [];
  let units = 0;
  if (format === "docx") {
    parts = pick(/^word\/document\.xml$/);
    units = (parts.join("").match(/<w:p[ >]/g) ?? []).length;
  } else if (format === "pptx") {
    parts = pick(/^ppt\/slides\/slide\d+\.xml$/);
    units = parts.length;
  } else if (format === "xlsx") {
    parts = pick(/^xl\/sharedStrings\.xml$/);
    units = (parts.join("").match(/<si>/g) ?? []).length;
  }
  const text = stripXml(parts.join(" ")).slice(0, 20000);
  return { kind: "office", format, text, units };
}
var OFFICE = new Set([".docx", ".pptx", ".xlsx"]);
var CSVX = new Set([".csv", ".tsv"]);
var TEXT = new Set([".txt", ".md", ".mdx", ".rst", ".adoc"]);
function isNonCodeMinable(ext) {
  return OFFICE.has(ext) || CSVX.has(ext) || TEXT.has(ext);
}
function extractContent(path, ext) {
  try {
    if (OFFICE.has(ext)) {
      const o = mineOffice(readFileSync9(path), ext);
      return o.text ? `[${o.format}, ${o.units} ед.] ${o.text}` : null;
    }
    if (CSVX.has(ext)) {
      const c = mineCsv(readFileSync9(path, "utf8"));
      return `[таблица ${c.rows} строк, колонки: ${c.columns.join(", ")}]`;
    }
    if (TEXT.has(ext)) {
      const content = readFileSync9(path, "utf8");
      const t2 = mineText(content);
      return `[${t2.words} слов, заголовки: ${t2.headings.slice(0, 8).join(" · ")}]
${content.slice(0, 3000)}`;
    }
    return null;
  } catch {
    return null;
  }
}

// src/domains/frame.ts
var SENSITIVE = {
  медицина: /(пациент|диагноз|врач|симптом|лечени|медицин|анализ[а-я]* (крови|мочи)|здоровь|заболевани|препарат|дозировк|терапи|клиническ)/i,
  финансы: /(платеж|платёж|финанс|банк|кредит|инвестиц|транзакц|биллинг|выплат|payout|комиссион)/i,
  "безопасность/harm-reduction": /(уязвимост|эксплойт|пентест|вредонос|обход защит|harm[- ]?reduction|снижени[ея] вреда|наркотическ|передозировк)/i,
  право: /(юридическ|правов[ао]|законодательств|нормативн|договорн)/i
};
var LEGIT_MARKER = /(не (заменяе[а-я]*|являе[а-я]*|ставит диагноз|назначае[а-я]*|да[её]т медицинск[а-я]*|предоставляе[а-я]* (медицинск|юридическ|финансов)[а-я]*)|носит (информационн|справочн|ознакомительн)[а-я]* характер|информационн[а-я]* характер|не (для|заменяет) самолечени|проконсультируйтесь|перед применением|для информировани|помогает (понять|разобраться|подготовить)|добровольн[а-я]*|с (информированного )?согласия|обезлич[а-я]*|не хранит|не переда[её]т.{0,40}треть)/i;
function sensitiveDirections(conceptText) {
  const out = [];
  for (const [name, re] of Object.entries(SENSITIVE)) {
    if (re.test(conceptText))
      out.push(name);
  }
  return out;
}
var splitSentences = (text) => text.replace(/\s+/g, " ").split(/(?<=[.!?;])\s+|\n+|\s+[-—•]\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
var MAX_LEN = 170;
function deriveFrameCandidates(conceptText, max = 6) {
  const out = [];
  const seen = new Set;
  for (const raw of splitSentences(conceptText)) {
    const s = raw.replace(/[*_`]+/g, "").trim();
    if (s.length < 15 || s.length > MAX_LEN)
      continue;
    if (!LEGIT_MARKER.test(s))
      continue;
    if (!/^[«"“А-ЯЁA-Z]/.test(s))
      continue;
    if (!/[.!?;»"”]$/.test(s))
      continue;
    if (/[a-zа-яё0-9_]+:\s*$/i.test(s))
      continue;
    const key = s.toLowerCase().replace(/[^а-яёa-z ]/g, "").slice(0, 55);
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max)
      break;
  }
  return out;
}
var IMPERATIVE = /(обязательно|должен|должна|должны|немедленно|срочно|ни в коем случае|ты обязан|нельзя отказыва)/i;
var EMOTIONAL = /(пожалуйста|умоляю|очень важно|критически важно|прошу тебя|вопрос жизни|во что бы то ни стало)/i;
var PERSONA = /(ты\s+(врач|эксперт|специалист|доктор|юрист)|представь(,)?\s+что\s+ты|веди себя как|в роли\s+\w+|притворись)/i;
function compileFrame(candidates) {
  const kept = [];
  const rejected = [];
  for (const s of candidates) {
    if (IMPERATIVE.test(s))
      rejected.push({ statement: s, reason: "императив" });
    else if (EMOTIONAL.test(s))
      rejected.push({ statement: s, reason: "эмоциональное давление" });
    else if (PERSONA.test(s))
      rejected.push({ statement: s, reason: "persona-нажим" });
    else
      kept.push(s);
  }
  return { kept, rejected };
}
function renderFrame(kept, directions) {
  if (kept.length === 0 || directions.length === 0)
    return "";
  const lines = [
    "## Контекст легитимности (правдивые факты о проекте — снижают ложные отказы на чувствительной теме; это факты, НЕ инструкции)",
    "",
    `- направление: ${directions.join(", ")} — работа с этим контентом здесь легитимна`,
    ...kept.map((s) => `- ${s}`),
    "- уточнить/дополнить факты: /sym-charter (только правдивое; рамка из выдумки недопустима)"
  ];
  return lines.join(`
`);
}
function buildFrame(conceptText) {
  const directions = sensitiveDirections(conceptText);
  if (directions.length === 0)
    return "";
  const { kept } = compileFrame(deriveFrameCandidates(conceptText));
  return renderFrame(kept, directions);
}
function readFrame(dataDir) {
  try {
    const { readFileSync: readFileSync10 } = __require("node:fs");
    const { join: join11 } = __require("node:path");
    return readFileSync10(join11(dataDir, "frame.md"), "utf8").trim();
  } catch {
    return "";
  }
}

// src/passport/build.ts
init_i18n();

// src/layer1/facts1.ts
init_i18n();
var push2 = (facts, area2, statement2, positive, total) => {
  const prevalence = total > 0 ? positive / total : 0;
  facts.push({ area: area2, statement: statement2, positive, total, prevalence, tier: tierOf(prevalence, total) });
};
var L2 = {
  L0: pair("пустые catch-блоки — не встречаются (ошибка всегда обрабатывается)", "empty catch blocks — never (errors are always handled)"),
  L1: pair("пустые catch-блоки — обычное дело (осознанное глушение)", "empty catch blocks — common (deliberate silencing)"),
  L2: pair("ошибки из catch — возвращаются значением, не пробрасываются", "errors from catch — returned as a value, not rethrown"),
  L3: pair("ошибки из catch — пробрасываются дальше (re-throw)", "errors from catch — rethrown further"),
  L4: pair("исключения — ловятся, но свои не бросаются (throw почти не встречается)", "exceptions — caught but not raised (throw is rare)"),
  L5: pair("async-функции — преобладают", "async functions — predominant"),
  L6: pair("async-функции — почти не используются", "async functions — barely used"),
  L7: pair("классы — не используются (функции и модули)", "classes — not used (functions and modules)"),
  L8: pair("классы — основной строительный блок", "classes — the main building block")
};
function deriveAstFacts(m) {
  const facts = [];
  if (m.catchCount >= 10) {
    const nonEmpty = m.catchCount - m.emptyCatch;
    if (m.emptyCatch / m.catchCount <= 0.05) {
      push2(facts, "обработка ошибок", L2.L0, nonEmpty, m.catchCount);
    } else if (m.emptyCatch / m.catchCount >= 0.3) {
      push2(facts, "обработка ошибок", L2.L1, m.emptyCatch, m.catchCount);
    }
    if (m.catchWithReturn / m.catchCount >= 0.7) {
      push2(facts, "обработка ошибок", L2.L2, m.catchWithReturn, m.catchCount);
    } else if (m.catchWithRethrow / m.catchCount >= 0.7) {
      push2(facts, "обработка ошибок", L2.L3, m.catchWithRethrow, m.catchCount);
    }
  }
  if (m.tryCount >= 10 && m.throwCount <= m.tryCount * 0.05) {
    push2(facts, "обработка ошибок", L2.L4, m.tryCount, m.tryCount + m.throwCount);
  }
  if (m.fnTotal >= 20) {
    const asyncShare = m.fnAsync / m.fnTotal;
    if (asyncShare >= 0.5) {
      push2(facts, "функции", L2.L5, m.fnAsync, m.fnTotal);
    } else if (asyncShare <= 0.05 && m.fnAsync >= 0) {
      push2(facts, "функции", L2.L6, m.fnTotal - m.fnAsync, m.fnTotal);
    }
    if (m.classCount === 0) {
      push2(facts, "архитектура", L2.L7, m.fnTotal, m.fnTotal);
    } else if (m.classCount >= m.fnTotal * 0.15) {
      push2(facts, "архитектура", L2.L8, m.classCount, m.classCount + m.fnTotal);
    }
  }
  return facts;
}

// src/verifiers/content.ts
init_i18n();
var V = {
  ALPHABET: pair("чистота алфавита (кир/лат микс в слове)", "alphabet purity (Cyrillic/Latin mix inside a word)"),
  BROKEN: pair("битая внутренняя ссылка", "broken internal link"),
  ANCHOR_DUP: pair("один анкор на разные цели", "one anchor pointing to different targets"),
  EMPTY_ANCHOR: pair("ссылка без текста (a11y/SEO)", "link without text (a11y/SEO)")
};
function makeResolver(entityRels) {
  const index = buildResolveIndex(entityRels);
  return (fromRel, target) => resolveContentTarget(fromRel, target, index);
}
function contentVerifierActive(ext) {
  return ENTITY_EXT.has(ext.toLowerCase());
}
function loadEntityResolver(db) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
    if (!has)
      return;
    const rels = db.query("SELECT file FROM entity_nodes").all().map((r) => r.file);
    return rels.length > 0 ? makeResolver(rels) : undefined;
  } catch {
    return;
  }
}
var CYRILLIC = /[Ѐ-ӿ]/;
var LATIN = /[A-Za-z]/;
var WORD_RE = /[A-Za-zЀ-ӿ][A-Za-zЀ-ӿ\d]*/g;
function stripNonProse(text) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/gi, " ").replace(/\b[\w.-]+\/[\w./-]+/g, " ");
}
function mixedScriptTokens(text) {
  const out = [];
  const seen = new Set;
  for (const m of stripNonProse(text).matchAll(WORD_RE)) {
    const tok = m[0];
    if (CYRILLIC.test(tok) && LATIN.test(tok) && !seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}
var MAX_EXAMPLES = 5;
function checkAlphabetPurity(content) {
  const bad = mixedScriptTokens(content);
  if (bad.length === 0)
    return [];
  const examples = bad.slice(0, MAX_EXAMPLES).map((t2) => `«${t2}»`).join(", ");
  return [
    {
      verifier: V.ALPHABET,
      detail: `${bad.length} слов со смешением алфавитов: ${examples}${bad.length > MAX_EXAMPLES ? " …" : ""}`
    }
  ];
}
function checkContentLinks(rel, content, ext, resolve) {
  const links = extractContentLinks(ext, content);
  const broken = [];
  const emptyAnchors = [];
  const anchorTargets = new Map;
  for (const link of links) {
    if (!link.explicit)
      continue;
    if (link.anchor.length === 0) {
      if (emptyAnchors.length < MAX_EXAMPLES)
        emptyAnchors.push(link.target);
      continue;
    }
    if (resolve) {
      const res = resolve(rel, link.target);
      if (res.kind === "broken") {
        broken.push(link.target);
        continue;
      }
      if (res.kind === "entity") {
        const set = anchorTargets.get(link.anchor) ?? new Set;
        set.add(res.rel);
        anchorTargets.set(link.anchor, set);
      }
    }
  }
  const out = [];
  if (broken.length > 0) {
    out.push({
      verifier: V.BROKEN,
      detail: `${broken.length}: ${broken.slice(0, MAX_EXAMPLES).map((t2) => `→ ${t2}`).join(", ")}${broken.length > MAX_EXAMPLES ? " …" : ""}`
    });
  }
  const dup = [...anchorTargets.entries()].filter((entry) => entry[1].size >= 2);
  if (dup.length > 0) {
    out.push({
      verifier: V.ANCHOR_DUP,
      detail: dup.slice(0, MAX_EXAMPLES).map((entry) => `«${entry[0]}» → ${entry[1].size} ${t("целей", "targets")}`).join(", ")
    });
  }
  if (emptyAnchors.length > 0) {
    out.push({
      verifier: V.EMPTY_ANCHOR,
      detail: `${emptyAnchors.length}: ${emptyAnchors.map((t2) => `→ ${t2}`).join(", ")}`
    });
  }
  return out;
}
function runContentVerifiers(rel, content, ext, ctx = {}) {
  if (!contentVerifierActive(ext))
    return [];
  return [...checkAlphabetPurity(content), ...checkContentLinks(rel, content, ext, ctx.resolve)];
}

// src/core/statements.ts
init_constitution_derive();

// src/passport/build.ts
var tierSections = () => [
  ["закон", t("Законы стиля (в этом репозитории соблюдаются практически всегда)", "Style laws (in this repository they hold almost always)")],
  ["привычка", t("Преобладающий стиль (возможны легитимные исключения)", "Prevailing style (legitimate exceptions possible)")]
];
function renderGraphBlock(top) {
  if (top.length === 0)
    return "";
  const lines = [`## ${t("Ключевые модули (по связности импортов; вход↑ = многие зависят)", "Key modules (by import connectivity; in↑ = many depend on it)")}`, ""];
  for (const s of top)
    lines.push(`- ${s.file} · ${t("вход", "in")}:${s.inDeg} · ${t("исход", "out")}:${s.outDeg}`);
  lines.push("");
  return lines.join(`
`);
}
var factLine = (f) => `- ${statement(f.statement)} — ${factBasis(f)}`;
function renderSummary(projectName, allFacts, blocks = {}) {
  const graphTop = blocks.graphTop ?? [];
  const artifactsBlock = blocks.artifacts ?? "";
  const stanceBlock = blocks.stance ?? "";
  const stackBlock = blocks.stack ?? "";
  const entityBlock = blocks.entity ?? "";
  const maturityBlock = blocks.maturity ?? "";
  const profile = allFacts.filter((f) => f.area === "профиль качества");
  const constitution = allFacts.filter((f) => f.area === "конституция");
  const facts = allFacts.filter((f) => f.area !== "профиль качества" && f.area !== "конституция");
  const lines = [
    t(`# Паспорт проекта «${projectName}» — выведено из его же кода и истории`, `# Project passport for “${projectName}” — derived from its own code and history`),
    "",
    t("> Сгенерировано Symbiont. Числа статистики — измеренная распространённость; правила, выведенные моделью, помечены «по N образцам».", "> Generated by Symbiont. Statistics are measured prevalence; rules inferred by a model are marked “from N samples”."),
    ""
  ];
  if (stanceBlock)
    lines.push(stanceBlock, "");
  if (maturityBlock)
    lines.push(maturityBlock, "");
  for (const [tier2, title] of tierSections()) {
    const list = facts.filter((f) => f.tier === tier2);
    if (list.length === 0)
      continue;
    lines.push(`## ${title}`, "");
    for (const f of list)
      lines.push(factLine(f));
    lines.push("");
  }
  const mixed = facts.filter((f) => f.tier === "нет консенсуса");
  if (mixed.length > 0) {
    lines.push(`## ${t("Смешанный стиль (единого правила нет)", "Mixed style (no single rule)")}`, "");
    for (const f of mixed)
      lines.push(`- ${statement(f.statement).split("—")[0].trim()}: ${Math.round(f.prevalence * 100)}% / ${100 - Math.round(f.prevalence * 100)}%`);
    lines.push("");
  }
  if (artifactsBlock)
    lines.push(artifactsBlock, "");
  if (stackBlock)
    lines.push(stackBlock, "");
  if (profile.length > 0) {
    lines.push(`## ${t("Профиль качества (что «топ-1» значит именно здесь; выведено из сигналов проекта)", "Quality profile (what “best in class” means here; derived from project signals)")}`, "");
    for (const f of profile)
      lines.push(`- ${statement(f.statement)}`);
    lines.push("");
  }
  if (constitution.length > 0) {
    lines.push(`## ${t("Приоритеты и ограничения (выведены из git-истории и профиля; наблюдения, не догадки)", "Priorities and constraints (derived from git history and the profile; observations, not guesses)")}`, "");
    for (const f of constitution)
      lines.push(`- ${statement(f.statement)}`);
    lines.push("");
  }
  const graphBlock = renderGraphBlock(graphTop);
  if (graphBlock)
    lines.push(graphBlock);
  if (entityBlock)
    lines.push(entityBlock);
  return lines.join(`
`);
}
function projectionCodeVersion() {
  if (true)
    return "bundle-88f7d20f0393";
  const rel = ["build.ts", "artifacts.ts", "profile.ts", "constitution-derive.ts", "../miner/facts.ts", "../graph/graph.ts", "../graph/entities.ts"];
  const parts = [];
  for (const r of rel) {
    try {
      parts.push(readFileSync10(join11(import.meta.dirname, r), "utf8"));
    } catch {}
  }
  return parts.length > 0 ? `auto-${sha1(parts.join(" "))}` : "fallback-v4-2026-07-30";
}
function buildPassport(projectRoot, dataDir) {
  mkdirSync(dataDir, { recursive: true });
  initLang(dataDir, projectRoot);
  const engine = new Engine(join11(dataDir, "passport.db"));
  engine.invalidateIfCodeChanged(`${projectionCodeVersion()}:${lang()}`);
  const store = new FactStore(engine.db);
  engine.db.run("CREATE TABLE IF NOT EXISTS file_cache(path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL)");
  const cacheGet = engine.db.query("SELECT mtime_ms, size, hash FROM file_cache WHERE path=?");
  const cachePut = engine.db.query("INSERT INTO file_cache(path,mtime_ms,size,hash) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET mtime_ms=excluded.mtime_ms, size=excluded.size, hash=excluded.hash");
  const walked = walkFiles(projectRoot);
  const files = codeFiles(walked);
  const relPaths = files.map((f) => relative(projectRoot, f.path)).sort();
  engine.setInput("fileset", sha1(JSON.stringify(relPaths)));
  const currentHashes = new Map;
  for (const f of files) {
    const rel = relative(projectRoot, f.path);
    const cached = cacheGet.get(rel);
    let hash;
    if (cached && cached.mtime_ms === f.mtimeMs && cached.size === f.size) {
      hash = cached.hash;
    } else {
      let content = "";
      try {
        content = readFileSync10(f.path, "utf8");
      } catch {}
      hash = sha1(content);
      cachePut.run(rel, f.mtimeMs, f.size, hash);
    }
    engine.setInput(`file:${rel}`, hash);
    currentHashes.set(rel.replaceAll("\\", "/"), hash);
  }
  migrateRenames(engine.db, currentHashes);
  engine.register("facts", (ctx) => {
    ctx.input("fileset");
    const observations = files.map((f) => {
      const rel = relative(projectRoot, f.path);
      ctx.input(`file:${rel}`);
      let content = "";
      try {
        content = readFileSync10(f.path, "utf8");
      } catch {}
      return analyzeFile(f.path, f.ext, content);
    });
    const agg = aggregate(observations, files.map((f) => f.ext));
    observeComments(dataDir, agg.comments.cyr, agg.comments.lat);
    return deriveFacts(agg);
  });
  engine.register("graph", (ctx) => {
    ctx.input("fileset");
    const entries = files.map((f) => {
      const rel = relative(projectRoot, f.path);
      ctx.input(`file:${rel}`);
      let content = "";
      try {
        content = readFileSync10(f.path, "utf8");
      } catch {}
      return { rel: rel.replaceAll("\\", "/"), content };
    });
    const g = buildEdges(entries);
    const stats = nodeStats(g);
    return {
      nodeCount: g.nodes.length,
      edgeCount: g.edges.length,
      top: stats.slice(0, 8),
      allStats: stats,
      edges: g.edges
    };
  });
  const artProfile = artifactProfile(walked.map((f) => ({ name: basename(f.path), ext: f.ext })));
  const artifactsBlock = renderArtifacts(artProfile);
  const stanceBlock = renderQualityStance(artProfile);
  const stack = detectStack(projectRoot, walked.map((f) => relative(projectRoot, f.path).replaceAll("\\", "/")));
  const stackBlock = renderStack(stack);
  const MAX_ENTITY_FILES = 5000;
  const entityFiles = walked.filter((f) => ENTITY_EXT.has(f.ext)).slice(0, MAX_ENTITY_FILES);
  const entityInputs = [];
  for (const f of entityFiles) {
    let content = null;
    try {
      content = readFileSync10(f.path, "utf8");
    } catch {}
    if (content === null || content.length > 1e6)
      continue;
    entityInputs.push({ rel: relative(projectRoot, f.path).replaceAll("\\", "/"), ext: f.ext, content });
  }
  const entityGraph = buildEntityGraph(entityInputs);
  const entityBlock = renderEntityBlock(entityGraph);
  engine.setInput("entity-graph", sha1(JSON.stringify([entityGraph.edges, entityGraph.nodes.map((n) => [n.file, n.depth, n.isHub]), entityGraph.broken])));
  engine.register("entities", (ctx) => {
    ctx.input("entity-graph");
    return entityGraph;
  });
  engine.get("entities");
  if (engine.executions("entities") > 0) {
    engine.db.run("CREATE TABLE IF NOT EXISTS entity_nodes(file TEXT PRIMARY KEY, kind TEXT NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL, depth INTEGER, is_hub INTEGER NOT NULL)");
    engine.db.run("CREATE TABLE IF NOT EXISTS entity_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, anchor TEXT NOT NULL, PRIMARY KEY(from_file, to_file, anchor))");
    engine.db.run("CREATE TABLE IF NOT EXISTS entity_broken(from_file TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(from_file, target))");
    engine.db.run("BEGIN");
    engine.db.run("DELETE FROM entity_nodes");
    engine.db.run("DELETE FROM entity_edges");
    engine.db.run("DELETE FROM entity_broken");
    const insNode = engine.db.query("INSERT INTO entity_nodes(file,kind,in_deg,out_deg,depth,is_hub) VALUES(?,?,?,?,?,?)");
    for (const n of entityGraph.nodes)
      insNode.run(n.file, n.kind, n.inDeg, n.outDeg, n.depth, n.isHub ? 1 : 0);
    const insEdge = engine.db.query("INSERT OR IGNORE INTO entity_edges(from_file,to_file,anchor) VALUES(?,?,?)");
    for (const e of entityGraph.edges)
      insEdge.run(e.from, e.to, e.anchor);
    const insBroken = engine.db.query("INSERT OR IGNORE INTO entity_broken(from_file,target) VALUES(?,?)");
    for (const b of entityGraph.broken)
      insBroken.run(b.from, b.target);
    engine.db.run("COMMIT");
  }
  engine.setInput("artifacts", sha1(artifactsBlock + " " + stanceBlock + " " + stackBlock + " " + entityBlock));
  engine.register("summary", (ctx) => {
    ctx.input("journal-active");
    ctx.input("artifacts");
    ctx.input("maturity");
    return renderSummary(basename(projectRoot), new FactStore(engine.db).active(), {
      graphTop: ctx.get("graph").top,
      artifacts: artifactsBlock,
      stance: stanceBlock,
      stack: stackBlock,
      entity: entityBlock,
      maturity: maturityBlock ? `${maturityBlock}${learnedBlock ? `

${learnedBlock}` : ""}` : learnedBlock
    });
  });
  const head = (() => {
    try {
      const r = spawnSync2("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8", timeout: 3000, windowsHide: true });
      return r.status === 0 ? r.stdout.trim() : "no-git";
    } catch {
      return "no-git";
    }
  })();
  engine.setInput("git-head", head);
  engine.register("cochange", (ctx) => {
    if (ctx.input("git-head") === "no-git")
      return { pairs: [], totals: [] };
    const r = spawnSync2("git", ["log", "--name-only", "--pretty=format:@%H", "-n", "300"], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    });
    if (r.status !== 0 || typeof r.stdout !== "string")
      return { pairs: [], totals: [] };
    const data = pairCounts(parseNameOnlyLog(r.stdout));
    return {
      pairs: [...data.pairs.entries()].filter(([, n]) => n >= 2).map(([k, n]) => ({ k, n })),
      totals: [...data.totals.entries()].map(([file, n]) => ({ file, n }))
    };
  });
  const cochange = engine.get("cochange");
  if (engine.executions("cochange") > 0) {
    engine.db.run("CREATE TABLE IF NOT EXISTS cochange(file_a TEXT NOT NULL, file_b TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(file_a, file_b))");
    engine.db.run("CREATE TABLE IF NOT EXISTS cochange_totals(file TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    engine.db.run("BEGIN");
    engine.db.run("DELETE FROM cochange");
    engine.db.run("DELETE FROM cochange_totals");
    const insPair = engine.db.query("INSERT INTO cochange(file_a,file_b,n) VALUES(?,?,?)");
    for (const p of cochange.pairs) {
      const [a, b] = p.k.split("|");
      insPair.run(a, b, p.n);
    }
    const insTotal = engine.db.query("INSERT INTO cochange_totals(file,n) VALUES(?,?)");
    for (const t2 of cochange.totals)
      insTotal.run(t2.file, t2.n);
    engine.db.run("COMMIT");
  }
  try {
    const allRelForCfg = walked.map((f) => relative(projectRoot, f.path).replaceAll("\\", "/"));
    const cfgPaths = configPathsOf(allRelForCfg).slice(0, 40);
    if (cfgPaths.length > 0) {
      const entries = readConfigEntries(projectRoot, cfgPaths);
      const codeSample = [];
      for (const f of files.slice(0, 400)) {
        try {
          codeSample.push({ rel: relative(projectRoot, f.path).replaceAll("\\", "/"), content: readFileSync10(f.path, "utf8") });
        } catch {}
      }
      const pairs = cochange.pairs.map((p) => {
        const parts = p.k.split("|");
        return { a: parts[0], b: parts[1], n: p.n };
      });
      storeConfigEdges(engine.db, collectConfigLinks(entries, codeSample, pairs));
    }
  } catch {}
  const allRel = walked.map((f) => relative(projectRoot, f.path).replaceAll("\\", "/"));
  const probes = probeProfile(projectRoot, allRel);
  engine.setInput("profile-probes", sha1(JSON.stringify(probes)));
  engine.register("profile", (ctx) => {
    ctx.input("profile-probes");
    return profileFacts(probes);
  });
  const profFacts = engine.get("profile");
  const facts = engine.get("facts");
  const graphFull = engine.get("graph");
  const factsExecutedNow = engine.executions("facts") > 0;
  let journal = { born: 0, updated: 0, superseded: 0 };
  if (factsExecutedNow) {
    journal = store.assertAll(facts, "miner:layer0");
  } else {
    store.touchAll();
  }
  if (engine.executions("profile") > 0) {
    const pj = store.assertAll(profFacts, "miner:profile");
    const gone = store.retractMissingBySource("miner:profile", new Set(profFacts.map((f) => keyOf(f))));
    journal = {
      born: journal.born + pj.born,
      updated: journal.updated + pj.updated,
      superseded: journal.superseded + pj.superseded + gone
    };
  }
  const commitLog = (() => {
    if (head === "no-git")
      return "";
    const r = spawnSync2("git", ["log", "--name-only", "--pretty=format:@%H%x09%s", "-n", "300"], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    });
    return r.status === 0 && typeof r.stdout === "string" ? r.stdout : "";
  })();
  const derived = commitLog ? deriveSignals(parseCommitLog(commitLog)) : { commitTypes: {}, reverts: 0, fixZones: {}, totalCommits: 0, valueMentions: {} };
  const constFacts = deriveConstitutionFacts(derived, probes);
  const styleFacts = store.active().filter((f) => f.area !== "профиль качества" && f.area !== "конституция" && f.area !== "зрелость проекта");
  const maturity = assessMaturity({
    codeFiles: relPaths.length,
    commits: derived.totalCommits,
    testFiles: allRel.filter((p) => /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i.test(p)).length,
    hasCi: [".github/workflows", ".gitlab-ci.yml", "Jenkinsfile"].some((p) => existsSync6(join11(projectRoot, p))),
    prevalences: styleFacts.map((f) => f.prevalence),
    fixCommits: derived.commitTypes.fix ?? 0,
    reverts: derived.reverts,
    nature: artProfile.dominant === "контент" ? "контент" : artProfile.dominant === "код" ? "код" : "смешанный",
    content: {
      entities: entityGraph.nodes.length,
      broken: entityGraph.broken.length,
      orphans: entityGraph.orphans.length
    }
  });
  try {
    const unknown = findUnknownMaterial(walked.map((f) => f.ext), {
      code: CODE_EXT,
      entity: ENTITY_EXT,
      office: new Set([...OFFICE, ...TEXT, ...CSVX])
    });
    const uf = unknownFact(unknown);
    if (uf)
      store.assertAll([uf], "miner:unknown-material");
    else
      store.retractMissingBySource("miner:unknown-material", new Set);
  } catch {}
  let learnedBlock = "";
  try {
    const hints = hintsForMaterials(dirname3(dataDir), [...new Set(walked.map((f) => f.ext))]);
    if (hints.length > 0) {
      learnedBlock = ["## Опыт по видам материала (из других проектов; здешнее наблюдение сильнее)", "", ...hints.map((h) => `- ${h}`)].join(`
`);
    }
  } catch {}
  const maturityBlock = renderMaturity(maturity);
  engine.setInput("maturity", sha1(`${maturity.score.toFixed(3)}|${maturity.level}`));
  try {
    if (!maturity.empty)
      store.assertAll([maturityFact(maturity)], "miner:maturity");
  } catch {}
  try {
    storeZoneProfiles(engine.db, computeZoneProfiles(projectRoot, allRel, derived.fixZones));
  } catch {}
  engine.setInput("constitution-derived", sha1(JSON.stringify(constFacts.map((f) => f.statement))));
  engine.register("constitution", (ctx) => {
    ctx.input("constitution-derived");
    return constFacts;
  });
  engine.get("constitution");
  if (engine.executions("constitution") > 0) {
    const cj = store.assertAll(constFacts, "miner:constitution");
    const gone = store.retractMissingBySource("miner:constitution", new Set(constFacts.map((f) => keyOf(f))));
    journal = {
      born: journal.born + cj.born,
      updated: journal.updated + cj.updated,
      superseded: journal.superseded + cj.superseded + gone
    };
  }
  const journalHash = sha1(JSON.stringify(store.active().map((r) => [r.id, r.tier, r.statement, r.prevalence, r.positive, r.total])));
  engine.setInput("journal-active", journalHash);
  const summary = engine.get("summary");
  const graphExecuted = engine.executions("graph") > 0;
  if (graphExecuted) {
    engine.db.run("CREATE TABLE IF NOT EXISTS graph_edges(from_file TEXT NOT NULL, to_file TEXT NOT NULL, PRIMARY KEY(from_file, to_file))");
    engine.db.run("CREATE TABLE IF NOT EXISTS graph_nodes(file TEXT PRIMARY KEY, rank REAL NOT NULL, in_deg INTEGER NOT NULL, out_deg INTEGER NOT NULL)");
    engine.db.run("BEGIN");
    engine.db.run("DELETE FROM graph_edges");
    engine.db.run("DELETE FROM graph_nodes");
    const insEdge = engine.db.query("INSERT OR IGNORE INTO graph_edges(from_file,to_file) VALUES(?,?)");
    for (const e of graphFull.edges)
      insEdge.run(e.from, e.to);
    const insNode = engine.db.query("INSERT INTO graph_nodes(file,rank,in_deg,out_deg) VALUES(?,?,?,?)");
    for (const s of graphFull.allStats)
      insNode.run(s.file, s.rank, s.inDeg, s.outDeg);
    engine.db.run("COMMIT");
  }
  try {
    healProjections(engine.db, projectRoot);
  } catch {}
  captureHealth(engine.db, head, new Date().toISOString());
  try {
    const framePath = join11(dataDir, "frame.md");
    const step = Math.max(1, Math.floor(entityInputs.length / 60));
    const sample = [];
    for (let i = 0;i < entityInputs.length; i += step)
      sample.push(entityInputs[i].content);
    const frameText = [readConceptText(projectRoot, allRel), ...sample].join(`
`).slice(0, 150000);
    const frame = buildFrame(frameText);
    if (frame)
      writeFileSync3(framePath, frame, "utf8");
    else if (existsSync6(framePath))
      writeFileSync3(framePath, "", "utf8");
  } catch {}
  const summaryPath = join11(dataDir, "SUMMARY.md");
  const summaryRebuilt = engine.executions("summary") > 0;
  if (summaryRebuilt || !existsSync6(summaryPath))
    writeFileSync3(summaryPath, summary, "utf8");
  const result = {
    factsExecuted: factsExecutedNow,
    graphExecuted,
    summaryRebuilt,
    facts,
    graph: { nodeCount: graphFull.nodeCount, edgeCount: graphFull.edgeCount, top: graphFull.top },
    journal,
    summaryPath
  };
  engine.close();
  return result;
}

// src/core/sessions.ts
import { statSync as statSync2 } from "node:fs";
var STALE_HOURS_DEFAULT = 12;
var IDLE_DEAD_HOURS = 6;
function deadByTranscript(path, now, idleHours = IDLE_DEAD_HOURS) {
  if (!path)
    return false;
  try {
    return now - statSync2(path).mtimeMs > idleHours * 3600000;
  } catch {
    return false;
  }
}
var SNAPSHOT_LIMIT = 50000;
function snapshotContent(text) {
  return text.slice(0, SNAPSHOT_LIMIT);
}

class SessionLog {
  db;
  constructor(db) {
    this.db = db;
    db.run(`CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY,
        source TEXT,
        started_at TEXT NOT NULL,
        closed_at TEXT,
        close_reason TEXT
      )`);
    try {
      this.db.run("ALTER TABLE sessions ADD COLUMN transcript_path TEXT");
    } catch {}
  }
  open(sessionId, source, now = new Date().toISOString(), transcriptPath = null) {
    this.db.query("INSERT INTO sessions(session_id, source, started_at, transcript_path) VALUES(?,?,?,?) ON CONFLICT(session_id) DO NOTHING").run(sessionId, source, now, transcriptPath);
  }
  close(sessionId, reason, now = new Date().toISOString()) {
    this.db.query("UPDATE sessions SET closed_at=?, close_reason=? WHERE session_id=? AND closed_at IS NULL").run(now, reason, sessionId);
  }
  openOthers(currentSessionId) {
    return this.db.query("SELECT session_id, started_at, transcript_path FROM sessions WHERE closed_at IS NULL AND session_id != ?").all(currentSessionId);
  }
  reconcileStale(currentSessionId, maxAgeHours = STALE_HOURS_DEFAULT, now = new Date) {
    const cutoff = new Date(now.getTime() - maxAgeHours * 3600000).toISOString();
    const upd = this.db.query("UPDATE sessions SET closed_at=?, close_reason=? WHERE session_id=? AND closed_at IS NULL");
    let closed = 0;
    for (const row of this.openOthers(currentSessionId)) {
      const byAge = row.started_at < cutoff;
      const byIdle = deadByTranscript(row.transcript_path, now.getTime());
      if (!byAge && !byIdle)
        continue;
      upd.run(now.toISOString(), byAge ? "reconciled-dirty" : "reconciled-idle", row.session_id);
      closed++;
    }
    return closed;
  }
  openLiveOthers(currentSessionId, now = Date.now()) {
    return this.openOthers(currentSessionId).filter((r) => !deadByTranscript(r.transcript_path, now)).length;
  }
  get(sessionId) {
    return this.db.query("SELECT * FROM sessions WHERE session_id=?").get(sessionId);
  }
  recentStarts(exceptSessionId, limit = 10) {
    return this.db.query("SELECT started_at FROM sessions WHERE session_id != ? ORDER BY started_at DESC LIMIT ?").all(exceptSessionId, limit).map((r) => r.started_at);
  }
  pruneEphemeral(keep = 30) {
    const recent = this.db.query("SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT ?").all(keep);
    if (recent.length < keep)
      return;
    const ids = recent.map((r) => r.session_id);
    const placeholders = ids.map(() => "?").join(",");
    for (const table of ["jit_log", "gate_log", "model_state", "gate_fuse", "session_edits"]) {
      try {
        this.db.query(`DELETE FROM ${table} WHERE session_id NOT IN (${placeholders})`).run(...ids);
      } catch {}
    }
  }
}

// src/core/constitution.ts
import { readFileSync as readFileSync11, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join12 } from "node:path";
var FILE3 = "constitution.json";
function readConstitution(dataDir) {
  try {
    const j = JSON.parse(readFileSync11(join12(dataDir, FILE3), "utf8"));
    if (!Array.isArray(j.pairs))
      return null;
    const pairs = j.pairs.filter((p) => typeof p?.goal === "string" && typeof p?.constraint === "string" && p.goal.trim().length > 0);
    return pairs.length > 0 ? { pairs, updated_at: j.updated_at ?? "" } : null;
  } catch {
    return null;
  }
}
function upsertConstitution(dataDir, incoming, now = new Date().toISOString()) {
  const current2 = readConstitution(dataDir)?.pairs ?? [];
  const byGoal = new Map(current2.map((p) => [p.goal.trim().toLowerCase(), p]));
  for (const p of incoming) {
    if (typeof p?.goal !== "string" || typeof p?.constraint !== "string" || !p.goal.trim())
      continue;
    byGoal.set(p.goal.trim().toLowerCase(), { goal: p.goal.trim(), constraint: p.constraint.trim() });
  }
  const next = { pairs: [...byGoal.values()], updated_at: now };
  writeFileSync4(join12(dataDir, FILE3), JSON.stringify(next, null, 1), "utf8");
  return next;
}
function renderConstitution(c) {
  const lines = ["## Воля владельца (задана явно, поверх выведенных приоритетов; действует без повторения в промптах)", ""];
  for (const p of c.pairs)
    lines.push(`- цель: ${p.goal} · ограничение: ${p.constraint}`);
  return lines.join(`
`);
}

// src/hooks/heartbeat.ts
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join13 } from "node:path";
function beat(dataDir, channel, extra = {}) {
  try {
    mkdirSync2(dataDir, { recursive: true });
    writeFileSync5(join13(dataDir, `heartbeat-${channel.toLowerCase()}.json`), JSON.stringify({ channel, at: new Date().toISOString(), ...extra }), "utf8");
  } catch {}
}

// src/gardener/scheduler.ts
init_i18n();
var META_TABLE = "gardener_meta";
var RETRY_DELAYS_MS = [5 * 60000, 30 * 60000, 2 * 3600000];
var MAX_FAST_RETRIES = RETRY_DELAYS_MS.length;
function ensureMeta(db) {
  db.run(`CREATE TABLE IF NOT EXISTS ${META_TABLE}(work TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT NOT NULL)`);
  const cols = db.query(`PRAGMA table_info(${META_TABLE})`).all().map((c) => c.name);
  if (!cols.includes("attempts"))
    db.run(`ALTER TABLE ${META_TABLE} ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
  if (!cols.includes("next_at")) {
    db.run(`ALTER TABLE ${META_TABLE} ADD COLUMN next_at TEXT`);
    db.run(`UPDATE ${META_TABLE} SET attempts=1, next_at=at WHERE ok=0`);
  }
}
function lastRun(db, id) {
  try {
    ensureMeta(db);
    const row = db.query(`SELECT at, ok, note, attempts, next_at FROM ${META_TABLE} WHERE work=?`).get(id);
    if (!row)
      return null;
    return { at: row.at, ok: row.ok === 1, note: row.note, attempts: row.attempts ?? 0, nextAt: row.next_at ?? null };
  } catch {
    return null;
  }
}
function recordRun(db, id, ok, note, nowIso) {
  try {
    ensureMeta(db);
    const prevAttempts = lastRun(db, id)?.attempts ?? 0;
    const attempts = ok ? 0 : prevAttempts + 1;
    const delay = ok ? null : RETRY_DELAYS_MS[attempts - 1] ?? null;
    const nextAt = delay === null ? null : new Date(Date.parse(nowIso) + delay).toISOString();
    db.query(`INSERT INTO ${META_TABLE}(work, at, ok, note, attempts, next_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(work) DO UPDATE SET at=excluded.at, ok=excluded.ok, note=excluded.note, attempts=excluded.attempts, next_at=excluded.next_at`).run(id, nowIso, ok ? 1 : 0, note.slice(0, 300), attempts, nextAt);
  } catch {}
}
function cooldownPassed(db, w, nowMs) {
  const last = lastRun(db, w.id);
  if (!last)
    return true;
  if (last.nextAt !== null) {
    const due = Date.parse(last.nextAt);
    return Number.isFinite(due) ? nowMs >= due : true;
  }
  if (w.cooldownH <= 0)
    return true;
  const hours = (nowMs - Date.parse(last.at)) / 3600000;
  if (!Number.isFinite(hours))
    return true;
  return hours >= (last.ok ? w.cooldownH : w.cooldownH / 4);
}
async function runWorks(works, ctx, options = {}) {
  const opts = typeof options === "number" ? { budgetMs: options } : options;
  const budgetMs = opts.budgetMs ?? 240000;
  const report = { outcomes: [], skipped: [] };
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const ordered = [...works].sort((a, b) => a.cost === b.cost ? 0 : a.cost === "cheap" ? -1 : 1);
  for (const w of ordered) {
    let due;
    try {
      due = w.due(ctx) && (opts.ignoreCooldown === true || cooldownPassed(ctx.db, w, ctx.nowMs));
    } catch {
      due = false;
    }
    if (!due) {
      report.skipped.push(w.id);
      continue;
    }
    if (w.cost === "llm" && elapsed() >= budgetMs) {
      report.skipped.push(`${w.id} (бюджет)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const note = await w.run(ctx);
      const ms = Date.now() - t0;
      if (note === null) {
        report.skipped.push(`${w.id} (нечего)`);
        continue;
      }
      report.outcomes.push({ id: w.id, ok: true, note, ms });
      recordRun(ctx.db, w.id, true, note, new Date().toISOString());
    } catch (e) {
      const ms = Date.now() - t0;
      const note = String(e).slice(0, 200);
      report.outcomes.push({ id: w.id, ok: false, note, ms });
      recordRun(ctx.db, w.id, false, note, new Date().toISOString());
    }
  }
  return report;
}
function renderGardenerSilence(db, nowMs, quietDays = 7) {
  try {
    const born = db.query("SELECT MIN(asserted_at) AS at FROM fact_journal").get()?.at;
    if (!born)
      return "";
    const ageDays = (nowMs - Date.parse(born)) / 86400000;
    if (!Number.isFinite(ageDays) || ageDays < quietDays)
      return "";
    ensureMeta(db);
    const last = db.query(`SELECT MAX(at) AS at FROM ${META_TABLE}`).get()?.at;
    if (!last) {
      return t("- ⚠ фоновое обслуживание ни разу не отрабатывало: паспорт не углубляется (проверьте рантайм и learn.json)", "- ⚠ background maintenance has never run: the passport is not deepening (check the runtime and learn.json)");
    }
    const quiet = (nowMs - Date.parse(last)) / 86400000;
    if (!Number.isFinite(quiet) || quiet < quietDays)
      return "";
    return t(`- ⚠ фоновое обслуживание молчит ${Math.round(quiet)}д: паспорт перестал углубляться (проверьте рантайм и learn.json)`, `- ⚠ background maintenance has been silent for ${Math.round(quiet)}d: the passport stopped deepening (check the runtime and learn.json)`);
  } catch {
    return "";
  }
}
var REPORTED_WORKS = ["truth", "repair", "drift", "verbalize", "corrections", "zsummary", "contract", "material", "composition", "grounding"];
function renderBackground(db, ids, nowMs) {
  const parts = [];
  for (const id of ids) {
    const last = lastRun(db, id);
    if (!last || !last.note)
      continue;
    const hours = (nowMs - Date.parse(last.at)) / 3600000;
    if (!Number.isFinite(hours) || hours > 72)
      continue;
    const fate = last.ok ? "" : last.nextAt !== null ? t(` — повтор назначен (попытка ${last.attempts + 1} из ${MAX_FAST_RETRIES + 1})`, ` — a retry is scheduled (attempt ${last.attempts + 1} of ${MAX_FAST_RETRIES + 1})`) : t(" — быстрые повторы исчерпаны, вернулось к обычному расписанию", " — fast retries are spent, back on the normal schedule");
    parts.push(`${last.ok ? "" : "⚠ "}${last.note}${fate}`);
  }
  if (parts.length === 0)
    return "";
  return `- ${t("фоновая работа", "background work")}: ${parts.join(" · ")}`;
}

// src/gardener/utility.ts
init_i18n();
var MUTE_SCORE = 0.15;
var MIN_SAMPLE = 12;
var EXPLORE_EVERY = 10;
var UTILITY_HALF_LIFE_MS = 30 * 24 * 3600000;
var FOLD_MIN_AGE_MS = 3600000;
function ensureUtilityTable(db) {
  db.run("CREATE TABLE IF NOT EXISTS feed_utility(kind TEXT PRIMARY KEY, surfaced INTEGER NOT NULL, used INTEGER NOT NULL)");
  const cols = db.query("PRAGMA table_info(feed_utility)").all().map((c) => c.name);
  if (!cols.includes("attempts"))
    db.run("ALTER TABLE feed_utility ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("decayed_at"))
    db.run("ALTER TABLE feed_utility ADD COLUMN decayed_at TEXT");
}
function foldDecay(db, kind, nowMs) {
  const row = db.query("SELECT surfaced, used, decayed_at FROM feed_utility WHERE kind=?").get(kind);
  if (!row)
    return;
  if (row.decayed_at === null) {
    db.query("UPDATE feed_utility SET decayed_at=? WHERE kind=?").run(new Date(nowMs).toISOString(), kind);
    return;
  }
  const age = nowMs - Date.parse(row.decayed_at);
  if (!Number.isFinite(age) || age < FOLD_MIN_AGE_MS)
    return;
  const k = Math.pow(0.5, age / UTILITY_HALF_LIFE_MS);
  db.query("UPDATE feed_utility SET surfaced=?, used=?, decayed_at=? WHERE kind=?").run(row.surfaced * k, row.used * k, new Date(nowMs).toISOString(), kind);
}
function noteSurfaced(db, kind, nowMs = Date.now()) {
  try {
    ensureUtilityTable(db);
    foldDecay(db, kind, nowMs);
    db.query("INSERT INTO feed_utility(kind, surfaced, used, decayed_at) VALUES(?,1,0,?) ON CONFLICT(kind) DO UPDATE SET surfaced=surfaced+1").run(kind, new Date(nowMs).toISOString());
  } catch {}
}
function noteUsed(db, kind, nowMs = Date.now()) {
  try {
    ensureUtilityTable(db);
    foldDecay(db, kind, nowMs);
    db.query("INSERT INTO feed_utility(kind, surfaced, used, decayed_at) VALUES(?,1,1,?) ON CONFLICT(kind) DO UPDATE SET used=used+1").run(kind, new Date(nowMs).toISOString());
  } catch {}
}
function utilityOf(db, kind) {
  try {
    ensureUtilityTable(db);
    const row = db.query("SELECT surfaced, used FROM feed_utility WHERE kind=?").get(kind);
    const surfaced = row?.surfaced ?? 0;
    const used = row?.used ?? 0;
    return { kind, surfaced, used, score: (used + 1) / (surfaced + 2) };
  } catch {
    return { kind, surfaced: 0, used: 0, score: 0.5 };
  }
}
function shouldFeed(db, kind, nowMs = Date.now()) {
  try {
    ensureUtilityTable(db);
    foldDecay(db, kind, nowMs);
  } catch {}
  const u = utilityOf(db, kind);
  if (u.surfaced < MIN_SAMPLE)
    return true;
  if (u.score >= MUTE_SCORE)
    return true;
  let attempts = 0;
  try {
    ensureUtilityTable(db);
    db.query("UPDATE feed_utility SET attempts = attempts + 1 WHERE kind=?").run(kind);
    attempts = db.query("SELECT attempts FROM feed_utility WHERE kind=?").get(kind)?.attempts ?? 0;
  } catch {
    return true;
  }
  return attempts % EXPLORE_EVERY === 0;
}
function rankKinds(db) {
  try {
    ensureUtilityTable(db);
    const rows = db.query("SELECT kind, surfaced, used FROM feed_utility").all();
    return rows.map((r) => ({ kind: r.kind, surfaced: r.surfaced, used: r.used, score: (r.used + 1) / (r.surfaced + 2) })).sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}
function mutedKinds(db) {
  return rankKinds(db).filter((u) => u.surfaced >= MIN_SAMPLE && u.score < MUTE_SCORE);
}
function renderUtility(rows) {
  if (rows.length === 0)
    return "";
  const shown = rows.filter((r) => r.surfaced > 0).slice(0, 6).map((r) => `${r.kind} ${Math.round(r.score * 100)}% (${Math.round(r.used)}/${Math.round(r.surfaced)})`);
  return shown.length > 0 ? `${t("окупаемость подачи", "feed payback")}: ${shown.join(" · ")}` : "";
}

// src/hooks/session-start-core.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync13, appendFileSync } from "node:fs";
import { basename as basename2, join as join15 } from "node:path";

// src/hooks/git-state.ts
init_i18n();
import { spawnSync as spawnSync3 } from "node:child_process";
function git(cwd, args) {
  try {
    const r = spawnSync3("git", args, { cwd, encoding: "utf8", timeout: 8000, windowsHide: true });
    if (r.status !== 0 || typeof r.stdout !== "string")
      return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}
function gitState(cwd) {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null)
    return null;
  const porcelain = git(cwd, ["status", "--porcelain"]) ?? "";
  const dirty = porcelain.split(`
`).filter((l) => l.trim().length > 0);
  return {
    branch,
    dirtyCount: dirty.length,
    dirtyTop: dirty.slice(0, 5).map((l) => l.slice(3).trim()),
    lastCommit: git(cwd, ["log", "-1", "--format=%s (%cr)"])
  };
}
function asData(s, limit = 120) {
  const firstLine = s.split(/[\r\n]/)[0].replace(/`/g, "'").trim();
  const cut = firstLine.slice(0, limit);
  return "`" + cut + (firstLine.length > limit ? "…" : "") + "`";
}
function renderGitBlock(g, reconciledDirty) {
  const lines = [t("## Состояние", "## State"), ""];
  lines.push(`- ${t("ветка", "branch")}: ${g.branch} · ${t("незакоммичено", "uncommitted")}: ${g.dirtyCount}${g.dirtyCount > 0 ? ` (${g.dirtyTop.map((f) => asData(f, 80)).join(", ")}${g.dirtyCount > 5 ? ", …" : ""})` : ""}`);
  if (g.lastCommit)
    lines.push(`- ${t("последний коммит", "last commit")}: ${asData(g.lastCommit)}`);
  if (reconciledDirty > 0) {
    lines.push(t(`- прошлая сессия (${reconciledDirty} шт.) оборвалась без завершения — обрыв учтён`, `- ${reconciledDirty} previous session(s) died without finishing — the break has been accounted for`));
  }
  return lines.join(`
`);
}

// src/graph/heat.ts
var HEAT_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
var READ_TOUCH_WEIGHT = 1;
var EDIT_TOUCH_WEIGHT = 4;
var HEAT_CAP = 10;
function decayHeat(heat, ageMs, halfLifeMs = HEAT_HALF_LIFE_MS) {
  if (!Number.isFinite(ageMs) || ageMs <= 0)
    return heat;
  return heat * Math.pow(0.5, ageMs / halfLifeMs);
}
function ensureHeatTable(db) {
  db.run("CREATE TABLE IF NOT EXISTS node_heat(file TEXT PRIMARY KEY, heat REAL NOT NULL, updated_at TEXT NOT NULL)");
}
function bumpHeat(db, file, nowIso, weight = READ_TOUCH_WEIGHT) {
  ensureHeatTable(db);
  const row = db.query("SELECT heat, updated_at FROM node_heat WHERE file=?").get(file);
  const decayed = row ? decayHeat(row.heat, Date.parse(nowIso) - Date.parse(row.updated_at)) : 0;
  db.query("INSERT INTO node_heat(file, heat, updated_at) VALUES(?,?,?) ON CONFLICT(file) DO UPDATE SET heat=excluded.heat, updated_at=excluded.updated_at").run(file, Math.min(decayed + weight, HEAT_CAP), nowIso);
}
function effectiveHeat(rows, nowMs, halfLifeMs = HEAT_HALF_LIFE_MS) {
  const out = new Map;
  for (const r of rows) {
    const h = decayHeat(r.heat, nowMs - Date.parse(r.updated_at), halfLifeMs);
    if (h > 0)
      out.set(r.file, h);
  }
  return out;
}
function hotFiles(heat, threshold, max) {
  return [...heat.entries()].filter((pair2) => pair2[1] >= threshold).sort((a, b) => b[1] - a[1]).slice(0, max).map((pair2) => pair2[0]);
}
function readHeatRows(db) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='node_heat'").get().n > 0;
    if (!has)
      return [];
    return db.query("SELECT file, heat, updated_at FROM node_heat").all();
  } catch {
    return [];
  }
}

// src/hooks/entry.ts
init_i18n();
function tableExists2(db, name) {
  return db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;
}
function reconstructEntry(db, thread, dirty, nowMs) {
  try {
    if (!tableExists2(db, "graph_nodes") || !tableExists2(db, "graph_edges"))
      return "";
    const nodes = db.query("SELECT file FROM graph_nodes").all().map((r) => r.file);
    if (nodes.length === 0)
      return "";
    const nodeSet = new Set(nodes);
    const heat = effectiveHeat(readHeatRows(db), nowMs);
    const hot = hotFiles(heat, 0.5, 3);
    const work = [...new Set([...thread, ...dirty, ...hot])].filter((f) => nodeSet.has(f));
    if (work.length === 0)
      return "";
    const seeds = work.map((f) => ({ file: f, weight: 50 }));
    const seedSet = new Set(seeds.map((s) => s.file));
    const edges = db.query("SELECT from_file, to_file FROM graph_edges").all().map((e) => ({ from: e.from_file, to: e.to_file }));
    if (edges.length === 0)
      return "";
    const neighborhood = reachableUndirected(edges, seedSet, 2);
    const related = taskRelevantNeighbors(nodes, edges, seeds, neighborhood, 4).map((n) => n.file);
    const lines = [t("## Вход в работу (что было в работе до этого сообщения)", "## Picking up the work (what was in progress before this message)"), ""];
    lines.push(t(`- над чем шла работа: ${work.slice(0, 6).join(", ")}${work.length > 6 ? ", …" : ""}`, `- what was being worked on: ${work.slice(0, 6).join(", ")}${work.length > 6 ? ", …" : ""}`));
    if (related.length > 0) {
      lines.push(t(`- рядом по связям проекта (не названо, но связано): ${related.join(", ")}`, `- nearby through the project's links (not named, but connected): ${related.join(", ")}`));
    }
    lines.push(t("- «продолжи» ложи на это состояние, а не на букву промпта: восстанови намерение, сверь с git-диффом и нитью, затем действуй", '- read "carry on" against this state, not against the letter of the prompt: reconstruct the intent, check it against the git diff and the thread, then act'));
    return lines.join(`
`);
  } catch {
    return "";
  }
}

// src/hooks/diagnose.ts
import { readFileSync as readFileSync12, readdirSync as readdirSync2 } from "node:fs";
import { join as join14 } from "node:path";
var EXPECTED = ["userpromptsubmit", "stop"];
var SILENT_SESSIONS = 3;
function silentChannels(beats, sessionStartsDesc) {
  if (sessionStartsDesc.length < SILENT_SESSIONS)
    return [];
  const cutoff = Date.parse(sessionStartsDesc[SILENT_SESSIONS - 1]);
  if (!Number.isFinite(cutoff))
    return [];
  const beatAt = new Map(beats.map((b) => [b.channel.toLowerCase(), Date.parse(b.at)]));
  const silent = [];
  for (const ch of EXPECTED) {
    const at = beatAt.get(ch);
    if (at === undefined || !Number.isFinite(at) || at < cutoff)
      silent.push(ch);
  }
  return silent;
}
function readBeats(dataDir) {
  try {
    return readdirSync2(dataDir).filter((f) => f.startsWith("heartbeat-") && f.endsWith(".json")).map((f) => {
      try {
        const j = JSON.parse(readFileSync12(join14(dataDir, f), "utf8"));
        return j.channel && j.at ? { channel: j.channel, at: j.at } : null;
      } catch {
        return null;
      }
    }).filter((b) => b !== null);
  } catch {
    return [];
  }
}
var LABEL = {
  userpromptsubmit: "UserPromptSubmit (JIT-срез по промпту)",
  stop: "Stop (гейт формы / HANDOFF)"
};
function renderDiagnosis(silent) {
  if (silent.length === 0)
    return "";
  const named = silent.map((c) => LABEL[c] ?? c).join(", ");
  return `- ⚠ самодиагностика: канал(ы) молчат ${SILENT_SESSIONS}+ сессий — ${named}. Возможен сломанный хук (обнови плагин / перезапусти Claude Code); паспорт работает на оставшихся каналах.`;
}

// src/hooks/session-start-core.ts
init_i18n();
function detectCorrections(db, cwd, currentSid) {
  const hasState = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='model_state'").get().n > 0;
  if (!hasState)
    return 0;
  db.run("CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, before_content TEXT NOT NULL, from_session TEXT NOT NULL, detected_at TEXT NOT NULL, analyzed INTEGER NOT NULL DEFAULT 0)");
  const rows = db.query("SELECT session_id, file, hash, content FROM model_state WHERE session_id != ?").all(currentSid);
  let found = 0;
  const insert = db.query("INSERT INTO corrections(file, before_content, from_session, detected_at) VALUES(?,?,?,?)");
  const consume = db.query("DELETE FROM model_state WHERE session_id=? AND file=?");
  for (const r of rows) {
    try {
      const nowContent = snapshotContent(readFileSync13(join15(cwd, r.file), "utf8"));
      if (sha1(nowContent) !== r.hash) {
        insert.run(r.file, r.content, r.session_id, new Date().toISOString());
        found++;
      }
    } catch {}
    consume.run(r.session_id, r.file);
  }
  return found;
}
var CONTEXT_CHAR_BUDGET = 8000;
function slugOf(path) {
  const norm = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return basename2(norm).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "project";
}
function handleSessionStart(input, dataRoot) {
  const cwd = input.cwd ?? process.cwd();
  const dataDir = join15(dataRoot, slugOf(cwd));
  mkdirSync3(dataDir, { recursive: true });
  initLang(dataDir, cwd);
  beat(dataDir, "SessionStart", { source: input.source ?? null });
  try {
    const r = buildPassport(cwd, dataDir);
    let reconciled = 0;
    let threadLine = "";
    let threadFiles = [];
    let gateLine = "";
    let diagLine = "";
    let bgLine = "";
    const runtimeLine = renderRuntimeWarning(inspectRuntime());
    let utilLine = "";
    let entryBlock = "";
    let survivalLine = "";
    const g = gitState(cwd);
    try {
      const db = openDb(join15(dataDir, "passport.db"));
      const log = new SessionLog(db);
      const sid = input.session_id ?? `manual-${Date.now()}`;
      diagLine = renderDiagnosis(silentChannels(readBeats(dataDir), log.recentStarts(sid)));
      log.open(sid, input.source ?? null, new Date().toISOString(), input.transcript_path ?? null);
      reconciled = log.reconcileStale(sid);
      log.pruneEphemeral();
      detectCorrections(db, cwd, sid);
      try {
        bgLine = renderBackground(db, REPORTED_WORKS, Date.now());
        if (bgLine === "")
          bgLine = renderGardenerSilence(db, Date.now());
      } catch {}
      try {
        const muted = mutedKinds(db);
        if (muted.length > 0) {
          utilLine = t(`- подача адаптирована: ${muted.map((m) => `${m.kind} (${m.used}/${m.surfaced} окупаемость)`).join(", ")} — здесь не окупалось, приглушено; периодически перепроверяется`, `- delivery adapted: ${muted.map((m) => `${m.kind} (${m.used}/${m.surfaced} payoff)`).join(", ")} — it did not pay off here and was dimmed; re-checked from time to time`);
        }
      } catch {}
      const hasGateLog = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='gate_log'").get().n > 0;
      if (hasGateLog) {
        const top = db.query("SELECT law, COUNT(*) n FROM gate_log GROUP BY law HAVING n >= 3 ORDER BY n DESC LIMIT 1").get();
        if (top) {
          gateLine = t(`- гейт чаще всего ловит: «${statement(top.law)}» — ${top.n} поимок (это правило здесь нарушается регулярно)`, `- the gate catches this most often: “${statement(top.law)}” — ${top.n} catches (this rule is broken here regularly)`);
        }
      }
      const hasThreads = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='session_threads'").get().n > 0;
      if (hasThreads) {
        const tcols = db.query("PRAGMA table_info(session_threads)").all().map((c) => c.name);
        const sel = tcols.includes("commits") ? "files, updated_at, commits" : "files, updated_at";
        const th = db.query(`SELECT ${sel} FROM session_threads WHERE session_id != ? ORDER BY updated_at DESC LIMIT 1`).get(sid);
        if (th) {
          const files = JSON.parse(th.files);
          const ageH = Math.max(0, Math.round((Date.now() - Date.parse(th.updated_at)) / 3600000));
          const age = ageH < 1 ? t("меньше часа назад", "less than an hour ago") : ageH < 48 ? t(`${ageH}ч назад`, `${ageH}h ago`) : t(`${Math.round(ageH / 24)}д назад`, `${Math.round(ageH / 24)}d ago`);
          threadLine = `- ${t("нить прошлой сессии", "thread of the previous session")} (${age}): ${files.slice(0, 5).join(", ")}${files.length > 5 ? `, … (+${files.length - 5})` : ""}`;
          threadFiles = files;
          const commits = th.commits ? JSON.parse(th.commits) : [];
          if (commits.length > 0) {
            const shown = commits.slice(0, 3).map((c) => c.replace(/`/g, "'").slice(0, 90));
            threadLine += `
- ${t("прошлая сессия сделала", "the previous session did")}: ${shown.join("; ")}${commits.length > 3 ? `, … (+${commits.length - 3})` : ""}`;
          }
        }
      }
      if (input.source === "compact") {
        try {
          const edits = db.query("SELECT file FROM session_edits WHERE session_id=? ORDER BY edited_at").all(sid);
          if (edits.length > 0) {
            const files = edits.map((e) => e.file);
            const shown = files.slice(0, 8).join(", ") + (files.length > 8 ? `, … (+${files.length - 8})` : "");
            survivalLine = t(`- правлено ЭТОЙ сессией до сжатия (порядок работы, из журнала — не из пересказа): ${shown}`, `- edited by THIS session before compaction (work order, from the journal — not from a summary): ${shown}`);
          }
          const caught = db.query("SELECT law, COUNT(*) n FROM gate_log WHERE session_id=? GROUP BY law ORDER BY n DESC LIMIT 2").all(sid);
          if (caught.length > 0) {
            const shown = caught.map((c) => `«${statement(c.law)}» ×${c.n}`).join(", ");
            survivalLine += `${survivalLine ? `
` : ""}${t(`- гейт этой сессии ловил: ${shown} — если правилось, не потеряй фикс при продолжении`, `- this session's gate caught: ${shown} — if it was being fixed, do not lose the fix when continuing`)}`;
          }
        } catch {}
      }
      entryBlock = reconstructEntry(db, threadFiles, g?.dirtyTop ?? [], Date.now());
      db.close();
    } catch {}
    const constitution = readConstitution(dataDir);
    const constBlock = constitution ? `
${renderConstitution(constitution)}
` : "";
    let summary = "";
    try {
      summary = readFileSync13(r.summaryPath, "utf8");
    } catch {}
    if (!summary.includes("## "))
      summary = "";
    if (!summary && !constBlock)
      return {};
    if (summary.length > CONTEXT_CHAR_BUDGET) {
      summary = summary.slice(0, CONTEXT_CHAR_BUDGET) + `
…обрезано; полная версия: ${r.summaryPath}`;
    }
    let stateBlock = g ? `
${renderGitBlock(g, reconciled)}` : "";
    const compactNote = input.source === "compact" ? t("- контекст был сжат — паспорт восстановлен (то, что компакция могла выронить)", "- the context was compacted — the passport has been restored (what compaction could have dropped)") : input.source === "fork" ? t("- сессия форкнута — паспорт подан форку (сабагенты не наследуют контекст родителя)", "- the session was forked — the passport was delivered to the fork (subagents do not inherit the parent context)") : "";
    for (const line of [runtimeLine, compactNote, survivalLine, threadLine, bgLine, utilLine, gateLine, diagLine]) {
      if (line)
        stateBlock += `${stateBlock ? `
` : `
${t("## Состояние", "## State")}

`}${line}`;
    }
    if (stateBlock)
      stateBlock += `
`;
    const entrySection = entryBlock ? `
${entryBlock}
` : "";
    let frameSection = "";
    try {
      const frame = readFileSync13(join15(dataDir, "frame.md"), "utf8").trim();
      if (frame)
        frameSection = `
${frame}
`;
    } catch {}
    const freshness = r.factsExecuted ? t("свежий пересчёт", "freshly recomputed") : t("кэш (код не менялся)", "cache (the code has not changed)");
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `${summary}${constBlock}${frameSection}${stateBlock}${entrySection}
_Symbiont · ${freshness} · ${t("подробнее по требованию", "more on demand")}: passport_conventions / passport_history_`
      }
    };
  } catch (e) {
    try {
      appendFileSync(join15(dataDir, "errors.log"), `${new Date().toISOString()} SessionStart: ${String(e)}
`, "utf8");
    } catch {}
    return {};
  }
}

export { lang, t, sourceLabel, readState, initLang, observePrompt, chooseLang, statement, tier, area, areaList, areaKey, init_i18n, inspectRuntime, runtimeBlocker, silentSpawnOptions, openDb, isDue, factBasis, keyOf, FactStore, inDerivedZone, CODE_EXT, walkFiles, codeFiles, init_walk, sha1, analyzeJs, detectIndent, GENERATED_LINE_CHARS, taskRelevantNeighbors, reachableUndirected, ENTITY_EXT, zoneAncestors, effectiveProfile, rootAxesFromFacts, renderEffective, readZoneProfiles, auditTruth, healProjections, renderTruth, isConfigFile, parseConfigFile, readConfigEntries, readConfigEdges, renderConfigInfluence, artifactProfile, activeAxes, detectStack, fileDomains, jsonOnly, documentsBlock, revisionsBlock, findUnknownMaterial, buildUnknownPrompt, mergeLearnedMaterials, OFFICE, CSVX, TEXT, isNonCodeMinable, extractContent, computeHealth, computeDrift, renderDrift, renderDriftReport, hotspotsFromGit, readFrame, deriveAstFacts, contentVerifierActive, loadEntityResolver, runContentVerifiers, buildPassport, snapshotContent, SessionLog, readConstitution, upsertConstitution, renderConstitution, READ_TOUCH_WEIGHT, EDIT_TOUCH_WEIGHT, bumpHeat, effectiveHeat, hotFiles, readHeatRows, beat, lastRun, runWorks, REPORTED_WORKS, noteSurfaced, noteUsed, shouldFeed, rankKinds, renderUtility, slugOf, handleSessionStart };
