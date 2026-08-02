import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  migrateLegacyPassports,
  resolveDataRoot
} from "./session-start-aqk1c5nv.js";
import {
  handleSessionStart
} from "./session-start-8w88p7pt.js";
import {
  __require,
  __toESM
} from "./session-start-70d7ckvt.js";

// src/hooks/session-start.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var out = handleSessionStart(input, res.root);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
try {
  const { spawnAutoLearnDetached } = await import("./detach-ta1rajbg.js");
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root);
} catch {}
