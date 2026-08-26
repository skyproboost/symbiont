import {
  toRelNode
} from "./session-start-f6jkdtrr.js";
import"./session-start-6vfyfrmt.js";
import {
  heaviestTokens,
  outlineTokens,
  outlineView
} from "./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import {
  claimNode,
  ensureFeedLog
} from "./session-start-p1t5vyb4.js";
import"./session-start-046cybce.js";
import"./session-start-ehh2y93s.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-j1yy7aw2.js";
import {
  beat,
  initLang,
  init_i18n,
  openDb,
  sha1,
  shouldFeed,
  slugOf,
  t
} from "./session-start-nhshhf7v.js";
import"./session-start-70d7ckvt.js";

// src/hooks/post-tool-failure.ts
import { join as join2 } from "node:path";

// src/hooks/post-tool-failure-core.ts
init_i18n();
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var EDIT_FAIL_KIND = "edit-fail";
var WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
function handlePostToolFailure(input, dataRoot) {
  try {
    if (!WRITE_TOOLS.has(input.tool_name ?? ""))
      return {};
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath)
      return {};
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "PostToolUseFailure");
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
    if (content === null)
      return {};
    const db = openDb(dbPath);
    try {
      if (!shouldFeed(db, EDIT_FAIL_KIND))
        return {};
      const sid = input.session_id ?? "manual";
      const view = outlineView(db, rel, () => content, sha1);
      if (!view || !view.fresh || view.rows.length === 0)
        return {};
      ensureFeedLog(db);
      if (!claimNode(db, sid, `#editfail:${rel}`, EDIT_FAIL_KIND))
        return {};
      const cost = outlineTokens(view.rows);
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUseFailure",
          additionalContext: t(`Symbiont · правка ${rel} не прошла — обычная причина: файл на диске разошёлся с тем, что о нём помнится. Структура файла уже разобрана и СВЕЖА (сверено хэшем): ${view.rows.length} символов · оглавление ≈${cost}t, самый большой символ ≈${heaviestTokens(view.rows)}t против файла целиком ≈${view.wholeFileTokens}t — passport_outline("${rel}"), затем passport_unfold(file, symbol) дешевле полного перечитывания.`, `Symbiont · the edit of ${rel} failed — the usual cause: the file on disk diverged from what is remembered about it. Its structure is already parsed and FRESH (hash-verified): ${view.rows.length} symbols · outline ≈${cost}t, largest symbol ≈${heaviestTokens(view.rows)}t versus the whole file ≈${view.wholeFileTokens}t — passport_outline("${rel}"), then passport_unfold(file, symbol) is cheaper than re-reading it all.`)
        }
      };
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

// src/hooks/post-tool-failure.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostToolFailure(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
