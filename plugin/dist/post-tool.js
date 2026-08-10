import {
  handlePostTool
} from "./session-start-1ed12f44.js";
import"./session-start-crraq3nz.js";
import"./session-start-8ychq3hk.js";
import"./session-start-brek4qna.js";
import"./session-start-5ghb5kgm.js";
import"./session-start-4kdpq2zq.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-dhyq0anx.js";
import"./session-start-q2jjr130.js";
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
