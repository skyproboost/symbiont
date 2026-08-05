import {
  readGateMode
} from "./session-start-g0g6tesq.js";
import {
  networkDownUntil,
  readAvailability,
  renderAvailability
} from "./session-start-vd1nr52e.js";
import {
  contentHashOf,
  countLessons,
  summaryFor,
  summaryStats
} from "./session-start-305kkwpz.js";
import {
  migrateLegacyPassports,
  resolveDataRoot,
  stripDataFlag
} from "./session-start-12ctfabv.js";
import {
  REPORTED_WORKS,
  auditTruth,
  chooseLang,
  computeDrift,
  computeHealth,
  effectiveHeat,
  hotspotsFromGit,
  initLang,
  init_i18n,
  isDue,
  lastRun,
  openDb,
  rankKinds,
  readHeatRows,
  renderDrift,
  renderDriftReport,
  renderTruth,
  renderUtility,
  silentSpawnOptions,
  slugOf,
  sourceLabel,
  statement,
  t,
  tier
} from "./session-start-p2v9f776.js";
import {
  __require
} from "./session-start-70d7ckvt.js";

// src/cli/symbiont.ts
import { join as join2, basename } from "node:path";
import { existsSync as existsSync2, writeFileSync } from "node:fs";

// src/cli/reports.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
init_i18n();
var ago = (iso) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins) || mins < 0)
    return iso;
  if (mins < 1)
    return t("только что", "just now");
  if (mins < 60)
    return t(`${mins}м назад`, `${mins}m ago`);
  if (mins < 48 * 60)
    return t(`${Math.round(mins / 60)}ч назад`, `${Math.round(mins / 60)}h ago`);
  return t(`${Math.round(mins / 1440)}д назад`, `${Math.round(mins / 1440)}d ago`);
};
var q = (db, sql, ...args) => db.query(sql).all(...args);
var one = (db, sql, ...args) => db.query(sql).get(...args);
var tableExists = (db, name) => one(db, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?", name).n > 0;
var bar = (n, max, width = 16) => n <= 0 ? "" : "█".repeat(Math.max(1, Math.round(n / Math.max(max, 1) * width)));
var pad = (s, w) => s.length >= w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
var num = (n, w) => String(n).padStart(w);
function buildStatusReport(dataDir) {
  const dbPath = join(dataDir, "passport.db");
  if (!existsSync(dbPath))
    return t("Symbiont: паспорт для этого проекта ещё не построен (строится при старте сессии).", "Symbiont: no passport for this project yet — it is built when a session starts.");
  const db = openDb(dbPath, { readonly: true });
  try {
    const L = [t("Symbiont · статус паспорта", "Symbiont · passport status"), ""];
    const tiers = q(db, "SELECT tier, COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL GROUP BY tier ORDER BY n DESC");
    const journal = one(db, "SELECT COUNT(*) n FROM fact_journal").n;
    const superseded = one(db, "SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NOT NULL").n;
    const lastSeen = one(db, "SELECT MAX(seen_at) t FROM fact_journal")?.t;
    const maxTier = Math.max(...tiers.map((t2) => t2.n), 1);
    let due = 0;
    try {
      const llm = q(db, "SELECT stability, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' AND stability IS NOT NULL");
      due = llm.filter((r) => isDue(r.stability, r.seen_at)).length;
    } catch {}
    L.push(` ${pad(t("Петля фактов", "Fact loop"), 16)} ${t("журнал", "journal")} ${journal} · ${t("заменено", "superseded")} ${superseded}${lastSeen ? ` · ${t("замер", "measured")} ${lastSeen.slice(0, 10)}` : ""}${due > 0 ? ` · ${t("к перепроверке", "due for recheck")}: ${due} (${t("фон сделает сам", "background will do it")})` : ""}`);
    for (const row of tiers)
      L.push(`   ${pad(tier(row.tier), 16)}${pad(bar(row.n, maxTier), 18)}${row.n}`);
    L.push("");
    if (tableExists(db, "graph_nodes")) {
      const nodes = one(db, "SELECT COUNT(*) n FROM graph_nodes").n;
      const edges = one(db, "SELECT COUNT(*) n FROM graph_edges").n;
      L.push(` ${pad(t("Граф", "Graph"), 16)} ${t("узлов", "nodes")} ${nodes} · ${t("рёбер", "edges")} ${edges}`, "");
    }
    const driftLine = renderDrift(computeDrift(db));
    if (driftLine)
      L.push(driftLine, "");
    if (tableExists(db, "sessions")) {
      const total = one(db, "SELECT COUNT(*) n FROM sessions").n;
      const open = one(db, "SELECT COUNT(*) n FROM sessions WHERE closed_at IS NULL").n;
      const dirty = one(db, "SELECT COUNT(*) n FROM sessions WHERE close_reason='reconciled-dirty'").n;
      L.push(` ${pad(t("Сессии", "Sessions"), 16)} ${t("всего", "total")} ${total} · ${t("открытых", "open")} ${open} · ${t("обрывов", "interrupted")} ${dirty}`, "");
    }
    const jit = tableExists(db, "jit_log") ? one(db, "SELECT COUNT(*) n FROM jit_log").n : 0;
    const gates = tableExists(db, "gate_log") ? q(db, "SELECT law, COUNT(*) n FROM gate_log GROUP BY law ORDER BY n DESC LIMIT 5") : [];
    const gateTotal = gates.reduce((s, g) => s + g.n, 0);
    const corrections = tableExists(db, "corrections") ? one(db, "SELECT COUNT(*) n FROM corrections").n : 0;
    const lessons = countLessons(db);
    const gateMode = readGateMode(dataDir) === "block" ? t("блокировка", "blocking") : "dry-run";
    L.push(` ${pad(t("Каналы", "Channels"), 16)} ${t("срезов по файлам", "file briefs")} ${jit} · ${t("гейт", "gate")} (${gateMode}): ${t("поимок", "catches")} ${gateTotal}${gateTotal === 0 ? t(" — чисто", " — clean") : ""} · ${t("поправок владельца", "owner corrections")}: ${corrections}${lessons > 0 ? ` · ${t("уроков зон", "zone lessons")}: ${lessons}` : ""}`);
    try {
      const surfaced = one(db, "SELECT COUNT(*) n FROM jit_log WHERE file NOT LIKE '#%'")?.n ?? 0;
      const used = one(db, "SELECT COUNT(*) n FROM jit_log WHERE file NOT LIKE '#%' AND used=1")?.n ?? 0;
      if (surfaced > 0)
        L.push(`   ${pad(t("окупаемость", "payback"), 15)} ${t("подано файлов", "files surfaced")} ${surfaced} · ${t("пригодилось", "used")} ${used} (${Math.round(used / surfaced * 100)}%)`);
    } catch {}
    try {
      const meta = one(db, "SELECT value FROM learn_meta WHERE key='auto_learn'");
      if (meta) {
        const j = JSON.parse(meta.value);
        L.push(`   ${pad(t("авто-обучение", "self-learning"), 15)} ${ago(j.at)} · ${j.note}`);
      } else {
        L.push(`   ${pad(t("авто-обучение", "self-learning"), 15)} ${t("ещё не бегало (стартует само, когда появится сырьё)", "has not run yet — starts on its own once there is material")}`);
      }
    } catch {}
    if (gates.length > 0) {
      const maxGate = Math.max(...gates.map((g) => g.n), 1);
      for (const g of gates)
        L.push(`   ${pad(statement(g.law).split("—")[0].trim(), 20)}${pad(bar(g.n, maxGate, 12), 14)}${g.n}`);
    }
    L.push("");
    try {
      const beats = readdirSync(dataDir).filter((f) => f.startsWith("heartbeat") && f.endsWith(".json")).map((f) => {
        try {
          return JSON.parse(readFileSync(join(dataDir, f), "utf8"));
        } catch {
          return null;
        }
      }).filter((b) => b !== null && !!b.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      if (beats.length > 0) {
        L.push(t(" Пульс каналов", " Channel pulse"));
        for (const b of beats)
          L.push(`   ${pad(b.channel, 18)}${ago(b.at)}`);
        L.push("");
      }
    } catch {}
    try {
      const vec = renderAvailability(readAvailability(dataDir), Date.now());
      if (vec.length > 0) {
        L.push(t(" Модели (для глубоких задач — качество вперёд · для рутины — цена вперёд)", " Models (deep tasks — quality first · routine — cost first)"));
        for (const line of vec)
          L.push(`   ${line}`);
        L.push("");
      }
    } catch {}
    try {
      const until = networkDownUntil(dataDir, Date.now());
      if (until !== null) {
        L.push(` ${pad(t("Сеть", "Network"), 16)} ${t("недоступна — следующая проба после", "unavailable — next attempt after")} ${new Date(until).toLocaleTimeString(t("ru-RU", "en-GB"), { hour: "2-digit", minute: "2-digit" })}`, "");
      }
    } catch {}
    try {
      const z = summaryStats(db);
      if (z.have > 0 || z.pending > 0) {
        L.push(` ${pad(t("Роли файлов", "File roles"), 16)} ${t("выведены у", "derived for")} ${z.have} ${t("узлов", "nodes")}${z.pending > 0 ? ` · ${t("в очереди", "queued")} ${z.pending} (${t("доберёт фоновая работа", "background work will finish")})` : ""}`);
        L.push("");
      }
    } catch {}
    try {
      const heat = effectiveHeat(readHeatRows(db), Date.now());
      const hot = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (hot.length > 0) {
        L.push(t(" Горячие узлы (недавняя работа, остывают)", " Hot nodes (recent work, cooling down)"));
        const max = hot[0][1];
        for (const h of hot)
          L.push(`   ${pad(h[0], 34)}${bar(h[1], max, 10)} ${h[1].toFixed(1)}`);
      }
    } catch {}
    return L.join(`
`);
  } finally {
    db.close();
  }
}
var TIER_STAR = ["✦", "●", "✧", "·"];
var TIER_HEAT = ["█", "▓", "▒", "░"];
function tierOfRank(pos, total) {
  const pct = pos / Math.max(total, 1);
  if (pct <= 0.05)
    return 0;
  if (pct <= 0.2)
    return 1;
  if (pct <= 0.5)
    return 2;
  return 3;
}
var segmentOf = (file) => {
  const i = file.indexOf("/");
  return i === -1 ? "(корень)" : file.slice(0, i) + "/";
};
function heatBar(tierCounts, width = 24) {
  const total = tierCounts.reduce((s, n) => s + n, 0);
  if (total === 0)
    return "░".repeat(width);
  let out = "";
  for (let t2 = 0;t2 < 4; t2++) {
    if (tierCounts[t2] === 0)
      continue;
    out += TIER_HEAT[t2].repeat(Math.max(1, Math.round(tierCounts[t2] / total * width)));
  }
  return out.slice(0, width).padEnd(width, TIER_HEAT[3]);
}
function buildMapReport(dataDir, zone) {
  const dbPath = join(dataDir, "passport.db");
  if (!existsSync(dbPath))
    return t("Symbiont: паспорт не построен.", "Symbiont: passport not built.");
  const db = openDb(dbPath, { readonly: true });
  try {
    if (!tableExists(db, "graph_nodes"))
      return t("Symbiont: граф не построен.", "Symbiont: graph not built.");
    const all = q(db, "SELECT file, rank, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC");
    if (all.length === 0)
      return t("Symbiont: в графе нет узлов (нет внутренних импортов).", "Symbiont: the graph has no nodes (no internal imports).");
    const tierByFile = new Map(all.map((n, i) => [n.file, tierOfRank(i, all.length)]));
    if (zone) {
      const z = zone.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "");
      const nodes = all.filter((n) => n.file.toLowerCase().startsWith(z));
      if (nodes.length === 0)
        return t(`Symbiont: зона «${zone}» в графе не найдена. Список зон — /symbiont:status без аргумента.`, `Symbiont: area “${zone}” is not in the graph. Run /symbiont:status with no arguments to list areas.`);
      const L2 = [
        t(`Symbiont · зона ${zone} · ${nodes.length} узлов`, `Symbiont · area ${zone} · ${nodes.length} nodes`),
        "",
        `      ${pad(t("файл", "file"), 42)}${t("вход", "in").padStart(6)}${t("исход", "out").padStart(7)}`,
        `      ${"─".repeat(55)}`
      ];
      for (const n of nodes.slice(0, 25)) {
        L2.push(`   ${TIER_STAR[tierByFile.get(n.file)]}  ${pad(n.file, 42)}${num(n.in_deg, 6)}${num(n.out_deg, 7)}`);
        const z1 = summaryFor(db, n.file, contentHashOf(db, n.file));
        if (z1)
          L2.push(`      ${z1}`);
      }
      if (nodes.length > 25)
        L2.push("", t(`   … и ещё ${nodes.length - 25} · полный радиус узла: passport_impact`, `   … and ${nodes.length - 25} more · full node radius: passport_impact`));
      return L2.join(`
`);
    }
    const groups = new Map;
    for (const n of all) {
      const seg = segmentOf(n.file);
      if (!groups.has(seg))
        groups.set(seg, []);
      groups.get(seg).push(n);
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].reduce((s, n) => s + n.rank, 0) - a[1].reduce((s, n) => s + n.rank, 0));
    const edgeCount = one(db, "SELECT COUNT(*) n FROM graph_edges").n;
    const L = [
      t(`Symbiont · карта проекта · ${all.length} узлов · ${edgeCount} рёбер`, `Symbiont · project map · ${all.length} nodes · ${edgeCount} edges`),
      t(" Состав созвездия:  █ ядро (топ-5%) · ▓ важный · ▒ заметный · ░ рядовой", " Groups: █ core (top 5%) · ▓ important · ▒ notable · ░ ordinary"),
      ""
    ];
    for (const [seg, members] of ordered.slice(0, 10)) {
      const counts = [0, 0, 0, 0];
      for (const m of members)
        counts[tierByFile.get(m.file)]++;
      L.push(` ${pad(seg, 12)}${heatBar(counts)}  ${num(members.length, 5)}`);
      for (const m of members.slice(0, 3)) {
        const rank = tierByFile.get(m.file);
        if (rank >= 2)
          continue;
        const short = seg === "(корень)" ? m.file : m.file.slice(seg.length);
        L.push(`     ${TIER_STAR[rank]} ${pad(short, 34)}${t("вход", "in")} ${num(m.in_deg, 4)}`);
      }
      L.push("");
    }
    if (ordered.length > 10)
      L.push(t(` … и ещё ${ordered.length - 10} групп`, ` … and ${ordered.length - 10} more groups`), "");
    L.push(t(" Зум в зону: /symbiont:status <каталог> · кто зависит от файла: passport_impact", " Zoom into an area: /symbiont:status <directory> · who depends on a file: passport_impact"));
    return L.join(`
`);
  } finally {
    db.close();
  }
}

// src/cli/graph-html.ts
var MAX_NODES = 220;
var zoneOf = (file) => {
  const parts = file.split("/");
  return parts.length <= 1 ? "(корень)" : parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
};
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function collectGraphData(db, project, stats, zone = null, limit = MAX_NODES) {
  const rows = zone ? db.query("SELECT file, rank, in_deg, out_deg FROM graph_nodes WHERE file LIKE ? ORDER BY rank DESC LIMIT ?").all(`${zone}%`, limit) : db.query("SELECT file, rank, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(limit);
  const heat = new Map;
  try {
    for (const r of db.query("SELECT file, heat FROM node_heat").all()) {
      heat.set(r.file, r.heat);
    }
  } catch {}
  const roles = new Map;
  try {
    for (const r of db.query("SELECT file, z1 FROM node_summary").all()) {
      roles.set(r.file, r.z1);
    }
  } catch {}
  const cochange = new Map;
  try {
    for (const r of db.query("SELECT file_a, file_b, n FROM cochange ORDER BY n DESC").all()) {
      for (const pair of [[r.file_a, r.file_b], [r.file_b, r.file_a]]) {
        const list = cochange.get(pair[0]) ?? [];
        if (list.length < 5)
          list.push([pair[1], r.n]);
        cochange.set(pair[0], list);
      }
    }
  } catch {}
  const gateHits = new Map;
  try {
    for (const r of db.query("SELECT file, COUNT(*) n FROM gate_log GROUP BY file").all()) {
      gateHits.set(r.file, r.n);
    }
  } catch {}
  const index = new Map;
  const nodes = rows.map((r, i) => {
    index.set(r.file, i);
    return {
      file: r.file,
      rank: r.rank,
      inDeg: r.in_deg,
      outDeg: r.out_deg,
      zone: zoneOf(r.file),
      heat: heat.get(r.file) ?? 0,
      role: roles.get(r.file) ?? null,
      cochange: cochange.get(r.file) ?? [],
      gateHits: gateHits.get(r.file) ?? 0
    };
  });
  const edges = [];
  try {
    for (const e of db.query("SELECT from_file, to_file FROM graph_edges").all()) {
      const a = index.get(e.from_file);
      const b = index.get(e.to_file);
      if (a !== undefined && b !== undefined && a !== b)
        edges.push([a, b]);
    }
  } catch {}
  const configEdges = [];
  try {
    const rows2 = db.query("SELECT config_file, code_file, via FROM config_edges").all();
    for (const r of rows2) {
      const codeIdx = index.get(r.code_file);
      if (codeIdx === undefined)
        continue;
      let cfgIdx = index.get(r.config_file);
      if (cfgIdx === undefined) {
        cfgIdx = nodes.length;
        index.set(r.config_file, cfgIdx);
        nodes.push({
          file: r.config_file,
          rank: 0,
          inDeg: 0,
          outDeg: 0,
          zone: zoneOf(r.config_file),
          heat: heat.get(r.config_file) ?? 0,
          role: roles.get(r.config_file) ?? null,
          cochange: cochange.get(r.config_file) ?? [],
          gateHits: gateHits.get(r.config_file) ?? 0,
          isConfig: true
        });
      }
      configEdges.push([cfgIdx, codeIdx, r.via]);
    }
  } catch {}
  const zoneMap = new Map;
  for (const n of nodes) {
    const z = zoneMap.get(n.zone) ?? { zone: n.zone, files: 0, axes: [], constraints: [], lessons: [] };
    z.files++;
    zoneMap.set(n.zone, z);
  }
  try {
    for (const r of db.query("SELECT zone, axes, constraints FROM zone_profile").all()) {
      const z = zoneMap.get(r.zone);
      if (!z)
        continue;
      z.axes = JSON.parse(r.axes);
      z.constraints = JSON.parse(r.constraints);
    }
  } catch {}
  try {
    for (const r of db.query("SELECT zone, statement FROM lessons ORDER BY rowid DESC").all()) {
      const z = zoneMap.get(r.zone);
      if (z && z.lessons.length < 3)
        z.lessons.push(r.statement);
    }
  } catch {}
  return { project, nodes, edges, configEdges, stats, zones: [...zoneMap.values()] };
}
function renderGraphHtml(data) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbiont · карта проекта «${esc(data.project)}»</title>
<style>
:root{--bg:#0b0f0d;--panel:#121a15;--line:#223328;--text:#d9e5dc;--muted:#8fa596;--accent:#4ade80;--strong:#f0fff5}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#app{display:flex;height:100%}
#canvas-wrap{flex:1;position:relative;overflow:hidden}
canvas{display:block;cursor:grab}
canvas.dragging{cursor:grabbing}
#side{width:340px;flex:0 0 340px;border-left:1px solid var(--line);background:var(--panel);padding:18px;overflow-y:auto}
h1{font-size:17px;margin:0 0 4px;color:var(--strong)}
.sub{color:var(--muted);font-size:12px;margin-bottom:16px}
.stat{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}
.stat span:first-child{color:var(--muted)}
.stat span:last-child{color:var(--text);text-align:right}
.sec{margin-top:18px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
#detail{margin-top:10px;font-size:13px}
#detail .file{color:var(--strong);font-weight:600;word-break:break-all}
#detail .role{color:var(--text);margin:8px 0;padding:8px 10px;background:#0e1512;border-left:2px solid var(--accent);border-radius:0 6px 6px 0}
#detail .rel{color:var(--muted);font-size:12px;margin-top:6px;word-break:break-all}
#hint{color:var(--muted);font-size:12px}
.warn{color:#fbbf24;font-size:12px;margin:6px 0;padding:6px 9px;background:#1a1508;border-radius:6px}
.acts{display:flex;gap:7px;margin-top:14px}
.mini{font-size:11px;padding:5px 9px}
#search{width:100%;padding:7px 10px;margin-bottom:12px;background:#0e1512;border:1px solid var(--line);border-radius:7px;color:var(--text);font-size:13px}
#search:focus{outline:none;border-color:var(--accent)}
#legend{position:absolute;left:14px;bottom:12px;font-size:11px;color:var(--muted);background:rgba(11,15,13,.82);padding:8px 11px;border-radius:8px;border:1px solid var(--line);line-height:1.7}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
#toolbar{position:absolute;right:14px;top:12px;display:flex;gap:6px}
button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer}
button:hover{border-color:var(--accent)}
@media(max-width:860px){#app{flex-direction:column}#side{width:auto;flex:0 0 auto;border-left:none;border-top:1px solid var(--line);max-height:44%}}
</style>
</head>
<body>
<div id="app">
  <div id="canvas-wrap">
    <canvas id="c"></canvas>
    <div id="toolbar">
      <button id="fit">Вписать</button>
      <button id="freeze">Заморозить</button>
      <button id="isolate-off" style="display:none">Показать весь граф</button>
    </div>
    <div id="legend">
      <div><span class="dot" style="background:var(--accent)"></span>размер — важность в графе (PageRank)</div>
      <div><span class="dot" style="background:#f59e0b"></span>свечение — недавняя работа (тепло)</div>
      <div><span class="dot" style="background:#fbbf24"></span>ромб и пунктир — настройка управляет кодом (связи нет в импортах)</div>
      <div>цвет — зона проекта · тяните узлы мышью, колесо — зум</div>
    </div>
  </div>
  <aside id="side">
    <h1>${esc(data.project)}</h1>
    <div class="sub">карта проекта · Symbiont</div>
    <input id="search" type="search" placeholder="поиск по файлам…" autocomplete="off">
    <div id="stats"></div>
    <div class="sec">узел</div>
    <div id="detail"><div id="hint">Наведите на узел или кликните, чтобы закрепить. Роли узлов выводятся фоном по мере работы.</div></div>
  </aside>
</div>
<script>
const DATA = ${payload};
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const wrap = document.getElementById('canvas-wrap');
const zones = [...new Set(DATA.nodes.map(n => n.zone))];
const palette = ['#4ade80','#60a5fa','#f472b6','#fbbf24','#a78bfa','#2dd4bf','#fb7185','#94a3b8','#c084fc','#34d399'];
const colorOf = z => palette[zones.indexOf(z) % palette.length];
const maxRank = Math.max(...DATA.nodes.map(n => n.rank), 1e-9);
const maxHeat = Math.max(...DATA.nodes.map(n => n.heat), 1);

// Раскладка: узлы отталкиваются, рёбра стягивают. Стартовое кольцо, а не
// случайные точки — при перезапуске картинка узнаваема (Math.random ломал бы
// «ту же карту», которую человек уже запомнил).
const N = DATA.nodes.length;
const P = DATA.nodes.map((n, i) => {
  const a = (i / Math.max(N, 1)) * Math.PI * 2, r = 90 + (i % 7) * 34;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, r: 4 + Math.sqrt(n.rank / maxRank) * 17 };
});
const deg = DATA.nodes.map(() => 0);
for (const e of DATA.edges) { deg[e[0]]++; deg[e[1]]++; }

let view = { x: 0, y: 0, k: 1 }, frozen = false, hover = -1, pinned = -1, dragging = -1, panning = null, query = '', isolate = -1, isolated = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr;
  cv.style.width = wrap.clientWidth + 'px'; cv.style.height = wrap.clientHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { resize(); fit(); });

function step() {
  if (frozen) return;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
      let d2 = dx * dx + dy * dy || 0.01;
      if (d2 > 160000) continue; // дальние пары не считаем: O(n²) иначе душит
      const f = 1100 / d2, d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      P[i].vx -= fx; P[i].vy -= fy; P[j].vx += fx; P[j].vy += fy;
    }
  }
  for (const e of DATA.edges) {
    const a = P[e[0]], b = P[e[1]];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
    const f = (d - 105) * 0.0032;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  for (let i = 0; i < N; i++) {
    if (i === dragging) continue;
    P[i].vx -= P[i].x * 0.0012; P[i].vy -= P[i].y * 0.0012; // к центру
    P[i].vx *= 0.86; P[i].vy *= 0.86;
    P[i].x += P[i].vx; P[i].y += P[i].vy;
  }
}

const sx = p => (p.x + view.x) * view.k + wrap.clientWidth / 2;
const sy = p => (p.y + view.y) * view.k + wrap.clientHeight / 2;

function draw() {
  ctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
  const focus = pinned >= 0 ? pinned : hover;
  const near = new Set();
  if (focus >= 0) {
    near.add(focus);
    for (const e of DATA.edges) { if (e[0] === focus) near.add(e[1]); if (e[1] === focus) near.add(e[0]); }
    for (const e of DATA.configEdges) { if (e[0] === focus) near.add(e[1]); if (e[1] === focus) near.add(e[0]); }
  }

  // Рёбра «настройка управляет кодом» — пунктиром и другим цветом: это связь
  // иного сорта, чем импорт, и рисовать её одинаково значило бы соврать.
  ctx.setLineDash([4, 4]);
  for (const e of DATA.configEdges) {
    if (isolated && (!isolated.has(e[0]) || !isolated.has(e[1]))) continue;
    const lit = focus >= 0 && (e[0] === focus || e[1] === focus);
    ctx.strokeStyle = lit ? 'rgba(251,191,36,.9)' : focus >= 0 ? 'rgba(251,191,36,.12)' : 'rgba(251,191,36,.34)';
    ctx.lineWidth = e[2] === 'история' ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(sx(P[e[0]]), sy(P[e[0]]));
    ctx.lineTo(sx(P[e[1]]), sy(P[e[1]]));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const e of DATA.edges) {
    if (isolated && (!isolated.has(e[0]) || !isolated.has(e[1]))) continue;
    const lit = focus >= 0 && (e[0] === focus || e[1] === focus);
    ctx.strokeStyle = lit ? 'rgba(74,222,128,.75)' : focus >= 0 ? 'rgba(120,140,128,.10)' : 'rgba(120,140,128,.22)';
    ctx.lineWidth = lit ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(sx(P[e[0]]), sy(P[e[0]]));
    ctx.lineTo(sx(P[e[1]]), sy(P[e[1]]));
    ctx.stroke();
  }
  // Узлы рисуем от мелких к крупным, чтобы важное не оказалось под пылью
  const order = DATA.nodes.map((_, i) => i).sort((a, b) => P[a].r - P[b].r);
  const labels = [];
  for (const i of order) {
    const n = DATA.nodes[i], p = P[i], x = sx(p), y = sy(p), r = p.r * view.k;
    if (isolated && !isolated.has(i)) continue;
    const match = query && n.file.toLowerCase().includes(query);
    const dim = (focus >= 0 && !near.has(i)) || (query && !match);
    if (n.heat > 0.15) {
      ctx.beginPath(); ctx.arc(x, y, r + 7 * (n.heat / maxHeat) + 3, 0, 6.284);
      ctx.fillStyle = 'rgba(245,158,11,' + (dim ? .05 : .16 * (n.heat / maxHeat) + .06) + ')'; ctx.fill();
    }
    ctx.beginPath();
    if (n.isConfig) {
      // Ромб вместо круга: настройка — сущность другого рода, и это должно быть
      // видно без легенды
      ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, 6.284);
    }
    ctx.fillStyle = n.isConfig ? '#fbbf24' : colorOf(n.zone); ctx.globalAlpha = dim ? .28 : 1; ctx.fill();
    if (match || i === focus) { ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (!dim && (r > 8 || i === focus || near.has(i) || match)) labels.push({ i, x, y, r, focus: i === focus });
  }

  // Подписи: последними и БЕЗ НАЛОЖЕНИЙ. На хаб-узле их десятки, и без проверки
  // занятого места они превращаются в кашу (видно на первом же скриншоте).
  ctx.textBaseline = 'middle';
  const taken = [];
  labels.sort((a, b) => (b.focus ? 1 : 0) - (a.focus ? 1 : 0) || b.r - a.r);
  for (const L of labels) {
    const text = DATA.nodes[L.i].file.split('/').pop();
    ctx.font = (L.focus ? 'bold ' : '') + '12px ui-monospace,Consolas,monospace';
    const w = ctx.measureText(text).width, h = 14;
    const bx = L.x + L.r + 5, by = L.y;
    const box = { x: bx - 2, y: by - h / 2, w: w + 4, h };
    if (taken.some(t => !(box.x > t.x + t.w || box.x + box.w < t.x || box.y > t.y + t.h || box.y + box.h < t.y))) continue;
    taken.push(box);
    // подложка: подпись обязана читаться поверх рёбер
    ctx.fillStyle = 'rgba(11,15,13,.72)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = L.focus ? '#f0fff5' : '#c9d8ce';
    ctx.fillText(text, bx, by);
  }
  ctx.textBaseline = 'alphabetic';
}

function loop() { step(); draw(); requestAnimationFrame(loop); }

function fit() {
  const xs = P.map(p => p.x), ys = P.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1;
  view.k = Math.min(wrap.clientWidth / (w + 140), wrap.clientHeight / (h + 140), 3.2);
  view.x = -(Math.max(...xs) + Math.min(...xs)) / 2; view.y = -(Math.max(...ys) + Math.min(...ys)) / 2;
}

function pick(mx, my) {
  for (let i = N - 1; i >= 0; i--) {
    const dx = mx - sx(P[i]), dy = my - sy(P[i]);
    if (dx * dx + dy * dy <= Math.pow(P[i].r * view.k + 4, 2)) return i;
  }
  return -1;
}

const detail = document.getElementById('detail');
const rankOrder = DATA.nodes.map((n, i) => i).sort((a, b) => DATA.nodes[b].rank - DATA.nodes[a].rank);
const percentile = i => Math.round((1 - rankOrder.indexOf(i) / Math.max(N - 1, 1)) * 100);

function show(i) {
  if (i < 0) { detail.innerHTML = '<div id="hint">Наведите на узел или кликните, чтобы закрепить. Двойной клик — фокус на его окружении.</div>'; return; }
  const n = DATA.nodes[i];
  const ins = [], outs = [];
  for (const e of DATA.edges) { if (e[1] === i) ins.push(DATA.nodes[e[0]].file); if (e[0] === i) outs.push(DATA.nodes[e[1]].file); }
  const zone = DATA.zones.find(z => z.zone === n.zone);
  const list = (title, items) => items.length ? '<div class="rel"><b>' + title + '</b> ' + items.join(', ') + '</div>' : '';

  detail.innerHTML =
    '<div class="file">' + n.file + '</div>' +
    (n.role
      ? '<div class="role">' + n.role + '</div>'
      : '<div class="rel">роль ещё не выведена — фон опишет её, когда файл будут открывать</div>') +
    '<div class="stat"><span>зона</span><span>' + n.zone + (zone ? ' · ' + zone.files + ' файлов' : '') + '</span></div>' +
    '<div class="stat"><span>важность в графе</span><span>' + n.rank.toFixed(4) + ' · топ ' + percentile(i) + '%</span></div>' +
    '<div class="stat"><span>зависят от него</span><span>' + n.inDeg + '</span></div>' +
    '<div class="stat"><span>зависит сам</span><span>' + n.outDeg + '</span></div>' +
    (n.heat > 0.15 ? '<div class="stat"><span>недавняя работа</span><span>тепло ' + n.heat.toFixed(1) + '</span></div>' : '') +
    (n.gateHits > 0 ? '<div class="stat"><span>поимок гейта здесь</span><span>' + n.gateHits + '</span></div>' : '') +
    list('зависят:', ins.slice(0, 8).concat(ins.length > 8 ? ['…'] : [])) +
    list('зависит от:', outs.slice(0, 8).concat(outs.length > 8 ? ['…'] : [])) +
    ((() => {
      const controls = [], controlledBy = [];
      for (const e of DATA.configEdges) {
        if (e[0] === i) controls.push(DATA.nodes[e[1]].file + ' (' + e[2] + ')');
        if (e[1] === i) controlledBy.push(DATA.nodes[e[0]].file + ' (' + e[2] + ')');
      }
      let out = '';
      if (controlledBy.length) out += '<div class="sec">управляет этим кодом</div>' + controlledBy.slice(0, 6).map(c => '<div class="rel">⚙ ' + c + '</div>').join('');
      if (controls.length) out += '<div class="sec">эта настройка управляет</div>' + controls.slice(0, 8).map(c => '<div class="rel">→ ' + c + '</div>').join('');
      return out;
    })()) +
    (n.cochange.length
      ? '<div class="sec">правятся вместе (из истории)</div>' +
        n.cochange.map(c => '<div class="stat"><span>' + c[0] + '</span><span>' + c[1] + '×</span></div>').join('')
      : '') +
    (zone && (zone.axes.length || zone.constraints.length || zone.lessons.length)
      ? '<div class="sec">условия зоны</div>' +
        (zone.axes.length ? '<div class="rel"><b>важно здесь:</b> ' + zone.axes.join(', ') + '</div>' : '') +
        zone.constraints.map(c => '<div class="warn">' + c + '</div>').join('') +
        zone.lessons.map(l => '<div class="rel">\uD83D\uDCDD ' + l + '</div>').join('')
      : '') +
    '<div class="acts">' +
      '<button class="mini" id="focus-btn">Фокус на окружении</button>' +
      '<button class="mini" id="copy-btn">Скопировать путь</button>' +
    '</div>';

  const fb = document.getElementById('focus-btn');
  if (fb) fb.onclick = () => setIsolate(isolate === i ? -1 : i);
  const cb = document.getElementById('copy-btn');
  if (cb) cb.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(n.file); cb.textContent = 'Скопировано'; };
}

// Изоляция: оставить на холсте только узел и его окружение в 2 хопа. Ответ на
// «волосяной шар» — вместо кластеризации, которая на хаб-графе кода капризна,
// человек сам выбирает интересующий его кусок.
function neighborsWithin(i, hops) {
  let front = new Set([i]); const seen = new Set([i]);
  for (let h = 0; h < hops; h++) {
    const next = new Set();
    for (const e of DATA.edges.concat(DATA.configEdges.map(c => [c[0], c[1]]))) {
      if (front.has(e[0]) && !seen.has(e[1])) { next.add(e[1]); seen.add(e[1]); }
      if (front.has(e[1]) && !seen.has(e[0])) { next.add(e[0]); seen.add(e[0]); }
    }
    front = next;
  }
  return seen;
}
function setIsolate(i) {
  isolate = i;
  isolated = i < 0 ? null : neighborsWithin(i, 2);
  const btn = document.getElementById('isolate-off');
  if (btn) btn.style.display = i < 0 ? 'none' : 'inline-block';
}

cv.addEventListener('mousemove', ev => {
  const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  if (dragging >= 0) { P[dragging].x = (mx - wrap.clientWidth / 2) / view.k - view.x; P[dragging].y = (my - wrap.clientHeight / 2) / view.k - view.y; return; }
  if (panning) { view.x += (mx - panning.x) / view.k; view.y += (my - panning.y) / view.k; panning = { x: mx, y: my }; return; }
  const i = pick(mx, my); if (i !== hover) { hover = i; if (pinned < 0) show(i); }
});
cv.addEventListener('mousedown', ev => {
  const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const i = pick(mx, my);
  if (i >= 0) { dragging = i; pinned = i; show(i); } else { panning = { x: mx, y: my }; pinned = -1; show(-1); }
  cv.classList.add('dragging');
});
window.addEventListener('mouseup', () => { dragging = -1; panning = null; cv.classList.remove('dragging'); });
cv.addEventListener('dblclick', ev => {
  const r = cv.getBoundingClientRect();
  const i = pick(ev.clientX - r.left, ev.clientY - r.top);
  if (i >= 0) { setIsolate(isolate === i ? -1 : i); pinned = i; show(i); }
});
cv.addEventListener('wheel', ev => { ev.preventDefault(); view.k = Math.max(.15, Math.min(4, view.k * (ev.deltaY < 0 ? 1.12 : .89))); }, { passive: false });
document.getElementById('fit').onclick = fit;
document.getElementById('isolate-off').onclick = () => { setIsolate(-1); };
document.getElementById('freeze').onclick = e => { frozen = !frozen; e.target.textContent = frozen ? 'Продолжить' : 'Заморозить'; };
document.getElementById('search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); });

document.getElementById('stats').innerHTML = Object.entries(DATA.stats)
  .map(pair => '<div class="stat"><span>' + pair[0] + '</span><span>' + pair[1] + '</span></div>').join('');

resize(); fit(); loop();
</script>
</body>
</html>`;
}

// src/cli/symbiont.ts
init_i18n();
function openInBrowser(file) {
  try {
    const { spawn } = __require("node:child_process");
    const opts = silentSpawnOptions();
    const p = process.platform === "win32" ? spawn("explorer.exe", [file.replaceAll("/", "\\")], opts) : process.platform === "darwin" ? spawn("open", [file], opts) : spawn("xdg-open", [file], opts);
    p.on("error", () => {});
    p.unref();
    return true;
  } catch {
    return false;
  }
}
var root = process.cwd();
var res = resolveDataRoot(join2(import.meta.dirname, "..", "..", ".data"));
migrateLegacyPassports(res);
var dataDir = join2(res.root, slugOf(root));
var arg = stripDataFlag(process.argv.slice(2)).join(" ").trim();
initLang(dataDir, root);
var LANG_WORDS = /^(язык|lang|language)\s+(ru|en|auto|авто|рус\w*|англ\w*)$/i;
var langArg = arg.match(LANG_WORDS);
if (langArg) {
  const raw = langArg[2].toLowerCase();
  const choice = /^(auto|авто)$/.test(raw) ? null : /^(ru|рус)/.test(raw) ? "ru" : "en";
  const verdict = chooseLang(dataDir, choice);
  console.log(choice === null ? t(`Symbiont: язык подачи снова определяется сам — сейчас ${verdict.lang} (${sourceLabel(verdict.source)}).`, `Symbiont: language is detected automatically again — currently ${verdict.lang} (${sourceLabel(verdict.source)}).`) : t(`Symbiont: язык подачи — ${verdict.lang}. Вернуть автоопределение: /symbiont:status lang auto`, `Symbiont: output language is now ${verdict.lang}. Back to automatic: /symbiont:status lang auto`));
  process.exit(0);
}
if (!existsSync2(join2(dataDir, "passport.db"))) {
  console.log(t("Symbiont: паспорт ещё не построен — соберётся сам при старте сессии в этом проекте.", "Symbiont: no passport yet — it builds itself when a session starts in this project."));
  process.exit(0);
}
var HEALTH_WORDS = /^(здоровье|health|дрейф|drift)$/i;
var GRAPH_WORDS = /^(граф|карта|graph|map|html)(?:\s+(.+))?$/i;
var graphArg = arg.match(GRAPH_WORDS);
if (graphArg) {
  const zone = (graphArg[2] ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "") || null;
  const db = openDb(join2(dataDir, "passport.db"), { readonly: true });
  try {
    const one2 = (sql) => {
      try {
        return db.query(sql).get().n;
      } catch {
        return 0;
      }
    };
    const nodes = zone ? db.query("SELECT COUNT(*) n FROM graph_nodes WHERE file LIKE ?").get(`${zone}%`).n : one2("SELECT COUNT(*) n FROM graph_nodes");
    if (nodes === 0) {
      console.log(zone ? t(`Symbiont: в каталоге «${zone}» узлов графа нет — проверьте путь (список зон покажет /symbiont:status).`, `Symbiont: no graph nodes under “${zone}” — check the path (/symbiont:status lists the areas).`) : t("Symbiont: граф пуст (нет внутренних импортов) — рисовать нечего.", "Symbiont: the graph is empty (no internal imports) — nothing to draw."));
      process.exit(0);
    }
    const stats = {
      "узлов в графе": String(nodes),
      "связей": String(one2("SELECT COUNT(*) n FROM graph_edges")),
      "фактов живо": String(one2("SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL")),
      "из них законов": String(one2("SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL AND tier='закон'")),
      "ролей выведено": String(one2("SELECT COUNT(*) n FROM node_summary")),
      "поимок гейта": String(one2("SELECT COUNT(*) n FROM gate_log"))
    };
    const html = renderGraphHtml(collectGraphData(db, zone ? `${basename(root)} · ${zone}` : basename(root), stats, zone));
    const out = join2(dataDir, zone ? `graph-${zone.replaceAll("/", "-")}.html` : "graph.html");
    writeFileSync(out, html, "utf8");
    console.log(t(`Symbiont · интерактивная карта${zone ? ` каталога ${zone}` : ""}: ${nodes} узлов`, `Symbiont · interactive map${zone ? ` of ${zone}` : ""}: ${nodes} nodes`));
    console.log(`
  ${out}
`);
    const opened = openInBrowser(out);
    console.log(opened ? t("Открывается в браузере: тяните узлы мышью, колесо — зум, клик — детали узла, двойной клик — фокус на окружении.", "Opening in your browser — drag nodes, wheel to zoom, click for node details, double-click to focus on its surroundings.") : t("Откройте файл в браузере: тяните узлы мышью, колесо — зум, клик — детали узла, двойной клик — фокус на окружении.", "Open the file in a browser — drag nodes, wheel to zoom, click for node details, double-click to focus on its surroundings."));
    console.log(t("_один файл, ноль внешних запросов; в нём только пути и связи, ни строки кода проекта_", "_one file, zero external requests; it holds paths and links only, not a line of your code_"));
  } finally {
    db.close();
  }
  process.exit(0);
}
if (arg && !HEALTH_WORDS.test(arg)) {
  console.log(buildMapReport(dataDir, arg));
  process.exit(0);
}
var db = openDb(join2(dataDir, "passport.db"), { readonly: true });
try {
  if (HEALTH_WORDS.test(arg)) {
    console.log(renderDriftReport(computeHealth(db), computeDrift(db), hotspotsFromGit(root)));
    console.log(`
` + renderTruth(auditTruth(db, root, dataDir)));
    console.log(`
` + t("_куда всё ползёт относительно прошлых замеров; выправляется фоном само, команда лишь показывает_", "_where things are drifting relative to earlier snapshots; the background fixes it by itself, the command only shows_"));
  } else {
    console.log(buildStatusReport(dataDir));
    const bg = REPORTED_WORKS.map((id) => ({ id, last: lastRun(db, id) })).filter((r) => r.last !== null);
    if (bg.length > 0) {
      console.log(" " + t("Фоновая работа (идёт сама, команд не требует)", "Background work (runs on its own, needs no commands)"));
      for (const r of bg) {
        const ageH = Math.round((Date.now() - Date.parse(r.last.at)) / 3600000);
        const age = ageH < 1 ? t("меньше часа назад", "less than an hour ago") : ageH < 48 ? t(`${ageH}ч назад`, `${ageH}h ago`) : t(`${Math.round(ageH / 24)}д назад`, `${Math.round(ageH / 24)}d ago`);
        console.log(`   ${r.id.padEnd(12)}${r.last.ok ? " " : "⚠"} ${age} · ${r.last.note}`);
      }
      console.log("");
    }
    const util = renderUtility(rankKinds(db));
    if (util)
      console.log(` ${util}
`);
    console.log(t("_смежное: /symbiont:graph — интерактивная карта · /symbiont:health — что уползло и можно ли верить паспорту_", "_nearby: /symbiont:graph — the interactive map · /symbiont:health — what drifted and whether the passport can be trusted_"));
  }
} finally {
  db.close();
}
