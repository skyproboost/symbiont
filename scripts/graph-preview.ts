/**
 * Статичное SVG-превью карты для README и лендинга.
 *
 * Почему SVG, а не скриншот: вектор чёток на любом экране, весит килобайты,
 * читаемо диффится в git и рисуется из НАСТОЯЩИХ данных проекта — картинка не
 * может разойтись с продуктом, потому что она из него и сделана. Скриншот
 * интерактивной карты вдобавок показал бы чужой проект целиком: имена файлов
 * там читаются, а превью в README видят посторонние.
 *
 * Визуальный язык взят у интерактивной карты (/symbiont:graph), потому что
 * человек, увидевший превью, потом откроет именно её: тёмное поле, цвет — зона
 * проекта, размер — важность узла, свечение — недавняя работа, жёлтый пунктир —
 * связь настройки с кодом. Разреженная схема из десятка точек выглядела честной,
 * но обещала не то: настоящая карта плотная, и это её главное свойство.
 *
 * Раскладка считается здесь и один раз (детерминированно, без Math.random):
 * превью обязано быть воспроизводимым, иначе каждый прогон давал бы новый диф.
 * Запуск: bun run scripts/graph-preview.ts [путь-проекта]
 */
import { writeFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { openDb } from '../src/core/db'
import { resolveDataRoot } from '../src/core/data-root'
import { slugOf } from '../src/hooks/session-start-core'
import { initLang, t } from '../src/core/i18n'

const W = 960
const H = 540
/** Потолок узлов: плотность и есть суть карты, но за парой сотен точки сливаются. */
const MAX = process.argv.includes('--anon') ? 300 : 220
/** Сколько имён подписать. Их немного намеренно — подписи спорят с плотностью. */
const LABELS = 3

/**
 * Режим для чужого проекта. Картинка убедительнее на большом живом проекте, но
 * такой проект не наш: его СТРУКТУРА (имя проекта, раскладка зон) — чужое дело.
 * Форма графа секретом не является, поэтому режим убирает имя проекта в шапке и
 * легенду зон, а пару имён самых крупных узлов оставляет: без единой подписи
 * картинка читается как абстрактная графика, а одно имя файла возвращает ей
 * масштаб и не выдаёт ничего (решение владельца проекта, с которого снята карта).
 */
const anon = process.argv.includes('--anon')
initLang(null, null) // язык подачи берётся из окружения: SYMBIONT_LANG=en для англоязычного превью
const root = resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? process.cwd())
const dataDir = join(resolveDataRoot(join(import.meta.dirname, '..', '.data')).root, slugOf(root))
const db = openDb(join(dataDir, 'passport.db'), { readonly: true })

const nodes = db
  .query('SELECT file, rank, in_deg FROM graph_nodes ORDER BY rank DESC LIMIT ?')
  .all(MAX) as Array<{ file: string; rank: number; in_deg: number }>
if (nodes.length === 0) {
  console.error('граф пуст — нечего рисовать')
  process.exit(1)
}
const index = new Map(nodes.map((n, i) => [n.file, i]))
const edges: Array<[number, number]> = []
for (const e of db.query('SELECT from_file, to_file FROM graph_edges').all() as Array<{ from_file: string; to_file: string }>) {
  const a = index.get(e.from_file)
  const b = index.get(e.to_file)
  if (a !== undefined && b !== undefined && a !== b) edges.push([a, b])
}
// Связи настроек с кодом — третий вид рёбер, и на карте они читаются отдельно:
// «этот файл управляется вот этой настройкой» видно без чтения кода
const configEdges: Array<[number, number]> = []
try {
  for (const e of db.query('SELECT config_file, code_file FROM config_edges').all() as Array<{ config_file: string; code_file: string }>) {
    const a = index.get(e.config_file)
    const b = index.get(e.code_file)
    if (a !== undefined && b !== undefined && a !== b) configEdges.push([a, b])
  }
} catch {
  /* связей настроек нет — пунктира просто не будет */
}
const heat = new Map<string, number>()
try {
  for (const r of db.query('SELECT file, heat FROM node_heat').all() as Array<{ file: string; heat: number }>) heat.set(r.file, r.heat)
} catch {
  /* тепла нет — свечения не будет */
}
db.close()

const zoneOf = (f: string): string => {
  const p = f.split('/')
  return p.length <= 1 ? '(корень)' : p.length >= 3 ? `${p[0]}/${p[1]}` : p[0]
}
const zones = [...new Set(nodes.map((n) => zoneOf(n.file)))]
const palette = ['#4ade80', '#60a5fa', '#f472b6', '#c084fc', '#2dd4bf', '#fbbf24', '#fb7185', '#38bdf8', '#a3e635', '#94a3b8']
const colorOf = (z: string): string => palette[zones.indexOf(z) % palette.length]

// Стартовое кольцо + силовая релаксация фиксированным числом шагов
const N = nodes.length
const maxRank = Math.max(...nodes.map((n) => n.rank), 1e-9)
const P = nodes.map((n, i) => {
  const a = (i / N) * Math.PI * 2 * 3.7 // не ровное кольцо: спираль даёт живой старт
  const r = 60 + (i / N) * 190
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, r: 3 + Math.sqrt(n.rank / maxRank) * 17 }
})
for (let step = 0; step < 700; step++) {
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = P[j].x - P[i].x
      const dy = P[j].y - P[i].y
      const d2 = dx * dx + dy * dy || 0.01
      const f = 430 / d2
      const d = Math.sqrt(d2)
      P[i].vx -= (dx / d) * f
      P[i].vy -= (dy / d) * f
      P[j].vx += (dx / d) * f
      P[j].vy += (dy / d) * f
    }
  }
  // Пружины считаются и по конфиг-рёбрам: без них узел настроек не притянут
  // ничем и улетает за облако, растягивая картинку пустотой
  for (const e of [...edges, ...configEdges]) {
    const a = P[e[0]]
    const b = P[e[1]]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.01
    const f = (d - 52) * 0.006
    a.vx += (dx / d) * f
    a.vy += (dy / d) * f
    b.vx -= (dx / d) * f
    b.vy -= (dy / d) * f
  }
  for (const p of P) {
    p.vx -= p.x * 0.0026
    p.vy -= p.y * 0.0026
    p.vx *= 0.85
    p.vy *= 0.85
    p.x += p.vx
    p.y += p.vy
  }
}

// Рамка считается по перцентилям, а не по краям облака: пара узлов-одиночек
// далеко в стороне иначе ужимает основную массу в точку (та же грабля, что у
// кнопки «Вписать» в интерактивной карте). Всё, что за рамкой, обрежется краем.
const pct = (arr: number[], t: number): number => {
  const v = [...arr].sort((a, b) => a - b)
  return v[Math.max(0, Math.min(v.length - 1, Math.floor((v.length - 1) * t)))]
}
const xs = [pct(P.map((p) => p.x), 0.03), pct(P.map((p) => p.x), 0.97)]
const ys = [pct(P.map((p) => p.y), 0.03), pct(P.map((p) => p.y), 0.97)]
// Силовая раскладка даёт круглое облако, а холст широкий: без мягкого растяжения
// по горизонтали треть картинки — пустые поля. Растяжение ограничено (×1.35):
// у графа нет собственной геометрии, но сильная анизотропия уже врала бы про
// расстояния между узлами
const scale = Math.min((W - 120) / (Math.max(...xs) - Math.min(...xs) || 1), (H - 110) / (Math.max(...ys) - Math.min(...ys) || 1))
const scaleX = Math.min((W - 120) / (Math.max(...xs) - Math.min(...xs) || 1), scale * 1.35)
const cx = (Math.max(...xs) + Math.min(...xs)) / 2
const cy = (Math.max(...ys) + Math.min(...ys)) / 2
const px = (i: number): number => (P[i].x - cx) * scaleX + W / 2
const py = (i: number): number => (P[i].y - cy) * scale + H / 2 + 14
const rad = (i: number): number => Math.max(2.2, P[i].r * scale)

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const parts: string[] = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace,SFMono-Regular,Consolas,monospace">`)
// Свечение узлов — тот же приём, что в интерактивной карте: мягкий ореол вокруг
// важного и недавно тронутого. Один фильтр на весь документ, а не на узел
// Ореол — двумя полупрозрачными кругами, а не SVG-фильтром: фильтры в разных
// просмотрщиках и на GitHub ведут себя неодинаково, а картинка обязана
// выглядеть одинаково везде
parts.push(
  '<defs>' +
    '<radialGradient id="vign" cx="50%" cy="46%" r="72%"><stop offset="55%" stop-color="#0d0d10" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".5"/></radialGradient>' +
    // Подложка под шапкой: узлы плотные и лезут под текст, а текст обязан
    // читаться на любой карте, а не только на удачной
    '<linearGradient id="hd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0d10" stop-opacity=".96"/><stop offset="1" stop-color="#0d0d10" stop-opacity="0"/></linearGradient>' +
    '</defs>',
)
parts.push(`<rect width="${W}" height="${H}" rx="12" fill="#0d0d10"/>`)

for (const e of edges) {
  parts.push(
    `<line x1="${px(e[0]).toFixed(1)}" y1="${py(e[0]).toFixed(1)}" x2="${px(e[1]).toFixed(1)}" y2="${py(e[1]).toFixed(1)}" stroke="#464e5c" stroke-width=".65" opacity=".32"/>`,
  )
}
for (const e of configEdges.slice(0, 24)) {
  parts.push(
    `<line x1="${px(e[0]).toFixed(1)}" y1="${py(e[0]).toFixed(1)}" x2="${px(e[1]).toFixed(1)}" y2="${py(e[1]).toFixed(1)}" stroke="#eab308" stroke-width=".8" stroke-dasharray="3 4" opacity=".28"/>`,
  )
}

// Ореолы: сперва тёплые (недавняя работа), затем крупные узлы — они и должны
// притягивать взгляд первыми
const maxHeat = Math.max(...[...heat.values()], 1)
for (let i = 0; i < N; i++) {
  const h = (heat.get(nodes[i].file) ?? 0) / maxHeat
  if (h < 0.15) continue
  parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(i).toFixed(1)}" r="${(rad(i) + 7).toFixed(1)}" fill="#f59e0b" opacity="${(0.1 + h * 0.16).toFixed(2)}"/>`)
}
for (let i = 0; i < N; i++) {
  const r = rad(i)
  const color = colorOf(zoneOf(nodes[i].file))
  if (r > 3.4) {
    parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(i).toFixed(1)}" r="${(r * 2.4).toFixed(1)}" fill="${color}" opacity=".10"/>`)
    parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(i).toFixed(1)}" r="${(r * 1.55).toFixed(1)}" fill="${color}" opacity=".18"/>`)
  }
  parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(i).toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity=".95"/>`)
}
parts.push(`<rect width="${W}" height="${H}" rx="12" fill="url(#vign)"/>`)

// Подписи — только самым важным и без наложений
const taken: Array<{ x: number; y: number; w: number; h: number }> = []
for (let i = 0; i < Math.min(N, LABELS * 3) && taken.length < (anon ? 2 : LABELS); i++) {
  const name = nodes[i].file.split('/').pop() as string
  const w = name.length * 6.2 + 10
  const box = { x: px(i) + rad(i) + 6, y: py(i) - 8, w, h: 16 }
  if (box.x + box.w > W - 10 || box.y < 60) continue
  if (taken.some((tk) => !(box.x > tk.x + tk.w + 6 || box.x + box.w + 6 < tk.x || box.y > tk.y + tk.h + 6 || box.y + box.h + 6 < tk.y))) continue
  taken.push(box)
  parts.push(
    `<rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="4" fill="#0d0d10" opacity=".82"/>` +
      `<text x="${(box.x + 5).toFixed(1)}" y="${(box.y + 11.5).toFixed(1)}" font-size="10.5" fill="#e5e7eb">${esc(name)}</text>`,
  )
}

// Легенда зон: цвет без расшифровки — украшение, с расшифровкой — информация
const topZones = zones
  .map((z) => ({ zone: z, n: nodes.filter((n) => zoneOf(n.file) === z).length }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 6)
if (!anon) topZones.forEach((z, i) => {
  const lx = 24
  const ly = H - 18 - (topZones.length - 1 - i) * 0
  const x = lx + i * 132
  if (x > W - 120) return
  parts.push(`<circle cx="${x}" cy="${ly - 4}" r="4" fill="${colorOf(z.zone)}"/>`)
  parts.push(`<text x="${x + 10}" y="${ly}" font-size="10" fill="#9ca3af">${esc(z.zone)} · ${z.n}</text>`)
})

// Плотная полоса под текстом плюс мягкий сход: полупрозрачный градиент один
// не справлялся — крупный узел под ним всё равно спорил с буквами
parts.push(`<rect width="${W}" height="62" fill="#0d0d10" opacity=".93"/>`)
parts.push(`<rect y="62" width="${W}" height="26" fill="url(#hd)"/>`)
parts.push(
  `<text x="24" y="34" font-size="13" fill="#f3f4f6">${anon ? t('Symbiont · карта проекта', 'Symbiont · project map') : t(`Symbiont · карта проекта «${esc(basename(root))}»`, `Symbiont · project map of “${esc(basename(root))}”`)}</text>`,
)
parts.push(
  t(
    `<text x="24" y="52" font-size="10.5" fill="#9ca3af">${N} узлов · ${edges.length} связей${configEdges.length > 0 ? ` · ${configEdges.length} связей настроек` : ''} · размер = важность · цвет = зона · свечение = недавняя работа</text>`,
    `<text x="24" y="52" font-size="10.5" fill="#9ca3af">${N} nodes · ${edges.length} links${configEdges.length > 0 ? ` · ${configEdges.length} config links` : ''} · size = importance · colour = area · glow = recent work</text>`,
  ),
)
parts.push('</svg>')

const out = join(import.meta.dirname, '..', 'docs', anon ? 'graph-preview-large.svg' : 'graph-preview.svg')
writeFileSync(out, parts.join('\n'), 'utf8')
console.log(`✓ превью: ${out} · ${N} узлов, ${edges.length} связей, ${configEdges.length} связей настроек`)
