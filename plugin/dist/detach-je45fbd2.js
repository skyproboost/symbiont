import {
  silentSpawnOptions,
  slugOf
} from "./session-start-wv0favmt.js";
import"./session-start-70d7ckvt.js";

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
  const dbPath = join(dataRoot, slugOf(cwd), "passport.db");
  if (!existsSync(dbPath))
    return;
  spawn(process.execPath, [autoLearnEntry(), cwd, "--data", dataRoot], silentSpawnOptions()).unref();
}
export {
  spawnAutoLearnDetached
};
