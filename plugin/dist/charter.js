import {
  RUBRIC
} from "./session-start-7bev5jvd.js";
import {
  callClaudeDetailed
} from "./session-start-zz08nty3.js";
import"./session-start-7vxtw5jw.js";
import {
  playbooksFor
} from "./session-start-8ychq3hk.js";
import"./session-start-5s7r4262.js";
import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-jt5shx0g.js";
import {
  FactStore,
  detectStack,
  initLang,
  init_i18n,
  init_walk,
  jsonOnly,
  openDb,
  readConstitution,
  renderConstitution,
  runtimeBlocker,
  slugOf,
  t,
  upsertConstitution,
  walkFiles
} from "./session-start-1940hha9.js";
import"./session-start-rvra3cez.js";

// src/cli/charter.ts
init_i18n();
import { join as join2 } from "node:path";
import { mkdirSync } from "node:fs";

// src/elevate/charter.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
init_walk();
import { relative } from "node:path";
function coveredCapabilities(projectRoot, dataDir) {
  const caps = new Set;
  for (const a of RUBRIC)
    caps.add(`ось «${a.axis}»: ${a.lens}`);
  const rels = (() => {
    try {
      return walkFiles(projectRoot).map((f) => relative(projectRoot, f.path).replaceAll("\\", "/"));
    } catch {
      return [];
    }
  })();
  const stack = detectStack(projectRoot, rels);
  for (const p of playbooksFor(stack))
    caps.add(`плейбук «${p.domain}»: ${p.checklist.slice(0, 3).join("; ")}`);
  const dbPath = join(dataDir, "passport.db");
  if (existsSync(dbPath)) {
    const db = openDb(dbPath, { readonly: true });
    try {
      for (const f of new FactStore(db).active().filter((f2) => f2.area === "конституция" || f2.area === "профиль качества")) {
        caps.add(f.statement);
      }
    } catch {} finally {
      db.close();
    }
  }
  return [...caps];
}
function buildCharterPrompt(requirements, covered) {
  return [
    "Владелец продукта описал требования/условия к проекту СВОИМИ словами (возможно вагонно, наивно или завуалированно).",
    "Твоя задача — сопоставить каждое требование с тем, что система УЖЕ покрывает автоматически, и классифицировать:",
    "- «уже-покрыто»: требование по сути совпадает с существующей осью качества / плейбуком / выведенной конституцией (даже если сказано другими словами) → повторно фиксировать НЕ нужно, укажи чем покрыто;",
    "- «уникальное»: невыводимая из кода стратегическая воля владельца → зафиксировать парой «цель + ограничение»;",
    "- «уточнение»: усиливает/сужает уже покрытое (например «приватность ВАЖНЕЕ скорости») → зафиксировать как приоритет.",
    "НЕ дублируй под капотное. Будь честен: если требование уже под капотом — так и скажи.",
    "",
    "## Что система уже покрывает автоматически",
    ...covered.map((c) => `- ${c}`),
    "",
    "## Требования владельца (свободный текст)",
    requirements,
    "",
    jsonOnly('[{"requirement":"исходное требование","status":"уже-покрыто|уникальное|уточнение","coveredBy":"чем (если уже-покрыто)","asWill":"цель — … · ограничение — … (если уникальное/уточнение)"}]')
  ].join(`
`);
}
function parseCharter(text) {
  try {
    const s = text.indexOf("[");
    const e = text.lastIndexOf("]");
    if (s === -1 || e <= s)
      return [];
    const arr = JSON.parse(text.slice(s, e + 1));
    if (!Array.isArray(arr))
      return [];
    const valid = new Set(["уже-покрыто", "уникальное", "уточнение"]);
    return arr.filter((r) => typeof r?.requirement === "string" && valid.has(r?.status)).map((r) => ({
      requirement: r.requirement,
      status: r.status,
      coveredBy: typeof r.coveredBy === "string" ? r.coveredBy : undefined,
      asWill: typeof r.asWill === "string" ? r.asWill : undefined
    }));
  } catch {
    return [];
  }
}
function runCharter(projectRoot, dataDir, requirements, caller) {
  if (!requirements.trim())
    return { model: null, verdicts: [] };
  const covered = coveredCapabilities(projectRoot, dataDir);
  const res = caller(buildCharterPrompt(requirements, covered));
  if (!res)
    return { model: null, verdicts: [] };
  return { model: res.model, verdicts: parseCharter(res.text) };
}
function verdictsToPairs(verdicts) {
  const pairs = [];
  for (const v of verdicts) {
    if (v.status === "уже-покрыто" || !v.asWill)
      continue;
    const goalM = v.asWill.match(/цель\s*—\s*([^·]+)/i);
    const conM = v.asWill.match(/ограничение\s*—\s*(.+)/i);
    pairs.push({
      goal: (goalM?.[1] ?? v.requirement).trim(),
      constraint: (conM?.[1] ?? "соблюдать в рамках задачи, не сверх").trim()
    });
  }
  return pairs;
}
function renderCharter(r) {
  if (!r.model)
    return "Symbiont · устав: модели недоступны или требования пусты.";
  if (r.verdicts.length === 0)
    return "Symbiont · устав: не удалось разобрать требования (попробуй переформулировать).";
  const L = [`Symbiont · устав (модель ${r.model}) — сопоставление требований с уже покрытым:`, ""];
  const covered = r.verdicts.filter((v) => v.status === "уже-покрыто");
  const unique = r.verdicts.filter((v) => v.status !== "уже-покрыто");
  if (covered.length > 0) {
    L.push("Уже под капотом (повторять не нужно):");
    for (const v of covered)
      L.push(`- «${v.requirement}» → ${v.coveredBy ?? "покрыто"}`);
    L.push("");
  }
  if (unique.length > 0) {
    L.push("Уникальная воля владельца (зафиксирую в конституции, побеждает выведенное):");
    for (const v of unique)
      L.push(`- «${v.requirement}» → ${v.asWill ?? v.requirement}`);
  }
  return L.join(`
`);
}

// src/cli/charter.ts
var root = process.cwd();
var res = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join2(res.root, slugOf(root));
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
mkdirSync(dataDir, { recursive: true });
var existing = readConstitution(dataDir);
if (existing) {
  console.log(t(`Symbiont · устав · уже зафиксировано ранее:
`, `Symbiont · charter · already recorded earlier:
`));
  console.log(renderConstitution(existing));
  console.log("");
} else {
  console.log(t(`Symbiont · устав · ранее ничего не фиксировалось (авто-конституция всё равно выводится сама).
`, `Symbiont · charter · nothing was recorded before (the automatic constitution is derived anyway).
`));
}
var requirements = stripDataFlag(process.argv.slice(2)).join(" ").trim();
if (!requirements) {
  console.log(t("Добавить/изменить — передай требования текстом. Пример: /symbiont:charter «важнее всего приватность пациентов; не трогать прод-оплаты; топ-1 по качеству разборов». Существующее сохранится (дополнится/обновится по цели).", "To add or change it, pass your requirements as text. For example: /symbiont:charter “patient privacy matters most; never touch production payments; be best in class at parsing quality”. What is already recorded is kept and extended."));
  process.exit(0);
}
console.log(t("Symbiont · устав · сопоставление требований с уже покрытым…", "Symbiont · charter · matching your requirements against what is already covered…"));
var r = runCharter(root, dataDir, requirements, (prompt) => callClaudeDetailed(prompt, { intent: "deep", dataDir }).result);
console.log(renderCharter(r));
var pairs = verdictsToPairs(r.verdicts);
if (pairs.length > 0) {
  const c = upsertConstitution(dataDir, pairs);
  console.log(t(`
Зафиксировано в конституцию: ${pairs.length} (всего пар: ${c.pairs.length}). Подаётся в каждую сессию.`, `
Recorded into the constitution: ${pairs.length} (pairs in total: ${c.pairs.length}). Delivered to every session.`));
}
