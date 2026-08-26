import {
  communityLabels,
  communityName
} from "./session-start-046cybce.js";
import {
  jsonOnly,
  sha1
} from "./session-start-b23jq1kp.js";

// src/graph/cdigest.ts
var MIN_MEMBERS = 4;
var MIN_ROLES = 2;
var MAX_DIGEST_BATCH = 4;
var MAX_DIGEST_CHARS = 220;
function ensureDigestTables(db) {
  db.run("CREATE TABLE IF NOT EXISTS community_digest(label TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL, members_hash TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS community_member(file TEXT PRIMARY KEY, label TEXT NOT NULL)");
}
function communitiesOf(db) {
  const nodes = db.query("SELECT file FROM graph_nodes").all().map((r) => r.file);
  const edges = db.query("SELECT from_file, to_file FROM graph_edges").all().map((e) => ({ from: e.from_file, to: e.to_file }));
  const labels = communityLabels(nodes, edges);
  const groups = new Map;
  for (const [file, label] of labels) {
    const list = groups.get(label) ?? [];
    list.push(file);
    groups.set(label, list);
  }
  for (const [label, files] of groups)
    if (files.length < MIN_MEMBERS)
      groups.delete(label);
  return groups;
}
var membersHash = (files) => sha1([...files].sort().join(`
`));
function pendingDigests(db, limit = MAX_DIGEST_BATCH) {
  try {
    ensureDigestTables(db);
    const visited = new Set(db.query("SELECT file FROM node_visits").all().map((r) => r.file));
    if (visited.size === 0)
      return [];
    const out = [];
    for (const [label, members] of communitiesOf(db)) {
      if (out.length >= limit)
        break;
      if (!members.some((f) => visited.has(f)))
        continue;
      const have = db.query("SELECT members_hash FROM community_digest WHERE label=?").get(label);
      if (have && have.members_hash === membersHash(members))
        continue;
      const roles = [];
      for (const f of members) {
        const r = db.query("SELECT z1 FROM node_summary WHERE file=?").get(f);
        if (r)
          roles.push({ file: f, z1: r.z1 });
      }
      if (roles.length < MIN_ROLES)
        continue;
      out.push({ label, name: communityName(members), members, roles });
    }
    return out;
  } catch {
    return [];
  }
}
function buildDigestPrompt(pending) {
  const blocks = pending.map((p) => {
    const roles = p.roles.slice(0, 12).map((r) => `  - ${r.file}: ${r.z1}`);
    return [`Подсистема «${p.name}» (${p.members.length} файлов), известные роли файлов:`, ...roles].join(`
`);
  });
  return [
    "Ты описываешь ПОДСИСТЕМЫ проекта одной строкой каждую — по уже известным ролям их файлов.",
    "",
    "Требования к строке:",
    "- что подсистема делает для проекта в целом и за что отвечает — не пересказ ролей по файлам;",
    `- одна строка до ${MAX_DIGEST_CHARS} символов, без markdown;`,
    "- формулируй фактом, без оценок и советов.",
    "",
    ...blocks,
    "",
    jsonOnly('[{"name": "имя подсистемы как в заголовке", "digest": "назначение одной строкой"}]')
  ].join(`
`);
}
function parseDigests(text) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start)
      return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr))
      return [];
    const out = [];
    for (const r of arr) {
      if (typeof r?.name !== "string" || typeof r?.digest !== "string")
        continue;
      const digest = r.digest.replace(/\s+/g, " ").trim();
      if (digest.length >= 10)
        out.push({ name: r.name, digest: digest.slice(0, MAX_DIGEST_CHARS) });
    }
    return out;
  } catch {
    return [];
  }
}
function runCommunityDigests(db, caller, nowIso) {
  const pending = pendingDigests(db);
  if (pending.length === 0)
    return { model: null, requested: 0, stored: 0 };
  const res = caller(buildDigestPrompt(pending));
  if (!res)
    return { model: null, requested: pending.length, stored: 0 };
  const byName = new Map(parseDigests(res.text).map((d) => [d.name, d.digest]));
  let stored = 0;
  ensureDigestTables(db);
  const putDigest = db.query(`INSERT INTO community_digest(label, name, digest, members_hash, model, created_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(label) DO UPDATE SET name=excluded.name, digest=excluded.digest, members_hash=excluded.members_hash, model=excluded.model, created_at=excluded.created_at`);
  const putMember = db.query("INSERT INTO community_member(file, label) VALUES(?,?) ON CONFLICT(file) DO UPDATE SET label=excluded.label");
  for (const p of pending) {
    const digest = byName.get(p.name);
    if (!digest)
      continue;
    putDigest.run(p.label, p.name, digest, membersHash(p.members), res.model, nowIso);
    for (const f of p.members)
      putMember.run(f, p.label);
    stored++;
  }
  return { model: res.model, requested: pending.length, stored };
}
function digestForFile(db, file) {
  try {
    const m = db.query("SELECT label FROM community_member WHERE file=?").get(file);
    if (!m)
      return null;
    const d = db.query("SELECT name, digest FROM community_digest WHERE label=?").get(m.label);
    return d ? { label: m.label, name: d.name, digest: d.digest } : null;
  } catch {
    return null;
  }
}

// src/domains/grounding.ts
var GROUNDING_TTL_DAYS = 90;
function ensureGroundingTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS grounding(
       domain TEXT PRIMARY KEY, checked_at TEXT NOT NULL, correction TEXT NOT NULL, source TEXT NOT NULL)`);
}
function readGrounding(db) {
  try {
    ensureGroundingTable(db);
    return db.query("SELECT domain, checked_at, correction, source FROM grounding").all().map((r) => ({
      domain: r.domain,
      checkedAt: r.checked_at,
      correction: r.correction,
      source: r.source
    }));
  } catch {
    return [];
  }
}
function storeGrounding(db, rec) {
  try {
    ensureGroundingTable(db);
    db.query(`INSERT INTO grounding(domain, checked_at, correction, source) VALUES(?,?,?,?)
       ON CONFLICT(domain) DO UPDATE SET checked_at=excluded.checked_at, correction=excluded.correction, source=excluded.source`).run(rec.domain, rec.checkedAt, rec.correction.slice(0, 600), rec.source.slice(0, 200));
  } catch {}
}
function dueForGrounding(db, activeDomains, nowMs) {
  if (activeDomains.length === 0)
    return null;
  const byDomain = new Map(readGrounding(db).map((r) => [r.domain, r]));
  const ttlMs = GROUNDING_TTL_DAYS * 24 * 3600000;
  for (const d of activeDomains) {
    if (!byDomain.has(d))
      return d;
  }
  const stale = activeDomains.map((d) => ({ d, rec: byDomain.get(d) })).filter((x) => nowMs - Date.parse(x.rec.checkedAt) > ttlMs).sort((a, b) => Date.parse(a.rec.checkedAt) - Date.parse(b.rec.checkedAt));
  return stale.length > 0 ? stale[0].d : null;
}
function buildGroundingPrompt(domain, checklist, thresholds, source) {
  return [
    `Проверь, не устарели ли эти инженерные ориентиры по направлению «${domain}».`,
    "",
    "Текущие ориентиры (записаны ранее из официальных источников):",
    ...checklist.slice(0, 8).map((c) => `- ${c}`),
    ...thresholds.length > 0 ? ["", "Пороги:", ...thresholds.map((t) => `- ${t}`)] : [],
    "",
    `Заявленный источник: ${source}`,
    "",
    "Найди в вебе АКТУАЛЬНОЕ состояние этих стандартов и ответь строго по делу: что из перечисленного изменилось, какие числа стали другими, что признано устаревшим, что добавилось важного.",
    "",
    jsonOnly('{"changed": true|false, "correction": "что именно изменилось, с числами", "source": "ссылка или название источника"}'),
    "",
    "Если ничего существенного не изменилось — верни changed: false и пустую correction. Это нормальный и ожидаемый ответ: стандарты меняются редко, и подтверждение не менее ценно, чем поправка."
  ].join(`
`);
}
function parseGrounding(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start)
      return null;
    const o = JSON.parse(text.slice(start, end + 1));
    const changed = o.changed === true;
    const correction = typeof o.correction === "string" ? o.correction.trim() : "";
    if (changed && correction.length < 15)
      return null;
    return { changed, correction, source: typeof o.source === "string" ? o.source.trim() : "" };
  } catch {
    return null;
  }
}
function renderCorrection(rec) {
  if (!rec || !rec.correction)
    return "";
  const when = rec.checkedAt.slice(0, 10);
  return `уточнение от ${when}: ${rec.correction}${rec.source ? ` (${rec.source})` : ""}`;
}

export { pendingDigests, runCommunityDigests, digestForFile, readGrounding, storeGrounding, dueForGrounding, buildGroundingPrompt, parseGrounding, renderCorrection };
