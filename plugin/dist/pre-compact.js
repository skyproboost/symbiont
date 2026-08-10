import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-jt5shx0g.js";
import {
  beat,
  initLang,
  init_i18n,
  slugOf
} from "./session-start-1940hha9.js";
import {
  __require
} from "./session-start-rvra3cez.js";

// src/hooks/pre-compact.ts
import { join as join2 } from "node:path";

// src/hooks/pre-compact-core.ts
init_i18n();
import { join } from "node:path";
function handlePreCompact(input, dataRoot) {
  try {
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
    initLang(dataDir, cwd);
    beat(dataDir, "PreCompact", { trigger: input.trigger ?? null });
  } catch {}
  return {};
}

// src/hooks/pre-compact.ts
if (isInternalCall())
  process.exit(0);
var input = readStdinJson();
var res = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data"));
var out = handlePreCompact(input, res.root);
if (out.hookSpecificOutput)
  console.log(JSON.stringify(out));
try {
  const { spawnAutoLearnDetached } = await import("./detach-faajd50f.js");
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root);
} catch {}
