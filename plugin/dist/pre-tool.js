import {
  toRelNode
} from "./session-start-xz2k47an.js";
import"./session-start-7nqwdg85.js";
import"./session-start-8ychq3hk.js";
import {
  claimNode,
  ensureFeedLog,
  nodeBrief
} from "./session-start-h0v4bf5q.js";
import"./session-start-62swq0w9.js";
import"./session-start-w5at5vwx.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  heaviestTokens,
  outlineTokens,
  outlineView
} from "./session-start-n4jed5qc.js";
import {
  resolveDataRoot
} from "./session-start-4dzffwrx.js";
import {
  beat,
  init_i18n,
  openDb,
  sha1,
  shouldFeed,
  slugOf,
  t
} from "./session-start-sh8zj220.js";
import"./session-start-70d7ckvt.js";

// src/hooks/pre-tool.ts
import { join as join2 } from "node:path";

// src/hooks/pre-tool-core.ts
init_i18n();
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var PRE_READ_KIND = "pre-read";
var MIN_FILE_CHARS = 4000;
function renderOutlineOffer(file, symbols, wholeTokens, outlineCost, heaviest) {
  return t(`- структура уже разобрана: ${symbols} символов · файл целиком ≈${wholeTokens}t, оглавление ≈${outlineCost}t, самый большой символ ≈${heaviest}t — passport_outline("${file}"), затем passport_unfold(file, symbol)`, `- structure already parsed: ${symbols} symbols · whole file ≈${wholeTokens}t, outline ≈${outlineCost}t, largest symbol ≈${heaviest}t — passport_outline("${file}"), then passport_unfold(file, symbol)`);
}
function handlePreTool(input, dataRoot) {
  try {
    if (input.tool_name !== "Read")
      return {};
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath)
      return {};
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    beat(dataDir, "PreToolUse");
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const rel = toRelNode(cwd, filePath);
    if (!rel)
      return {};
    let content = null;
    try {
      content = readFileSync(join(cwd, rel), "utf8");
    } catch {
      content = null;
    }
    if (content === null || content.length < MIN_FILE_CHARS)
      return {};
    const db = openDb(dbPath);
    try {
      if (!shouldFeed(db, PRE_READ_KIND))
        return {};
      const sid = input.session_id ?? "manual";
      const lines = [];
      const node = db.query("SELECT file, in_deg, out_deg FROM graph_nodes WHERE file = ?").get(rel);
      const view = outlineView(db, rel, () => content, sha1);
      const cost = outlineTokens(view.rows);
      const offer = view.fresh && view.rows.length > 0 && cost * 2 < view.wholeFileTokens ? renderOutlineOffer(rel, view.rows.length, view.wholeFileTokens, cost, heaviestTokens(view.rows)) : "";
      if (!node && !offer)
        return {};
      ensureFeedLog(db);
      if (!claimNode(db, sid, rel, PRE_READ_KIND))
        return {};
      if (node)
        lines.push(`- ${nodeBrief(db, node)}`);
      if (offer)
        lines.push(offer);
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
var dataRoot = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePreTool(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
