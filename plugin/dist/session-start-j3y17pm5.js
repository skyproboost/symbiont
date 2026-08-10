import {
  jsonOnly
} from "./session-start-yn4tr5xd.js";

// src/env/rules.ts
function ensureRuleTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS contract_rule(
       pattern TEXT NOT NULL, config_key TEXT NOT NULL, config_file TEXT NOT NULL,
       requires TEXT NOT NULL, what TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
       PRIMARY KEY(pattern, config_key))`);
}
function isSafePattern(pattern) {
  if (pattern.length < 3 || pattern.length > 120)
    return false;
  if (/(\(\?<|\(\?=|\(\?!)/.test(pattern))
    return false;
  if (/(\*|\+|\{\d+,?\d*\})\s*(\*|\+)/.test(pattern))
    return false;
  if (/\([^)]*(\*|\+)[^)]*\)\s*(\*|\+)/.test(pattern))
    return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
function storeRules(db, rules, nowIso = new Date().toISOString()) {
  ensureRuleTable(db);
  const ins = db.query(`INSERT INTO contract_rule(pattern, config_key, config_file, requires, what, model, created_at)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(pattern, config_key) DO UPDATE SET created_at=excluded.created_at`);
  let stored = 0;
  for (const r of rules) {
    if (!isSafePattern(r.pattern))
      continue;
    ins.run(r.pattern, r.configKey, r.configFile, r.requires, r.what, r.model, nowIso);
    stored++;
  }
  return stored;
}
function readRules(db) {
  try {
    ensureRuleTable(db);
    return db.query("SELECT pattern, config_key, config_file, requires, what, model FROM contract_rule").all().map((r) => ({
      pattern: r.pattern,
      configKey: r.config_key,
      configFile: r.config_file,
      requires: r.requires,
      what: r.what,
      model: r.model
    }));
  } catch {
    return [];
  }
}
function applyRules(content, rules) {
  const out = [];
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern).test(content))
        out.push({ rule });
    } catch {}
  }
  return out;
}
function buildRulesPrompt(entries) {
  return [
    "Ниже — реальные настройки конфигурации одного проекта (файл, ключ, значение).",
    "",
    "Задача: определить, какой КОД эти настройки ограничивают или требуют. Нас интересуют только те настройки, которые способны СЛОМАТЬ работающий код в проде, если код потребует того, что настройка не разрешает.",
    "",
    "Пример логики (не копируй его, если в списке нет такого): настройка политики безопасности контента, ограничивающая источники медиа, ломает код, который создаёт объектные URL для видео — браузер заблокирует воспроизведение.",
    "",
    "Настройки проекта:",
    ...entries.slice(0, 60).map((e) => `- ${e.file} · ${e.key} = ${e.value.slice(0, 120)}`),
    "",
    jsonOnly('[{"pattern": "регулярное выражение для поиска такого кода", "configKey": "ключ из списка", "configFile": "файл из списка", "requires": "что должно быть в значении, чтобы код работал", "what": "одной фразой: что делает код и почему настройка его сломает"}]'),
    "",
    "Требования к pattern: простое выражение до 120 символов, без просмотров вперёд/назад и без вложенных квантификаторов; оно должно находить характерный вызов или конструкцию, а не любое слово.",
    "Возвращай только уверенные правила (максимум 12). Если настройка ничего в коде не ограничивает — не включай её."
  ].join(`
`);
}
function parseRules(text, model) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start)
      return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr))
      return [];
    const out = [];
    for (const r of arr) {
      if (typeof r?.pattern !== "string" || typeof r?.configKey !== "string")
        continue;
      if (typeof r?.what !== "string" || r.what.trim().length < 10)
        continue;
      if (!isSafePattern(r.pattern))
        continue;
      out.push({
        pattern: r.pattern,
        configKey: r.configKey,
        configFile: typeof r.configFile === "string" ? r.configFile : "(конфигурация проекта)",
        requires: typeof r.requires === "string" ? r.requires : "",
        what: r.what.trim().slice(0, 200),
        model
      });
    }
    return out;
  } catch {
    return [];
  }
}

export { storeRules, readRules, applyRules, buildRulesPrompt, parseRules };
