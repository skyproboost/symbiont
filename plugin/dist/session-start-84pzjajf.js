import {
  init_i18n,
  t
} from "./session-start-b23jq1kp.js";

// src/core/models.ts
init_i18n();
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var FAMILY_PRIORITY = {
  deep: ["fable", "opus", "sonnet", "haiku"],
  routine: ["haiku", "sonnet", "opus", "fable"]
};
var UNAVAILABLE_STATUSES = new Set([401, 403, 404]);
var FRESH_DAYS = 14;
var LIMIT_STATUSES = new Set([429]);
var LIMIT_COOLDOWN_MS = 60 * 60000;
var LIMIT_WORDS = /(usage|rate)[\s-]?limit|limit reached|quota|too many requests|out of credit/i;
function parseResetHint(text, nowMs) {
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m)
    return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59)
    return null;
  if (meridiem === "pm" && hour < 12)
    hour += 12;
  if (meridiem === "am" && hour === 12)
    hour = 0;
  const at = new Date(nowMs);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= nowMs)
    at.setDate(at.getDate() + 1);
  return at.toISOString();
}
var AVAIL_FILE = "model-availability.json";
function readAvailability(dataDir) {
  try {
    const p = join(dataDir, AVAIL_FILE);
    if (!existsSync(p))
      return {};
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeAvailability(dataDir, data) {
  try {
    writeFileSync(join(dataDir, AVAIL_FILE), JSON.stringify(data, null, 2), "utf8");
  } catch {}
}
function classify(prev, out) {
  const base = prev ?? { alias: "", status: "unknown", resolvedId: null, checkedAt: out.now, note: "", until: null };
  if (out.ok) {
    return { ...base, status: "alive", resolvedId: out.resolvedId ?? base.resolvedId, checkedAt: out.now, note: out.note, until: null };
  }
  if (out.apiErrorStatus != null && UNAVAILABLE_STATUSES.has(out.apiErrorStatus)) {
    return { ...base, status: "dead", checkedAt: out.now, note: `api=${out.apiErrorStatus} ${out.note}`.trim(), until: null };
  }
  const limited = out.apiErrorStatus != null && LIMIT_STATUSES.has(out.apiErrorStatus) || LIMIT_WORDS.test(out.note);
  if (limited) {
    const nowMs = Date.parse(out.now);
    const until = parseResetHint(out.note, nowMs) ?? new Date(nowMs + LIMIT_COOLDOWN_MS).toISOString();
    return { ...base, status: "limited", checkedAt: out.now, note: `лимит: ${out.note}`.trim(), until };
  }
  return { ...base, checkedAt: out.now, note: `транзиент: ${out.note}`.trim(), until: base.until ?? null };
}
function recordOutcome(dataDir, alias, out) {
  const data = readAvailability(dataDir);
  const next = classify(data[alias], out);
  next.alias = alias;
  data[alias] = next;
  writeAvailability(dataDir, data);
}
var freshStatus = (a, now) => {
  if (!a)
    return "unknown";
  const age = now - Date.parse(a.checkedAt);
  if (!Number.isFinite(age) || age > FRESH_DAYS * 86400000)
    return "unknown";
  if (a.status === "limited") {
    const until = a.until ? Date.parse(a.until) : NaN;
    if (!Number.isFinite(until) || until <= now)
      return "unknown";
  }
  return a.status;
};
function resolveVector(intent, avail, nowMs) {
  const base = FAMILY_PRIORITY[intent];
  const penalty = (alias) => {
    const s = freshStatus(avail[alias], nowMs);
    return s === "dead" ? 2 : s === "limited" ? 1 : 0;
  };
  return base.map((alias, i) => ({ alias, i, rank: penalty(alias) })).sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.alias);
}
var NET_FILE = "network-state.json";
var NETWORK_WORDS = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENETDOWN|EHOSTUNREACH|getaddrinfo|fetch failed|socket hang up|network is unreachable|connection error/i;
var OFFLINE_COOLDOWN_MS = 5 * 60000;
var looksLikeNetworkFailure = (note) => NETWORK_WORDS.test(note);
function networkDownUntil(dataDir, nowMs) {
  try {
    const p = join(dataDir, NET_FILE);
    if (!existsSync(p))
      return null;
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const until = raw?.until ? Date.parse(raw.until) : NaN;
    return Number.isFinite(until) && until > nowMs ? until : null;
  } catch {
    return null;
  }
}
function markNetworkDown(dataDir, note, nowMs) {
  try {
    writeFileSync(join(dataDir, NET_FILE), JSON.stringify({ until: new Date(nowMs + OFFLINE_COOLDOWN_MS).toISOString(), note: note.slice(0, 200), at: new Date(nowMs).toISOString() }, null, 2), "utf8");
  } catch {}
}
function clearNetworkDown(dataDir) {
  try {
    const p = join(dataDir, NET_FILE);
    if (existsSync(p))
      writeFileSync(p, JSON.stringify({ until: null, at: new Date().toISOString() }, null, 2), "utf8");
  } catch {}
}
function renderAvailability(avail, nowMs) {
  const glyph = {
    alive: t("✓ доступна", "✓ available"),
    dead: t("✗ нет доступа", "✗ no access"),
    limited: t("⏳ лимит исчерпан", "⏳ limit reached"),
    unknown: t("· не пробована", "· not tried")
  };
  const lines = [];
  for (const intent of ["deep", "routine"]) {
    const vec = resolveVector(intent, avail, nowMs);
    lines.push(`${intent}: ${vec.join(" → ")}`);
  }
  const known = Object.values(avail);
  if (known.length > 0) {
    const untried = ["fable", "opus", "sonnet", "haiku"].filter((a) => !(a in avail));
    if (untried.length > 0)
      lines.push(`  ${untried.join(", ")}: ${t("очередь до них не дошла (вектор останавливается на первой ответившей)", "the queue never reached them (the vector stops at the first model that answers)")}`);
    for (const a of known.sort((x, y) => x.alias.localeCompare(y.alias))) {
      const s = freshStatus(a, nowMs);
      const ageH = Math.round((nowMs - Date.parse(a.checkedAt)) / 3600000);
      const when = !Number.isFinite(ageH) ? "" : ageH < 1 ? t(", проверено только что", ", checked just now") : ageH < 48 ? t(`, проверено ${ageH}ч назад`, `, checked ${ageH}h ago`) : t(`, проверено ${Math.round(ageH / 24)}д назад`, `, checked ${Math.round(ageH / 24)}d ago`);
      const back = s === "limited" && a.until ? `${t(" — вернётся к ", " — back at ")}${new Date(a.until).toLocaleTimeString(t("ru-RU", "en-GB"), { hour: "2-digit", minute: "2-digit" })}` : "";
      lines.push(`  ${a.alias}: ${glyph[s]}${back}${a.resolvedId ? ` (${a.resolvedId}${when})` : ""}${s === "unknown" && a.status !== "unknown" ? t(" — устарело, перепроверится", " — stale, will be rechecked") : ""}`);
    }
  }
  return lines;
}

export { FAMILY_PRIORITY, readAvailability, recordOutcome, resolveVector, looksLikeNetworkFailure, networkDownUntil, markNetworkDown, clearNetworkDown, renderAvailability };
