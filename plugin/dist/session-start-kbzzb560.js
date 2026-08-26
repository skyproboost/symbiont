import {
  contentHashOf,
  markVisited,
  summaryFor
} from "./session-start-cnmd1j37.js";
import {
  init_i18n,
  noteSurfaced,
  noteUsed,
  noteWithheld,
  noteWithheldUsed,
  readConfigEdges,
  renderConfigInfluence,
  shouldWithhold,
  t
} from "./session-start-rqxgy7zy.js";

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
  if (!cols.includes("withheld"))
    db.run("ALTER TABLE jit_log ADD COLUMN withheld INTEGER NOT NULL DEFAULT 0");
}
function claimNode(db, sessionId, file, kind = "graph") {
  if (kind === "graph" && briefSilenced(db, sessionId, file))
    return false;
  const withheld = shouldWithhold(sessionId, file, kind);
  const fresh = Number(db.query("INSERT OR IGNORE INTO jit_log(session_id, file, kind, withheld) VALUES(?,?,?,?)").run(sessionId, file, kind, withheld ? 1 : 0).changes) > 0;
  if (!fresh)
    return false;
  if (withheld) {
    noteWithheld(db, kind);
    return false;
  }
  noteSurfaced(db, kind);
  return true;
}
var SILENCE_AFTER = 3;
var SILENCE_SESSIONS = 5;
function briefSilenced(db, sessionId, file) {
  try {
    db.run("CREATE TABLE IF NOT EXISTS brief_silence(file TEXT PRIMARY KEY, since_ordinal INTEGER NOT NULL)");
    const ordinal = Number(db.query("SELECT COUNT(*) n FROM sessions").get()?.n ?? 0);
    const row = db.query("SELECT since_ordinal FROM brief_silence WHERE file=?").get(file);
    if (row) {
      if (ordinal - row.since_ordinal < SILENCE_SESSIONS)
        return true;
      db.query("DELETE FROM brief_silence WHERE file=?").run(file);
      return false;
    }
    const recent = db.query(`SELECT j.used FROM jit_log j LEFT JOIN sessions s ON s.session_id = j.session_id
         WHERE j.file=? AND j.kind='graph' AND j.session_id<>? ORDER BY s.started_at DESC LIMIT ?`).all(file, sessionId, SILENCE_AFTER);
    if (recent.length < SILENCE_AFTER || recent.some((r) => r.used === 1))
      return false;
    db.query("INSERT OR REPLACE INTO brief_silence(file, since_ordinal) VALUES(?,?)").run(file, ordinal);
    return true;
  } catch {
    return false;
  }
}
function markUsed(db, sessionId, file, coveringKeys = []) {
  try {
    const keys = [file, ...coveringKeys];
    const marked = new Set;
    for (const key of keys) {
      const row = db.query("SELECT kind, used, withheld FROM jit_log WHERE session_id=? AND file=?").get(sessionId, key);
      if (!row || row.used === 1 || marked.has(key))
        continue;
      db.query("UPDATE jit_log SET used=1 WHERE session_id=? AND file=?").run(sessionId, key);
      marked.add(key);
      if (row.withheld === 1)
        noteWithheldUsed(db, row.kind ?? "graph");
      else
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
