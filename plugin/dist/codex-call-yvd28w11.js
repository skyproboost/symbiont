// src/gates/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
function readOutlineMode(dataDir) {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, "gate.json"), "utf8"));
    return j.outline === "deny" ? "deny" : "offer";
  } catch {
    return "offer";
  }
}
function readGateMode(dataDir) {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, "gate.json"), "utf8"));
    return j.mode === "block" ? "block" : "dry-run";
  } catch {
    return "dry-run";
  }
}

export { readOutlineMode, readGateMode };
