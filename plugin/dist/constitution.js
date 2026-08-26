import {
  migrateLegacyPassports,
  resolveDataRoot
} from "./session-start-0zc82bg9.js";
import {
  initLang,
  init_i18n,
  readConstitution,
  renderConstitution,
  runtimeBlocker,
  slugOf,
  t,
  upsertConstitution
} from "./session-start-dx0v6ppa.js";
import"./session-start-70d7ckvt.js";

// src/cli/constitution.ts
init_i18n();
import { join } from "node:path";
import { mkdirSync } from "node:fs";
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(process.cwd()));
initLang(dataDir, process.cwd());
var blocked = runtimeBlocker();
if (blocked) {
  console.log(blocked);
  process.exit(0);
}
mkdirSync(dataDir, { recursive: true });
var cmd = process.argv[2];
if (cmd === "set") {
  const raw = process.argv[3] ?? "";
  let pairs;
  try {
    pairs = JSON.parse(raw);
  } catch {
    console.log(t('Ошибка: ожидается JSON-массив пар [{"goal":"…","constraint":"…"}]', 'Error: a JSON array of pairs is expected — [{"goal":"…","constraint":"…"}]'));
    process.exit(1);
  }
  const c = upsertConstitution(dataDir, Array.isArray(pairs) ? pairs : []);
  console.log(t(`Конституция сохранена: ${c.pairs.length} пар(ы). Подаётся в каждую сессию этого проекта.`, `Constitution saved: ${c.pairs.length} pair(s). Delivered to every session of this project.`));
  console.log(renderConstitution(c));
} else {
  const c = readConstitution(dataDir);
  console.log(c ? renderConstitution(c) : `Ручная конституция не задана — и не обязана быть: приоритеты, ценности и ограничения Symbiont выводит из истории работы сам.
Дописать волю, которой в коде не видно: /symbiont:charter`);
}
