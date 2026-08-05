import {
  WORKS
} from "./session-start-f4mwg907.js";
import"./session-start-2bjn9vg8.js";
import"./session-start-ghd7z0t9.js";
import"./session-start-0xyqxcjv.js";
import"./session-start-9y69e5jn.js";
import"./session-start-8ychq3hk.js";
import"./session-start-5zvjmsx7.js";
import"./session-start-4f4yyj4d.js";
import"./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-5ysrdsv8.js";
import {
  openDb,
  runWorks,
  slugOf
} from "./session-start-15k5a1x7.js";
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
