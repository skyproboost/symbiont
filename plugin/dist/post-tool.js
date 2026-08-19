import {
  handlePostTool
} from "./session-start-y14th4ky.js";
import"./session-start-k4dwr41q.js";
import"./session-start-8ychq3hk.js";
import"./session-start-r07w0qcc.js";
import"./session-start-046cybce.js";
import"./session-start-3yf8mzq3.js";
import"./session-start-p28bkwec.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-c4qexxaq.js";
import"./session-start-j3rj72xj.js";
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
