import {
  handlePostToolFailure
} from "./codex-call-peq4c7qm.js";
import"./codex-call-psab7pqj.js";
import"./codex-call-dfpy0wrg.js";
import {
  readStdinJson
} from "./codex-call-p89re5se.js";
import {
  isInternalCall
} from "./codex-call-5s7r4262.js";
import {
  resolveDataRoot
} from "./codex-call-pxxba9as.js";
import {
  emitHookOutput
} from "./codex-call-qxxgrqz0.js";
import"./codex-call-b1s33asb.js";
import"./codex-call-rvra3cez.js";

// src/hooks/post-tool-failure.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostToolFailure(input, dataRoot);
if (out.hookSpecificOutput)
  emitHookOutput(out, "PostToolUseFailure", dataRoot, input.cwd);
