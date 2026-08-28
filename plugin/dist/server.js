import {
  outlineView,
  resolveIndexed,
  tokensOf
} from "./session-start-psab7pqj.js";
import {
  resolveDataRoot
} from "./session-start-5p4d188q.js";
import {
  FactStore,
  area,
  areaKey,
  areaList,
  factBasis,
  initLang,
  init_i18n,
  mutedKeys,
  openDb,
  sha1,
  slugOf,
  statement,
  t,
  tier
} from "./session-start-99y99kna.js";
import"./session-start-70d7ckvt.js";

// src/mcp/server.ts
import { join as join2 } from "node:path";
import { createInterface } from "node:readline";

// src/mcp/handlers.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
init_i18n();
function toolDefs() {
  return [
    {
      name: "passport_conventions",
      description: t(`Конвенции проекта из паспорта Symbiont: выведенные из кода правила с распространённостью и ярусом уверенности (закон/привычка/гипотеза). Опционально фильтр по области (${areaList()}).`, `Project conventions from the Symbiont passport: rules derived from the code, with prevalence and a confidence tier (law/habit/hypothesis). Optional filter by area (${areaList()}).`),
      inputSchema: {
        type: "object",
        properties: { area: { type: "string", description: t("фильтр по области (опционально)", "filter by area (optional)") } }
      }
    },
    {
      name: "passport_history",
      description: t("История правила в журнале паспорта: как менялся вердикт со временем (вытеснения, даты, числа). Ключ берётся из passport_conventions ДОСЛОВНО — он остаётся в той форме, в какой лежит в журнале, и не переводится.", "The history of a rule in the passport journal: how the verdict changed over time (supersessions, dates, numbers). Take the key VERBATIM from passport_conventions — it stays in the form it has in the journal and is never translated."),
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: t("ключ правила из passport_conventions", "the rule key, as printed by passport_conventions") } },
        required: ["key"]
      }
    },
    {
      name: "passport_map",
      description: t("Карта проекта из паспорта Symbiont: ключевые модули по связности импортов (PageRank, вход/исход) — быстрый обзор структуры без чтения файлов.", "A map of the project from the Symbiont passport: key modules by import connectivity (PageRank, in/out degree) — a quick overview of the structure without reading files."),
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: t("сколько модулей показать (по умолчанию 15)", "how many modules to show (15 by default)") } }
      }
    },
    {
      name: "passport_impact",
      description: t("Радиус влияния файла: кто зависит от него по импортам (транзитивно, по уровням глубины) — «что может сломаться, если менять X». Принимает имя файла или его хвост пути.", 'The blast radius of a file: what depends on it through imports (transitively, by depth level) — "what may break if X changes". Takes a file name or a path suffix.'),
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", description: t("файл или хвост пути (например payments.ts или utils/api.ts)", "a file or a path suffix (for example payments.ts or utils/api.ts)") } },
        required: ["file"]
      }
    },
    {
      name: "passport_orphans",
      description: t("Здоровье перелинковки контента (статьи/хабы/YAML-сущности): сироты без входящих ссылок, битые внутренние ссылки, одинаковые анкоры на разные цели. Детерминированно из доменного графа сущностей.", "The health of content interlinking (articles, hubs, YAML entities): orphans with no inbound links, broken internal links, identical anchors pointing to different targets. Computed deterministically from the domain entity graph."),
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: t("сколько строк на секцию (по умолчанию 15)", "how many rows per section (15 by default)") } }
      }
    },
    {
      name: "passport_reach",
      description: t("Достижимость контента из хабов: глубина каждой сущности (клики от хаба), недостижимые, распределение обратных ссылок. С аргументом file — срез одной сущности (глубина, кто ссылается, куда ссылается).", "Reachability of content from hubs: the depth of every entity (clicks from a hub), what is unreachable, how backlinks are distributed. With the file argument — a slice for one entity (its depth, what links to it, what it links to)."),
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", description: t("сущность или хвост пути (опционально)", "an entity or a path suffix (optional)") } }
      }
    },
    {
      name: "passport_related",
      description: t("Прецеденты правок из git-истории: какие файлы исторически меняются ВМЕСТЕ с указанным (co-change) — «правишь X — обычно правят и Y» (миграции к схеме, тесты к коду и т.п.).", 'Edit precedents from the git history: which files historically change TOGETHER with the given one (co-change) — "when X is edited, Y usually is too" (migrations with a schema, tests with code, and so on).'),
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", description: t("файл или хвост пути", "a file or a path suffix") } },
        required: ["file"]
      }
    },
    {
      name: "passport_outline",
      description: t("Оглавление файла из паспорта: какие функции, классы и методы в нём объявлены, на каких строках и во сколько токенов обойдётся выемка каждого — БЕЗ чтения файла (сотни токенов вместо десятков тысяч). Готовый ответ индекса, разбор в этот момент не запускается.", "A file outline from the passport: which functions, classes and methods it declares, on which lines, and what each one costs to pull out — WITHOUT reading the file (hundreds of tokens instead of tens of thousands). Served from the index; nothing is parsed at call time."),
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", description: t("файл или хвост пути", "a file or a path suffix") } },
        required: ["file"]
      }
    },
    {
      name: "passport_unfold",
      description: t("Один символ файла целиком — по границам из оглавления, со строками для правки. Дешёвая замена чтению всего файла, когда имя нужного символа известно (его даёт passport_outline). Отказывается работать, если файл изменился после снятия оглавления, — вместо того чтобы выдать чужие строки.", "One symbol of a file in full — by the boundaries from the outline, with line numbers ready for editing. The cheap replacement for reading the whole file once the symbol name is known (passport_outline gives it). Refuses if the file changed after the outline was taken, rather than handing back the wrong lines."),
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: t("файл или хвост пути", "a file or a path suffix") },
          symbol: { type: "string", description: t("имя символа из passport_outline (например FactStore.assertAll)", "a symbol name from passport_outline (for example FactStore.assertAll)") }
        },
        required: ["file", "symbol"]
      }
    }
  ];
}
var factLine = (f) => {
  const measured = !f.source.startsWith("llm:");
  return `${f.key} · ${statement(f.statement)} · ${tier(f.tier)} · ${factBasis(f)}${measured ? ` · ${t("замер", "measured")} ${f.seen_at.slice(0, 10)}` : ""}`;
};
var readSource = (projectRoot) => (rel) => {
  try {
    return readFileSync(join(projectRoot, rel), "utf8");
  } catch {
    return null;
  }
};
function callTool(name, args, dataDir, projectRoot = process.cwd()) {
  const dbPath = join(dataDir, "passport.db");
  if (!existsSync(dbPath)) {
    return t("Паспорт не построен для этого проекта. Он строится автоматически при старте сессии (SessionStart-хук Symbiont).", "The passport has not been built for this project. It is built automatically at session start (the Symbiont SessionStart hook).");
  }
  const db = openDb(dbPath, { readonly: true });
  try {
    const store = new FactStore(db);
    if (name === "passport_conventions") {
      const muted = mutedKeys(db);
      let facts = store.active(Date.now(), true);
      const asked = typeof args.area === "string" ? args.area.trim() : "";
      const key = asked ? areaKey(asked) : "";
      if (key)
        facts = facts.filter((f) => f.area.toLowerCase().includes(key.toLowerCase()));
      if (facts.length === 0) {
        return asked ? t(`Фактов по области «${area(key)}» нет.`, `No facts for the area "${area(key)}".`) : t("Фактов пока нет.", "No facts yet.");
      }
      return [
        t("Легенда: ключ · факт · ярус · распространённость · дата замера", "Legend: key · fact · tier · prevalence · measurement date"),
        ...facts.map((f) => muted.has(f.key) ? `${factLine(f)} · ${t("⊘ приглушён владельцем — не подаётся, не судится", "⊘ muted by the owner — not delivered, not enforced")}` : factLine(f))
      ].join(`
`);
    }
    if (name === "passport_history") {
      const key = String(args.key ?? "").trim();
      const hist = store.history(key);
      if (hist.length === 0) {
        return t(`Истории по ключу «${key}» нет. Ключи — в passport_conventions.`, `No history for the key "${key}". Keys come from passport_conventions.`);
      }
      const mark = (f) => f.superseded_by == null ? t("● действует", "● in force") : t("○ вытеснен ", "○ superseded");
      return [
        t(`История «${key}» (новые сверху; вытеснённые помечены):`, `History of "${key}" (newest first; superseded entries are marked):`),
        ...hist.map((f) => `${mark(f)} · ${factLine(f)} · ${t("заявлен", "asserted")} ${f.asserted_at.slice(0, 10)}`)
      ].join(`
`);
    }
    if (name === "passport_map") {
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
      const rows = db.query("SELECT file, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(limit);
      if (rows.length === 0) {
        return t("Граф не построен (или в проекте нет внутренних импортов).", "The graph has not been built (or the project has no internal imports).");
      }
      return [
        t("Легенда: файл · вход (сколько файлов зависят) · исход (от скольких зависит); порядок — важность (PageRank)", "Legend: file · in (how many files depend on it) · out (how many it depends on); ordered by importance (PageRank)"),
        ...rows.map((r) => `${r.file} · ${t("вход", "in")}:${r.in_deg} · ${t("исход", "out")}:${r.out_deg}`)
      ].join(`
`);
    }
    if (name === "passport_impact") {
      const needle = String(args.file ?? "").trim().replaceAll("\\", "/");
      if (!needle)
        return t("Укажи файл или хвост пути.", "Name a file or a path suffix.");
      const node = db.query("SELECT file FROM graph_nodes WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
      if (!node)
        return t(`Файл «${needle}» в графе не найден. Список — в passport_map.`, `File "${needle}" is not in the graph. See passport_map for the list.`);
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
      if (levels.length === 0) {
        return t(`${node.file}: прямых зависимых по импортам нет — радиус влияния минимальный.`, `${node.file}: nothing depends on it through imports — the blast radius is minimal.`);
      }
      const total = levels.reduce((s, l) => s + l.length, 0);
      const cut = visited.size >= CAP ? t(" · обрезано по лимиту", " · truncated at the limit") : "";
      return [
        t(`Радиус влияния ${node.file}: ${total} зависимых (по уровням; 1 = импортируют напрямую)${cut}`, `Blast radius of ${node.file}: ${total} dependents (by level; 1 = imports it directly)${cut}`),
        ...levels.map((l, i) => `${i + 1}: ${l.join(", ")}`)
      ].join(`
`);
    }
    if (name === "passport_orphans") {
      const hasTables = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
      if (!hasTables) {
        return t("Контент-граф не построен: в проекте нет связанных сущностей (md/html/yaml) или паспорт ещё не собран.", "The content graph has not been built: the project has no linked entities (md/html/yaml), or the passport has not been assembled yet.");
      }
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
      const total = db.query("SELECT COUNT(*) n FROM entity_nodes").get().n;
      if (total === 0)
        return t("Контент-граф пуст: сущностей (md/html/yaml) не найдено.", "The content graph is empty: no entities (md/html/yaml) were found.");
      const orphans = db.query("SELECT file, out_deg FROM entity_nodes WHERE in_deg = 0 AND is_hub = 0 ORDER BY out_deg DESC, file LIMIT ?").all(limit);
      const orphanCount = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE in_deg = 0 AND is_hub = 0").get().n;
      const broken = db.query("SELECT from_file, target FROM entity_broken ORDER BY from_file LIMIT ?").all(limit);
      const brokenCount = db.query("SELECT COUNT(*) n FROM entity_broken").get().n;
      const dups = db.query(`SELECT anchor, COUNT(DISTINCT to_file) n, GROUP_CONCAT(DISTINCT to_file) targets
           FROM entity_edges WHERE anchor != '' GROUP BY anchor HAVING n >= 2 ORDER BY n DESC LIMIT ?`).all(limit);
      const lines = [t(`Здоровье перелинковки (${total} сущностей):`, `Interlinking health (${total} entities):`)];
      lines.push(orphanCount === 0 ? t("— сирот нет: на каждую сущность есть хотя бы одна входящая ссылка", "— no orphans: every entity has at least one inbound link") : t(`Сироты (0 входящих ссылок) — ${orphanCount}:`, `Orphans (0 inbound links) — ${orphanCount}:`));
      for (const o of orphans)
        lines.push(`- ${o.file}${o.out_deg > 0 ? t(` · сама ссылается на ${o.out_deg}`, ` · links out to ${o.out_deg}`) : ""}`);
      if (orphanCount > orphans.length)
        lines.push(t(`  … и ещё ${orphanCount - orphans.length}`, `  … and ${orphanCount - orphans.length} more`));
      if (brokenCount > 0) {
        lines.push(t(`Битые внутренние ссылки — ${brokenCount}:`, `Broken internal links — ${brokenCount}:`));
        for (const b of broken)
          lines.push(`- ${b.from_file} → ${b.target}`);
        if (brokenCount > broken.length)
          lines.push(t(`  … и ещё ${brokenCount - broken.length}`, `  … and ${brokenCount - broken.length} more`));
      }
      if (dups.length > 0) {
        lines.push(t("Один анкор ведёт на разные цели (размывает сигнал):", "One anchor points to different targets (this dilutes the signal):"));
        for (const d of dups)
          lines.push(`- «${d.anchor}» → ${d.n} ${t("целей", "targets")}: ${d.targets}`);
      }
      return lines.join(`
`);
    }
    if (name === "passport_reach") {
      const hasTables = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
      if (!hasTables) {
        return t("Контент-граф не построен: в проекте нет связанных сущностей (md/html/yaml) или паспорт ещё не собран.", "The content graph has not been built: the project has no linked entities (md/html/yaml), or the passport has not been assembled yet.");
      }
      const needle = typeof args.file === "string" ? args.file.trim().replaceAll("\\", "/") : "";
      if (needle) {
        const node = db.query("SELECT file, kind, in_deg, out_deg, depth, is_hub FROM entity_nodes WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
        if (!node)
          return t(`Сущность «${needle}» в контент-графе не найдена.`, `Entity "${needle}" is not in the content graph.`);
        const inbound = db.query("SELECT DISTINCT from_file FROM entity_edges WHERE to_file = ? LIMIT 20").all(node.file);
        const outbound = db.query("SELECT DISTINCT to_file FROM entity_edges WHERE from_file = ? LIMIT 20").all(node.file);
        const hub = node.is_hub ? t(" · ХАБ", " · HUB") : "";
        const depth = node.depth ?? t("недостижима", "unreachable");
        return [
          t(`${node.file} · ${node.kind}${hub} · глубина от хаба: ${depth}`, `${node.file} · ${node.kind}${hub} · depth from a hub: ${depth}`),
          t(`Ссылаются на неё (${node.in_deg}): `, `Linked from (${node.in_deg}): `) + (inbound.map((r) => r.from_file).join(", ") || "—"),
          t(`Сама ссылается (${node.out_deg}): `, `Links out (${node.out_deg}): `) + (outbound.map((r) => r.to_file).join(", ") || "—")
        ].join(`
`);
      }
      const hubs = db.query("SELECT file, out_deg FROM entity_nodes WHERE is_hub = 1 ORDER BY out_deg DESC LIMIT 10").all();
      if (hubs.length === 0) {
        return t("Хабов не найдено (нет страниц, ссылающихся на 5+ сущностей, и index/README со ссылками) — достижимость не считается.", "No hubs were found (no page links to 5+ entities, and no index/README with links) — reachability is not computed.");
      }
      const dist = db.query("SELECT depth, COUNT(*) n FROM entity_nodes WHERE depth IS NOT NULL GROUP BY depth ORDER BY depth").all();
      const unreachable = db.query("SELECT file FROM entity_nodes WHERE depth IS NULL AND in_deg > 0 ORDER BY in_deg DESC, file LIMIT 15").all();
      const unreachCount = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE depth IS NULL AND in_deg > 0").get().n;
      const topBack = db.query("SELECT file, in_deg FROM entity_nodes WHERE in_deg > 0 ORDER BY in_deg DESC LIMIT 5").all();
      const zeroBack = db.query("SELECT COUNT(*) n FROM entity_nodes WHERE in_deg = 0").get().n;
      const total = db.query("SELECT COUNT(*) n FROM entity_nodes").get().n;
      const outside = unreachable.length > 0 ? t(` (со связями, но вне хабового дерева: ${unreachable.map((r) => r.file).join(", ")})`, ` (linked, but outside the hub tree: ${unreachable.map((r) => r.file).join(", ")})`) : "";
      return [
        t(`Хабы (${hubs.length}): `, `Hubs (${hubs.length}): `) + hubs.map((h) => `${h.file} (→${h.out_deg})`).join(", "),
        t("Глубина от хабов (клики): ", "Depth from hubs (clicks): ") + dist.map((d) => `${d.depth}:${d.n}`).join(" · "),
        t(`Недостижимо из хабов: ${unreachCount} из ${total}${outside}`, `Unreachable from hubs: ${unreachCount} of ${total}${outside}`),
        t("Топ по обратным ссылкам: ", "Top by backlinks: ") + (topBack.map((r) => `${r.file} (←${r.in_deg})`).join(", ") || "—") + t(` · без единой обратной: ${zeroBack}`, ` · with no backlink at all: ${zeroBack}`)
      ].join(`
`);
    }
    if (name === "passport_related") {
      const needle = String(args.file ?? "").trim().replaceAll("\\", "/");
      if (!needle)
        return t("Укажи файл или хвост пути.", "Name a file or a path suffix.");
      const node = db.query("SELECT file, n FROM cochange_totals WHERE file = ? OR file LIKE '%' || ? ORDER BY LENGTH(file) LIMIT 1").get(needle, needle);
      if (!node) {
        return t(`По файлу «${needle}» истории совместных правок нет (мало коммитов или файл новый).`, `There is no co-change history for "${needle}" (too few commits, or the file is new).`);
      }
      const partners = db.query(`SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END AS partner, n
           FROM cochange WHERE file_a = ? OR file_b = ? ORDER BY n DESC LIMIT 10`).all(node.file, node.file, node.file);
      if (partners.length === 0)
        return t(`${node.file}: устойчивых совместных правок не найдено.`, `${node.file}: no stable co-change pattern was found.`);
      return [
        t(`Вместе с ${node.file} исторически меняются (правок файла в истории: ${node.n}):`, `Historically changed together with ${node.file} (edits of that file in history: ${node.n}):`),
        ...partners.map((p) => t(`- ${p.partner} · вместе ${p.n} раз (${Math.round(p.n / node.n * 100)}% его правок)`, `- ${p.partner} · together ${p.n} times (${Math.round(p.n / node.n * 100)}% of its edits)`))
      ].join(`
`);
    }
    if (name === "passport_outline" || name === "passport_unfold") {
      const needle = String(args.file ?? "").trim();
      if (!needle)
        return t("Укажи файл или хвост пути.", "Name a file or a path suffix.");
      const file = resolveIndexed(db, needle);
      if (!file) {
        return t(`Оглавления по «${needle}» нет: файл не найден в индексе структуры (он строится фоном по коду на поддерживаемых языках). Читай файл обычным способом.`, `No outline for "${needle}": the file is not in the structure index (built in the background for code in supported languages). Read the file the usual way.`);
      }
      const view = outlineView(db, file, readSource(projectRoot), sha1);
      if (name === "passport_outline") {
        if (view.rows.length === 0) {
          return t(`${file}: объявленных символов не найдено — файл читается целиком.`, `${file}: no declared symbols found — read the file in full.`);
        }
        const width = Math.max(...view.rows.map((r) => r.kind.length));
        const head = view.fresh ? t(`${file} · оглавление снято по текущему содержимому`, `${file} · outline matches the file on disk`) : t(`${file} · ⚠ файл изменился после снятия оглавления: имена верны, номера строк могли сместиться (фон пересчитает)`, `${file} · ⚠ the file changed after the outline was taken: names hold, line numbers may have moved (the background will refresh it)`);
        return [
          head,
          t("Легенда: строки · вид · имя · ≈цена выемки", "Legend: lines · kind · name · ≈cost to pull out"),
          ...view.rows.map((r) => `  ${`${r.line}-${r.endLine}`.padEnd(11)} ${r.kind.padEnd(width)}  ${r.name} · ~${tokensOf(r.chars)}t`),
          view.wholeFileTokens > 0 ? t(`Символов: ${view.rows.length}. Файл целиком ≈${view.wholeFileTokens}t — бери нужное через passport_unfold(file, symbol).`, `Symbols: ${view.rows.length}. The whole file is ≈${view.wholeFileTokens}t — take what you need with passport_unfold(file, symbol).`) : t(`Символов: ${view.rows.length}. Бери нужное через passport_unfold(file, symbol).`, `Symbols: ${view.rows.length}. Take what you need with passport_unfold(file, symbol).`)
        ].join(`
`);
      }
      const wanted = String(args.symbol ?? "").trim();
      if (!wanted)
        return t("Укажи имя символа (его печатает passport_outline).", "Name a symbol (passport_outline prints them).");
      const lower = wanted.toLowerCase();
      const hit = view.rows.find((r) => r.name === wanted) ?? view.rows.find((r) => r.name.toLowerCase() === lower) ?? view.rows.find((r) => r.name.toLowerCase().endsWith(`.${lower}`)) ?? null;
      if (!hit) {
        const near = view.rows.slice(0, 12).map((r) => r.name).join(", ");
        return t(`В ${file} символа «${wanted}» нет. Есть: ${near}${view.rows.length > 12 ? ", …" : ""} (полный список — passport_outline).`, `${file} has no symbol "${wanted}". It has: ${near}${view.rows.length > 12 ? ", …" : ""} (full list — passport_outline).`);
      }
      if (!view.fresh) {
        return t(`${file} изменился после снятия оглавления — границы «${wanted}» указывают в прежнюю редакцию, поэтому выемка не делается. Прочитай файл обычным способом; фон пересчитает структуру сам.`, `${file} changed after the outline was taken — the boundaries of "${wanted}" point at the previous revision, so nothing is pulled out. Read the file the usual way; the background will refresh the structure.`);
      }
      const text = readSource(projectRoot)(file);
      if (text === null)
        return t(`${file} не читается с диска.`, `${file} cannot be read from disk.`);
      const lines = text.split(`
`);
      const from = Math.max(1, hit.line);
      const to = Math.min(lines.length, hit.endLine);
      const pad = String(to).length;
      const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(pad)}  ${l}`);
      return [
        t(`${file} · ${hit.kind} ${hit.name} · строки ${from}-${to} · ~${tokensOf(hit.chars)}t (файл целиком ≈${view.wholeFileTokens}t)`, `${file} · ${hit.kind} ${hit.name} · lines ${from}-${to} · ~${tokensOf(hit.chars)}t (the whole file is ≈${view.wholeFileTokens}t)`),
        ...body
      ].join(`
`);
    }
    return t(`Неизвестный инструмент: ${name}`, `Unknown tool: ${name}`);
  } finally {
    db.close();
  }
}
function handleMessage(msg, dataDir, projectRoot = process.cwd()) {
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
        instructions: t("Паспорт проекта Symbiont: выведенные из кода конвенции и их история. Спрашивай при вопросах о стиле/правилах проекта и «почему/с каких пор здесь так принято».", "The Symbiont project passport: conventions derived from the code and their history. Consult it for questions about the project's style and rules, and about why — and since when — something is done this way here.")
      }
    };
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/"))
    return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: toolDefs() } };
  }
  if (method === "tools/call") {
    const params = msg.params ?? {};
    try {
      const text = callTool(params.name ?? "", params.arguments ?? {}, dataDir, projectRoot);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `${t("Ошибка паспорта", "Passport error")}: ${String(e)}` }], isError: true }
      };
    }
  }
  if (id === undefined)
    return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `${t("Метод не поддерживается", "Method not supported")}: ${method}` } };
}

// src/mcp/server.ts
init_i18n();
var dataDir = join2(resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data")).root, slugOf(process.cwd()));
initLang(dataDir, process.cwd());
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
    const res = handleMessage(msg, dataDir, process.cwd());
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
