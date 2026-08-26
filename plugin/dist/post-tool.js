import {
  handlePostTool
} from "./session-start-2bf71fhk.js";
import"./session-start-wwd3bw7x.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-kwsr2xpd.js";
import"./session-start-046cybce.js";
import"./session-start-1cqw2caa.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-0zc82bg9.js";
import"./session-start-dx0v6ppa.js";
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
