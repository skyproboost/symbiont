import {
  WORKS
} from "./session-start-z5r7nxgr.js";
import"./session-start-0hbm8nsh.js";
import"./session-start-2ac08kse.js";
import"./session-start-0xyqxcjv.js";
import"./session-start-jfm8hzf3.js";
import"./session-start-8ychq3hk.js";
import {
  markVisited
} from "./session-start-nkwfkq7m.js";
import"./session-start-24y7fezg.js";
import"./session-start-5s7r4262.js";
import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-a4kc6fyf.js";
import {
  buildPassport,
  initLang,
  openDb,
  runWorks,
  slugOf,
  t
} from "./session-start-8nd3663h.js";
import"./session-start-70d7ckvt.js";

// src/cli/init.ts
import { join, basename, resolve } from "node:path";
import { existsSync } from "node:fs";
var PRESEED_NODES = 24;
var FULL_WORDS = /^(re|redo|fresh|full|force|заново|полностью)$/i;
var full = FULL_WORDS.test(stripDataFlag(process.argv.slice(2)).join(" ").trim());
var root = resolve(process.cwd());
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(root));
initLang(dataDir, root);
console.log(`Symbiont · инициализация проекта «${basename(root)}»${full ? " — полный пересчёт" : ""}`);
console.log(full ? `Все проходы выполняются заново, включая уже сделанные.
` : t(`Разовый глубокий проход. Уже сделанное не повторяется — «/symbiont:init re» форсирует полный пересчёт.
`, `A one-off deep pass. Work already done is not repeated — “/symbiont:init re” forces a full recount.
`));
var t0 = performance.now();
var built = buildPassport(root, dataDir);
console.log(`  ✓ паспорт собран за ${Math.round(performance.now() - t0)}мс · узлов ${built.graph.nodeCount} · связей ${built.graph.edgeCount} · фактов +${built.journal.born}`);
if (!existsSync(join(dataDir, "passport.db"))) {
  console.log("  ✗ паспорт не создан — дальше идти некуда");
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
      console.log(`  ✓ в очередь ролей поставлено ${top.length} важнейших узлов`);
  } catch {}
  console.log(`  … глубокий проход: разбор кода по синтаксису, неписаные правила, связь настроек с кодом, роли файлов, снимок здоровья
`);
  const report = await runWorks(WORKS, { db, projectRoot: root, dataDir, nowMs: Date.now() }, { budgetMs: 900000, ignoreCooldown: full });
  for (const o of report.outcomes)
    console.log(`  ${o.ok ? "✓" : "✗"} ${o.id.padEnd(12)} ${String(o.ms + "мс").padEnd(9)} ${o.note}`);
  const quiet = report.skipped.filter((s) => s.includes("нечего")).length;
  if (quiet > 0)
    console.log(`  · ${quiet} работ не нашли для себя материала — это норма`);
  const already = report.skipped.filter((s) => !s.includes("нечего") && !s.includes("бюджет")).length;
  if (!full && already > 0) {
    console.log(t(`  · ${already} работ уже сделаны ранее и не повторялись (токены не потрачены) — «/symbiont:init re» форсирует`, `  · ${already} jobs were already done and were not repeated (no tokens spent) — “/symbiont:init re” forces them`));
  }
  console.log(`
Готово. Паспорт подаётся в каждую сессию сам; дальше система дополняет его по мере работы.`);
  console.log("Посмотреть: /symbiont:status · карта: /symbiont:graph · здоровье проекта: /symbiont:health");
} finally {
  db.close();
}
