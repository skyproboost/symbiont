import {
  handlePostTool
} from "./session-start-v14j0fye.js";
import"./session-start-3vtd2w0e.js";
import"./session-start-8ychq3hk.js";
import"./session-start-24cc7x79.js";
import"./session-start-046cybce.js";
import"./session-start-cm20p20w.js";
import"./session-start-ktr0tyzc.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-jt5shx0g.js";
import"./session-start-1940hha9.js";
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
