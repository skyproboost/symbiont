// src/gardener/cited.ts
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
var TAIL_LINES = 4000;
function assistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath))
    return "";
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split(`
`);
  } catch {
    return "";
  }
  if (lines.length > TAIL_LINES)
    lines = lines.slice(-TAIL_LINES);
  const out = [];
  for (const line of lines) {
    if (!line.includes('"type":"assistant"') || !line.includes('"text"'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content))
      continue;
    for (const c of obj.message?.content ?? [])
      if (c.type === "text" && typeof c.text === "string")
        out.push(c.text);
  }
  return out.join(`
`);
}
function citedKeys(surfaced, text) {
  if (!text)
    return [];
  const byBase = new Map;
  for (const f of surfaced)
    byBase.set(basename(f), (byBase.get(basename(f)) ?? 0) + 1);
  return surfaced.filter((f) => text.includes(f) || byBase.get(basename(f)) === 1 && text.includes(basename(f)));
}
function markCited(db, sessionId, transcriptPath) {
  try {
    const rows = db.query("SELECT file FROM jit_log WHERE session_id=? AND cited=0 AND file NOT LIKE '#%'").all(sessionId);
    if (rows.length === 0)
      return 0;
    const text = assistantText(transcriptPath);
    if (!text)
      return 0;
    const upd = db.query("UPDATE jit_log SET cited=1 WHERE session_id=? AND file=?");
    let n = 0;
    for (const key of citedKeys(rows.map((r) => r.file), text))
      n += Number(upd.run(sessionId, key).changes);
    return n;
  } catch {
    return 0;
  }
}
var MIN_WITHHELD = 8;
function citedStats(db) {
  try {
    const row = db.query(`SELECT
           SUM(CASE WHEN withheld=0 THEN 1 ELSE 0 END) s,
           SUM(CASE WHEN withheld=0 AND cited=1 THEN 1 ELSE 0 END) sc,
           SUM(CASE WHEN withheld=1 THEN 1 ELSE 0 END) w,
           SUM(CASE WHEN withheld=1 AND cited=1 THEN 1 ELSE 0 END) wc
         FROM jit_log WHERE file NOT LIKE '#%'`).get();
    const surfaced = row?.s ?? 0;
    if (surfaced === 0)
      return null;
    const cited = row?.sc ?? 0;
    const withheld = row?.w ?? 0;
    const lift = withheld >= MIN_WITHHELD ? Math.round((cited / surfaced - (row?.wc ?? 0) / withheld) * 100) : null;
    return { surfaced, cited, lift };
  } catch {
    return null;
  }
}

export { markCited, citedStats };
