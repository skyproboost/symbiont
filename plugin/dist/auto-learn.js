import {
  WORKS
} from "./session-start-3bz9h0sv.js";
import"./session-start-sv68xggb.js";
import"./session-start-cwpee15w.js";
import"./session-start-penbn1w9.js";
import"./session-start-eqtg8smr.js";
import"./session-start-8ychq3hk.js";
import"./session-start-1p1g6x0j.js";
import"./session-start-kg15phns.js";
import"./session-start-5s7r4262.js";
import"./session-start-n4jed5qc.js";
import {
  resolveDataRoot
} from "./session-start-mxkjpptq.js";
import {
  initLang,
  init_i18n,
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./session-start-fhfq0nbs.js";
import"./session-start-rvra3cez.js";

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
