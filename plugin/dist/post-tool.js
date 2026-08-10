import {
  handlePostTool
} from "./session-start-fk3km3ye.js";
import"./session-start-dc48w8wb.js";
import"./session-start-8ychq3hk.js";
import"./session-start-815f2xtj.js";
import"./session-start-e2m3mbve.js";
import"./session-start-q9ahmawb.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-kwm6pash.js";
import"./session-start-yn4tr5xd.js";
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
