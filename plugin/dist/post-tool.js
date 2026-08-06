import {
  claimNode,
  ensureFeedLog,
  markUsed,
  nodeBrief
} from "./session-start-jrfcnane.js";
import {
  checkAgainstLaws
} from "./session-start-h2fyvqta.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  readGrounding,
  renderCorrection
} from "./session-start-bng491ep.js";
import {
  playbooksFor,
  renderPlaybookBrief
} from "./session-start-8ychq3hk.js";
import {
  zoneOf
} from "./session-start-kq7yws6c.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-xsjahv15.js";
import {
  FactStore,
  beat,
  bumpHeat,
  contentVerifierActive,
  effectiveProfile,
  fileDomains,
  init_i18n,
  loadEntityResolver,
  openDb,
  readZoneProfiles,
  renderEffective,
  rootAxesFromFacts,
  runContentVerifiers,
  shouldFeed,
  slugOf,
  statement,
  t,
  zoneAncestors
} from "./session-start-mwmgewqe.js";
import"./session-start-70d7ckvt.js";

// src/hooks/post-tool.ts
import { join as join2 } from "node:path";

// src/hooks/post-tool-core.ts
init_i18n();
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
var WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var TOUCH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Read"]);
var MAX_CONTENT = 1e6;
var SKIP_ZONES = /(^|\/)(node_modules|\.git|\.data|dist|build|\.nuxt|vendor)(\/|$)/;
function toRelNode(cwd, filePath) {
  const rel = relative(cwd.replaceAll("\\", "/"), filePath.replaceAll("\\", "/")).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.includes(":"))
    return null;
  if (SKIP_ZONES.test(rel))
    return null;
  return rel;
}
function recordEdit(db, sid, rel) {
  try {
    db.run("CREATE TABLE IF NOT EXISTS session_edits(session_id TEXT NOT NULL, file TEXT NOT NULL, edited_at TEXT NOT NULL, PRIMARY KEY(session_id, file))");
    db.query("INSERT INTO session_edits(session_id, file, edited_at) VALUES(?,?,?) ON CONFLICT(session_id, file) DO UPDATE SET edited_at=excluded.edited_at").run(sid, rel, new Date().toISOString());
  } catch {}
}
function handlePostTool(input, dataRoot) {
  try {
    const tool = input.tool_name ?? "";
    if (!TOUCH_TOOLS.has(tool))
      return {};
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath)
      return {};
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    beat(dataDir, "PostToolUse");
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const rel = toRelNode(cwd, filePath);
    if (!rel)
      return {};
    const db = openDb(dbPath);
    try {
      const sid = input.session_id ?? "manual";
      const lines = [];
      if (WRITE_TOOLS.has(tool)) {
        ensureFeedLog(db);
        const covering = [`#lesson:${zoneOf(rel)}`, ...zoneAncestors(rel).map((z) => `#zone:${z}`), ...fileDomains(rel).map((d) => `#playbook:${d}`)];
        markUsed(db, sid, rel, covering);
        recordEdit(db, sid, rel);
      }
      if (WRITE_TOOLS.has(tool)) {
        const ext = extname(rel).toLowerCase();
        let content = null;
        try {
          content = readFileSync(join(cwd, rel), "utf8");
        } catch {
          content = null;
        }
        if (content !== null && content.length <= MAX_CONTENT) {
          db.run("CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))");
          const dedup = db.query("INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)");
          const laws = new FactStore(db).active().filter((f) => f.tier === "закон");
          for (const v of checkAgainstLaws(content, ext, laws)) {
            if (Number(dedup.run(sid, rel, v.law).changes) === 0)
              continue;
            lines.push(t(`- отклонение от закона «${statement(v.law)}» · ${v.detail}`, `- deviation from the law “${statement(v.law)}” · ${v.detail}`));
          }
          if (contentVerifierActive(ext)) {
            const resolve = loadEntityResolver(db);
            for (const v of runContentVerifiers(rel, content, ext, { resolve })) {
              if (Number(dedup.run(sid, rel, v.verifier).changes) === 0)
                continue;
              lines.push(t(`- верификатор «${v.verifier}» · ${v.detail}`, `- verifier “${v.verifier}” · ${v.detail}`));
            }
          }
        }
      }
      const node = db.query("SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?").get(rel);
      if (node) {
        try {
          bumpHeat(db, node.file, new Date().toISOString());
        } catch {}
        ensureFeedLog(db);
        if (claimNode(db, sid, node.file))
          lines.push(`- ${nodeBrief(db, node)}`);
      }
      try {
        const profiles = readZoneProfiles(db);
        if (profiles.length > 0) {
          const rootAxes = rootAxesFromFacts(new FactStore(db).active().filter((f) => f.area === "профиль качества").map((f) => f.statement));
          const eff = effectiveProfile(rel, rootAxes, profiles);
          if (eff && shouldFeed(db, "zone")) {
            ensureFeedLog(db);
            if (claimNode(db, sid, `#zone:${eff.zone}`, "zone"))
              lines.push("", renderEffective(eff));
          }
        }
      } catch {}
      const domains = fileDomains(rel);
      if (domains.length > 0 && shouldFeed(db, "playbook")) {
        ensureFeedLog(db);
        const active = playbooksFor({ frameworks: [], infra: [], domains });
        const corrections = new Map(readGrounding(db).map((r) => [r.domain, r]));
        for (const pb of active) {
          if (!claimNode(db, sid, `#playbook:${pb.domain}`, "playbook"))
            continue;
          lines.push("", renderPlaybookBrief(pb));
          const corr = renderCorrection(corrections.get(pb.domain));
          if (corr)
            lines.push(corr);
        }
      }
      if (lines.length === 0)
        return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `Symbiont · ${rel}:
${lines.join(`
`)}`
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/post-tool.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostTool(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
