import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-25e3w7d2.js";
import {
  FactStore,
  factBasis,
  initLang,
  init_i18n,
  openDb,
  runtimeBlocker,
  slugOf,
  statement,
  t
} from "./session-start-anv3kp9x.js";
import"./session-start-70d7ckvt.js";

// src/cli/export.ts
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
init_i18n();
var BEGIN = "<!-- BEGIN SYMBIONT PASSPORT (generated — do not edit inside; regenerate with /symbiont:export) -->";
var END = "<!-- END SYMBIONT PASSPORT -->";
var LAWS_MAX = 20;
var HABITS_MAX = 10;
var MODULES_MAX = 10;
var root = process.cwd();
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(root));
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
var dbPath = join(dataDir, "passport.db");
if (!existsSync(dbPath)) {
  console.log(t("Symbiont: паспорта ещё нет — экспортировать нечего. Начните сессию или позовите /symbiont:init.", "Symbiont: there is no passport yet — nothing to export. Start a session or call /symbiont:init."));
  process.exit(0);
}
var arg = stripDataFlag(process.argv.slice(2)).join(" ").trim().toLowerCase();
var dryRun = /^(dry|preview|показать|превью)$/.test(arg);
var db = openDb(dbPath, { readonly: true });
var section = "";
try {
  const store = new FactStore(db);
  const active = store.active();
  const laws = active.filter((f) => f.tier === "закон").slice(0, LAWS_MAX);
  const habits = active.filter((f) => f.tier === "привычка").slice(0, HABITS_MAX);
  let modules = [];
  try {
    modules = db.query("SELECT g.file, g.in_deg, s.z1 FROM graph_nodes g LEFT JOIN node_summary s ON s.file = g.file ORDER BY g.rank DESC LIMIT ?").all(MODULES_MAX);
  } catch {
    try {
      modules = db.query("SELECT file, in_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(MODULES_MAX).map((m) => ({ ...m, z1: null }));
    } catch {
      modules = [];
    }
  }
  if (laws.length === 0 && habits.length === 0 && modules.length === 0) {
    console.log(t("Symbiont: паспорт ещё пуст (нет ни законов, ни карты) — экспорт отложите до первых сессий.", "Symbiont: the passport is still empty (no laws, no map) — postpone the export until the first sessions."));
    process.exit(0);
  }
  const lines = [BEGIN, ""];
  lines.push(t("## Паспорт проекта (Symbiont)", "## Project passport (Symbiont)"), "", t("_Выведено из кода и истории самого проекта. Числа — измеренная распространённость; «выведено по N образцам» — вывод модели, не замер. Секция генерируется целиком: правки внутри маркеров будут перезаписаны._", "_Derived from the project’s own code and history. Numbers are measured prevalence; “inferred from N samples” is a model’s inference, not a measurement. The section is generated as a whole: edits inside the markers will be overwritten._"), "");
  if (laws.length > 0) {
    lines.push(t("### Законы (соблюдаются практически всегда)", "### Laws (held virtually always)"), "");
    for (const f of laws)
      lines.push(`- ${statement(f.statement)} — ${factBasis(f)}`);
    lines.push("");
  }
  if (habits.length > 0) {
    lines.push(t("### Преобладающий стиль (возможны легитимные исключения)", "### Prevailing style (legitimate exceptions possible)"), "");
    for (const f of habits)
      lines.push(`- ${statement(f.statement)} — ${factBasis(f)}`);
    lines.push("");
  }
  if (modules.length > 0) {
    lines.push(t("### Ключевые модули (по влиянию в графе импортов)", "### Key modules (by influence in the import graph)"), "");
    for (const m of modules)
      lines.push(`- \`${m.file}\` (${t("вход", "in")} ${m.in_deg})${m.z1 ? ` — ${m.z1}` : ""}`);
    lines.push("");
  }
  lines.push(END);
  section = lines.join(`
`);
} finally {
  db.close();
}
var target = join(root, "AGENTS.md");
var existing = existsSync(target) ? readFileSync(target, "utf8") : null;
var next;
if (existing === null) {
  next = `${section}
`;
} else if (existing.includes(BEGIN) && existing.includes(END)) {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END) + END.length;
  next = existing.slice(0, start) + section + existing.slice(end);
} else {
  next = `${existing.replace(/\s*$/, "")}

${section}
`;
}
if (dryRun) {
  console.log(section);
  console.log(t(`
(сухой прогон — файл не тронут; запись: /symbiont:export)`, `
(dry run — the file was not touched; to write: /symbiont:export)`));
} else {
  writeFileSync(target, next, "utf8");
  console.log(t(`Symbiont: секция паспорта записана в AGENTS.md (${existing === null ? "файл создан" : "обновлена внутри маркеров, остальное не тронуто"}). Её читают Codex/Cursor/Copilot и другие инструменты; Claude Code получает то же знание живыми каналами. Повторный вызов перегенерирует секцию свежими числами.`, `Symbiont: the passport section was written to AGENTS.md (${existing === null ? "file created" : "updated inside the markers, the rest untouched"}). Codex/Cursor/Copilot and other tools read it; Claude Code gets the same knowledge through live channels. Calling again regenerates the section with fresh numbers.`));
}
