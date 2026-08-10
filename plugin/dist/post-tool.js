import {
  handlePostTool
} from "./session-start-wfdes020.js";
import"./session-start-eqtg8smr.js";
import"./session-start-8ychq3hk.js";
import"./session-start-32w37wr9.js";
import"./session-start-1p1g6x0j.js";
import"./session-start-pptpkwhc.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-mxkjpptq.js";
import"./session-start-fhfq0nbs.js";
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
