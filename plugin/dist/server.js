import {
  resolveDataRoot
} from "./session-start-ah2h903t.js";
import {
  FactStore,
  factBasis,
  init_i18n,
  openDb,
  slugOf,
  statement,
  t,
  tier
} from "./session-start-a6061n0b.js";
import"./session-start-70d7ckvt.js";

// src/mcp/server.ts
import { join as join2 } from "node:path";
import { createInterface } from "node:readline";

// src/mcp/handlers.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
init_i18n();
var TOOLS = [
  {
    name: "passport_conventions",
    description: "Конвенции проекта из паспорта Symbiont: выведенные из кода правила с распространённостью и ярусом уверенности (закон/привычка/гипотеза). Опционально фильтр по области (форматирование, объявления, функции, итерации, именование, параметры, vue).",
    inputSchema: {
      type: "object",
      properties: { area: { type: "string", description: "фильтр по области (опционально)" } }
    }
  },
  {
    name: "passport_history",
    description: "История правила в журнале паспорта: как менялся вердикт со временем (вытеснения, даты, числа). Ключ — из passport_conventions, формат «область|предмет», например «форматирование|отступы».",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "ключ правила «область|предмет»" } },
      required: ["key"]
    }
  },
  {
    name: "passport_map",
    description: "Карта проекта из паспорта Symbiont: ключевые модули по связности импортов (PageRank, вход/исход) — быстрый обзор структуры без чтения файлов.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "сколько модулей показать (по умолчанию 15)" } }
    }
  },
  {
    name: "passport_impact",
    description: "Радиус влияния файла: кто зависит от него по импортам (транзитивно, по уровням глубины) — «что может сломаться, если менять X». Принимает имя файла или его хвост пути.",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "файл или хвост пути (например payments.ts или utils/api.ts)" } },
      required: ["file"]
    }
  },
  {
    name: "passport_orphans",
    description: "Здоровье перелинковки контента (статьи/хабы/YAML-сущности): сироты без входящих ссылок, битые внутренние ссылки, одинаковые анкоры на разные цели. Детерминированно из доменного графа сущностей.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "сколько строк на секцию (по умолчанию 15)" } }
    }
  },
  {
    name: "passport_reach",
    description: "Достижимость контента из хабов: глубина каждой сущности (клики от хаба), недостижимые, распределение обратных ссылок. С аргументом file — срез одной сущности (глубина, кто ссылается, куда ссылается).",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "сущность или хвост пути (опционально)" } }
    }
  },
  {
    name: "passport_related",
    description: "Прецеденты правок из git-истории: какие файлы исторически меняются ВМЕСТЕ с указанным (co-change) — «правишь X — обычно правят и Y» (миграции к схеме, тесты к коду и т.п.).",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "файл или хвост пути" } },
      required: ["file"]
    }
  }
];
var factLine = (f) => {
  const measured = !f.source.startsWith("llm:");
  return `${f.key} · ${statement(f.statement)} · ${tier(f.tier)} · ${factBasis(f)}${measured ? ` · ${t("замер", "measured")} ${f.seen_at.slice(0, 10)}` : ""}`;
};
function callTool(name, args, dataDir) {
  const dbPath = join(dataDir, "passport.db");
  if (!existsSync(dbPath)) {
    return "Паспорт не построен для этого проекта. Он строится автоматически при старте сессии (SessionStart-хук Symbiont).";
  }
  const db = openDb(dbPath, { readonly: true });
  try {
    const store = new FactStore(db);
    if (name === "passport_conventions") {
      let facts = store.active();
      const area = typeof args.area === "string" ? args.area.trim().toLowerCase() : "";
      if (area)
        facts = facts.filter((f) => f.area.toLowerCase().includes(area));
      if (facts.length === 0)
        return area ? `Фактов по области «${area}» нет.` : "Фактов пока нет.";
      return [
        "Легенда: ключ · факт · ярус · распространённость · дата замера",
        ...facts.map(factLine)
      ].join(`
`);
    }
    if (name === "passport_history") {
      const key = String(args.key ?? "").trim();
      const hist = store.history(key);
      if (hist.length === 0)
        return `Истории по ключу «${key}» нет. Ключи — в passport_conventions.`;
      return [
        `История «${key}» (новые сверху; вытеснённые помечены):`,
        ...hist.map((f) => `${f.superseded_by == null ? "● действует" : "○ вытеснен "} · ${factLine(f)} · заявлен ${f.asserted_at.slice(0, 10)}`)
      ].join(`
`);
    }
    if (name === "passport_map") {
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
      const rows = db.query("SELECT file, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(limit);
      if (rows.length === 0)
        return "Граф не построен (или в проекте нет внутренних импортов).";
      return [
        "Легенда: файл · вход (сколько файлов зависят) · исход (от скольких зависит); порядок — важность (PageRank)",
        ...rows.map((r) => `${r.file} · вход:${r.in_deg} · исход:${r.out_deg}`)
      ].join(`
`);
    }
    if (name === "passport_impact") {
      const needle = String(args.file ?? "").trim().replaceAll("\\", "/");
      if (!needle)
        return "Укажи файл или хвост пути.";
      const node = db.query("SELECT file FROM graph_nodes WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
      if (!node)
        return `Файл «${needle}» в графе не найден. Список — в passport_map.`;
      const depQ = db.query("SELECT from_file FROM graph_edges WHERE to_file = ?");
      const visited = new Set([node.file]);
      let frontier = [node.file];
      const levels = [];
      const CAP = 120;
      for (let depth = 0;depth < 5 && frontier.length > 0 && visited.size < CAP; depth++) {
        const next = [];
        for (const f of frontier) {
          for (const row of depQ.all(f)) {
            if (visited.has(row.from_file))
              continue;
            visited.add(row.from_file);
            next.push(row.from_file);
          }
        }
        if (next.length > 0)
          levels.push(next);
        frontier = next;
      }
      if (levels.length === 0)
        return `${node.file}: прямых зависимых по импортам нет — радиус влияния минимальный.`;
      const total = levels.reduce((s, l) => s + l.length, 0);
      return [
        `Радиус влияния ${node.file}: ${total} зависимых (по уровням; 1 = импортируют напрямую)${visited.size >= CAP ? " · обрезано по лимиту" : ""}`,
        ...levels.map((l, i) => `${i + 1}: ${l.join(", ")}`)
      ].join(`
`);
    }
    if (name === "passport_orphans") {
      const hasTables = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
      if (!hasTables)
        return "Контент-граф не построен: в проекте нет связанных сущностей (md/html/yaml) или паспорт ещё не собран.";
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
      const total = db.query("SELECT COUNT(*) n FROM entity_nodes").get().n;
      if (total === 0)
        return "Контент-граф пуст: сущностей (md/html/yaml) не найдено.";
      const orphans = db.query("SELECT file, out_deg FROM entity_nodes WHERE in_deg = 0 AND is_hub = 0 ORDER BY out_deg DESC, file LIMIT ?").all(limit);
      const orphanCount = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE in_deg = 0 AND is_hub = 0").get().n;
      const broken = db.query("SELECT from_file, target FROM entity_broken ORDER BY from_file LIMIT ?").all(limit);
      const brokenCount = db.query("SELECT COUNT(*) n FROM entity_broken").get().n;
      const dups = db.query(`SELECT anchor, COUNT(DISTINCT to_file) n, GROUP_CONCAT(DISTINCT to_file) targets
           FROM entity_edges WHERE anchor != '' GROUP BY anchor HAVING n >= 2 ORDER BY n DESC LIMIT ?`).all(limit);
      const lines = [`Здоровье перелинковки (${total} сущностей):`];
      lines.push(orphanCount === 0 ? "— сирот нет: на каждую сущность есть хотя бы одна входящая ссылка" : `Сироты (0 входящих ссылок) — ${orphanCount}:`);
      for (const o of orphans)
        lines.push(`- ${o.file}${o.out_deg > 0 ? ` · сама ссылается на ${o.out_deg}` : ""}`);
      if (orphanCount > orphans.length)
        lines.push(`  … и ещё ${orphanCount - orphans.length}`);
      if (brokenCount > 0) {
        lines.push(`Битые внутренние ссылки — ${brokenCount}:`);
        for (const b of broken)
          lines.push(`- ${b.from_file} → ${b.target}`);
        if (brokenCount > broken.length)
          lines.push(`  … и ещё ${brokenCount - broken.length}`);
      }
      if (dups.length > 0) {
        lines.push("Один анкор ведёт на разные цели (размывает сигнал):");
        for (const d of dups)
          lines.push(`- «${d.anchor}» → ${d.n} целей: ${d.targets}`);
      }
      return lines.join(`
`);
    }
    if (name === "passport_reach") {
      const hasTables = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
      if (!hasTables)
        return "Контент-граф не построен: в проекте нет связанных сущностей (md/html/yaml) или паспорт ещё не собран.";
      const needle = typeof args.file === "string" ? args.file.trim().replaceAll("\\", "/") : "";
      if (needle) {
        const node = db.query("SELECT file, kind, in_deg, out_deg, depth, is_hub FROM entity_nodes WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
        if (!node)
          return `Сущность «${needle}» в контент-графе не найдена.`;
        const inbound = db.query("SELECT DISTINCT from_file FROM entity_edges WHERE to_file = ? LIMIT 20").all(node.file);
        const outbound = db.query("SELECT DISTINCT to_file FROM entity_edges WHERE from_file = ? LIMIT 20").all(node.file);
        return [
          `${node.file} · ${node.kind}${node.is_hub ? " · ХАБ" : ""} · глубина от хаба: ${node.depth ?? "недостижима"}`,
          `Ссылаются на неё (${node.in_deg}): ${inbound.map((r) => r.from_file).join(", ") || "—"}`,
          `Сама ссылается (${node.out_deg}): ${outbound.map((r) => r.to_file).join(", ") || "—"}`
        ].join(`
`);
      }
      const hubs = db.query("SELECT file, out_deg FROM entity_nodes WHERE is_hub = 1 ORDER BY out_deg DESC LIMIT 10").all();
      if (hubs.length === 0)
        return "Хабов не найдено (нет страниц, ссылающихся на 5+ сущностей, и index/README со ссылками) — достижимость не считается.";
      const dist = db.query("SELECT depth, COUNT(*) n FROM entity_nodes WHERE depth IS NOT NULL GROUP BY depth ORDER BY depth").all();
      const unreachable = db.query("SELECT file FROM entity_nodes WHERE depth IS NULL AND in_deg > 0 ORDER BY in_deg DESC, file LIMIT 15").all();
      const unreachCount = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE depth IS NULL AND in_deg > 0").get().n;
      const topBack = db.query("SELECT file, in_deg FROM entity_nodes WHERE in_deg > 0 ORDER BY in_deg DESC LIMIT 5").all();
      const zeroBack = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE in_deg = 0").get().n;
      const total = db.query("SELECT COUNT(*) n FROM entity_nodes").get().n;
      return [
        `Хабы (${hubs.length}): ${hubs.map((h) => `${h.file} (→${h.out_deg})`).join(", ")}`,
        `Глубина от хабов (клики): ${dist.map((d) => `${d.depth}:${d.n}`).join(" · ")}`,
        `Недостижимо из хабов: ${unreachCount} из ${total}${unreachable.length > 0 ? ` (со связями, но вне хабового дерева: ${unreachable.map((r) => r.file).join(", ")})` : ""}`,
        `Топ по обратным ссылкам: ${topBack.map((t2) => `${t2.file} (←${t2.in_deg})`).join(", ") || "—"} · без единой обратной: ${zeroBack}`
      ].join(`
`);
    }
    if (name === "passport_related") {
      const needle = String(args.file ?? "").trim().replaceAll("\\", "/");
      if (!needle)
        return "Укажи файл или хвост пути.";
      const node = db.query("SELECT file, n FROM cochange_totals WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
      if (!node)
        return `По файлу «${needle}» истории совместных правок нет (мало коммитов или файл новый).`;
      const partners = db.query(`SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n
           FROM cochange WHERE file_a = ? OR file_b = ? ORDER BY n DESC LIMIT 10`).all(node.file, node.file, node.file);
      if (partners.length === 0)
        return `${node.file}: устойчивых совместных правок не найдено.`;
      return [
        `Вместе с ${node.file} исторически меняются (правок файла в истории: ${node.n}):`,
        ...partners.map((p) => `- ${p.partner} · вместе ${p.n} раз (${Math.round(p.n / node.n * 100)}% его правок)`)
      ].join(`
`);
    }
    return `Неизвестный инструмент: ${name}`;
  } finally {
    db.close();
  }
}
function handleMessage(msg, dataDir) {
  const id = msg.id;
  const method = msg.method;
  if (method === "initialize") {
    const params = msg.params ?? {};
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "symbiont-passport", version: "0.1.0" },
        instructions: "Паспорт проекта Symbiont: выведенные из кода конвенции и их история. Спрашивай при вопросах о стиле/правилах проекта и «почему/с каких пор здесь так принято»."
      }
    };
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/"))
    return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    const params = msg.params ?? {};
    try {
      const text = callTool(params.name ?? "", params.arguments ?? {}, dataDir);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Ошибка паспорта: ${String(e)}` }], isError: true } };
    }
  }
  if (id === undefined)
    return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Метод не поддерживается: ${method}` } };
}

// src/mcp/server.ts
var dataDir = join2(resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root, slugOf(process.cwd()));
var rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed)
    return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  try {
    const res = handleMessage(msg, dataDir);
    if (res)
      process.stdout.write(JSON.stringify(res) + `
`);
  } catch (e) {
    if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e) } }) + `
`);
    }
  }
});
