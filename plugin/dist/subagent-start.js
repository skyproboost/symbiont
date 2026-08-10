import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-dhyq0anx.js";
import {
  FactStore,
  beat,
  initLang,
  init_i18n,
  openDb,
  slugOf,
  statement,
  t
} from "./session-start-q2jjr130.js";
import"./session-start-rvra3cez.js";

// src/hooks/subagent-start.ts
import { join as join2 } from "node:path";

// src/hooks/subagent-start-core.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
init_i18n();
var SUBAGENT_CHAR_BUDGET = 1400;
var LAWS_MAX = 6;
var NODES_MAX = 6;
function handleSubagentStart(input, dataRoot) {
  try {
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "SubagentStart", { agent: input.agent_type ?? null });
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const db = openDb(dbPath, { readonly: true });
    try {
      const laws = new FactStore(db).active().filter((f) => f.tier === "закон").slice(0, LAWS_MAX).map((f) => statement(f.statement));
      let nodes = [];
      try {
        nodes = db.query("SELECT g.file, g.in_deg, s.z1 FROM graph_nodes g LEFT JOIN node_summary s ON s.file = g.file ORDER BY g.rank DESC LIMIT ?").all(NODES_MAX);
      } catch {
        try {
          nodes = db.query("SELECT file, in_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(NODES_MAX).map((n) => ({ ...n, z1: null }));
        } catch {
          nodes = [];
        }
      }
      const lawsSec = laws.length > 0 ? `${t("Законы стиля (нарушение ловит гейт)", "Style laws (violations are caught by the gate)")}: ${laws.join(" · ")}` : "";
      const mapSec = nodes.length > 0 ? `${t("Ключевые модули", "Key modules")}: ${nodes.map((n) => `${n.file} (${t("вход", "in")} ${n.in_deg}${n.z1 ? ` — ${n.z1}` : ""})`).join("; ")}` : "";
      if (!lawsSec && !mapSec)
        return {};
      const planner = /plan/i.test(input.agent_type ?? "");
      const sections = (planner ? [lawsSec, mapSec] : [mapSec, lawsSec]).filter(Boolean);
      const header = t(`Symbiont · паспорт проекта для сабагента${input.agent_type ? ` (${input.agent_type})` : ""} — выведено из самого проекта`, `Symbiont · project passport for the subagent${input.agent_type ? ` (${input.agent_type})` : ""} — derived from the project itself`);
      let text = `${header}:
${sections.map((s) => `- ${s}`).join(`
`)}`;
      if (text.length > SUBAGENT_CHAR_BUDGET)
        text = `${text.slice(0, SUBAGENT_CHAR_BUDGET)}…`;
      return {
        hookSpecificOutput: {
          hookEventName: "SubagentStart",
          additionalContext: text
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/subagent-start.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root;
var out = handleSubagentStart(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
