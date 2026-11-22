import {
  heaviestTokens,
  outlineTokens,
  outlineView
} from "./codex-call-psab7pqj.js";
import {
  claimNode,
  ensureFeedLog
} from "./codex-call-wy53kzbe.js";
import {
  beat,
  initLang,
  init_i18n,
  isSecretCarrier,
  openDb,
  sha1,
  shouldFeed,
  slugOf,
  t
} from "./codex-call-3wacacvb.js";

// src/hooks/post-tool-failure-core.ts
init_i18n();
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// src/hooks/rel-node.ts
import { relative } from "node:path";
var SKIP_ZONES = /(^|\/)(node_modules|\.git|\.data|dist|build|\.nuxt|vendor)(\/|$)/;
function toRelNode(cwd, filePath) {
  const rel = relative(cwd.replaceAll("\\", "/"), filePath.replaceAll("\\", "/")).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.includes(":"))
    return null;
  if (SKIP_ZONES.test(rel))
    return null;
  return rel;
}

// src/hooks/post-tool-failure-core.ts
var EDIT_FAIL_KIND = "edit-fail";
var WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
function isRejectedWrite(toolResponse) {
  return typeof toolResponse === "string" && /^\s*(Error(?::|\s|$)|<tool_use_error>)/.test(toolResponse);
}
function handlePostToolFailure(input, dataRoot, event = "PostToolUseFailure") {
  try {
    if (!WRITE_TOOLS.has(input.tool_name ?? ""))
      return {};
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath)
      return {};
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, event);
    const dbPath = join(dataDir, "passport.db");
    if (!existsSync(dbPath))
      return {};
    const rel = toRelNode(cwd, filePath);
    if (!rel)
      return {};
    if (isSecretCarrier(rel))
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
          hookEventName: event,
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

export { toRelNode, isRejectedWrite, handlePostToolFailure };
