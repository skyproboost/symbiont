import {
  handlePostTool
} from "./session-start-4zqxejba.js";
import"./session-start-g1bzfztz.js";
import"./session-start-8ychq3hk.js";
import"./session-start-f416vzn2.js";
import"./session-start-6c4w21x4.js";
import"./session-start-pf07v2xa.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-9rqh6363.js";
import"./session-start-0svyw48g.js";
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
