import {
  DESIGN_PRINCIPLES,
  axesForArtifacts
} from "./session-start-7bev5jvd.js";
import {
  callClaudeDetailed,
  callClaudeWithTools
} from "./session-start-9gcaq94s.js";
import"./session-start-8myhjb3p.js";
import {
  playbooksFor
} from "./session-start-8ychq3hk.js";
import"./session-start-5s7r4262.js";
import {
  migrateLegacyPassports,
  renderRootNotice,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-j1yy7aw2.js";
import {
  activeAxes,
  artifactProfile,
  codeFiles,
  detectStack,
  documentsBlock,
  extractContent,
  initLang,
  init_i18n,
  init_walk,
  isNonCodeMinable,
  jsonOnly,
  openDb,
  runtimeBlocker,
  slugOf,
  t,
  walkFiles
} from "./session-start-nhshhf7v.js";
import {
  __require
} from "./session-start-70d7ckvt.js";

// src/cli/elevate.ts
import { join as join3 } from "node:path";
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";

// src/elevate/engine.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// src/elevate/verdicts.ts
var TABLE = "elevate_verdicts";
function ensure(db) {
  db.run(`CREATE TABLE IF NOT EXISTS ${TABLE}(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verdict TEXT NOT NULL,
      axis TEXT NOT NULL,
      observation TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL
    )`);
}
function recordVerdict(db, input) {
  ensure(db);
  db.query(`INSERT INTO ${TABLE}(verdict, axis, observation, reason, at) VALUES(?,?,?,?,?)`).run(input.verdict, input.axis, input.observation.slice(0, 600), input.reason.slice(0, 400), input.at ?? new Date().toISOString());
}
function readVerdicts(db, limit = 20) {
  try {
    ensure(db);
    const rows = db.query(`SELECT id, verdict, axis, observation, reason, at FROM ${TABLE} ORDER BY id DESC LIMIT ?`).all(limit);
    return rows.map((r, i) => ({
      n: i + 1,
      verdict: r.verdict,
      axis: r.axis,
      observation: r.observation,
      reason: r.reason,
      at: r.at
    }));
  } catch {
    return [];
  }
}
function renderVerdictsForPrompt(rows) {
  if (rows.length === 0)
    return "";
  const rejected = rows.filter((r) => r.verdict === "отклонено");
  const accepted = rows.filter((r) => r.verdict === "принято");
  const L = ["", "## Решения владельца по прошлым предложениям (память аудита)"];
  if (rejected.length > 0) {
    L.push("ОТКЛОНЕНО ранее — не повторяй тот же довод, если не появилось НОВОГО основания; если считаешь отклонение ошибочным, скажи это прямо и приведи новое доказательство:");
    for (const r of rejected)
      L.push(`- [${r.axis}] ${r.observation} → отклонено: ${r.reason}`);
  }
  if (accepted.length > 0) {
    L.push("УЖЕ ПРИНЯТО и сделано — не предлагай повторно:");
    for (const r of accepted)
      L.push(`- [${r.axis}] ${r.observation}`);
  }
  return L.join(`
`);
}
function renderVerdicts(rows) {
  if (rows.length === 0)
    return "Решений по предложениям пока нет: аудит ничего не помнит и предложит всё заново.";
  const L = [`Symbiont · память аудита: ${rows.length} решений (свежие сверху)`, ""];
  for (const r of rows) {
    L.push(`${r.n}. ${r.verdict === "отклонено" ? "✗" : "✓"} [${r.axis}] ${r.observation.slice(0, 120)}`);
    if (r.reason)
      L.push(`   причина: ${r.reason}`);
  }
  return L.join(`
`);
}

// src/elevate/engine.ts
init_walk();
import { relative, basename } from "node:path";
var SCOPES = ["локальное", "модуль", "архитектура", "концепция"];
var EFFORT = ["низкое", "среднее", "высокое"];
var RISK = ["низкий", "средний", "высокий"];
var SAMPLE_FILES = 8;
var SAMPLE_CHARS = 3500;
var DEFAULT_THRESHOLD = 70;
function buildContext(projectRoot, dataDir, presentOverride) {
  let summary = "";
  try {
    summary = readFileSync(join(dataDir, "SUMMARY.md"), "utf8");
  } catch {}
  const walked = walkSafe(projectRoot);
  const profile = artifactProfile(walked.map((f) => ({ name: basename(f.path), ext: f.ext })));
  const classes = presentOverride ?? (profile.present.length > 0 ? profile.present : ["код"]);
  const rubric = axesForArtifacts(classes);
  const axesActive = activeAxes(profile);
  const samples = [];
  let verdictsBlock = "";
  const dbPath = join(dataDir, "passport.db");
  if (existsSync(dbPath)) {
    const db = openDb(dbPath, { readonly: true });
    try {
      const nodes = db.query("SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(SAMPLE_FILES);
      for (const r of nodes) {
        try {
          samples.push({ file: r.file, content: readFileSync(join(projectRoot, r.file), "utf8").slice(0, SAMPLE_CHARS) });
        } catch {
          continue;
        }
      }
      verdictsBlock = renderVerdictsForPrompt(readVerdicts(db));
    } finally {
      db.close();
    }
  }
  if (samples.length < SAMPLE_FILES) {
    for (const s of gatherNonCodeSamples(projectRoot, SAMPLE_FILES - samples.length))
      samples.push(s);
  }
  const stack = detectStack(projectRoot, walked.map((f) => relative(projectRoot, f.path).replaceAll("\\", "/")));
  const playbooks = playbooksFor(stack).map((p) => ({ domain: p.domain, checklist: p.checklist, thresholds: p.thresholds, pitfalls: p.pitfalls }));
  return { summary, activeAxes: axesActive, rubric, samples, playbooks, stack, verdictsBlock };
}
function walkSafe(projectRoot) {
  try {
    return walkFiles(projectRoot);
  } catch {
    return [];
  }
}
function gatherNonCodeSamples(projectRoot, limit) {
  if (limit <= 0)
    return [];
  const priority = (ext) => ext === ".docx" || ext === ".pptx" || ext === ".xlsx" ? 0 : ext === ".csv" || ext === ".tsv" ? 1 : 2;
  let files;
  try {
    files = walkFiles(projectRoot).filter((f) => isNonCodeMinable(f.ext)).sort((a, b) => priority(a.ext) - priority(b.ext)).slice(0, limit * 4);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (out.length >= limit)
      break;
    const content = extractContent(f.path, f.ext);
    if (content)
      out.push({ file: relative(projectRoot, f.path).replaceAll("\\", "/"), content: content.slice(0, SAMPLE_CHARS) });
  }
  return out;
}
function buildElevatePrompt(ctx) {
  const axesList = ctx.rubric.map((a) => `- ${a.axis}${a.iso ? ` [ISO ${a.iso}]` : ""}: ${a.lens}. Смотреть: ${a.checks.join("; ")}.${a.thresholds ? ` Пороги: ${a.thresholds.join("; ")}.` : ""}`).join(`
`);
  const principles = DESIGN_PRINCIPLES.map((p) => `- ${p.rule}`).join(`
`);
  const playbookBlock = ctx.playbooks.length > 0 ? [
    "",
    "## Доменная экспертиза активных направлений (топ-уровень; заземлено на стандарты)",
    ...ctx.playbooks.flatMap((p) => [
      `### ${p.domain}`,
      `эталон: ${p.checklist.slice(0, 8).join("; ")}`,
      p.thresholds && p.thresholds.length ? `пороги: ${p.thresholds.join(" · ")}` : "",
      `частые провалы: ${p.pitfalls.join("; ")}`
    ]).filter(Boolean)
  ].join(`
`) : "";
  const st = ctx.stack;
  const withWhy = (names) => names.map((n) => st.evidence?.[n] ? `${n} (${st.evidence[n]})` : n).join(", ");
  const stackLine = [
    st.frameworks.length ? `фреймворки: ${withWhy(st.frameworks)}` : "",
    st.infra.length ? `инфра: ${withWhy(st.infra)}` : "",
    st.domains.length ? `направления: ${withWhy(st.domains)}` : "",
    st.otherDeps.length ? `прочие зависимости: ${st.otherDeps.join(", ")}` : ""
  ].filter(Boolean).join(" · ");
  return [
    "Ты — аудитор возвышения проекта до уровня топ-1. Твоя задача — предложить точечные улучшения по осям качества, применимым ИМЕННО к этому проекту.",
    "ВАЖНО: НЕ используй инструменты и НЕ читай файлы — весь нужный контекст (паспорт, оси, фрагменты) уже приведён ниже. Ответь напрямую JSON-ом за один ход.",
    "",
    "## Паспорт проекта (уже выведен системой)",
    ctx.summary.slice(0, 4000),
    "",
    stackLine ? `## Обнаруженный стек
${stackLine}` : "",
    "Для технологий/направлений стека, по которым НИЖЕ нет готового плейбука, применяй СВОЮ актуальную (2026) экспертизу топ-уровня по этой конкретной технологии — не ограничивайся приведёнными плейбуками.",
    "",
    "## Оси качества, применимые к составу этого проекта (заземлены на стандарты)",
    axesList,
    playbookBlock,
    "",
    "## Обязательные принципы (нарушение = брак ответа)",
    principles,
    ctx.verdictsBlock,
    "",
    "## Фрагменты самых связных файлов",
    documentsBlock(ctx.samples),
    "",
    "## Что вернуть",
    "Ранжированный список предложений по возвышению — от самого влиятельного. Каждое предложение сначала попробуй опровергнуть и включи только то, что попытку пережило. На здоровой зоне пустой список — достойный ответ: находки ради количества обесценивают весь аудит.",
    "Scope: «локальное» | «модуль» | «архитектура» | «концепция» (концепция = переработка самой идеи продукта). Опирайся на конвенции этого проекта, а не на общие best-practice.",
    "",
    jsonOnly('[{"axis":"ось","scope":"локальное","observation":"что наблюдаем в коде/контенте","proposal":"что конкретно изменить","impact":"ожидаемый эффект","effort":"низкое|среднее|высокое","risk":"низкий|средний|высокий","confidence":0-100,"refutation":"как это может быть неверно","survives":true}]')
  ].join(`
`);
}
function parseProposals(text, threshold = DEFAULT_THRESHOLD) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start)
      return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr))
      return [];
    const out = [];
    for (const r of arr) {
      if (typeof r?.axis !== "string" || typeof r?.observation !== "string" || typeof r?.proposal !== "string" || typeof r?.confidence !== "number") {
        continue;
      }
      const survives = r.survives !== false;
      if (!survives || r.confidence < threshold)
        continue;
      out.push({
        axis: r.axis,
        scope: SCOPES.includes(r.scope) ? r.scope : "локальное",
        observation: r.observation,
        proposal: r.proposal,
        impact: typeof r.impact === "string" ? r.impact : "",
        effort: EFFORT.includes(r.effort) ? r.effort : "среднее",
        risk: RISK.includes(r.risk) ? r.risk : "средний",
        confidence: Math.round(r.confidence),
        survivesRefutation: true
      });
    }
    const scopeWeight = { концепция: 1.3, архитектура: 1.2, модуль: 1.05, локальное: 1 };
    return out.sort((a, b) => b.confidence * scopeWeight[b.scope] - a.confidence * scopeWeight[a.scope]);
  } catch {
    return [];
  }
}
function runElevate(projectRoot, dataDir, caller, threshold = DEFAULT_THRESHOLD) {
  const ctx = buildContext(projectRoot, dataDir);
  if (ctx.rubric.length === 0)
    return { model: null, proposals: [], axesConsidered: [] };
  const res = caller(buildElevatePrompt(ctx));
  try {
    const { writeFileSync } = __require("node:fs");
    writeFileSync(join(dataDir, "elevate-last.json"), JSON.stringify({ at: new Date().toISOString(), raw: res }, null, 1), "utf8");
  } catch {}
  if (!res)
    return { model: null, proposals: [], axesConsidered: ctx.rubric.map((a) => a.axis) };
  return { model: res.model, proposals: parseProposals(res.text, threshold), axesConsidered: ctx.rubric.map((a) => a.axis) };
}
function renderProposals(r) {
  if (!r.model)
    return "Symbiont · возвышение: модели цепочки недоступны или паспорт не построен.";
  if (r.proposals.length === 0) {
    return `Symbiont · возвышение · оси рассмотрены: ${r.axesConsidered.join(", ")}.
Предложений выше порога уверенности нет — по рассмотренным зонам проект здоров (это достойный результат, не пустой).`;
  }
  const L = [`Symbiont · возвышение · ${r.proposals.length} предложений (модель ${r.model}), ранжировано по влиянию:`, ""];
  let i = 1;
  for (const p of r.proposals) {
    L.push(`${i}. [${p.axis} · ${p.scope} · уверенность ${p.confidence} · усилие ${p.effort} · риск ${p.risk}]`);
    L.push(`   наблюдение: ${p.observation}`);
    L.push(`   предложение: ${p.proposal}`);
    if (p.impact)
      L.push(`   эффект: ${p.impact}`);
    L.push("");
    i++;
  }
  L.push("Ничего не применено — это карта возможностей, решение за владельцем.");
  return L.join(`
`);
}

// src/elevate/ground.ts
init_walk();
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var ENV_REF = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]{2,})/g;
function gatherInternals(projectRoot) {
  const deps = [];
  const scripts = [];
  try {
    const pkg = JSON.parse(readFileSync2(join2(projectRoot, "package.json"), "utf8"));
    deps.push(...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}));
    scripts.push(...Object.keys(pkg.scripts ?? {}));
  } catch {}
  const envKeys = new Set;
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    try {
      for (const line of readFileSync2(join2(projectRoot, name), "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z][A-Z0-9_]{2,})\s*=/);
        if (m)
          envKeys.add(m[1]);
      }
    } catch {}
  }
  try {
    const files = codeFiles(walkFiles(projectRoot)).slice(0, 400);
    for (const f of files) {
      let content = "";
      try {
        content = readFileSync2(f.path, "utf8");
      } catch {
        continue;
      }
      for (const m of content.matchAll(ENV_REF))
        envKeys.add(m[1]);
    }
  } catch {}
  const repoTools = [];
  try {
    const scriptFiles = walkFiles(join2(projectRoot, "scripts")).filter((f) => [".mjs", ".ts", ".js", ".sh", ".py"].includes(f.ext)).map((f) => f.path.split(/[\\/]/).pop());
    repoTools.push(...new Set(scriptFiles));
  } catch {}
  return {
    deps: [...new Set(deps)].slice(0, 60),
    scripts: [...new Set(scripts)].slice(0, 40),
    envKeys: [...envKeys].slice(0, 40),
    repoTools: repoTools.slice(0, 40)
  };
}
function buildGroundPrompt(needs, internals) {
  return [
    "Ты усиливаешь предложения по возвышению проекта, заземляя их на ПРОВЕРЕННЫЕ внешние подходы.",
    "Для каждой значимой потребности проекта: найди официальный/признанный подход (скилл, плагин, паттерн, алгоритм, архитектуру), но возьми ТОЛЬКО то, что нужно ИМЕННО здесь — в подходящей форме, возможно в сочетании. НЕ тащи всё подряд (анти-карго-культ): подгоняй под конвенции и стек этого проекта.",
    "Синтезируй с ВНУТРЕННИМ проекта: если у проекта уже есть подходящая зависимость, скрипт, env-ключ или инструмент — предложи использовать именно его, а не вводить новый.",
    "Каждое утверждение о внешнем подходе подкрепляй источником (ссылкой). Если не уверен или нет данных — так и скажи, не выдумывай.",
    "",
    "## Потребности проекта (обнаруженные оси/предложения)",
    ...needs.map((n) => `- ${n}`),
    "",
    "## Внутреннее проекта (для синтеза; значения секретов НЕ приводятся)",
    `- зависимости: ${internals.deps.join(", ") || "—"}`,
    `- npm-скрипты: ${internals.scripts.join(", ") || "—"}`,
    `- env-ключи (имена): ${internals.envKeys.join(", ") || "—"}`,
    `- инструменты репозитория (scripts/): ${internals.repoTools.join(", ") || "—"}`,
    "",
    "## Что вернуть",
    "Для каждой потребности, где внешний подход реально помогает: «потребность → проверенный подход (источник) → что именно взять и в какой форме → как синтезировать с внутренним проекта». Кратко, по делу, с реальными ссылками. Если заземление ничего не добавляет — скажи прямо."
  ].join(`
`);
}
function runGround(projectRoot, needs, caller) {
  const internals = gatherInternals(projectRoot);
  if (needs.length === 0)
    return { model: null, text: "", internals };
  const res = caller(buildGroundPrompt(needs, internals));
  return { model: res?.model ?? null, text: res?.text ?? "", internals };
}

// src/cli/elevate.ts
init_i18n();
var root = process.cwd();
var res = resolveDataRoot(join3(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join3(res.root, slugOf(root));
var dbPath = join3(dataDir, "passport.db");
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
var args = stripDataFlag(process.argv.slice(2));
var VERB_ALIAS = { reject: "отклонить", accept: "принять", decisions: "решения" };
var rawVerb = args.find((a) => /^(отклонить|принять|решения|reject|accept|decisions)$/.test(a)) ?? "";
var verb = VERB_ALIAS[rawVerb] ?? rawVerb;
function lastProposals() {
  try {
    const raw = JSON.parse(readFileSync3(join3(dataDir, "elevate-last.json"), "utf8"));
    return raw.raw?.text ? parseProposals(raw.raw.text, 0) : [];
  } catch {
    return [];
  }
}
if (verb === "решения") {
  if (!existsSync3(dbPath)) {
    console.log(t("Паспорт не построен — решений быть не может.", "The passport has not been built — there can be no decisions yet."));
  } else {
    const db = openDb(dbPath, { readonly: true });
    console.log(renderVerdicts(readVerdicts(db)));
    db.close();
  }
} else if (verb === "отклонить" || verb === "принять") {
  const idx = Number(args[args.indexOf(rawVerb) + 1]);
  const proposals = lastProposals();
  const p = Number.isFinite(idx) ? proposals[idx - 1] : undefined;
  if (!p) {
    const n = args[args.indexOf(rawVerb) + 1] ?? "?";
    console.log(t(`Нет предложения №${n} в последнем прогоне (их ${proposals.length}). Сначала прогоните аудит.`, `There is no proposal #${n} in the last run (it had ${proposals.length}). Run the audit first.`));
  } else if (!existsSync3(dbPath)) {
    console.log(t("Паспорт не построен — записывать решение некуда.", "The passport has not been built — there is nowhere to record the decision."));
  } else {
    const reason = args.slice(args.indexOf(rawVerb) + 2).join(" ").trim();
    if (verb === "отклонить" && !reason) {
      console.log(t("Отклонение без причины бесполезно: именно причина уходит в следующий аудит. Напишите её после номера.", "A rejection without a reason is useless — the reason is what the next audit receives. Write it after the number."));
    } else {
      const db = openDb(dbPath);
      recordVerdict(db, { verdict: verb === "отклонить" ? "отклонено" : "принято", axis: p.axis, observation: p.observation, reason });
      db.close();
      const mark = verb === "отклонить" ? t("✗ отклонено", "✗ rejected") : t("✓ принято", "✓ accepted");
      console.log(`${t("Записано", "Recorded")}: ${mark} — [${p.axis}] ${p.observation.slice(0, 100)}`);
      console.log(t("Следующий аудит это учтёт и не повторит тот же довод без нового основания.", "The next audit will take this into account and will not repeat the same argument without new grounds."));
    }
  }
} else {
  const threshold = Number(args.find((a) => /^\d+$/.test(a))) || 70;
  console.log(t("Symbiont · возвышение · глубокий аудит проекта (один LLM-проход)…", "Symbiont · elevation · deep project audit (a single LLM pass)…"));
  const rootNotice = renderRootNotice(res);
  if (rootNotice)
    console.log(rootNotice);
  const t0 = performance.now();
  let attempts = [];
  const r = runElevate(root, dataDir, (prompt) => {
    const o = callClaudeDetailed(prompt, { intent: "deep", dataDir });
    attempts = o.tried;
    return o.result;
  }, threshold);
  const sec = Math.round((performance.now() - t0) / 1000);
  for (const a of attempts)
    console.log(`  ${t("проба", "attempt")} ${a.model}: ${a.ok ? "✓" : "✗"} · ${Math.round(a.ms / 1000)}${t("с", "s")} · ${a.note}`);
  console.log(`  ${t("порог уверенности", "confidence threshold")}: ${threshold} · ${sec}${t("с", "s")}
`);
  console.log(renderProposals(r));
  if (r.proposals.length > 0) {
    console.log(t(`
Решение записывается командой: /symbiont:elevate отклонить N причина… (или «принять N»).`, `
Record a decision with: /symbiont:elevate reject N reason… (or "accept N").`));
    console.log(t("Записанное уходит в следующий аудит — отклонённый довод не вернётся без нового основания.", "What is recorded goes into the next audit — a rejected argument will not return without new grounds."));
  }
  if (args.includes("--ground") && r.proposals.length > 0) {
    const needs = r.proposals.map((p) => `${p.axis}: ${p.proposal}`).slice(0, 6);
    console.log(t(`
— Внешнее заземление (research + синтез с внутренним проекта; веб-инструменты)…`, `
— External grounding (research plus synthesis with the project’s own internals; web tools)…`));
    const g = runGround(root, needs, (prompt) => callClaudeWithTools(prompt, { intent: "deep", dataDir }));
    if (g.model) {
      console.log(t(`
Заземление (модель ${g.model}):
${g.text}`, `
Grounding (model ${g.model}):
${g.text}`));
    } else {
      console.log(t(`
Заземление недоступно (нет интернета/инструментов) — предложения выше стоят на априори модели.`, `
Grounding unavailable (no internet or no web tools) — the proposals above rest on the model’s prior alone.`));
    }
  }
}
