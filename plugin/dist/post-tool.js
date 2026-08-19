import {
  handlePostTool
} from "./session-start-qw9am39n.js";
import"./session-start-b3baeev6.js";
import"./session-start-8ychq3hk.js";
import"./session-start-3yxeyg4e.js";
import"./session-start-046cybce.js";
import"./session-start-zk21vbx4.js";
import"./session-start-330h1f5t.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-25e3w7d2.js";
import"./session-start-anv3kp9x.js";
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
