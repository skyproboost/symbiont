/**
 * Интерактивная карта проекта — самодостаточный HTML-файл.
 *
 * Зачем отдельный артефакт, а не вывод в терминал: граф на 100+ узлов в тексте
 * читается как «волосяной шар» (грабля из чек-листа приёмки, CONCEPT §7), а
 * человеку нужно СМОТРЕТЬ — тянуть узлы, наводить, искать, видеть кластеры
 * глазами. Такой интерактив терминал дать не может, а браузер может бесплатно.
 *
 * Ограничения, которые делают это честным продуктом, а не демо:
 * - ОДИН файл без единого внешнего запроса (ноль CDN, ноль шрифтов, ноль сети):
 *   открывается по file://, работает в самолёте, ничего о проекте не утекает —
 *   то же правило приватности, что у всего плагина;
 * - раскладка считается В БРАУЗЕРЕ (обычная сила отталкивания + пружины по
 *   рёбрам): предрасчёт в TS дал бы статичную картинку, а тянуть узел мышью и
 *   смотреть, как перестраивается окружение, — половина ценности;
 * - данные вшиваются в файл как JSON. Приватность: только пути, степени связей
 *   и уже выведенные роли — ни строки исходного кода.
 */
import type { Database } from '../core/db'

export interface GraphNodeData {
  file: string
  rank: number
  inDeg: number
  outDeg: number
  zone: string
  heat: number
  role: string | null
  /** исторически правятся вместе (co-change из git) — «тронешь это, тронешь и то» */
  cochange: Array<[string, number]>
  /** сколько раз гейт ловил нарушения в этом файле */
  gateHits: number
  /** узел-настройка, а не код: у него другая роль и другая отрисовка */
  isConfig?: boolean
}

export interface ZoneData {
  zone: string
  files: number
  /** эффективные условия зоны (каскад профиля): что здесь важно дополнительно */
  axes: string[]
  constraints: string[]
  /** уроки из прошлых поправок владельца по этой зоне */
  lessons: string[]
}

export interface GraphData {
  project: string
  nodes: GraphNodeData[]
  edges: Array<[number, number]>
  /**
   * Рёбра «настройка управляет кодом»: индексы в nodes + способ обнаружения.
   * Отдельно от импортов сознательно — это связь другого сорта, и рисовать её
   * так же значило бы утверждать, будто конфиг «вызывает» код.
   */
  configEdges: Array<[number, number, string]>
  stats: Record<string, string>
  /** знание о зонах — раскрывается при выборе узла (у зоны своя планка и своя память) */
  zones: ZoneData[]
}

const MAX_NODES = 220

const zoneOf = (file: string): string => {
  const parts = file.split('/')
  return parts.length <= 1 ? '(корень)' : parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0]
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Сбор данных карты из уже посчитанных проекций (ничего не пересчитывает). */
export function collectGraphData(db: Database, project: string, stats: Record<string, string>, zone: string | null = null, limit: number = MAX_NODES): GraphData {
  // Отбор по зоне идёт в запросе, а не после него: потолок узлов применяется
  // ПОСЛЕ отбора, иначе на большом проекте зона обрезалась бы чужими узлами
  const rows = (zone
    ? db.query('SELECT file, rank, in_deg, out_deg FROM graph_nodes WHERE file LIKE ? ORDER BY rank DESC LIMIT ?').all(`${zone}%`, limit)
    : db.query('SELECT file, rank, in_deg, out_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?').all(limit)) as Array<{
    file: string
    rank: number
    in_deg: number
    out_deg: number
  }>

  const heat = new Map<string, number>()
  try {
    for (const r of db.query('SELECT file, heat FROM node_heat').all() as Array<{ file: string; heat: number }>) {
      heat.set(r.file, r.heat)
    }
  } catch {
    /* тепла нет — узлы просто одного «возраста» */
  }
  const roles = new Map<string, string>()
  try {
    for (const r of db.query('SELECT file, z1 FROM node_summary').all() as Array<{ file: string; z1: string }>) {
      roles.set(r.file, r.z1)
    }
  } catch {
    /* ролей ещё нет — выведутся фоном */
  }

  // Прецеденты co-change и поимки гейта — то, чего в самом графе импортов нет,
  // но что человек ищет глазами: «а что здесь ломается вместе».
  const cochange = new Map<string, Array<[string, number]>>()
  try {
    for (const r of db.query('SELECT file_a, file_b, n FROM cochange ORDER BY n DESC').all() as Array<{ file_a: string; file_b: string; n: number }>) {
      for (const pair of [[r.file_a, r.file_b] as const, [r.file_b, r.file_a] as const]) {
        const list = cochange.get(pair[0]) ?? []
        if (list.length < 5) list.push([pair[1], r.n])
        cochange.set(pair[0], list)
      }
    }
  } catch {
    /* истории co-change нет — блок просто не покажется */
  }
  const gateHits = new Map<string, number>()
  try {
    for (const r of db.query('SELECT file, COUNT(*) n FROM gate_log GROUP BY file').all() as Array<{ file: string; n: number }>) {
      gateHits.set(r.file, r.n)
    }
  } catch {
    /* гейт ещё никого не ловил */
  }

  const index = new Map<string, number>()
  const nodes: GraphNodeData[] = rows.map((r, i) => {
    index.set(r.file, i)
    return {
      file: r.file,
      rank: r.rank,
      inDeg: r.in_deg,
      outDeg: r.out_deg,
      zone: zoneOf(r.file),
      heat: heat.get(r.file) ?? 0,
      role: roles.get(r.file) ?? null,
      cochange: cochange.get(r.file) ?? [],
      gateHits: gateHits.get(r.file) ?? 0,
    }
  })

  const edges: Array<[number, number]> = []
  try {
    for (const e of db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>) {
      const a = index.get(e.from_file)
      const b = index.get(e.to_file)
      if (a !== undefined && b !== undefined && a !== b) edges.push([a, b])
    }
  } catch {
    /* рёбер нет — покажем узлы россыпью */
  }

  // Конфигурационные узлы и их рёбра. Конфиг попадает на карту, только если он
  // реально чем-то управляет: одинокий файл настроек ничего не объясняет.
  const configEdges: Array<[number, number, string]> = []
  try {
    const rows = db.query('SELECT config_file, code_file, via FROM config_edges').all() as Array<{ config_file: string; code_file: string; via: string }>
    for (const r of rows) {
      const codeIdx = index.get(r.code_file)
      if (codeIdx === undefined) continue
      let cfgIdx = index.get(r.config_file)
      if (cfgIdx === undefined) {
        cfgIdx = nodes.length
        index.set(r.config_file, cfgIdx)
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
          isConfig: true,
        })
      }
      configEdges.push([cfgIdx, codeIdx, r.via])
    }
  } catch {
    /* слоя связей нет — карта покажет только импорты */
  }

  // Знание о зонах: у зоны своя планка (каскад профиля) и своя память (уроки из
  // поправок владельца). В панели это раскрывается при выборе узла.
  const zoneMap = new Map<string, ZoneData>()
  for (const n of nodes) {
    const z = zoneMap.get(n.zone) ?? { zone: n.zone, files: 0, axes: [], constraints: [], lessons: [] }
    z.files++
    zoneMap.set(n.zone, z)
  }
  try {
    for (const r of db.query('SELECT zone, axes, constraints FROM zone_profile').all() as Array<{ zone: string; axes: string; constraints: string }>) {
      const z = zoneMap.get(r.zone)
      if (!z) continue
      z.axes = JSON.parse(r.axes) as string[]
      z.constraints = JSON.parse(r.constraints) as string[]
    }
  } catch {
    /* каскада ещё нет */
  }
  try {
    for (const r of db.query('SELECT zone, statement FROM lessons ORDER BY rowid DESC').all() as Array<{ zone: string; statement: string }>) {
      const z = zoneMap.get(r.zone)
      if (z && z.lessons.length < 3) z.lessons.push(r.statement)
    }
  } catch {
    /* уроков ещё нет */
  }

  return { project, nodes, edges, configEdges, stats, zones: [...zoneMap.values()] }
}

/** Готовая страница: разметка + стиль + раскладка, всё внутри одного файла. */
export function renderGraphHtml(data: GraphData): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c')
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
        zone.lessons.map(l => '<div class="rel">📝 ' + l + '</div>').join('')
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
</html>`
}
