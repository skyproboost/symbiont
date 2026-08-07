import {
  migrateLegacyPassports,
  resolveDataRoot
} from "./session-start-4dzffwrx.js";
import {
  readConstitution,
  renderConstitution,
  runtimeBlocker,
  slugOf,
  upsertConstitution
} from "./session-start-sh8zj220.js";
import"./session-start-70d7ckvt.js";

// src/cli/constitution.ts
import { join } from "node:path";
import { mkdirSync } from "node:fs";
var res = resolveDataRoot(join(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join(res.root, slugOf(process.cwd()));
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
    console.log('Ошибка: ожидается JSON-массив пар [{"goal":"…","constraint":"…"}]');
    process.exit(1);
  }
  const c = upsertConstitution(dataDir, Array.isArray(pairs) ? pairs : []);
  console.log(`Конституция сохранена: ${c.pairs.length} пар(ы). Подаётся в каждую сессию этого проекта.`);
  console.log(renderConstitution(c));
} else {
  const c = readConstitution(dataDir);
  console.log(c ? renderConstitution(c) : `Ручная конституция не задана — и не обязана быть: приоритеты, ценности и ограничения Symbiont выводит из истории работы сам.
Дописать волю, которой в коде не видно: /symbiont:charter`);
}
