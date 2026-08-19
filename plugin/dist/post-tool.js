import {
  handlePostTool
} from "./session-start-7n0g4vcx.js";
import"./session-start-a2zcrqzf.js";
import"./session-start-8ychq3hk.js";
import"./session-start-ttvdv0m4.js";
import"./session-start-046cybce.js";
import"./session-start-z5t05k1x.js";
import"./session-start-d6zk7zs5.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-8vcksfq2.js";
import"./session-start-ddjzc6c9.js";
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
