import {
  handlePostTool
} from "./session-start-xz2k47an.js";
import"./session-start-7nqwdg85.js";
import"./session-start-8ychq3hk.js";
import"./session-start-h0v4bf5q.js";
import"./session-start-62swq0w9.js";
import"./session-start-w5at5vwx.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-4dzffwrx.js";
import"./session-start-sh8zj220.js";
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
