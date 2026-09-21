import {
  evidenceFromTranscript,
  runHistory,
  searchChurn
} from "./session-start-39yre5nk.js";
import {
  readGateMode,
  readOutlineMode
} from "./session-start-yvd28w11.js";
import {
  toRelNode,
  touchFeed
} from "./session-start-7p6dq8x2.js";
import"./session-start-21v95psk.js";
import {
  heaviestTokens,
  outlineTokens,
  outlineView
} from "./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import {
  OUTLINE_KIND,
  claimNode,
  ensureFeedLog,
  outlineKey
} from "./session-start-85cb26mf.js";
import"./session-start-046cybce.js";
import"./session-start-csgqgc86.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-t78rng83.js";
import {
  ENTITY_EXT,
  beat,
  inDerivedZone,
  initLang,
  init_i18n,
  init_walk,
  isConfigFile,
  isSecretCarrier,
  openDb,
  sha1,
  shouldFeed,
  slugOf,
  t
} from "./session-start-35d1d2f1.js";
import"./session-start-70d7ckvt.js";

// src/hooks/pre-tool.ts
import { join as join3 } from "node:path";

// src/hooks/pre-tool-core.ts
init_i18n();
import { existsSync as existsSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/hooks/commit-core.ts
init_i18n();
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
init_walk();
var COMMIT_COMMAND = /\bgit\s+(?:-[Cc]\s+\S+\s+)*commit(?![\w-])(?![^\n;&|]*--dry-run)/;
var isCommitCommand = (command) => COMMIT_COMMAND.test(command);
var PARTNER_CONFIDENCE = 0.9;
var PARTNER_SUPPORT = 5;
var MAX_PARTNERS = 3;
function missingPartners(db, edited, touched) {
  const out = [];
  try {
    const total = db.query("SELECT n FROM cochange_totals WHERE file=?");
    const pairs = db.query("SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n FROM cochange WHERE (file_a = ? OR file_b = ?) AND n >= ?");
    for (const file of edited) {
      const n = total.get(file)?.n ?? 0;
      if (n < PARTNER_SUPPORT)
        continue;
      for (const p of pairs.all(file, file, file, PARTNER_SUPPORT)) {
        if (p.n / n < PARTNER_CONFIDENCE || touched.has(p.partner))
          continue;
        if (inDerivedZone(p.partner) || isSecretCarrier(p.partner))
          continue;
        const seen = out.find((m) => m.partner === p.partner);
        if (seen && seen.together / seen.total >= p.n / n)
          continue;
        if (seen)
          out.splice(out.indexOf(seen), 1);
        out.push({ file, partner: p.partner, together: p.n, total: n });
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.together / b.total - a.together / a.total).slice(0, MAX_PARTNERS);
}
function workTree(cwd) {
  const none = { dirty: new Set, staged: new Set, readable: false };
  try {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", timeout: 8000, windowsHide: true });
    if (r.status !== 0 || typeof r.stdout !== "string")
      return none;
    const dirty = new Set;
    const staged = new Set;
    for (const l of r.stdout.split(`
`)) {
      if (l.length <= 3)
        continue;
      const file = l.slice(3).split(" -> ").pop().trim();
      dirty.add(file);
      if (l[0] !== " " && l[0] !== "?")
        staged.add(file);
    }
    return { dirty, staged, readable: true };
  } catch {
    return none;
  }
}
var STAGES_ITSELF = /\bgit\s+(?:-[Cc]\s+\S+\s+)*add\b|\bcommit(?![\w-])[^\n;&|]*\s-[a-zA-Z]*a/;
function commitSet(command, tree) {
  return STAGES_ITSELF.test(command) ? tree.dirty : tree.staged;
}
var samePathKey = (p) => p.replace(/^['"]|['"]$/g, "").replaceAll("\\", "/").replace(/^\/([a-zA-Z])\//, "$1:/").replace(/\/+$/, "").toLowerCase();
function commitsElsewhere(command, cwd) {
  const here = samePathKey(cwd);
  const targets = [...command.matchAll(/(?:^|[;&|\n(]\s*)cd\s+("[^"]+"|'[^']+'|\S+)|\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/g)].map((m) => samePathKey(m[1] ?? m[2]));
  return targets.some((p) => p !== here && p !== ".");
}
function handleCommitGate(input, dataRoot) {
  try {
    const command = String(input.tool_input?.command ?? "");
    if (!isCommitCommand(command))
      return {};
    const cwd = input.cwd ?? process.cwd();
    if (commitsElsewhere(command, cwd))
      return {};
    const dataDir = join(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "PreToolUse");
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const db = openDb(dbPath);
    try {
      const sid = input.session_id ?? "manual";
      let own = [];
      try {
        own = db.query("SELECT file FROM session_edits WHERE session_id=?").all(sid).map((r) => r.file);
      } catch {
        own = [];
      }
      if (own.length === 0)
        return {};
      let transcript = input.transcript_path ?? null;
      if (!transcript) {
        try {
          transcript = db.query("SELECT transcript_path FROM sessions WHERE session_id=?").get(sid)?.transcript_path ?? null;
        } catch {
          transcript = null;
        }
      }
      const tree = workTree(cwd);
      const going = commitSet(command, tree);
      const inCommit = tree.readable ? own.filter((f) => going.has(f)) : own;
      if (inCommit.length === 0)
        return {};
      const evidence = [];
      const codeOwn = new Set(inCommit.filter((f) => !ENTITY_EXT.has(extname(f).toLowerCase()) && !isConfigFile(f) && !inDerivedZone(f)));
      let hasTests = false;
      try {
        hasTests = codeOwn.size > 0 && db.query("SELECT COUNT(*) n FROM graph_nodes WHERE file LIKE '%test%' OR file LIKE '%spec%'").get().n > 0;
      } catch {
        hasTests = false;
      }
      if (hasTests) {
        const toRel = (abs) => toRelNode(cwd, abs);
        const ev = evidenceFromTranscript(transcript, codeOwn, toRel);
        if (ev.readable && ev.uncheckedFiles.length > 0) {
          const files = [...ev.uncheckedFiles].sort();
          const shown = `${files.slice(0, 4).join(", ")}${files.length > 4 ? `, … (+${files.length - 4})` : ""}`;
          evidence.push(t(`- после последней правки проверка не запускалась (${shown})`, `- no check was run after the last edit (${shown})`));
        } else if (ev.readable && runHistory(transcript, toRel).lastRun === "red") {
          evidence.push(t("- последняя проверка упала, зелёного прогона после неё не было", "- the last check failed and no green run followed it"));
        }
      }
      const touched = new Set([...own, ...tree.dirty]);
      const partners = missingPartners(db, inCommit.filter((f) => !inDerivedZone(f)), touched).filter((m) => existsSync(join(cwd, m.partner))).map((m) => t(`- ${m.partner} исторически меняется вместе с ${m.file} (${m.together} из ${m.total} коммитов) — в этой сессии не тронут`, `- ${m.partner} has historically changed together with ${m.file} (${m.together} of ${m.total} commits) — untouched in this session`));
      const lines = [...evidence, ...partners];
      if (lines.length === 0)
        return {};
      db.run("CREATE TABLE IF NOT EXISTS gate_log(session_id TEXT NOT NULL, file TEXT NOT NULL, law TEXT NOT NULL, PRIMARY KEY(session_id, file, law))");
      const fresh = Number(db.query("INSERT OR IGNORE INTO gate_log(session_id, file, law) VALUES(?,?,?)").run(sid, "#коммит", sha1(lines.join(`
`))).changes) > 0;
      if (!fresh)
        return {};
      if (evidence.length > 0 && readGateMode(dataDir) === "block") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: t(`Symbiont · коммит отложен (режим блокировки): на этом состоянии нет доказательства.
${lines.join(`
`)}
Запусти проверку и повтори коммит. Если проверка здесь не нужна — повтори ту же команду: второй раз она не отменяется, а владельцу стоит сказать почему.`, `Symbiont · the commit is held back (blocking mode): there is no evidence for this state.
${lines.join(`
`)}
Run the check and commit again. If no check is needed here, repeat the same command: it is not cancelled twice — and tell the owner why.`)
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: t(`Symbiont · перед коммитом (ничего не блокируется — состояние на этот момент):
${lines.join(`
`)}`, `Symbiont · before the commit (nothing is blocked — the state at this moment):
${lines.join(`
`)}`)
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/pre-tool-core.ts
var PRE_READ_KIND = "pre-read";
var MIN_FILE_CHARS = 4000;
var CHURN_STEPS = 8;
function renderOutlineDenial(file, rows, wholeTokens) {
  const list = rows.slice(0, 40).map((r) => `  ${r.line}-${r.endLine} ${r.kind} ${r.name}`).join(`
`);
  const more = rows.length > 40 ? t(`
  … ещё ${rows.length - 40}`, `
  … ${rows.length - 40} more`) : "";
  return t(`Symbiont · ${file} целиком ≈${wholeTokens}t — вместо этого его оглавление (строки · вид · имя):
${list}${more}
` + `Прочитай нужный диапазон: Read(file_path, offset, limit). Нужен весь файл — повтори тот же Read, второй раз он не отменяется.`, `Symbiont · ${file} in full ≈${wholeTokens}t — here is its outline instead (lines · kind · name):
${list}${more}
` + `Read the range you need: Read(file_path, offset, limit). If you need the whole file, repeat the same Read — it is not cancelled twice.`);
}
function writtenBySession(db, sid, rel) {
  try {
    return db.query("SELECT 1 FROM session_edits WHERE session_id=? AND file=?").get(sid, rel) !== null;
  } catch {
    return false;
  }
}
function renderOutlineOffer(file, symbols, wholeTokens, outlineCost, heaviest) {
  return t(`- структура уже разобрана: ${symbols} символов · файл целиком ≈${wholeTokens}t, оглавление ≈${outlineCost}t, самый большой символ ≈${heaviest}t — passport_outline("${file}"), затем passport_unfold(file, symbol)`, `- structure already parsed: ${symbols} symbols · whole file ≈${wholeTokens}t, outline ≈${outlineCost}t, largest symbol ≈${heaviest}t — passport_outline("${file}"), then passport_unfold(file, symbol)`);
}
function handlePreTool(input, dataRoot) {
  try {
    if (input.tool_name === "Bash" || input.tool_name === "PowerShell")
      return handleCommitGate(input, dataRoot);
    if (input.tool_name !== "Read")
      return {};
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath)
      return {};
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join2(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "PreToolUse");
    const dbPath = join2(dataDir, "passport.db");
    if (!existsSync2(dbPath))
      return {};
    const rel = toRelNode(cwd, filePath);
    if (!rel)
      return {};
    let content = null;
    try {
      content = readFileSync(join2(cwd, rel), "utf8");
    } catch {
      content = null;
    }
    if (content === null)
      return {};
    const db = openDb(dbPath);
    try {
      if (!shouldFeed(db, PRE_READ_KIND))
        return {};
      const sid = input.session_id ?? "manual";
      const lines = touchFeed(db, sid, rel, PRE_READ_KIND);
      try {
        if (input.transcript_path && shouldFeed(db, "delegate")) {
          const churn = searchChurn(input.transcript_path, (abs) => toRelNode(cwd, abs));
          if (churn.steps >= CHURN_STEPS) {
            ensureFeedLog(db);
            if (claimNode(db, sid, `#delegate:churn:${Math.floor(churn.steps / CHURN_STEPS)}`, "delegate")) {
              const seed = churn.files.slice(0, 5).join(", ");
              lines.push(t(`- разведка без правки: ${churn.steps} шагов поиска и чтения подряд${seed ? ` (${seed})` : ""} — задача шире одного окна: Explore-сабагент с этим сидом вернёт выжимку дешевле, чем чтение всего сюда`, `- exploration without an edit: ${churn.steps} consecutive search/read steps${seed ? ` (${seed})` : ""} — the task is wider than one window: an Explore subagent with this seed returns a digest cheaper than reading everything here`));
            }
          }
        }
      } catch {}
      const view = content.length >= MIN_FILE_CHARS ? outlineView(db, rel, () => content, sha1) : null;
      const cost = view ? outlineTokens(view.rows) : 0;
      const offer = view && view.fresh && view.rows.length > 0 && cost * 2 < view.wholeFileTokens ? renderOutlineOffer(rel, view.rows.length, view.wholeFileTokens, cost, heaviestTokens(view.rows)) : "";
      if (offer) {
        ensureFeedLog(db);
        const fresh = claimNode(db, sid, outlineKey(rel), OUTLINE_KIND);
        const wholeRead = input.tool_input?.offset === undefined && input.tool_input?.limit === undefined;
        if (fresh && wholeRead && view && readOutlineMode(dataDir) === "deny" && !writtenBySession(db, sid, rel)) {
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: [renderOutlineDenial(rel, view.rows, view.wholeFileTokens), ...lines].join(`
`)
            }
          };
        }
        if (fresh)
          lines.push(offer);
      }
      if (lines.length === 0)
        return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: t(`Symbiont · до чтения ${rel} (ничего не блокируется — это то, что уже известно):
${lines.join(`
`)}`, `Symbiont · before reading ${rel} (nothing is blocked — this is what is already known):
${lines.join(`
`)}`)
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/pre-tool.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join3(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePreTool(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
