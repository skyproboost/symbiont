import {
  WORKS
} from "./session-start-d4c8mg5k.js";
import"./session-start-11kfv4d7.js";
import"./session-start-7gtsfd67.js";
import"./session-start-djk6q8qh.js";
import"./session-start-4v315e9p.js";
import"./session-start-8ychq3hk.js";
import"./session-start-ppqgdrar.js";
import"./session-start-vp1vvy3r.js";
import"./session-start-5s7r4262.js";
import"./session-start-n4jed5qc.js";
import {
  resolveDataRoot
} from "./session-start-wttrst36.js";
import {
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf
} from "./session-start-dhy2j257.js";
import"./session-start-70d7ckvt.js";

// src/cli/auto-learn.ts
import { join as join2 } from "node:path";
import { existsSync } from "node:fs";

// src/gardener/auto-learn.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
function autoEnabled(dataDir) {
  try {
    return JSON.parse(readFileSync(join(dataDir, "learn.json"), "utf8")).auto !== false;
  } catch {
    return true;
  }
}

// src/cli/auto-learn.ts
var root = process.argv[2] ?? process.cwd();
var dataDir = join2(resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root, slugOf(root));
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
var dbPath = join2(dataDir, "passport.db");
if (!existsSync(dbPath))
  process.exit(0);
if (!autoEnabled(dataDir))
  process.exit(0);
var db = openDb(dbPath);
try {
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now() });
  for (const o of report.outcomes)
    console.log(`${o.ok ? "✓" : "✗"} ${o.id} · ${o.ms}мс · ${o.note}`);
} finally {
  db.close();
}
