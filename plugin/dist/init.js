import {
  WORKS
} from "./session-start-ydkfyvga.js";
import"./session-start-zcnveamz.js";
import"./session-start-ty0gwf55.js";
import"./session-start-dbapj88c.js";
import"./session-start-fscn0xe1.js";
import"./session-start-5psa84hc.js";
import"./session-start-psab7pqj.js";
import"./session-start-8ychq3hk.js";
import"./session-start-046cybce.js";
import"./session-start-vgezmhw1.js";
import"./session-start-5s7r4262.js";
import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-m33pss0e.js";
import {
  buildPassport,
  initLang,
  init_i18n,
  markVisited,
  openDb,
  renderSkipped,
  runWorks,
  runtimeBlocker,
  slugOf,
  t
} from "./session-start-tcz0z3pm.js";
import"./session-start-rvra3cez.js";

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
  if (full) {
    try {
      db.run("DELETE FROM learn_meta WHERE key='layer2_material'");
    } catch {}
  }
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
  const ctx = { db, projectRoot: root, dataDir, nowMs: Date.now(), full };
  const report = await runWorks(WORKS, ctx, { budgetMs: 900000 });
  for (const o of report.outcomes)
    console.log(`  ${o.ok ? "✓" : "✗"} ${o.id.padEnd(12)} ${String(o.ms + t("мс", "ms")).padEnd(9)} ${o.note}`);
  const exhausted = (id) => {
    if (full)
      return false;
    const w = WORKS.find((x) => x.id === id);
    try {
      return w !== undefined && w.due({ ...ctx, full: true });
    } catch {
      return false;
    }
  };
  for (const line of renderSkipped(report.skipped, exhausted))
    console.log(line);
  console.log(t(`
Готово. Паспорт подаётся в каждую сессию сам; дальше система дополняет его по мере работы.`, `
Done. The passport is delivered to every session by itself; from here the system fills it in as you work.`));
  console.log(t("Посмотреть: /symbiont:status · карта: /symbiont:graph · здоровье проекта: /symbiont:health", "See it: /symbiont:status · the map: /symbiont:graph · project health: /symbiont:health"));
} finally {
  db.close();
}
