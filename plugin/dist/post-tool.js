import {
  handlePostTool
} from "./session-start-6mc13jjm.js";
import"./session-start-4v315e9p.js";
import"./session-start-8ychq3hk.js";
import"./session-start-cpvp7b7g.js";
import"./session-start-ppqgdrar.js";
import"./session-start-fk53j4ar.js";
import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-wttrst36.js";
import"./session-start-dhy2j257.js";
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
