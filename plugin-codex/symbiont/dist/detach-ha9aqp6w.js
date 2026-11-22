import {
  handOffMaintenance
} from "./codex-call-dc70z6kp.js";
import"./codex-call-5s7r4262.js";
import {
  silentSpawnOptions,
  slugOf
} from "./codex-call-21dvb3ma.js";
import"./codex-call-b1s33asb.js";
import"./codex-call-rvra3cez.js";

// src/hooks/detach.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
function autoLearnEntry() {
  const bundled = join(import.meta.dirname, "auto-learn.js");
  if (existsSync(bundled))
    return bundled;
  return join(import.meta.dirname, "..", "cli", "auto-learn.ts");
}
function spawnAutoLearnDetached(cwd, dataRoot) {
  const dataDir = join(dataRoot, slugOf(cwd));
  if (!existsSync(join(dataDir, "passport.db")) || handOffMaintenance(cwd, dataDir))
    return;
  spawn(process.execPath, [autoLearnEntry(), cwd, "--data", dataRoot], silentSpawnOptions()).unref();
}
export {
  spawnAutoLearnDetached
};
