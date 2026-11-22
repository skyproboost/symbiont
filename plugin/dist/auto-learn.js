import {
  claimMaintenance
} from "./codex-call-h8kj2jja.js";
import {
  WORKS
} from "./codex-call-jba1gzz9.js";
import"./codex-call-penbn1w9.js";
import"./codex-call-f64wvkf6.js";
import"./codex-call-57z27tea.js";
import"./codex-call-fbsjv0g5.js";
import"./codex-call-807dazwp.js";
import"./codex-call-f9cazs4r.js";
import"./codex-call-8ychq3hk.js";
import"./codex-call-046cybce.js";
import"./codex-call-vgezmhw1.js";
import"./codex-call-psab7pqj.js";
import"./codex-call-5s7r4262.js";
import {
  resolveDataRoot
} from "./codex-call-pxxba9as.js";
import {
  initLang,
  init_i18n,
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./codex-call-qxxgrqz0.js";
import"./codex-call-b1s33asb.js";
import"./codex-call-rvra3cez.js";

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
if (process.argv.includes("--claim-maintenance")) {
  const release = claimMaintenance(root, dataDir);
  if (!release)
    process.exit(75);
  process.once("exit", release);
}
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
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now(), full: false });
  for (const o of report.outcomes)
    console.log(`${o.ok ? "✓" : "✗"} ${o.id} · ${o.ms}${t("мс", "ms")} · ${o.note}`);
} finally {
  db.close();
}
