import {
  handlePostTool
} from "./session-start-52pb3aaw.js";
import"./session-start-t8e41w9c.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-8jryvzx3.js";
import"./session-start-046cybce.js";
import"./session-start-54m9r494.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-57mz5gat.js";
import {
  emitHookOutput
} from "./session-start-8rqex817.js";
import"./session-start-70d7ckvt.js";

// src/hooks/post-tool.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostTool(input, dataRoot);
if (out.hookSpecificOutput)
  emitHookOutput(out, "PostToolUse", dataRoot, input.cwd);
