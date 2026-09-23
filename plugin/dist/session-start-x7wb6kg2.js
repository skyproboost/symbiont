import {
  init_i18n,
  t
} from "./session-start-r66a8rwv.js";

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

// src/gardener/feed-cost.ts
init_i18n();
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
var SIGNATURE = "Symbiont";
var SEEN_IDS = 64;
var MIN_SESSIONS = 3;
function ensureTable(db) {
  db.run("CREATE TABLE IF NOT EXISTS feed_cost(session_id TEXT PRIMARY KEY, byte_offset INTEGER NOT NULL, requests INTEGER NOT NULL, channels TEXT NOT NULL, seen TEXT NOT NULL, updated_at TEXT NOT NULL)");
}
function loadState(db, sid) {
  const row = db.query("SELECT byte_offset, requests, channels, seen FROM feed_cost WHERE session_id=?").get(sid);
  if (!row)
    return { offset: 0, requests: 0, channels: {}, seen: [] };
  return { offset: row.byte_offset, requests: row.requests, channels: JSON.parse(row.channels), seen: JSON.parse(row.seen) };
}
function readNewLines(path, offset) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    if (size < offset)
      return { lines: [], next: -1 };
    if (size === offset)
      return { lines: [], next: offset };
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const end = buf.lastIndexOf(10);
    if (end < 0)
      return { lines: [], next: offset };
    return { lines: buf.subarray(0, end).toString("utf8").split(`
`), next: offset + end + 1 };
  } finally {
    closeSync(fd);
  }
}
function applyLines(state, lines) {
  const channels = {};
  for (const [ch, c] of Object.entries(state.channels))
    channels[ch] = { ...c };
  const seen = [...state.seen];
  let requests = state.requests;
  for (const line of lines) {
    const boundary = line.includes('"compact_boundary"');
    const injection = !boundary && line.includes('"hook_additional_context"');
    const answer = !boundary && !injection && line.includes('"type":"assistant"');
    if (!boundary && !injection && !answer)
      continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain === true)
      continue;
    if (boundary && o.type === "system" && o.subtype === "compact_boundary") {
      for (const c of Object.values(channels))
        c.live = 0;
    } else if (injection && o.attachment?.type === "hook_additional_context" && Array.isArray(o.attachment.content)) {
      const ch = String(o.attachment.hookEvent ?? o.attachment.hookName ?? "?").split(":")[0];
      for (const text of o.attachment.content) {
        if (typeof text !== "string" || !text.includes(SIGNATURE))
          continue;
        const c = channels[ch] ??= { live: 0, once: 0, replay: 0 };
        c.live += text.length;
        c.once += text.length;
      }
    } else if (answer && o.type === "assistant" && typeof o.message?.id === "string" && !seen.includes(o.message.id)) {
      seen.push(o.message.id);
      if (seen.length > SEEN_IDS)
        seen.shift();
      requests++;
      for (const c of Object.values(channels))
        c.replay += c.live;
    }
  }
  return { offset: state.offset, requests, channels, seen };
}
function accountFeedCost(db, sid, transcriptPath, now = new Date) {
  if (!transcriptPath)
    return;
  try {
    ensureTable(db);
    let state = loadState(db, sid);
    const read = readNewLines(transcriptPath, state.offset);
    if (!read)
      return;
    if (read.next === -1) {
      state = { offset: 0, requests: 0, channels: {}, seen: [] };
      const again = readNewLines(transcriptPath, 0);
      if (!again || again.next === -1)
        return;
      state = { ...applyLines(state, again.lines), offset: again.next };
    } else {
      if (read.next === state.offset)
        return;
      state = { ...applyLines(state, read.lines), offset: read.next };
    }
    db.query("INSERT INTO feed_cost(session_id, byte_offset, requests, channels, seen, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET byte_offset=excluded.byte_offset, requests=excluded.requests, channels=excluded.channels, seen=excluded.seen, updated_at=excluded.updated_at").run(sid, state.offset, state.requests, JSON.stringify(state.channels), JSON.stringify(state.seen), now.toISOString());
  } catch {}
}
function feedCostStats(db) {
  try {
    const rows = db.query("SELECT channels FROM feed_cost WHERE requests > 0").all();
    if (rows.length < MIN_SESSIONS)
      return null;
    let once = 0;
    let replay = 0;
    const byChannel = new Map;
    for (const r of rows) {
      for (const [ch, c] of Object.entries(JSON.parse(r.channels))) {
        once += c.once;
        replay += c.replay;
        byChannel.set(ch, (byChannel.get(ch) ?? 0) + c.replay);
      }
    }
    if (once === 0)
      return null;
    const best = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      sessions: rows.length,
      oncePerSession: Math.round(once / rows.length),
      replayPerSession: Math.round(replay / rows.length),
      top: best && replay > 0 ? { channel: best[0], share: Math.round(best[1] / replay * 100) } : null
    };
  } catch {
    return null;
  }
}
function kilo(chars) {
  const k = chars / 1000;
  return k >= 100 ? String(Math.round(k)) : k.toFixed(1);
}
function renderFeedCost(s) {
  if (!s)
    return "";
  const factor = s.oncePerSession > 0 ? Math.round(s.replayPerSession / s.oncePerSession) : 0;
  const top = s.top ? t(` · больше всех: ${s.top.channel} ${s.top.share}%`, ` · largest: ${s.top.channel} ${s.top.share}%`) : "";
  return t(`~${kilo(s.oncePerSession)} тыс. симв. за сессию, с повтором ~${kilo(s.replayPerSession)} тыс. (×${factor}: каждый запрос перечитывает окно до сжатия)${top} · по ${s.sessions} сессиям`, `~${kilo(s.oncePerSession)}k chars per session, ~${kilo(s.replayPerSession)}k with replay (×${factor}: every request re-reads the window until compaction)${top} · over ${s.sessions} sessions`);
}

export { markCited, citedStats, accountFeedCost, feedCostStats, renderFeedCost };
