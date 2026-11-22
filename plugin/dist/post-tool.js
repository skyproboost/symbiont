import {
  handlePostTool
} from "./codex-call-thkw2csq.js";
import"./codex-call-pwyqcsmb.js";
import"./codex-call-8ychq3hk.js";
import"./codex-call-046cybce.js";
import"./codex-call-vgezmhw1.js";
import"./codex-call-pq9pcgtz.js";
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

// src/hooks/post-tool.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostTool(input, dataRoot);
if (out.hookSpecificOutput)
  emitHookOutput(out, "PostToolUse", dataRoot, input.cwd);
