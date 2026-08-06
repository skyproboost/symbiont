import {
  documentsBlock,
  jsonOnly
} from "./session-start-wv0favmt.js";
import {
  __require
} from "./session-start-70d7ckvt.js";

// src/graph/zsummary.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var MAX_BATCH = 10;
var SAMPLE_CHARS = 3000;
var MAX_Z1_CHARS = 200;
function ensureSummaryTables(db) {
  db.run("CREATE TABLE IF NOT EXISTS node_summary(file TEXT PRIMARY KEY, z1 TEXT NOT NULL, content_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS node_visits(file TEXT PRIMARY KEY, visits INTEGER NOT NULL, last_at TEXT NOT NULL)");
}
function markVisited(db, file, nowIso) {
  try {
    ensureSummaryTables(db);
    db.query("INSERT INTO node_visits(file, visits, last_at) VALUES(?,1,?) ON CONFLICT(file) DO UPDATE SET visits=visits+1, last_at=excluded.last_at").run(file, nowIso);
  } catch {}
}
function summaryFor(db, file, contentHash) {
  try {
    const row = db.query("SELECT z1, content_hash FROM node_summary WHERE file=?").get(file);
    if (!row)
      return null;
    if (contentHash && row.content_hash !== contentHash)
      return null;
    return row.z1;
  } catch {
    return null;
  }
}
function contentHashOf(db, file) {
  try {
    const row = db.query("SELECT hash FROM file_cache WHERE path=?").get(file);
    return row ? row.hash : null;
  } catch {
    return null;
  }
}
function contentHashes(db) {
  const out = new Map;
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='file_cache'").get().n > 0;
    if (!has)
      return out;
    for (const r of db.query("SELECT path, hash FROM file_cache").all()) {
      out.set(r.path, r.hash);
    }
  } catch {}
  return out;
}
function pendingSummaries(db, hashes, limit = MAX_BATCH) {
  try {
    ensureSummaryTables(db);
    const rows = db.query(`SELECT v.file AS file, v.visits AS visits, s.content_hash AS have
         FROM node_visits v LEFT JOIN node_summary s ON s.file = v.file
         ORDER BY v.visits DESC, v.last_at DESC`).all();
    const out = [];
    for (const r of rows) {
      if (out.length >= limit)
        break;
      const fresh = r.have !== null && r.have === (hashes.get(r.file) ?? r.have);
      if (fresh)
        continue;
      out.push({ file: r.file, visits: r.visits });
    }
    return out;
  } catch {
    return [];
  }
}
function buildSummaryPrompt(samples) {
  return [
    "Ты описываешь роль файлов в проекте одной строкой каждый — для карты проекта, которую читает другой инженер.",
    "",
    "Требования к строке:",
    "- зачем файл существует и что он держит: строку читает инженер, которому нужно решить, открывать ли файл, а пересказ кода построчно на этот вопрос не отвечает;",
    "- максимально конкретно: named сущности, ответственность, чем он является для остальных;",
    `- одна строка до ${MAX_Z1_CHARS} символов, без markdown, без имени файла в начале;`,
    "- формулируй фактом, без оценок и советов.",
    "",
    "Файлы:",
    documentsBlock(samples),
    "",
    jsonOnly('[{"file": "путь как в заголовке", "z1": "роль файла одной строкой"}]')
  ].join(`
`);
}
var asSummary = (file, z1) => {
  if (typeof file !== "string" || typeof z1 !== "string")
    return null;
  const text = z1.replace(/\s+/g, " ").trim();
  return text.length >= 10 ? { file, z1: text.slice(0, MAX_Z1_CHARS) } : null;
};
function salvageSummaries(text) {
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*?"file"\s*:\s*"([^"]+)"[^{}]*?"z1"\s*:\s*"([\s\S]*?)"\s*\}/g)) {
    const s = asSummary(m[1], m[2]);
    if (s)
      out.push(s);
  }
  return out;
}
function parseSummaries(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start)
    return [];
  const slice = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr))
      return [];
    const out = [];
    for (const r of arr) {
      const s = asSummary(r?.file, r?.z1);
      if (s)
        out.push(s);
    }
    return out;
  } catch {
    return salvageSummaries(slice);
  }
}
function storeSummary(db, s, contentHash, model, nowIso) {
  ensureSummaryTables(db);
  db.query(`INSERT INTO node_summary(file, z1, content_hash, model, created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(file) DO UPDATE SET z1=excluded.z1, content_hash=excluded.content_hash, model=excluded.model, created_at=excluded.created_at`).run(s.file, s.z1, contentHash, model, nowIso);
}
function runZSummaries(db, projectRoot, caller, nowIso = new Date().toISOString(), limit = MAX_BATCH, dataDir = null) {
  const hashes = contentHashes(db);
  const pending = pendingSummaries(db, hashes, limit);
  if (pending.length === 0)
    return { model: null, requested: 0, stored: 0 };
  const samples = [];
  for (const p of pending) {
    const abs = join(projectRoot, p.file);
    if (!existsSync(abs))
      continue;
    try {
      samples.push({ file: p.file, content: readFileSync(abs, "utf8").slice(0, SAMPLE_CHARS) });
    } catch {
      continue;
    }
  }
  if (samples.length === 0)
    return { model: null, requested: pending.length, stored: 0 };
  const res = caller(buildSummaryPrompt(samples));
  if (!res)
    return { model: null, requested: pending.length, stored: 0 };
  const known = new Set(samples.map((s) => s.file));
  const parsed = parseSummaries(res.text);
  let stored = 0;
  for (const s of parsed) {
    if (!known.has(s.file))
      continue;
    storeSummary(db, s, hashes.get(s.file) ?? "", res.model, nowIso);
    stored++;
  }
  if (dataDir) {
    try {
      const { writeFileSync } = __require("node:fs");
      const missed = samples.map((s) => s.file).filter((f) => !parsed.some((p) => p.file === f));
      writeFileSync(join(dataDir, "zsummary-last.json"), JSON.stringify({ model: res.model, at: nowIso, asked: samples.map((s) => s.file), missed, raw: res.text }, null, 1), "utf8");
    } catch {}
  }
  return { model: res.model, requested: pending.length, stored };
}
function summaryStats(db) {
  try {
    ensureSummaryTables(db);
    const have = db.query("SELECT COUNT(*) n FROM node_summary").get().n;
    const pending = pendingSummaries(db, contentHashes(db), 1000).length;
    return { have, pending };
  } catch {
    return { have: 0, pending: 0 };
  }
}

// src/gardener/lessons.ts
function zoneOf(file) {
  const norm = file.replaceAll("\\", "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? "(корень)" : norm.slice(0, i);
}
function ensureLessons(db) {
  db.run(`CREATE TABLE IF NOT EXISTS lessons(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone TEXT NOT NULL,
      statement TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(zone, statement)
    )`);
}
function recordLesson(db, zone, statement, source, now) {
  ensureLessons(db);
  db.query("INSERT INTO lessons(zone, statement, source, created_at) VALUES(?,?,?,?) ON CONFLICT(zone, statement) DO UPDATE SET created_at=excluded.created_at, source=excluded.source").run(zone, statement, source, now);
}
function lessonsForZones(db, zones, limit) {
  if (zones.length === 0)
    return [];
  const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get().n > 0;
  if (!has)
    return [];
  const uniq = [...new Set(zones)];
  const placeholders = uniq.map(() => "?").join(",");
  return db.query(`SELECT zone, statement, source, created_at FROM lessons WHERE zone IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`).all(...uniq, limit);
}
function countLessons(db) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get().n > 0;
    return has ? db.query("SELECT COUNT(*) n FROM lessons").get().n : 0;
  } catch {
    return 0;
  }
}

export { markVisited, summaryFor, contentHashOf, contentHashes, pendingSummaries, runZSummaries, summaryStats, zoneOf, recordLesson, lessonsForZones, countLessons };
