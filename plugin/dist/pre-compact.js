import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-wttrst36.js";
import {
  beat,
  slugOf
} from "./session-start-dhy2j257.js";
import {
  __require,
  __toESM
} from "./session-start-70d7ckvt.js";

// src/hooks/pre-compact.ts
import { join as join2 } from "node:path";

// src/hooks/pre-compact-core.ts
import { join } from "node:path";
function handlePreCompact(input, dataRoot) {
  try {
    const cwd = input.cwd ?? process.cwd();
    const dataDir = join(dataRoot, slugOf(cwd));
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
  const { spawnAutoLearnDetached } = await import("./detach-v2y884s5.js");
  spawnAutoLearnDetached(input.cwd ?? process.cwd(), res.root);
} catch {}
