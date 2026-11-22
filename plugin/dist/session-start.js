import {
  readStdinJson
} from "./codex-call-p89re5se.js";
import {
  isInternalCall
} from "./codex-call-5s7r4262.js";
import {
  migrateLegacyPassports,
  resolveDataRoot
} from "./codex-call-f5867843.js";
import {
  emitHookOutput,
  handleSessionStart
} from "./codex-call-21dvb3ma.js";
import"./codex-call-b1s33asb.js";
import {
  __require
} from "./codex-call-rvra3cez.js";

// src/hooks/session-start.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var out = handleSessionStart(input, res.root);
if (out.hookSpecificOutput)
  emitHookOutput(out, "SessionStart", res.root, input.cwd);
try {
  const { spawnAutoLearnDetached } = await import("./detach-ha9aqp6w.js");
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root);
} catch {}
