import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-5p4d188q.js";
import {
  chooseLang,
  initLang,
  init_i18n,
  lang,
  readState,
  runtimeBlocker,
  slugOf,
  sourceLabel,
  t
} from "./session-start-99y99kna.js";
import"./session-start-70d7ckvt.js";

// src/cli/lang.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
init_i18n();
var root = process.cwd();
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(root));
var arg = stripDataFlag(process.argv.slice(2)).join(" ").trim().toLowerCase();
initLang(dataDir, root);
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
function parse(input) {
  if (!input)
    return { kind: "show" };
  if (/^(auto|авто)$/.test(input))
    return { kind: "auto" };
  if (/^(ru|rus|russian|рус\w*)$/.test(input))
    return { kind: "set", lang: "ru" };
  if (/^(en|eng|english|англ\w*)$/.test(input))
    return { kind: "set", lang: "en" };
  return { kind: "unknown" };
}
var verdict = parse(arg);
if (verdict.kind === "unknown") {
  console.log(t(`Symbiont: «${arg}» — не язык. Ожидается ru, en или auto (без аргумента — показать текущий).`, `Symbiont: "${arg}" is not a language. Expected ru, en or auto (no argument — show the current one).`));
  process.exit(0);
}
if (verdict.kind === "show") {
  const state = existsSync(dataDir) ? readState(dataDir) : null;
  const source = state?.source ?? "default";
  console.log(t(`Symbiont: язык подачи — ${lang()} (основание: ${sourceLabel(source)}).`, `Symbiont: output language is ${lang()} (reason: ${sourceLabel(source)}).`));
  console.log(source === "choice" ? t("  Выбран вами и не будет переопределён наблюдением. Вернуть автоопределение: /symbiont:lang auto", "  Chosen by you and never overridden by observation. Back to automatic: /symbiont:lang auto") : t("  Определён наблюдением. Закрепить: /symbiont:lang ru или /symbiont:lang en", "  Decided by observation. Pin it: /symbiont:lang ru or /symbiont:lang en"));
  process.exit(0);
}
var choice = verdict.kind === "auto" ? null : verdict.lang;
var after = chooseLang(dataDir, choice);
console.log(choice === null ? t(`Symbiont: язык подачи снова определяется сам — сейчас ${after.lang} (${sourceLabel(after.source)}).`, `Symbiont: the language is decided by observation again — currently ${after.lang} (${sourceLabel(after.source)}).`) : t(`Symbiont: язык подачи — ${after.lang}. Держится, пока не смените. Вернуть автоопределение: /symbiont:lang auto`, `Symbiont: output language is now ${after.lang}. It holds until you change it. Back to automatic: /symbiont:lang auto`));
