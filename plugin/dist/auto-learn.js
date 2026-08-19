import {
  WORKS
} from "./session-start-rz81hmqp.js";
import"./session-start-djk6q8qh.js";
import"./session-start-204w5cyk.js";
import"./session-start-7vt6tmxd.js";
import"./session-start-n4jed5qc.js";
import"./session-start-b3baeev6.js";
import"./session-start-8ychq3hk.js";
import"./session-start-046cybce.js";
import"./session-start-zk21vbx4.js";
import"./session-start-fcbm01xt.js";
import"./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-25e3w7d2.js";
import {
  initLang,
  init_i18n,
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./session-start-anv3kp9x.js";
import"./session-start-70d7ckvt.js";

// src/cli/auto-learn.ts
init_i18n();
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
initLang(dataDir, root);
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
    console.log(`${o.ok ? "✓" : "✗"} ${o.id} · ${o.ms}${t("мс", "ms")} · ${o.note}`);
} finally {
  db.close();
}
