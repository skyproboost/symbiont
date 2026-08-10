import {
  handlePostTool
} from "./session-start-f1csjz9h.js";
import"./session-start-ys8jgfm9.js";
import"./session-start-8ychq3hk.js";
import"./session-start-92cnawjf.js";
import"./session-start-rdsv7g75.js";
import"./session-start-h1qnc55z.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-p44w5sd7.js";
import"./session-start-e05q8p5h.js";
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
