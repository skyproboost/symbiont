import {
  FAMILY_PRIORITY,
  clearNetworkDown,
  looksLikeNetworkFailure,
  markNetworkDown,
  networkDownUntil,
  readAvailability,
  recordOutcome,
  resolveVector
} from "./session-start-8dgq7me2.js";
import {
  internalEnv
} from "./session-start-5s7r4262.js";
import {
  init_i18n,
  readFrame,
  t
} from "./session-start-ddjzc6c9.js";

// src/layer2/llm.ts
import { spawnSync } from "node:child_process";
init_i18n();

// src/domains/refusal.ts
var REFUSAL_MARKERS = [
  /\bI can(?:'|no)t (?:help|assist|provide|continue)/i,
  /\bI(?:'m| am) (?:unable|not able) to (?:help|assist|provide)/i,
  /не могу (?:помочь|предоставить|продолжить|выполнить)/i,
  /я не буду/i,
  /это выходит за рамки того, что я могу/i
];
function detectRefusal(parsed, text) {
  if (parsed.stop_reason === "refusal")
    return { refused: true, reason: "stop_reason=refusal" };
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return { refused: false, reason: "пустой ответ — не отказ, а сбой доставки" };
  if (trimmed.length <= 600) {
    for (const m of REFUSAL_MARKERS) {
      if (m.test(trimmed))
        return { refused: true, reason: `маркер отказа: ${m.source.slice(0, 40)}` };
    }
  }
  return { refused: false, reason: "" };
}
function ensureRefusalLog(db) {
  db.run("CREATE TABLE IF NOT EXISTS refusal_log(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, framed INTEGER NOT NULL, resolved INTEGER NOT NULL, reason TEXT NOT NULL)");
}
function recordRefusal(db, ev) {
  try {
    ensureRefusalLog(db);
    db.query("INSERT INTO refusal_log(at, model, purpose, framed, resolved, reason) VALUES(?,?,?,?,?,?)").run(ev.at ?? new Date().toISOString(), ev.model, ev.purpose, ev.framed ? 1 : 0, ev.resolved ? 1 : 0, ev.reason.slice(0, 200));
  } catch {}
}
function markRefusalsResolved(db, count) {
  if (count <= 0)
    return;
  try {
    ensureRefusalLog(db);
    db.query("UPDATE refusal_log SET resolved=1 WHERE id IN (SELECT id FROM refusal_log ORDER BY id DESC LIMIT ?)").run(count);
  } catch {}
}

// src/layer2/llm.ts
function resolveModels(opts) {
  if (opts.models && opts.models.length > 0)
    return opts.models;
  const intent = opts.intent ?? "routine";
  if (!opts.dataDir)
    return FAMILY_PRIORITY[intent];
  return resolveVector(intent, readAvailability(opts.dataDir), Date.now());
}
function resolvedIdOf(parsed) {
  const usage = parsed.modelUsage;
  if (usage && typeof usage === "object") {
    const keys = Object.keys(usage);
    if (keys.length > 0)
      return keys[0];
  }
  return null;
}
var asStatus = (v) => typeof v === "number" ? v : null;
function offlineOutcome(dataDir, nowMs) {
  const until = networkDownUntil(dataDir, nowMs);
  if (until === null)
    return null;
  const back = new Date(until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return { result: null, tried: [{ model: "—", ms: 0, ok: false, note: `сеть недоступна — следующая проба после ${back}` }] };
}
function callClaudeDetailed(prompt, opts = {}) {
  const tried = [];
  if (opts.dataDir) {
    const offline = offlineOutcome(opts.dataDir, Date.now());
    if (offline)
      return offline;
  }
  const frame = opts.dataDir ? readFrame(opts.dataDir) : "";
  const framedPrompt = `${frame ? `${frame}

---

` : ""}${prompt}

${t("Отвечай по-русски.", "Answer in English.")}`;
  const effort = opts.effort ?? (opts.intent === "deep" ? "high" : "low");
  for (const model of resolveModels(opts)) {
    const t0 = performance.now();
    try {
      const spawnOnce = (withEffort) => spawnSync("claude", [
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--max-turns",
        "1",
        "--tools",
        "",
        ...withEffort ? ["--effort", effort] : []
      ], { input: framedPrompt, encoding: "utf8", timeout: 180000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: internalEnv() });
      let r = spawnOnce(true);
      if (r.status !== 0 && /unknown option|unrecognized/i.test(String(r.stderr ?? "")))
        r = spawnOnce(false);
      let parsed = {};
      if (typeof r.stdout === "string" && r.stdout.trim()) {
        try {
          parsed = JSON.parse(r.stdout.trim());
        } catch {}
      }
      const text = typeof parsed.result === "string" ? parsed.result : "";
      const ms = Math.round(performance.now() - t0);
      const resolvedId = resolvedIdOf(parsed);
      const apiStatus = asStatus(parsed.api_error_status);
      if (parsed.is_error || !text.trim()) {
        const why = apiStatus != null ? `api=${apiStatus}` : `subtype=${parsed.subtype ?? "?"}`;
        const stderr = (r.stderr ?? "").toString().slice(0, 150);
        const note = `exit=${r.status}; ${why}; stderr: ${stderr}`;
        tried.push({ model, ms, ok: false, note });
        if (opts.dataDir && looksLikeNetworkFailure(`${note} ${text}`)) {
          markNetworkDown(opts.dataDir, note, Date.now());
          return { result: null, tried };
        }
        if (opts.dataDir) {
          recordOutcome(opts.dataDir, model, {
            ok: false,
            resolvedId,
            apiErrorStatus: apiStatus,
            note: `${why} ${text.slice(0, 200)} ${stderr}`.trim(),
            now: new Date().toISOString()
          });
        }
        continue;
      }
      const refusal = detectRefusal(parsed, text);
      if (refusal.refused) {
        tried.push({ model, ms, ok: false, note: `отказ (${refusal.reason})${frame ? " — даже с рамкой" : ""}` });
        if (opts.db) {
          recordRefusal(opts.db, {
            model: resolvedId ?? model,
            purpose: opts.purpose ?? "llm",
            framed: frame.length > 0,
            resolved: false,
            reason: refusal.reason
          });
        }
        continue;
      }
      tried.push({ model, ms, ok: true, note: `ответ ${text.length} симв.${resolvedId ? ` (${resolvedId})` : ""}` });
      if (opts.dataDir) {
        recordOutcome(opts.dataDir, model, { ok: true, resolvedId, apiErrorStatus: null, note: `${text.length} симв.`, now: new Date().toISOString() });
        clearNetworkDown(opts.dataDir);
      }
      const refusalsBefore = tried.filter((t2) => t2.note.startsWith("отказ")).length;
      if (opts.db && refusalsBefore > 0)
        markRefusalsResolved(opts.db, refusalsBefore);
      return { result: { text, model: resolvedId ?? model }, tried };
    } catch (e) {
      const note = String(e).slice(0, 200);
      tried.push({ model, ms: Math.round(performance.now() - t0), ok: false, note });
      if (opts.dataDir && looksLikeNetworkFailure(note)) {
        markNetworkDown(opts.dataDir, note, Date.now());
        return { result: null, tried };
      }
    }
  }
  return { result: null, tried };
}
function explainNoAnswer(tried) {
  if (tried.length === 0)
    return "модели недоступны: ни одной попытки не сделано";
  const offline = tried.find((t2) => /сеть недоступна/.test(t2.note));
  if (offline)
    return offline.note;
  const reason = (note) => {
    if (/api=429/.test(note) || /(usage|rate)[\s-]?limit|limit reached|quota/i.test(note))
      return "лимит исчерпан";
    if (/api=40[134]/.test(note))
      return "нет доступа";
    if (/^отказ/.test(note))
      return "отказ модели";
    if (/timeout|ETIMEDOUT|timed out/i.test(note))
      return "таймаут";
    if (/ENOENT|not found|не найден/i.test(note))
      return "claude CLI не найден";
    return "ошибка";
  };
  return `модели недоступны: ${tried.map((t2) => `${t2.model} — ${reason(t2.note)}`).join(", ")}`;
}
function callClaudeWithTools(prompt, opts = {}) {
  if (opts.dataDir && networkDownUntil(opts.dataDir, Date.now()) !== null)
    return null;
  for (const model of resolveModels(opts)) {
    try {
      const r = spawnSync("claude", ["-p", "--model", model, "--output-format", "json", "--max-turns", "24", "--tools", "WebSearch,WebFetch"], { input: prompt, encoding: "utf8", timeout: 420000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: internalEnv() });
      let parsed = {};
      if (typeof r.stdout === "string" && r.stdout.trim()) {
        try {
          parsed = JSON.parse(r.stdout.trim());
        } catch {}
      }
      const text = typeof parsed.result === "string" ? parsed.result : "";
      const resolvedId = resolvedIdOf(parsed);
      const apiStatus = asStatus(parsed.api_error_status);
      if (!parsed.is_error && text.trim()) {
        if (opts.dataDir)
          recordOutcome(opts.dataDir, model, { ok: true, resolvedId, apiErrorStatus: null, note: "ground", now: new Date().toISOString() });
        return { text, model: resolvedId ?? model };
      }
      if (opts.dataDir)
        recordOutcome(opts.dataDir, model, { ok: false, resolvedId, apiErrorStatus: apiStatus, note: "ground", now: new Date().toISOString() });
    } catch {}
  }
  return null;
}

export { callClaudeDetailed, explainNoAnswer, callClaudeWithTools };
