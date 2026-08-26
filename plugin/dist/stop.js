import {
  applyRules,
  readRules
} from "./session-start-yy1exarv.js";
import {
  readGateMode
} from "./session-start-yvd28w11.js";
import {
  checkAgainstLaws,
  toRelNode
} from "./session-start-f6jkdtrr.js";
import"./session-start-6vfyfrmt.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-p1t5vyb4.js";
import"./session-start-046cybce.js";
import"./session-start-ehh2y93s.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-j1yy7aw2.js";
import {
  ENTITY_EXT,
  ENV_TEMPLATES,
  FactStore,
  SessionLog,
  beat,
  contentVerifierActive,
  inDerivedZone,
  initLang,
  init_i18n,
  init_walk,
  isConfigFile,
  loadEntityResolver,
  openDb,
  parseConfigFile,
  reachableUndirected,
  runContentVerifiers,
  sha1,
  slugOf,
  snapshotContent,
  statement,
  t
} from "./session-start-nhshhf7v.js";
import"./session-start-70d7ckvt.js";

// src/hooks/stop.ts
import { join as join3 } from "node:path";

// src/hooks/stop-core.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, statSync } from "node:fs";
import { extname, join as join2 } from "node:path";
import { spawnSync } from "node:child_process";

// src/verifiers/security.ts
var REMOVAL_RULES = [
  { kind: "снята валидация входа", onRemoval: true, re: /(zod|joi|yup|validator|express-validator|\.safeParse\(|[\w$]*schema[\w$]*\.parse\(|pydantic|BaseModel|is_valid\(|\.clean\(|validate\w*\(|sanitiz)/i },
  { kind: "снята аутентификация/авторизация", onRemoval: true, re: /\b(requireAuth|isAuthenticated|ensureLoggedIn|login_required|authorize\(|authenticate\(|verifyToken|jwt\.verify|checkPermission|@auth|hasRole|can\()/i },
  { kind: "снят security-заголовок", onRemoval: true, re: /(Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|helmet\(|frameguard|hsts\()/i },
  { kind: "снят rate-limit", onRemoval: true, re: /\b(rateLimit|express-rate-limit|limiter|limit_req|RateLimiter|throttle|slowDown)\b/i },
  { kind: "снято экранирование/санитизация", onRemoval: true, re: /\b(escapeHtml|escape\(|DOMPurify|sanitizeHtml|htmlspecialchars|bleach\.|escape_string|quote\()/i },
  { kind: "снята защита от CSRF", onRemoval: true, re: /\b(csrf|csurf|CSRFProtect|xsrf)\b/i }
];
var ADDITION_RULES = [
  { kind: "CORS расширен до «*»", onRemoval: false, re: /(Access-Control-Allow-Origin['"]?[\s:,]*['"]?\*|origin\s*:\s*['"]\*['"]|cors\(\s*\)|credentials\s*:\s*true[\s\S]{0,40}origin\s*:\s*['"]\*)/i },
  { kind: "отключена проверка TLS-сертификата", onRemoval: false, re: /(rejectUnauthorized\s*:\s*false|verify\s*=\s*False|ssl_verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|CURLOPT_SSL_VERIFYPEER\s*,\s*(0|false))/i },
  { kind: "внесён eval/динамическое исполнение", onRemoval: false, re: /(\beval\(|new Function\(|child_process[\s\S]{0,20}exec\(|os\.system\(|subprocess\.\w+\([^)]*shell\s*=\s*True|\bexec\s*\()/i },
  { kind: "внесён небезопасный HTML (XSS-поверхность)", onRemoval: false, re: /(dangerouslySetInnerHTML|\.innerHTML\s*=|v-html|\|\s*safe\b|mark_safe\(|\{\{\{)/i },
  { kind: "отключена/ослаблена CSRF-защита", onRemoval: false, re: /(csrf\s*:\s*false|csrf_exempt|@csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False|disable\w*[_-]?csrf)/i },
  { kind: "подавлен анализатор безопасности", onRemoval: false, re: /(#\s*nosec|eslint-disable[\w-]*security|\/\/\s*nosemgrep|#\s*noqa:\s*S\d|@SuppressWarnings\([^)]*security)/i }
];
function splitDiff(diff) {
  const added = [];
  const removed = [];
  for (const line of diff.split(`
`)) {
    if (line.startsWith("+") && !line.startsWith("+++"))
      added.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---"))
      removed.push(line.slice(1));
  }
  return { added, removed };
}
function detectSecurityRegressions(diff) {
  const { added, removed } = splitDiff(diff);
  if (added.length === 0 && removed.length === 0)
    return [];
  const addedText = added.join(`
`);
  const removedText = removed.join(`
`);
  const out = [];
  const seen = new Set;
  const push = (kind, sample) => {
    if (seen.has(kind))
      return;
    seen.add(kind);
    out.push({ kind, detail: sample.trim().slice(0, 80) });
  };
  for (const rule of REMOVAL_RULES) {
    const m = removedText.match(rule.re);
    if (m && !rule.re.test(addedText))
      push(rule.kind, m[0]);
  }
  for (const rule of ADDITION_RULES) {
    const m = addedText.match(rule.re);
    if (m)
      push(rule.kind, m[0]);
  }
  return out;
}

// src/gates/focus.ts
var MIN_FILES = 6;
var MAX_ZONES = 3;
var SEED_FILES = 3;
var NEIGHBOR_HOPS = 2;
var OUTSIDE_RATIO = 0.4;
var zoneOf = (file) => {
  const parts = file.split("/");
  return parts.length <= 1 ? "(корень)" : parts[0];
};
var TEST_LINE = /^-.*(?<!\.)\b(it|test|describe|expect|assert|should)\s*\(/m;
var TEST_FILE = /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i;
function detectFocusDrift(input) {
  const files = input.sessionFiles;
  const out = [];
  if (files.length < MIN_FILES)
    return out;
  const zones = [...new Set(files.map(zoneOf))];
  if (zones.length > MAX_ZONES) {
    out.push({
      kind: "работа расползлась по зонам",
      detail: `${files.length} файлов в ${zones.length} зонах: ${zones.slice(0, 5).join(", ")}`,
      files: []
    });
  }
  if (input.edges.length > 0) {
    const first = files[0];
    const nearFirst = reachableUndirected(input.edges, new Set([first]), NEIGHBOR_HOPS);
    const seed = new Set(files.slice(0, SEED_FILES).filter((f) => f === first || nearFirst.has(f)));
    const near = reachableUndirected(input.edges, seed, NEIGHBOR_HOPS);
    const outside = files.filter((f) => !seed.has(f) && !near.has(f));
    if (outside.length >= 3 && outside.length / files.length >= OUTSIDE_RATIO) {
      out.push({
        kind: "правки вне окружения задачи",
        detail: `${outside.length} из ${files.length} файлов не связаны с начатым (${[...seed].slice(0, 2).join(", ")}) даже через ${NEIGHBOR_HOPS} хопа`,
        files: outside.slice(0, 5)
      });
    }
  }
  if (input.diffs) {
    const stripped = [];
    for (const entry of input.diffs) {
      const rel = entry[0];
      const diff = entry[1];
      if (!TEST_FILE.test(rel) && !TEST_LINE.test(diff))
        continue;
      if (TEST_LINE.test(diff))
        stripped.push(rel);
    }
    if (stripped.length > 0) {
      out.push({
        kind: "из диффа исчезли проверки",
        detail: `удалены строки с проверками: ${stripped.slice(0, 3).join(", ")}`,
        files: stripped.slice(0, 5)
      });
    }
  }
  return out;
}
function renderFocus(signals) {
  return signals.map((s) => `- страж фокуса: ${s.kind} · ${s.detail}${s.files.length > 0 ? ` (${s.files.join(", ")})` : ""}`);
}

// src/gates/budget.ts
var RELATIVE_TOLERANCE = 0.15;
var MIN_ABSOLUTE_DIFF = 2;
function compareBudgets(before, after) {
  const byMetric = new Map(before.map((m) => [m.metric, m]));
  const out = [];
  for (const now of after) {
    const was = byMetric.get(now.metric);
    if (!was || was.value <= 0)
      continue;
    const worse = now.direction === "меньше лучше" ? now.value > was.value : now.value < was.value;
    if (!worse)
      continue;
    const diff = Math.abs(now.value - was.value);
    const ratio = now.direction === "меньше лучше" ? now.value / was.value : was.value / now.value;
    if (ratio - 1 < RELATIVE_TOLERANCE)
      continue;
    if (diff < MIN_ABSOLUTE_DIFF)
      continue;
    out.push({
      metric: now.metric,
      was: was.value,
      now: now.value,
      ratio,
      detail: now.direction === "меньше лучше" ? `выросло с ${was.value} до ${now.value} (в ${ratio.toFixed(1)} раза)` : `упало с ${was.value} до ${now.value}`
    });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
var TEST_PATH = /(\.test\.|\.spec\.|_test\.|(^|\/)(tests?|__tests__|spec)\/)/i;
var ASSERTION = /\b(expect|assert|should|require\.that|Assert\.|XCTAssert)\s*\(/g;
function measure(files) {
  let assertions = 0;
  let testFiles = 0;
  let biggest = 0;
  let totalLines = 0;
  for (const f of files) {
    const lines = f.content.split(`
`).length;
    totalLines += lines;
    if (lines > biggest)
      biggest = lines;
    if (TEST_PATH.test(f.rel))
      testFiles++;
    assertions += (f.content.match(ASSERTION) ?? []).length;
  }
  return [
    { metric: "проверок в коде", value: assertions, direction: "больше лучше" },
    { metric: "файлов с тестами", value: testFiles, direction: "больше лучше" },
    { metric: "строк в самом большом файле", value: biggest, direction: "меньше лучше" },
    { metric: "строк всего в затронутых файлах", value: totalLines, direction: "меньше лучше" }
  ];
}
var REPORTED = new Set(["проверок в коде", "файлов с тестами", "строк в самом большом файле"]);
function renderBudgets(breaches) {
  return breaches.filter((b) => REPORTED.has(b.metric)).map((b) => `- бюджет качества: ${b.metric} — ${b.detail} (опорная точка — прошлое состояние этого же проекта)`);
}
function measureBefore(files) {
  let assertions = 0;
  let testFiles = 0;
  let biggest = 0;
  let totalLines = 0;
  for (const f of files) {
    const added = f.diff.split(`
`).filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const removed = f.diff.split(`
`).filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const countIn = (lines) => lines.reduce((s, l) => s + (l.slice(1).match(ASSERTION) ?? []).length, 0);
    const nowLines = f.content.split(`
`).length;
    const wasLines = Math.max(0, nowLines - added.length + removed.length);
    totalLines += wasLines;
    if (wasLines > biggest)
      biggest = wasLines;
    const nowAssertions = (f.content.match(ASSERTION) ?? []).length;
    assertions += Math.max(0, nowAssertions - countIn(added) + countIn(removed));
    const isNew = removed.length === 0 && added.length >= nowLines;
    if (TEST_PATH.test(f.rel) && !isNew)
      testFiles++;
  }
  return [
    { metric: "проверок в коде", value: assertions, direction: "больше лучше" },
    { metric: "файлов с тестами", value: testFiles, direction: "больше лучше" },
    { metric: "строк в самом большом файле", value: biggest, direction: "меньше лучше" },
    { metric: "строк всего в затронутых файлах", value: totalLines, direction: "меньше лучше" }
  ];
}

// src/env/capabilities.ts
var CAPABILITIES = [
  {
    id: "blob-url",
    policy: "csp",
    directive: "media-src",
    source: "blob:",
    what: "код создаёт blob:-URL (например для видео или скачивания файла)",
    match: /URL\.createObjectURL\s*\(|new\s+Blob\s*\(/
  },
  {
    id: "media-stream",
    policy: "csp",
    directive: "media-src",
    source: "blob:",
    what: "код собирает видеопоток (MediaRecorder / captureStream)",
    match: /new\s+MediaRecorder\s*\(|\.captureStream\s*\(|new\s+MediaSource\s*\(/
  },
  {
    id: "worker",
    policy: "csp",
    directive: "worker-src",
    source: "blob:",
    what: "код запускает Worker",
    match: /new\s+(Shared)?Worker\s*\(/
  },
  {
    id: "websocket",
    policy: "csp",
    directive: "connect-src",
    source: "wss:",
    what: "код открывает WebSocket-соединение",
    match: /new\s+WebSocket\s*\(|io\s*\(\s*['"`]wss?:/
  },
  {
    id: "eval",
    policy: "csp",
    directive: "script-src",
    source: "'unsafe-eval'",
    what: "код исполняет строку как код (eval / new Function)",
    match: /\beval\s*\(|new\s+Function\s*\(/
  },
  {
    id: "inline-style",
    policy: "csp",
    directive: "style-src",
    source: "'unsafe-inline'",
    what: "код задаёт инлайновые стили через style-атрибут",
    match: /\.style\.cssText\s*=|setAttribute\s*\(\s*['"`]style['"`]/
  },
  {
    id: "data-image",
    policy: "csp",
    directive: "img-src",
    source: "data:",
    what: "код формирует изображение как data:-URL (canvas.toDataURL)",
    match: /toDataURL\s*\(|['"`]data:image\//
  }
];
var REMOTE_CALL = /(?:fetch|axios(?:\.\w+)?|\.get|\.post)\s*\(\s*['"`]https?:\/\/([^/'"`]+)/g;
function extractCapabilities(content) {
  const out = [];
  for (const rule of CAPABILITIES) {
    if (rule.match.test(content))
      out.push({ rule, target: null });
  }
  const seen = new Set;
  for (const m of content.matchAll(REMOTE_CALL)) {
    const host = m[1].toLowerCase();
    if (seen.has(host))
      continue;
    seen.add(host);
    out.push({
      rule: {
        id: "remote-call",
        policy: "csp",
        directive: "connect-src",
        source: host,
        what: `код обращается к внешнему адресу ${host}`,
        match: REMOTE_CALL
      },
      target: host
    });
  }
  return out;
}
function extractEnvUsage(content) {
  const out = new Set;
  for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g))
    out.add(m[1]);
  for (const m of content.matchAll(/process\.env\[['"`]([A-Z][A-Z0-9_]{2,})['"`]\]/g))
    out.add(m[1]);
  for (const m of content.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g))
    out.add(m[1]);
  for (const m of content.matchAll(/os\.environ(?:\.get)?\[?\(?['"`]([A-Z][A-Z0-9_]{2,})['"`]/g))
    out.add(m[1]);
  for (const m of content.matchAll(/getenv\s*\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g))
    out.add(m[1]);
  return [...out];
}

// src/env/policies.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var CSP_FILES = [
  "nuxt.config.ts",
  "nuxt.config.js",
  "next.config.js",
  "next.config.mjs",
  "vercel.json",
  "netlify.toml",
  "nginx.conf",
  "docker/nginx.conf",
  "deploy/nginx.conf",
  ".htaccess",
  "public/index.html",
  "index.html",
  "app.html"
];
var CSP_HEADER_DQ = /Content-Security-Policy['"\s:=]{0,6}"([^"]{5,800})"/i;
var CSP_HEADER_SQ = /Content-Security-Policy["'\s:=]{0,6}'([^']{5,800})'/i;
var CSP_META = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content="([^"]+)"/i;
function parseCspString(csp, source) {
  const directives = new Map;
  for (const chunk of csp.split(";")) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
      continue;
    const name = parts[0].toLowerCase();
    if (!/^[a-z-]+$/.test(name))
      continue;
    directives.set(name, parts.slice(1));
  }
  return directives.size > 0 ? { directives, source } : null;
}
function parseHelmetStyle(text, source) {
  const block = text.match(/directives\s*:\s*\{([\s\S]{0,1200}?)\}/);
  if (!block)
    return null;
  const directives = new Map;
  for (const m of block[1].matchAll(/["']?([a-zA-Z-]+)["']?\s*:\s*\[([^\]]*)\]/g)) {
    const name = m[1].replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    const values = [...m[2].matchAll(/["'`]([^"'`]+)["'`]/g)].map((v) => v[1]);
    if (values.length > 0)
      directives.set(name, values);
  }
  return directives.size > 0 ? { directives, source } : null;
}
function findCsp(root) {
  for (const rel of CSP_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs))
      continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const meta = text.match(CSP_META);
    if (meta) {
      const p = parseCspString(meta[1], rel);
      if (p)
        return p;
    }
    for (const re of [CSP_HEADER_DQ, CSP_HEADER_SQ]) {
      const header = text.match(re);
      if (!header)
        continue;
      const p = parseCspString(header[1], rel);
      if (p && p.directives.size > 0)
        return p;
    }
    const helmet = parseHelmetStyle(text, rel);
    if (helmet)
      return helmet;
  }
  return null;
}
var ENV_FILES = ENV_TEMPLATES;
function findDeclaredEnv(root) {
  const out = new Set;
  for (const rel of ENV_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs))
      continue;
    try {
      for (const line of readFileSync(abs, "utf8").split(`
`)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/);
        if (m)
          out.add(m[1]);
      }
    } catch {}
  }
  return out;
}
var COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
function findServices(root) {
  const out = new Set;
  for (const rel of COMPOSE_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs))
      continue;
    try {
      const text = readFileSync(abs, "utf8");
      const block = text.split(/^services:\s*$/m)[1];
      if (!block)
        continue;
      for (const m of block.matchAll(/^\s{2,4}([a-z][\w-]*)\s*:\s*$/gm))
        out.add(m[1].toLowerCase());
      for (const m of text.matchAll(/image:\s*["']?([a-z][\w.-]*)/gi))
        out.add(m[1].toLowerCase());
    } catch {}
  }
  return out;
}
function readPolicies(root, configFiles = []) {
  const raw = new Map;
  for (const rel of configFiles) {
    try {
      for (const e of parseConfigFile(rel, readFileSync(join(root, rel), "utf8"))) {
        raw.set(`${e.file}::${e.key}`, e.value);
        if (!raw.has(e.key))
          raw.set(e.key, e.value);
      }
    } catch {}
  }
  return { csp: findCsp(root), declaredEnv: findDeclaredEnv(root), services: findServices(root), raw };
}
function cspAllows(policy, directive, source) {
  const values = policy.directives.get(directive) ?? policy.directives.get("default-src");
  if (!values)
    return true;
  if (values.includes("'none'"))
    return false;
  if (values.includes("*"))
    return true;
  const wanted = source.toLowerCase();
  for (const v of values) {
    const val = v.toLowerCase();
    if (val === wanted)
      return true;
    if (val === "blob:" && wanted === "blob:")
      return true;
    if (val.startsWith("*.") && wanted.endsWith(val.slice(1)))
      return true;
    if (wanted.includes(".") && (val === wanted || val.endsWith("//" + wanted) || val === "https:" || val === "http:"))
      return true;
  }
  return false;
}

// src/env/contract.ts
var SERVICE_HINTS = [
  { id: "redis", match: /\b(createClient\s*\(|new\s+Redis\s*\(|ioredis|redis:\/\/)/ },
  { id: "postgres", match: /\b(new\s+Pool\s*\(|postgres:\/\/|postgresql:\/\/)/ },
  { id: "mysql", match: /\bmysql:\/\/|createConnection\s*\(\s*\{[^}]*mysql/i },
  { id: "mongo", match: /\bmongodb(\+srv)?:\/\/|new\s+MongoClient\s*\(/ },
  { id: "rabbitmq", match: /\bamqp:\/\// },
  { id: "elasticsearch", match: /new\s+Client\s*\(\s*\{[^}]*node:\s*['"`]https?:\/\/[^'"`]*9200/ }
];
function checkContract(content, policies, learned = []) {
  const out = [];
  for (const hit of applyRules(content, learned)) {
    const r = hit.rule;
    const configured = policies.raw.get(`${r.configFile}::${r.configKey}`) ?? policies.raw.get(r.configKey) ?? null;
    if (configured === null)
      continue;
    if (r.requires && configured.toLowerCase().includes(r.requires.toLowerCase()))
      continue;
    out.push({
      kind: "выведенное",
      requirement: r.what,
      policy: `${r.configKey}: ${configured.slice(0, 120)} — ${r.configFile}`,
      certainty: "наблюдение",
      detail: r.requires ? `ожидается наличие «${r.requires}» в настройке` : "настройка не покрывает это требование"
    });
  }
  if (policies.csp) {
    const csp = policies.csp;
    for (const hit of extractCapabilities(content)) {
      const rule = hit.rule;
      if (rule.policy !== "csp" || !rule.directive || !rule.source)
        continue;
      if (cspAllows(csp, rule.directive, rule.source))
        continue;
      const configured = csp.directives.get(rule.directive) ?? csp.directives.get("default-src") ?? [];
      out.push({
        kind: "csp",
        requirement: rule.what,
        policy: `${rule.directive}: ${configured.join(" ") || "(не задана)"} — ${csp.source}`,
        certainty: "противоречие",
        detail: `нужен источник ${rule.source} в ${rule.directive}, иначе браузер заблокирует это в проде`
      });
    }
  }
  if (policies.declaredEnv.size > 0) {
    for (const name of extractEnvUsage(content)) {
      if (policies.declaredEnv.has(name))
        continue;
      out.push({
        kind: "env",
        requirement: `код читает переменную окружения ${name}`,
        policy: `образец окружения (${policies.declaredEnv.size} переменных) её не объявляет`,
        certainty: "противоречие",
        detail: "на чистой машине и в CI значение будет пустым — добавить в образец окружения"
      });
    }
  }
  if (policies.services.size > 0) {
    for (const s of SERVICE_HINTS) {
      if (!s.match.test(content))
        continue;
      if ([...policies.services].some((svc) => svc.includes(s.id)))
        continue;
      out.push({
        kind: "service",
        requirement: `код обращается к ${s.id}`,
        policy: `инфраструктура проекта поднимает: ${[...policies.services].slice(0, 6).join(", ")}`,
        certainty: "наблюдение",
        detail: `${s.id} среди них нет — либо сервис внешний, либо в локальной среде его не будет`
      });
    }
  }
  return out;
}

// src/hooks/stop-core.ts
init_walk();

// src/gates/evidence.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
var CHECK_COMMAND = /\b(test|tests|spec|specs|pytest|jest|vitest|mocha|phpunit|rspec|cargo\s+(test|check|clippy)|go\s+(test|vet)|dotnet\s+test|gradle\w*\s+test|mvn\w*\s+(test|verify)|tsc\b|eslint|ruff|mypy|flake8|pylint|golangci-lint|canary|selflint|lint)\b/i;
var EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var isCheckCommand = (command) => CHECK_COMMAND.test(command);
var TAIL_LINES = 4000;
function evidenceFromTranscript(transcriptPath, own, toRel) {
  const none = { uncheckedFiles: [], checkedOnce: false, readable: false };
  if (!transcriptPath || !existsSync2(transcriptPath))
    return none;
  let lines;
  try {
    lines = readFileSync2(transcriptPath, "utf8").split(`
`);
  } catch {
    return none;
  }
  if (lines.length > TAIL_LINES)
    lines = lines.slice(-TAIL_LINES);
  const unchecked = new Set;
  let checkedOnce = false;
  for (const line of lines) {
    if (!line.includes('"tool_use"'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content))
      continue;
    for (const c of obj.message?.content ?? []) {
      if (c.type !== "tool_use" || !c.name)
        continue;
      if (c.name === "Bash") {
        const cmd = String(c.input?.command ?? "");
        if (isCheckCommand(cmd)) {
          unchecked.clear();
          checkedOnce = true;
        }
        continue;
      }
      if (EDIT_TOOLS.has(c.name)) {
        const abs = String(c.input?.file_path ?? c.input?.notebook_path ?? "");
        const rel = abs ? toRel(abs) : null;
        if (rel && own.has(rel))
          unchecked.add(rel);
      }
    }
  }
  return { uncheckedFiles: [...unchecked], checkedOnce, readable: true };
}

// src/hooks/stop-core.ts
init_i18n();
var FUSE_LIMIT = 8;
function fileStamp(cwd, rel) {
  try {
    const st = statSync(join2(cwd, rel));
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return "gone";
  }
}
var JS_FAMILY = new Set([".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".vue"]);
var GATED_EXT = new Set([...JS_FAMILY, ...ENTITY_EXT]);
var MAX_FILES = 20;
function fileDiff(cwd, rel, content) {
  for (let attempt = 0;attempt < 2; attempt++) {
    try {
      const r = spawnSync("git", ["diff", "HEAD", "--", rel], { cwd, encoding: "utf8", timeout: 12000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      if (r.status === 0 && typeof r.stdout === "string") {
        if (r.stdout.trim())
          return r.stdout;
        return content.split(`
`).map((l) => "+" + l).join(`
`);
      }
    } catch {}
  }
  return content.split(`
`).map((l) => "+" + l).join(`
`);
}
function sessionCommits(cwd, sinceIso) {
  try {
    const r = spawnSync("git", ["log", `--since=${sinceIso}`, "--format=%s", "-n", "10"], { cwd, encoding: "utf8", timeout: 8000, windowsHide: true });
    if (r.status !== 0 || typeof r.stdout !== "string")
      return [];
    return r.stdout.split(`
`).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  } catch {
    return [];
  }
}
function gitTrackedConfigs(cwd) {
  try {
    const r = spawnSync("git", ["ls-files"], { cwd, encoding: "utf8", timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0 || typeof r.stdout !== "string")
      return [];
    return r.stdout.split(`
`).map((f) => f.trim()).filter((f) => f && isConfigFile(f)).slice(0, 60);
  } catch {
    return [];
  }
}
function dirtyGatedFiles(cwd) {
  for (let attempt = 0;attempt < 2; attempt++) {
    try {
      const r = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", timeout: 12000, windowsHide: true });
      if (r.status === 0 && typeof r.stdout === "string") {
        return r.stdout.split(`
`).map((l) => l.slice(3).trim()).filter((f) => f && GATED_EXT.has(extname(f).toLowerCase()) && !inDerivedZone(f)).slice(0, MAX_FILES);
      }
    } catch {}
  }
  return [];
}
function ownEditedFiles(db, sid) {
  try {
    const rows = db.query("SELECT file FROM session_edits WHERE session_id=?").all(sid);
    return new Set(rows.map((r) => r.file));
  } catch {
    return new Set;
  }
}
function otherOpenSessions(db, sid) {
  try {
    return new SessionLog(db).openLiveOthers(sid);
  } catch {
    return 0;
  }
}
function handleStop(input, dataRoot) {
  try {
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join2(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "Stop");
    const dbPath = join2(dataDir, "passport.db");
    if (!existsSync3(dbPath))
      return {};
    const db = openDb(dbPath);
    try {
      const laws = new FactStore(db).active().filter((f) => f.tier === "закон");
      const resolve = loadEntityResolver(db);
      const sid = input.session_id ?? "manual";
      const session = db.query("SELECT started_at FROM sessions WHERE session_id=?").get(sid);
      const sessionStartMs = session ? Date.parse(session.started_at) : Date.now() - 24 * 3600000;
      db.run("CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))");
      const dedup = db.query("INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)");
      const configPaths = gitTrackedConfigs(cwd);
      const envPolicies = readPolicies(cwd, configPaths);
      const learnedRules = readRules(db);
      const parallel = otherOpenSessions(db, sid);
      const own = ownEditedFiles(db, sid);
      const sessionFiles = [];
      const contents = new Map;
      for (const rel of dirtyGatedFiles(cwd)) {
        const abs = join2(cwd, rel);
        try {
          if (statSync(abs).mtimeMs < sessionStartMs)
            continue;
          contents.set(rel, readFileSync3(abs, "utf8"));
          sessionFiles.push(rel);
        } catch {
          continue;
        }
      }
      const attributable = own.size > 0 || parallel > 0;
      const ownFiles = attributable ? sessionFiles.filter((f) => own.has(f)) : sessionFiles;
      const unattributed = sessionFiles.filter((f) => !ownFiles.includes(f));
      const freshUnattributed = parallel > 0 ? unattributed.filter((f) => Number(dedup.run("*", `#параллель:${fileStamp(cwd, f)}`, f).changes) > 0) : [];
      const named = `${freshUnattributed.slice(0, 3).join(", ")}${freshUnattributed.length > 3 ? ", …" : ""}`;
      const parallelLine = freshUnattributed.length > 0 ? t(`- параллельных сессий: ${parallel} · ${freshUnattributed.length} изменённых файлов не отнесены к этой сессии и не проверяются здесь — это работа соседа (${named})`, `- parallel sessions: ${parallel} · ${freshUnattributed.length} changed files are not attributed to this session and are not checked here — they are a neighbour's work (${named})`) : "";
      const gatedFiles = parallel > 0 ? ownFiles : sessionFiles;
      if (ownFiles.length > 0) {
        db.run("CREATE TABLE IF NOT EXISTS model_state(session_id TEXT NOT NULL, file TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(session_id, file))");
        const upsertState = db.query("INSERT INTO model_state(session_id,file,hash,content,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,file) DO UPDATE SET hash=excluded.hash, content=excluded.content, updated_at=excluded.updated_at");
        const now = new Date().toISOString();
        for (const rel of ownFiles) {
          const content = snapshotContent(contents.get(rel) ?? "");
          upsertState.run(sid, rel, sha1(content), content, now);
        }
      }
      const sinceIso = session?.started_at ?? new Date(sessionStartMs).toISOString();
      const commits = sessionCommits(cwd, sinceIso);
      if (ownFiles.length > 0 || commits.length > 0) {
        db.run("CREATE TABLE IF NOT EXISTS session_threads(session_id TEXT PRIMARY KEY, files TEXT NOT NULL, updated_at TEXT NOT NULL)");
        const tcols = db.query("PRAGMA table_info(session_threads)").all().map((c) => c.name);
        if (!tcols.includes("commits"))
          db.run("ALTER TABLE session_threads ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'");
        const prev = db.query("SELECT files FROM session_threads WHERE session_id=?").get(sid);
        const union = [...new Set([...prev ? JSON.parse(prev.files) : [], ...ownFiles])];
        db.query("INSERT INTO session_threads(session_id, files, commits, updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET files=excluded.files, commits=excluded.commits, updated_at=excluded.updated_at").run(sid, JSON.stringify(union), JSON.stringify(commits), new Date().toISOString());
      }
      const all = [];
      for (const rel of gatedFiles) {
        const content = contents.get(rel) ?? "";
        const ext = extname(rel).toLowerCase();
        for (const v of checkAgainstLaws(content, ext, laws)) {
          all.push({ file: rel, law: v.law, detail: v.detail });
        }
        if (contentVerifierActive(ext)) {
          for (const v of runContentVerifiers(rel, content, ext, { resolve })) {
            all.push({ file: rel, law: v.verifier, detail: v.detail });
          }
        }
        for (const s of detectSecurityRegressions(fileDiff(cwd, rel, content))) {
          all.push({ file: rel, law: `защитный слой: ${s.kind}`, detail: s.detail });
        }
        for (const c of checkContract(content, envPolicies, learnedRules)) {
          all.push({ file: rel, law: `контракт среды: ${c.kind}`, detail: `${c.requirement} · ${c.policy} · ${c.detail}` });
        }
      }
      const evidenceLines = [];
      try {
        const codeOwn = new Set(ownFiles.filter((f) => !ENTITY_EXT.has(extname(f).toLowerCase()) && !isConfigFile(f)));
        const hasTests = codeOwn.size > 0 && db.query("SELECT COUNT(*) n FROM graph_nodes WHERE file LIKE '%test%' OR file LIKE '%spec%'").get().n > 0;
        if (hasTests) {
          const transcript = input.transcript_path ?? db.query("SELECT transcript_path FROM sessions WHERE session_id=?").get(sid)?.transcript_path ?? null;
          const ev = evidenceFromTranscript(transcript, codeOwn, (abs) => toRelNode(cwd, abs));
          if (ev.readable && ev.uncheckedFiles.length > 0) {
            const files = [...ev.uncheckedFiles].sort();
            const shown = `${files.slice(0, 4).join(", ")}${files.length > 4 ? `, … (+${files.length - 4})` : ""}`;
            const detail = t(`после последней правки проверка не запускалась (${shown}) — запусти тесты/проверку или скажи владельцу, почему она здесь не нужна`, `no check was run after the last edit (${shown}) — run the tests/check, or tell the owner why none is needed here`);
            if (readGateMode(dataDir) === "block") {
              all.push({ file: shown, law: "доказательства", detail });
            } else if (Number(dedup.run(sid, "#доказательства", files.join(",")).changes) > 0) {
              evidenceLines.push(t(`- доказательств нет: ${detail}`, `- no evidence: ${detail}`));
            }
          }
        }
      } catch {}
      const focusLines = [];
      try {
        const edges = db.query("SELECT from_file, to_file FROM graph_edges").all();
        const diffs = new Map;
        for (const rel of ownFiles)
          diffs.set(rel, fileDiff(cwd, rel, contents.get(rel) ?? ""));
        const signals = detectFocusDrift({
          sessionFiles: ownFiles,
          edges: edges.map((e) => ({ from: e.from_file, to: e.to_file })),
          diffs
        });
        const fresh = signals.filter((s) => Number(dedup.run(sid, "#фокус", s.kind).changes) > 0);
        focusLines.push(...renderFocus(fresh));
      } catch {}
      const budgetLines = [];
      try {
        const withDiffs = gatedFiles.map((rel) => ({
          rel,
          content: contents.get(rel) ?? "",
          diff: fileDiff(cwd, rel, contents.get(rel) ?? "")
        }));
        if (withDiffs.length > 0) {
          const breaches = compareBudgets(measureBefore(withDiffs), measure(withDiffs));
          for (const line of renderBudgets(breaches)) {
            const metric = line.split("—")[0].replace("- бюджет качества: ", "").trim();
            if (Number(dedup.run(sid, "#бюджет", metric).changes) > 0)
              budgetLines.push(line);
          }
        }
      } catch {}
      const observations = [...evidenceLines, ...focusLines, ...budgetLines, parallelLine].filter(Boolean);
      const freshLines = all.filter((v) => Number(dedup.run(sid, v.file, v.law).changes) > 0).map((v) => `- ${v.file} · ${t(`«${statement(v.law)}»`, `“${statement(v.law)}”`)} · ${v.detail}`);
      db.run("CREATE TABLE IF NOT EXISTS gate_fuse(session_id TEXT PRIMARY KEY, streak INTEGER NOT NULL DEFAULT 0, released INTEGER NOT NULL DEFAULT 0)");
      const fuse = db.query("SELECT streak, released FROM gate_fuse WHERE session_id=?").get(sid) ?? { streak: 0, released: 0 };
      if (all.length === 0) {
        if (fuse.streak > 0)
          db.query("UPDATE gate_fuse SET streak=0 WHERE session_id=?").run(sid);
        if (observations.length > 0) {
          return {
            hookSpecificOutput: {
              hookEventName: "Stop",
              additionalContext: `Symbiont · ${t("наблюдение о ходе работы (факт, не требование)", "an observation about how the work is going (a fact, not a demand)")}:
${observations.join(`
`)}`
            }
          };
        }
        return {};
      }
      const mode = readGateMode(dataDir);
      if (mode === "block" && fuse.released === 0) {
        const streak = fuse.streak + 1;
        db.query("INSERT INTO gate_fuse(session_id, streak, released) VALUES(?,?,0) ON CONFLICT(session_id) DO UPDATE SET streak=excluded.streak").run(sid, streak);
        if (streak >= FUSE_LIMIT) {
          db.query("UPDATE gate_fuse SET released=1 WHERE session_id=?").run(sid);
          return {
            hookSpecificOutput: {
              hookEventName: "Stop",
              additionalContext: t(`Symbiont · предохранитель гейта: ${FUSE_LIMIT} блокировок подряд — гейт снят до конца сессии (похоже на цикл; ` + `нарушения остаются фактом): ${all.map((v) => `${v.file}: «${statement(v.law)}»`).join("; ")}.`, `Symbiont · gate fuse: ${FUSE_LIMIT} blocks in a row — the gate is off until the end of the session (this looks like a loop; ` + `the violations remain a fact): ${all.map((v) => `${v.file}: “${statement(v.law)}”`).join("; ")}.`)
            }
          };
        }
        return {
          decision: "block",
          reason: t(`Гейт Symbiont (режим блокировки, ${streak}/${FUSE_LIMIT}): изменённые файлы нарушают правила паспорта ` + `(законы формы + верификаторы направления) — приведи их к конвенциям проекта и закончи ход:
` + all.map((v) => `- ${v.file} · «${statement(v.law)}» · ${v.detail}`).join(`
`) + `
Правила выведены из репозитория (passport_conventions/passport_orphans); если отклонение намеренное — скажи об этом владельцу явно.`, `Symbiont gate (blocking mode, ${streak}/${FUSE_LIMIT}): the changed files break the passport's rules ` + `(form laws + direction verifiers) — bring them in line with the project's conventions and finish the turn:
` + all.map((v) => `- ${v.file} · “${statement(v.law)}” · ${v.detail}`).join(`
`) + `
The rules are derived from this repository (passport_conventions/passport_orphans); if the deviation is deliberate, say so to the owner explicitly.`)
        };
      }
      if (freshLines.length === 0 && observations.length === 0)
        return {};
      const gateBlock = freshLines.length > 0 ? t(`Symbiont · dry-run гейта (наблюдение, не блокировка): изменённые файлы нарушают правила паспорта ` + `(законы формы + верификаторы направления):
${freshLines.join(`
`)}
` + `Правила выведены из репозитория (passport_conventions/passport_orphans).`, `Symbiont · gate dry-run (an observation, not a block): the changed files break the passport's rules ` + `(form laws + direction verifiers):
${freshLines.join(`
`)}
` + `The rules are derived from this repository (passport_conventions/passport_orphans).`) : "";
      const focusBlock = observations.length > 0 ? `Symbiont · ${t("наблюдение о ходе работы (факт, не требование)", "an observation about how the work is going (a fact, not a demand)")}:
${observations.join(`
`)}` : "";
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: [gateBlock, focusBlock].filter(Boolean).join(`

`)
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/stop.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join3(import.meta.dirname, "..", "..", ".data")).root;
var out = handleStop(input, dataRoot);
if (out.hookSpecificOutput || out.decision)
  console.log(JSON.stringify(out));
