import {
  handlePostToolFailure
} from "./codex-call-pq9pcgtz.js";
import"./codex-call-psab7pqj.js";
import"./codex-call-wy53kzbe.js";
import {
  readStdinJson
} from "./codex-call-p89re5se.js";
import {
  isInternalCall
} from "./codex-call-5s7r4262.js";
import {
  resolveDataRoot
} from "./codex-call-1chfyq5a.js";
import {
  emitHookOutput
} from "./codex-call-3wacacvb.js";
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
