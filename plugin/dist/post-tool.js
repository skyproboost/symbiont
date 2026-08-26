import {
  handlePostTool
} from "./session-start-t0zwx5ze.js";
import"./session-start-dx28qj78.js";
import"./session-start-8ychq3hk.js";
import"./session-start-najkyckc.js";
import"./session-start-046cybce.js";
import"./session-start-ycv93669.js";
import"./session-start-hn90ywdt.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-n2m5c0ss.js";
import"./session-start-z50hya0n.js";
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
