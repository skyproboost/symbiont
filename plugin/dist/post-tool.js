import {
  handlePostTool
} from "./session-start-b2w73sf4.js";
import"./session-start-dj4fgvzp.js";
import"./session-start-8ychq3hk.js";
import"./session-start-pfyswmd8.js";
import"./session-start-m2yx435j.js";
import"./session-start-jtha3f83.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-z6xxtd7s.js";
import"./session-start-xqeg8ejq.js";
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
