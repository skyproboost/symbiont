import {
  WORKS
} from "./session-start-6mngh8hs.js";
import"./session-start-djk6q8qh.js";
import"./session-start-qwqtq2cp.js";
import"./session-start-0v494gwj.js";
import"./session-start-ae6zr2z6.js";
import"./session-start-kq43228r.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-046cybce.js";
import"./session-start-gmd2p749.js";
import"./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-7d4dv2d8.js";
import {
  initLang,
  init_i18n,
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./session-start-v794t6f0.js";
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
