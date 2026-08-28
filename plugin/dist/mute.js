import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-5p4d188q.js";
import {
  FactStore,
  MISLEADING,
  factBasis,
  initLang,
  init_i18n,
  labelFact,
  matchFacts,
  openDb,
  readLabels,
  runtimeBlocker,
  slugOf,
  statement,
  t,
  unlabelFact
} from "./session-start-99y99kna.js";
import"./session-start-70d7ckvt.js";

// src/cli/mute.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
init_i18n();
var root = process.cwd();
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(root));
var arg = stripDataFlag(process.argv.slice(2)).join(" ").trim();
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
var dbPath = join(dataDir, "passport.db");
if (!existsSync(dbPath)) {
  console.log(t("Symbiont: паспорт ещё не построен — приглушать нечего.", "Symbiont: no passport yet — nothing to mute."));
  process.exit(0);
}
var AMBIGUOUS_MAX = 8;
var LIST = /^(list|список|показать|show)?$/i;
var UNDO = /^(undo|отмена|снять|вернуть|unmute)\s+(.+)$/i;
var NOTE_SEP = /\s[—–-]{1,2}\s/;
var line = (f) => `  ${f.key} · ${statement(f.statement)} — ${factBasis(f)}`;
var db = openDb(dbPath);
try {
  const store = new FactStore(db);
  if (LIST.test(arg)) {
    const labels = readLabels(db).filter((l) => l.label === MISLEADING);
    if (labels.length === 0) {
      console.log(t("Symbiont · приглушённых правил нет. Приглушить: /symbiont:mute <фраза из правила> — оно перестанет подаваться и судиться, история останется.", "Symbiont · no muted rules. Mute one: /symbiont:mute <phrase from the rule> — it stops being delivered and enforced, its history stays."));
      process.exit(0);
    }
    const all = new Map(store.active(Date.now(), true).map((f) => [f.key, f]));
    console.log(t(`Symbiont · приглушено владельцем: ${labels.length}`, `Symbiont · muted by the owner: ${labels.length}`));
    for (const l of labels) {
      const f = all.get(l.key);
      console.log(f ? line(f) : `  ${l.key} · ${t("(в журнале уже нет активной версии)", "(no active version in the journal any more)")}`);
      console.log(`    ${l.at.slice(0, 10)}${l.note ? ` · ${l.note}` : ""} · ${t("вернуть", "undo")}: /symbiont:mute undo ${l.key}`);
    }
    process.exit(0);
  }
  const undo = arg.match(UNDO);
  if (undo) {
    const phrase2 = undo[2].trim();
    const muted = new Set(readLabels(db).filter((l) => l.label === MISLEADING).map((l) => l.key));
    const found2 = matchFacts(store.active(Date.now(), true), phrase2).filter((f) => muted.has(f.key));
    if (found2.length === 0 && muted.has(phrase2)) {
      unlabelFact(db, phrase2);
      console.log(t(`Symbiont · метка снята: ${phrase2}.`, `Symbiont · label removed: ${phrase2}.`));
      process.exit(0);
    }
    if (found2.length !== 1) {
      console.log(found2.length === 0 ? t(`Symbiont · среди приглушённых нет правила с «${phrase2}». Список: /symbiont:mute list`, `Symbiont · no muted rule matches “${phrase2}”. List: /symbiont:mute list`) : t(`Symbiont · под «${phrase2}» подходят ${found2.length} — уточните:
${found2.slice(0, AMBIGUOUS_MAX).map(line).join(`
`)}`, `Symbiont · “${phrase2}” matches ${found2.length} — be more specific:
${found2.slice(0, AMBIGUOUS_MAX).map(line).join(`
`)}`));
      process.exit(0);
    }
    unlabelFact(db, found2[0].key);
    console.log(t(`Symbiont · метка снята:
${line(found2[0])}
Правило снова подаётся со следующего входа.`, `Symbiont · label removed:
${line(found2[0])}
The rule is delivered again from the next session start.`));
    process.exit(0);
  }
  const sep = arg.search(NOTE_SEP);
  const phrase = sep === -1 ? arg : arg.slice(0, sep).trim();
  const note = sep === -1 ? "" : arg.slice(sep).replace(NOTE_SEP, "").trim();
  const found = matchFacts(store.active(), phrase);
  if (found.length === 0) {
    console.log(t(`Symbiont · активного правила с «${phrase}» нет. Формулировки — в passport_conventions.`, `Symbiont · no active rule matches “${phrase}”. Wordings are in passport_conventions.`));
    process.exit(0);
  }
  if (found.length > 1) {
    const rest = found.length > AMBIGUOUS_MAX ? t(`
  … ещё ${found.length - AMBIGUOUS_MAX}`, `
  … ${found.length - AMBIGUOUS_MAX} more`) : "";
    console.log(t(`Symbiont · под «${phrase}» подходят ${found.length} правил — уточните фразу или назовите ключ:
${found.slice(0, AMBIGUOUS_MAX).map(line).join(`
`)}${rest}`, `Symbiont · “${phrase}” matches ${found.length} rules — refine the phrase or name the key:
${found.slice(0, AMBIGUOUS_MAX).map(line).join(`
`)}${rest}`));
    process.exit(0);
  }
  labelFact(db, found[0].key, MISLEADING, note, new Date().toISOString());
  console.log(t(`Symbiont · приглушено как вводящее в заблуждение:
${line(found[0])}
Не подаётся и не судится гейтом со следующего входа; журнал цел. Вернуть: /symbiont:mute undo ${found[0].key}`, `Symbiont · muted as misleading:
${line(found[0])}
Not delivered and not enforced from the next session start; the journal is intact. Undo: /symbiont:mute undo ${found[0].key}`));
} finally {
  db.close();
}
