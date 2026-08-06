import {
  jsonOnly
} from "./session-start-wv0favmt.js";

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

export { readGrounding, storeGrounding, dueForGrounding, buildGroundingPrompt, parseGrounding, renderCorrection };
