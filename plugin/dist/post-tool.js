import {
  handlePostTool
} from "./session-start-tjewkh61.js";
import"./session-start-kv9qshcv.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-xxpp3h7f.js";
import"./session-start-046cybce.js";
import"./session-start-r4k0qmcn.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-b9p4mzc4.js";
import"./session-start-ywbay0qy.js";
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
