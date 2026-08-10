import {
  handlePostTool
} from "./session-start-gk98t0wr.js";
import"./session-start-tsrqywmw.js";
import"./session-start-8ychq3hk.js";
import"./session-start-48reyt5v.js";
import"./session-start-g3kq6xfd.js";
import"./session-start-7z7c0h4x.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-mbakjbsp.js";
import"./session-start-daqc63bv.js";
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
