import {
  handlePostTool
} from "./session-start-7gk0vxrv.js";
import"./session-start-vec8vxxx.js";
import"./session-start-8ychq3hk.js";
import"./session-start-4hn8xrzr.js";
import"./session-start-ssxwj69m.js";
import"./session-start-w77mqkxj.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-03xp094k.js";
import"./session-start-zxs5x1we.js";
import"./session-start-rvra3cez.js";

// src/hooks/post-tool.ts
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var dataRoot = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root;
var out = handlePostTool(input, dataRoot);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
