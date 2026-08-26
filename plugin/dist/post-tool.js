import {
  handlePostTool
} from "./session-start-99j36nfj.js";
import"./session-start-qpewbbdm.js";
import"./session-start-8ychq3hk.js";
import"./session-start-f3x6ygde.js";
import"./session-start-046cybce.js";
import"./session-start-f7v10bjv.js";
import"./session-start-ag4pz1jw.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-hz9hgf2k.js";
import"./session-start-b23jq1kp.js";
import"./session-start-70d7ckvt.js";

// src/hooks/post-tool.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostTool(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
