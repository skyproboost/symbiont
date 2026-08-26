import {
  digestForFile,
  readGrounding,
  renderCorrection
} from "./session-start-nttzs9gz.js";
import {
  indexedHash,
  readOutline
} from "./session-start-psab7pqj.js";
import {
  playbooksFor,
  renderPlaybookBrief
} from "./session-start-8ychq3hk.js";
import {
  claimNode,
  ensureFeedLog,
  markUsed,
  nodeBrief,
  outlineKey
} from "./session-start-kbzzb560.js";
import {
  zoneOf
} from "./session-start-cnmd1j37.js";
import {
  EDIT_TOUCH_WEIGHT,
  FactStore,
  READ_TOUCH_WEIGHT,
  analyzeJs,
  beat,
  bumpHeat,
  contentVerifierActive,
  detectIndent,
  effectiveProfile,
  fileDomains,
  initLang,
  init_i18n,
  loadEntityResolver,
  openDb,
  readZoneProfiles,
  renderEffective,
  resolveImport,
  rootAxesFromFacts,
  runContentVerifiers,
  sha1,
  shouldFeed,
  slugOf,
  statement,
  t,
  zoneAncestors
} from "./session-start-rqxgy7zy.js";

// src/hooks/post-tool-core.ts
init_i18n();
import { existsSync, readFileSync } from "node:fs";
import { extname as extname2, join, relative } from "node:path";

// src/gates/checks.ts
init_i18n();
var JS_FAMILY = new Set([".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".vue"]);
function checkAgainstLaws(content, ext, laws) {
  if (!JS_FAMILY.has(ext))
    return [];
  const out = [];
  const s = analyzeJs(content);
  const indent = detectIndent(content);
  const q = s.quotes;
  const quoteVerdict = q.single + q.double < 5 ? null : q.single >= q.double * 2 ? "single" : q.double >= q.single * 2 ? "double" : null;
  const sm = s.semiLines;
  const semiVerdict = sm.with + sm.without < 8 ? null : sm.with >= sm.without * 2 ? "with" : sm.without >= sm.with * 2 ? "without" : null;
  const add = (law, detail) => out.push({ law: law.statement, detail });
  for (const law of laws) {
    const st = law.statement;
    if (st.includes("переменные — только var")) {
      const n = s.decl.let + s.decl.const;
      if (n > 0)
        add(law, `let/const: ${n}`);
    } else if (st.includes("const/let")) {
      if (s.decl.var > 0)
        add(law, `var: ${s.decl.var}`);
    } else if (st.includes("стрелочные функции — не используются")) {
      if (s.fn.arrow > 0)
        add(law, `${t("стрелочных", "arrow functions")}: ${s.fn.arrow}`);
    } else if (st.includes("filter/map/reduce — не используются")) {
      const n = s.fmr.filter + s.fmr.map + s.fmr.reduce;
      if (n > 0)
        add(law, `filter/map/reduce: ${n}`);
    } else if (st.includes("деструктуризация в параметрах — не используется")) {
      if (s.destructuredParams > 0)
        add(law, `${t("деструктуризаций в параметрах", "destructured parameters")}: ${s.destructuredParams}`);
    } else if (st.includes("отступы — табы")) {
      if (indent === "s2" || indent === "s4")
        add(law, t("отступы пробелами", "indented with spaces"));
    } else if (st.includes("отступы — 2 пробела")) {
      if (indent === "tab" || indent === "s4") {
        add(law, indent === "tab" ? t("отступы табами", "indented with tabs") : t("отступы 4 пробелами", "indented with 4 spaces"));
      }
    } else if (st.includes("отступы — 4 пробела")) {
      if (indent === "tab" || indent === "s2") {
        add(law, indent === "tab" ? t("отступы табами", "indented with tabs") : t("отступы 2 пробелами", "indented with 2 spaces"));
      }
    } else if (st.includes("кавычки — одинарные")) {
      if (quoteVerdict === "double")
        add(law, `${t("двойные кавычки", "double quotes")}: ${q.double}`);
    } else if (st.includes("кавычки — двойные")) {
      if (quoteVerdict === "single")
        add(law, `${t("одинарные кавычки", "single quotes")}: ${q.single}`);
    } else if (st.includes("точки с запятой — используются")) {
      if (semiVerdict === "without")
        add(law, `${t("строк без ;", "lines without ;")}: ${sm.without}`);
    } else if (st.includes("точки с запятой — не используются")) {
      if (semiVerdict === "with")
        add(law, `${t("строк с ;", "lines with ;")}: ${sm.with}`);
    } else if (st.includes("<script setup>")) {
      if (ext === ".vue" && /<script(?![^>]*\bsetup\b)[^>]*>/.test(content))
        add(law, t("компонент без <script setup>", "component without <script setup>"));
    } else if (st.includes("Options API")) {
      if (ext === ".vue" && /<script[^>]*\bsetup\b/.test(content))
        add(law, t("компонент на <script setup>", "component using <script setup>"));
    }
  }
  return out;
}

// src/hooks/touch-feed.ts
init_i18n();
function touchFeed(db, sid, rel, kind, touchWeight = READ_TOUCH_WEIGHT) {
  const lines = [];
  const node = db.query("SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?").get(rel);
  if (node) {
    try {
      bumpHeat(db, node.file, new Date().toISOString(), touchWeight);
    } catch {}
    ensureFeedLog(db);
    if (claimNode(db, sid, node.file, kind))
      lines.push(`- ${nodeBrief(db, node)}`);
    try {
      if (shouldFeed(db, "community")) {
        const d = digestForFile(db, node.file);
        if (d && claimNode(db, sid, `#community:${d.label}`, "community")) {
          lines.push(`- ${t("подсистема", "subsystem")} «${d.name}»: ${d.digest}`);
        }
      }
    } catch {}
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
  return lines;
}

// src/verifiers/phantom.ts
import { extname } from "node:path";
init_i18n();
var NAMED_IMPORT = [
  {
    exts: new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"]),
    re: /^[ \t]*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm,
    split: (names) => names.split(",").map((n) => n.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0].trim()).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
  },
  {
    exts: new Set([".py", ".pyi"]),
    re: /^[ \t]*from\s+([\w.]+)\s+import\s+\(?([^)\n]+)\)?/gm,
    split: (names) => names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter((n) => /^[A-Za-z_]\w*$/.test(n) && n !== "*")
  }
];
function extractNamedImports(content, rel) {
  const ext = extname(rel).toLowerCase();
  const pack = NAMED_IMPORT.find((p) => p.exts.has(ext));
  if (!pack)
    return [];
  const out = [];
  for (const m of content.matchAll(pack.re)) {
    const [names, spec] = ext === ".py" || ext === ".pyi" ? [m[2], m[1]] : [m[1], m[2]];
    const list = pack.split(names);
    if (list.length > 0)
      out.push({ spec, names: list });
  }
  return out;
}
function topLevelNames(db, file) {
  return readOutline(db, file).filter((r) => r.kind !== "case" && !r.name.includes(".") && !r.name.includes("(")).map((r) => r.name);
}
function findPhantoms(db, rel, content, projectFiles, diskHash, writtenBySession) {
  const out = [];
  for (const imp of extractNamedImports(content, rel)) {
    let source = null;
    try {
      source = resolveImport(rel, imp.spec, projectFiles);
    } catch {
      source = null;
    }
    if (!source || source === rel || writtenBySession.has(source))
      continue;
    const indexed = indexedHash(db, source);
    if (indexed === null || indexed !== diskHash(source))
      continue;
    const names = topLevelNames(db, source);
    if (names.length === 0)
      continue;
    const have = new Set(names);
    for (const name of imp.names) {
      if (!have.has(name))
        out.push({ name, source, available: names.slice(0, 8) });
    }
  }
  return out;
}
function renderPhantom(p) {
  const list = p.available.join(", ");
  return t(`- фантом: «${p.name}» импортируется из ${p.source}, но там его нет (есть: ${list})`, `- phantom: “${p.name}” is imported from ${p.source}, which does not declare it (it has: ${list})`);
}

// src/hooks/post-tool-core.ts
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
    initLang(dataDir, cwd);
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
        const covering = [
          `#lesson:${zoneOf(rel)}`,
          ...zoneAncestors(rel).map((z) => `#zone:${z}`),
          ...fileDomains(rel).map((d) => `#playbook:${d}`),
          outlineKey(rel)
        ];
        markUsed(db, sid, rel, covering);
        recordEdit(db, sid, rel);
      }
      if (WRITE_TOOLS.has(tool)) {
        const ext = extname2(rel).toLowerCase();
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
          try {
            const files = new Set(db.query("SELECT file FROM graph_nodes").all().map((r) => r.file));
            const own = new Set(db.query("SELECT file FROM session_edits WHERE session_id=?").all(sid).map((r) => r.file));
            const diskHash = (f) => {
              try {
                return sha1(readFileSync(join(cwd, f), "utf8"));
              } catch {
                return null;
              }
            };
            for (const p of findPhantoms(db, rel, content, files, diskHash, own)) {
              if (Number(dedup.run(sid, rel, `#фантом:${p.name}`).changes) === 0)
                continue;
              lines.push(renderPhantom(p));
            }
          } catch {}
        }
      }
      lines.push(...touchFeed(db, sid, rel, "graph", WRITE_TOOLS.has(tool) ? EDIT_TOUCH_WEIGHT : READ_TOUCH_WEIGHT));
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

export { touchFeed, checkAgainstLaws, toRelNode, handlePostTool };
