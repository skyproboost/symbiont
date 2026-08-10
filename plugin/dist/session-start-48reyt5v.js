import {
  contentHashOf,
  markVisited,
  summaryFor
} from "./session-start-g3kq6xfd.js";
import {
  init_i18n,
  noteSurfaced,
  noteUsed,
  readConfigEdges,
  renderConfigInfluence,
  t
} from "./session-start-daqc63bv.js";

// src/hooks/node-brief.ts
init_i18n();
var OUTLINE_KIND = "outline";
var outlineKey = (rel) => `#outline:${rel}`;
function ensureFeedLog(db) {
  db.run("CREATE TABLE IF NOT EXISTS jit_log(session_id TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(session_id, file))");
  const cols = db.query("PRAGMA table_info(jit_log)").all().map((c) => c.name);
  if (!cols.includes("used"))
    db.run("ALTER TABLE jit_log ADD COLUMN used INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("kind"))
    db.run("ALTER TABLE jit_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'graph'");
}
function claimNode(db, sessionId, file, kind = "graph") {
  const fresh = Number(db.query("INSERT OR IGNORE INTO jit_log(session_id, file, kind) VALUES(?,?,?)").run(sessionId, file, kind).changes) > 0;
  if (fresh)
    noteSurfaced(db, kind);
  return fresh;
}
function markUsed(db, sessionId, file, coveringKeys = []) {
  try {
    const keys = [file, ...coveringKeys];
    const marked = new Set;
    for (const key of keys) {
      const row = db.query("SELECT kind, used FROM jit_log WHERE session_id=? AND file=?").get(sessionId, key);
      if (!row || row.used === 1 || marked.has(key))
        continue;
      db.query("UPDATE jit_log SET used=1 WHERE session_id=? AND file=?").run(sessionId, key);
      marked.add(key);
      noteUsed(db, row.kind ?? "graph");
    }
  } catch {}
}
function nodeBrief(db, node) {
  markVisited(db, node.file, new Date().toISOString());
  const z1 = summaryFor(db, node.file, contentHashOf(db, node.file));
  const deps = db.query("SELECT from_file FROM graph_edges WHERE to_file = ? ORDER BY from_file LIMIT 6").all(node.file).map((r) => r.from_file);
  const outs = db.query("SELECT to_file FROM graph_edges WHERE from_file = ? ORDER BY to_file LIMIT 6").all(node.file).map((r) => r.to_file);
  const parts = [`${node.file} · ${t("вход", "in")}:${node.in_deg} ${t("исход", "out")}:${node.out_deg}`];
  if (z1)
    parts.push(`${t("роль", "role")}: ${z1}`);
  const influence = renderConfigInfluence(readConfigEdges(db, node.file));
  if (influence) {
    parts.push(influence.replace(t("Symbiont · этим кодом управляет конфигурация: ", "Symbiont · this code is governed by configuration: "), t("управляет конфигурация: ", "governed by configuration: ")));
  }
  if (deps.length > 0)
    parts.push(`${t("зависят", "depended on by")}: ${deps.join(", ")}${node.in_deg > deps.length ? ", …" : ""}`);
  if (outs.length > 0)
    parts.push(`${t("зависит от", "depends on")}: ${outs.join(", ")}${node.out_deg > outs.length ? ", …" : ""}`);
  const hasCochange = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cochange'").get().n > 0;
  if (hasCochange) {
    const rel = db.query(`SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n
           FROM cochange WHERE file_a = ? OR file_b = ? ORDER BY n DESC LIMIT 3`).all(node.file, node.file, node.file).map((r) => `${r.partner} (${r.n})`);
    if (rel.length > 0)
      parts.push(`${t("исторически правятся вместе", "historically changed together")}: ${rel.join(", ")}`);
  }
  return parts.join(" · ");
}

export { OUTLINE_KIND, outlineKey, ensureFeedLog, claimNode, markUsed, nodeBrief };
