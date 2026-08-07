import {
  WORKS
} from "./session-start-823g9xey.js";
import"./session-start-ee9wngx9.js";
import"./session-start-jmvb6m66.js";
import"./session-start-djk6q8qh.js";
import"./session-start-dj4fgvzp.js";
import"./session-start-8ychq3hk.js";
import {
  markVisited
} from "./session-start-m2yx435j.js";
import"./session-start-wwhagmxs.js";
import"./session-start-5s7r4262.js";
import"./session-start-n4jed5qc.js";
import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-z6xxtd7s.js";
import {
  buildPassport,
  initLang,
  init_i18n,
  openDb,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./session-start-xqeg8ejq.js";
import"./session-start-70d7ckvt.js";

// src/cli/init.ts
import { join, basename, resolve } from "node:path";
import { existsSync } from "node:fs";
init_i18n();
var PRESEED_NODES = 24;
var FULL_WORDS = /^(re|redo|fresh|full|force|заново|полностью)$/i;
var full = FULL_WORDS.test(stripDataFlag(process.argv.slice(2)).join(" ").trim());
var root = resolve(process.cwd());
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(root));
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
console.log(t(`Symbiont · инициализация проекта «${basename(root)}»${full ? " — полный пересчёт" : ""}`, `Symbiont · initialising the project “${basename(root)}”${full ? " — full recount" : ""}`));
console.log(full ? t(`Все проходы выполняются заново, включая уже сделанные.
`, `Every pass runs again, including the ones already done.
`) : t(`Разовый глубокий проход. Уже сделанное не повторяется — «/symbiont:init re» форсирует полный пересчёт.
`, `A one-off deep pass. Work already done is not repeated — “/symbiont:init re” forces a full recount.
`));
var t0 = performance.now();
var built = buildPassport(root, dataDir);
console.log(t(`  ✓ паспорт собран за ${Math.round(performance.now() - t0)}мс · узлов ${built.graph.nodeCount} · связей ${built.graph.edgeCount} · фактов +${built.journal.born}`, `  ✓ passport built in ${Math.round(performance.now() - t0)}ms · nodes ${built.graph.nodeCount} · links ${built.graph.edgeCount} · facts +${built.journal.born}`));
if (!existsSync(join(dataDir, "passport.db"))) {
  console.log(t("  ✗ паспорт не создан — дальше идти некуда", "  ✗ the passport was not created — there is nowhere to go from here"));
  process.exit(1);
}
var db = openDb(join(dataDir, "passport.db"));
try {
  try {
    const top = db.query("SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(PRESEED_NODES);
    const now = new Date().toISOString();
    for (const n of top)
      markVisited(db, n.file, now);
    if (top.length > 0)
      console.log(t(`  ✓ в очередь ролей поставлено ${top.length} важнейших узлов`, `  ✓ ${top.length} most important nodes queued for role descriptions`));
  } catch {}
  console.log(t(`  … глубокий проход: разбор кода по синтаксису, неписаные правила, связь настроек с кодом, роли файлов, снимок здоровья
`, `  … deep pass: parsing the code by syntax, unwritten rules, how settings govern the code, file roles, a health snapshot
`));
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now() }, { budgetMs: 900000, ignoreCooldown: full });
  for (const o of report.outcomes)
    console.log(`  ${o.ok ? "✓" : "✗"} ${o.id.padEnd(12)} ${String(o.ms + t("мс", "ms")).padEnd(9)} ${o.note}`);
  const quiet = report.skipped.filter((s) => s.includes("нечего")).length;
  if (quiet > 0)
    console.log(t(`  · ${quiet} работ не нашли для себя материала — это норма`, `  · ${quiet} jobs found no material of their own — that is normal`));
  const already = report.skipped.filter((s) => !s.includes("нечего") && !s.includes("бюджет")).length;
  if (!full && already > 0) {
    console.log(t(`  · ${already} работ уже сделаны ранее и не повторялись (токены не потрачены) — «/symbiont:init re» форсирует`, `  · ${already} jobs were already done and were not repeated (no tokens spent) — “/symbiont:init re” forces them`));
  }
  console.log(t(`
Готово. Паспорт подаётся в каждую сессию сам; дальше система дополняет его по мере работы.`, `
Done. The passport is delivered to every session by itself; from here the system fills it in as you work.`));
  console.log(t("Посмотреть: /symbiont:status · карта: /symbiont:graph · здоровье проекта: /symbiont:health", "See it: /symbiont:status · the map: /symbiont:graph · project health: /symbiont:health"));
} finally {
  db.close();
}
