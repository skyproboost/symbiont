import {
  isInternalCall
} from "./codex-call-5s7r4262.js";
import {
  openDb,
  silentSpawnOptions
} from "./codex-call-qxxgrqz0.js";
import {
  agentHost
} from "./codex-call-b1s33asb.js";

// src/core/codex-maintenance.ts
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
function applies() {
  return process.platform === "win32" && agentHost() === "codex" && !isInternalCall();
}
function marker(cwd, dataDir) {
  const project = realpathSync.native(cwd).toLowerCase();
  const key = createHash("sha256").update(project).digest("hex");
  return join(dataDir, `codex-maintenance-${key}.pending`);
}
function handOffMaintenance(cwd, dataDir) {
  if (!applies())
    return false;
  const pending = marker(cwd, dataDir);
  try {
    mkdirSync(pending);
  } catch (e) {
    if (e.code !== "EEXIST")
      throw e;
  }
  return true;
}
function claimMaintenance(cwd, dataDir) {
  const pending = marker(cwd, dataDir);
  if (!existsSync(pending))
    return null;
  const lock = openDb(join(dataDir, "codex-maintenance.lock.db"));
  try {
    lock.run("PRAGMA busy_timeout = 0");
    lock.run("BEGIN IMMEDIATE");
    rmdirSync(pending);
    return () => lock.close();
  } catch (e) {
    lock.close();
    if (e.code === "ENOENT" || /database is (?:busy|locked)/i.test(String(e)))
      return null;
    throw e;
  }
}
function serveMaintenance(cwd, dataDir) {
  if (!applies())
    return () => {};
  const pending = marker(cwd, dataDir);
  const bundle = join(import.meta.dirname, "auto-learn.js");
  const entry = existsSync(bundle) ? bundle : join(import.meta.dirname, "..", "cli", "auto-learn.ts");
  let running = false;
  let retryAt = 0;
  function check() {
    if (running || Date.now() < retryAt || !existsSync(pending))
      return;
    running = true;
    const done = (retry) => {
      running = false;
      if (retry)
        retryAt = Date.now() + 30000;
    };
    try {
      const child = spawn(process.execPath, [entry, cwd, "--data", dirname(dataDir), "--claim-maintenance"], silentSpawnOptions());
      child.once("error", () => done(true));
      child.once("exit", (code) => done(code !== 0));
      child.unref();
    } catch {
      done(true);
    }
  }
  const timer = setInterval(check, 2000);
  timer.unref();
  check();
  return () => clearInterval(timer);
}

export { handOffMaintenance, claimMaintenance, serveMaintenance };
