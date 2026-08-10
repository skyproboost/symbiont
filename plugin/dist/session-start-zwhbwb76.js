import {
  callClaudeDetailed,
  callClaudeWithTools,
  explainNoAnswer
} from "./session-start-yq1xf3ee.js";
import {
  addMetrics,
  astSource,
  astSupported,
  collectMetrics,
  withRoot,
  zeroMetrics
} from "./session-start-djk6q8qh.js";
import {
  buildGroundingPrompt,
  dueForGrounding,
  parseGrounding,
  storeGrounding
} from "./session-start-tsrqywmw.js";
import {
  PLAYBOOKS
} from "./session-start-8ychq3hk.js";
import {
  contentHashes,
  pendingSummaries,
  recordLesson,
  runZSummaries,
  zoneOf
} from "./session-start-g3kq6xfd.js";
import {
  buildRulesPrompt,
  parseRules,
  storeRules
} from "./session-start-gva85vn5.js";
import {
  collectOutline,
  ensureSymbols,
  indexedHash,
  pruneSymbols,
  storeOutline
} from "./session-start-n4jed5qc.js";
import {
  CODE_EXT,
  CSVX,
  ENTITY_EXT,
  FactStore,
  GENERATED_LINE_CHARS,
  OFFICE,
  TEXT,
  auditTruth,
  buildUnknownPrompt,
  codeFiles,
  deriveAstFacts,
  documentsBlock,
  findUnknownMaterial,
  healProjections,
  hotspotsFromGit,
  init_i18n,
  init_walk,
  isConfigFile,
  jsonOnly,
  keyOf,
  mergeLearnedMaterials,
  openDb,
  readConfigEntries,
  revisionsBlock,
  sha1,
  t,
  walkFiles
} from "./session-start-daqc63bv.js";
import {
  __require
} from "./session-start-70d7ckvt.js";

// src/gardener/works.ts
import { readFileSync as readFileSync4, existsSync as existsSync2 } from "node:fs";
import { join as join4, relative as relative2, basename, dirname } from "node:path";
init_i18n();

// src/gardener/simhash.ts
import { createHash } from "node:crypto";
var MASK64 = (1n << 64n) - 1n;
function tokens(text, maxTokens) {
  const all = text.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, " ").split(/\s+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 5));
  return all.length > maxTokens ? all.slice(0, maxTokens) : all;
}
function simhash(text, maxTokens = Number.MAX_SAFE_INTEGER) {
  const v = new Array(64).fill(0);
  for (const t2 of tokens(text, maxTokens)) {
    const h = BigInt("0x" + createHash("sha1").update(t2).digest("hex").slice(0, 16));
    for (let bit = 0;bit < 64; bit++) {
      v[bit] += h >> BigInt(bit) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let bit = 0;bit < 64; bit++)
    if (v[bit] > 0)
      out |= 1n << BigInt(bit);
  return out & MASK64;
}
function hamming(a, b) {
  let x = (a ^ b) & MASK64;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

// src/gardener/clones.ts
var MIN_LINES = 6;
var MIN_CHARS = 80;
var STRING_LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
var NUMBER_LIT = /\b\d[\d._]*\b/g;
var LINE_COMMENT = /\/\/.*$|#(?!!).*$/;
function normalizeBlock(block) {
  const kept = block.split(`
`).map((l) => l.replace(LINE_COMMENT, "").replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  if (kept.length < MIN_LINES)
    return null;
  if (kept.reduce((s2, l) => s2 + l.length, 0) / kept.length > GENERATED_LINE_CHARS)
    return null;
  const first = kept[0].trim().slice(0, 70);
  let s = kept.join(`
`).replace(STRING_LIT, "S").replace(NUMBER_LIT, "N").replace(/[ \t]+/g, " ").trim();
  if (s.length < MIN_CHARS)
    return null;
  return { norm: s, lines: kept.length, first };
}
function findClones(files, k = 8) {
  const byHash = new Map;
  for (const f of files) {
    for (const raw of f.content.split(/\n[ \t]*\n/)) {
      const n = normalizeBlock(raw);
      if (!n)
        continue;
      const h = sha1(n.norm);
      const g = byHash.get(h) ?? { files: new Set, count: 0, lines: n.lines, first: n.first };
      g.files.add(f.rel);
      g.count++;
      byHash.set(h, g);
    }
  }
  return [...byHash.values()].filter((g) => g.count >= 2).map((g) => ({ count: g.count, files: [...g.files], lines: g.lines, sample: g.first })).sort((a, b) => b.count * b.lines - a.count * a.lines).slice(0, k);
}
var NEAR_MAX_DIST = 4;
var BANDS = 4;
var BAND_BITS = 16n;
var NEAR_MAX_BLOCKS = 4000;
var NEAR_SIZE_TOLERANCE = 0.3;
var NEAR_MAX_TOKENS = 400;
function findNearClones(files, k = 5) {
  const seen = new Map;
  const blocks = [];
  for (const f of files) {
    for (const raw of f.content.split(/\n[ \t]*\n/)) {
      const n = normalizeBlock(raw);
      if (!n)
        continue;
      const h = sha1(n.norm);
      seen.set(h, (seen.get(h) ?? 0) + 1);
      if (blocks.length < NEAR_MAX_BLOCKS)
        blocks.push({ file: f.rel, sample: n.first, lines: n.lines, hash: simhash(n.norm, NEAR_MAX_TOKENS), exact: h });
    }
  }
  const unique = blocks.filter((b) => (seen.get(b.exact) ?? 0) === 1);
  const buckets = new Map;
  for (let i = 0;i < unique.length; i++) {
    for (let band = 0;band < BANDS; band++) {
      const key = `${band}:${unique[i].hash >> BigInt(band) * BAND_BITS & (1n << BAND_BITS) - 1n}`;
      const list = buckets.get(key) ?? [];
      list.push(i);
      buckets.set(key, list);
    }
  }
  const found = new Map;
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 64)
      continue;
    for (let x = 0;x < list.length; x++) {
      for (let y = x + 1;y < list.length; y++) {
        const a = unique[list[x]];
        const b = unique[list[y]];
        if (a.hash === b.hash)
          continue;
        const bigger = Math.max(a.lines, b.lines);
        if (Math.abs(a.lines - b.lines) / bigger > NEAR_SIZE_TOLERANCE)
          continue;
        const d = hamming(a.hash, b.hash);
        if (d > NEAR_MAX_DIST)
          continue;
        const key = [`${a.file}|${a.sample}`, `${b.file}|${b.sample}`].sort().join("≈");
        if (!found.has(key))
          found.set(key, { a, b, distance: d });
      }
    }
  }
  return [...found.values()].sort((x, y) => x.distance - y.distance || y.a.lines - x.a.lines).slice(0, k);
}

// src/gardener/works.ts
init_walk();

// src/miner/composition.ts
var MIN_FILES = 3;
var MAX_FORMATS = 14;
var zoneOf2 = (rel) => {
  const parts = rel.split("/");
  return parts.length <= 1 ? "(корень)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
};
var extOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "(без расширения)" : base.slice(dot).toLowerCase();
};
var stemOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
};
var median = (nums) => {
  if (nums.length === 0)
    return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
function buildComposition(input) {
  const files = input.files;
  const byExt = new Map;
  for (const f of files) {
    const e = extOf(f);
    const list2 = byExt.get(e) ?? [];
    list2.push(f);
    byExt.set(e, list2);
  }
  const formats = [...byExt.entries()].filter((e) => e[1].length >= MIN_FILES).map((e) => {
    const zoneCount = new Map;
    for (const f of e[1])
      zoneCount.set(zoneOf2(f), (zoneCount.get(zoneOf2(f)) ?? 0) + 1);
    const zones = [...zoneCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((z) => z[0]);
    const lines = input.lines ? e[1].map((f) => input.lines.get(f) ?? 0).filter((n) => n > 0) : [];
    return { ext: e[0], files: e[1].length, share: e[1].length / Math.max(files.length, 1), zones, medianLines: median(lines) };
  }).sort((a, b) => b.files - a.files).slice(0, MAX_FORMATS);
  const pairs = [];
  const known = new Set(formats.map((f) => f.ext));
  const zonesByExt = new Map;
  const stemsByExt = new Map;
  for (const f of files) {
    const e = extOf(f);
    if (!known.has(e))
      continue;
    const z = zonesByExt.get(e) ?? new Set;
    z.add(zoneOf2(f));
    zonesByExt.set(e, z);
    const s = stemsByExt.get(e) ?? new Set;
    s.add(`${zoneOf2(f)}/${stemOf(f)}`);
    stemsByExt.set(e, s);
  }
  const cochangeByPair = new Map;
  for (const c of input.cochange ?? []) {
    const ea = extOf(c.a);
    const eb = extOf(c.b);
    if (ea === eb || !known.has(ea) || !known.has(eb))
      continue;
    const key = [ea, eb].sort().join("|");
    cochangeByPair.set(key, (cochangeByPair.get(key) ?? 0) + c.n);
  }
  const list = formats.map((f) => f.ext);
  for (let i = 0;i < list.length; i++) {
    for (let j = i + 1;j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const za = zonesByExt.get(a) ?? new Set;
      const zb = zonesByExt.get(b) ?? new Set;
      const together = [...za].filter((z) => zb.has(z)).length;
      const sa = stemsByExt.get(a) ?? new Set;
      const sb = stemsByExt.get(b) ?? new Set;
      let twins = [...sa].filter((s) => sb.has(s)).length;
      const derived = [...sa].filter((s) => sb.has(`${s}${a}`)).length;
      const derivedBack = [...sb].filter((s) => sa.has(`${s}${b}`)).length;
      twins += Math.max(derived, derivedBack);
      const base = Math.max(Math.min(sa.size, sb.size), 1);
      const twinShare = Math.min(1, twins / base);
      const cochanged = cochangeByPair.get([a, b].sort().join("|")) ?? 0;
      if (twinShare >= 0.3 || cochanged >= 3 || together >= 3) {
        pairs.push({ a, b, together, cochanged, twinShare });
      }
    }
  }
  pairs.sort((x, y) => y.twinShare + y.cochanged / 10 - (x.twinShare + x.cochanged / 10));
  return { formats, pairs: pairs.slice(0, 12), totalFiles: files.length };
}
function buildCompositionPrompt(c, projectName) {
  return [
    `Ниже — карта состава проекта «${projectName}»: из каких видов файлов он сделан и как эти виды связаны между собой.`,
    "",
    "Виды файлов (доля, где лежат, медианный размер в строках):",
    ...c.formats.map((f) => `- ${f.ext}: ${f.files} файлов (${Math.round(f.share * 100)}%), каталоги: ${f.zones.join(", ")}${f.medianLines > 0 ? `, обычно ~${f.medianLines} строк` : ""}`),
    "",
    ...c.pairs.length > 0 ? [
      "Связи между видами (парность имён — доля файлов первого вида, у которых есть одноимённый сосед второго; совместные правки — из истории):",
      ...c.pairs.map((p) => `- ${p.a} ↔ ${p.b}: парность ${Math.round(p.twinShare * 100)}%, общих каталогов ${p.together}, правились вместе ${p.cochanged} раз`),
      ""
    ] : [],
    "Задача: описать УСТРОЙСТВО этого продукта как системы. Что здесь источник, а что производное от него; какие виды файлов создаются только парой; что меняется вместе и почему; что здесь главное, а что вспомогательное; какие зависимости между видами существуют.",
    "",
    jsonOnly('[{"area": "устройство продукта", "statement": "предмет — вердикт", "evidence": ["вид1", "вид2"], "confidence": 0.8}]'),
    "",
    "Правила: утверждать только то, что следует из карты; формулировать фактом («стили — создаются парой к компоненту»), а не советом; не опираться на общеизвестные сведения о форматах, если карта их не подтверждает; если система не просматривается — вернуть пустой массив, это честный ответ."
  ].join(`
`);
}

// src/layer2/verbalize.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// src/gardener/dedupe.ts
var THRESHOLD = 12;
function dedupeLlmFacts(db) {
  const rows = db.query("SELECT id, statement, area, seen_at FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%' ORDER BY seen_at DESC, id DESC").all();
  if (rows.length < 2)
    return [];
  const hashes = rows.map((r) => simhash(`${r.area} ${r.statement}`));
  const gone = new Set;
  const merges = [];
  const supersede = db.query("UPDATE fact_journal SET superseded_by=? WHERE id=?");
  for (let i = 0;i < rows.length; i++) {
    if (gone.has(rows[i].id))
      continue;
    for (let j = i + 1;j < rows.length; j++) {
      if (gone.has(rows[j].id))
        continue;
      if (hamming(hashes[i], hashes[j]) <= THRESHOLD) {
        supersede.run(rows[i].id, rows[j].id);
        gone.add(rows[j].id);
        merges.push({ kept: rows[i].statement, removed: rows[j].statement });
      }
    }
  }
  return merges;
}

// src/layer2/verbalize.ts
var SAMPLE_FILES = 6;
var SAMPLE_CHARS_PER_FILE = 4000;
function buildSample(projectRoot, dataDir) {
  const dbPath = join(dataDir, "passport.db");
  if (!existsSync(dbPath))
    return [];
  const db = openDb(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT file FROM graph_nodes ORDER BY rank DESC LIMIT ?").all(SAMPLE_FILES);
    const out = [];
    for (const r of rows) {
      try {
        out.push({ file: r.file, content: readFileSync(join(projectRoot, r.file), "utf8").slice(0, SAMPLE_CHARS_PER_FILE) });
      } catch {
        continue;
      }
    }
    return out;
  } finally {
    db.close();
  }
}
function buildPrompt(laws, samples, dueStatements = []) {
  return [
    "Ты анализируешь кодовую базу проекта, чтобы вывести неписаные конвенции — те, что не видны простой статистике.",
    "",
    "Уже известные законы проекта. Выводи только то, чего в этом списке нет, и что из него не следует:",
    ...laws.map((l) => `- ${l}`),
    ...dueStatements.length > 0 ? [
      "",
      "Правила, выведенные ранее, — им пора переподтверждение. Включи в ответ те, что образец подтверждает: той же формулировкой, со свежими evidence. Остальные просто опусти:",
      ...dueStatements.map((s) => `- ${s}`)
    ] : [],
    "",
    "Фрагменты самых связных файлов проекта:",
    documentsBlock(samples),
    "",
    "Выведи 3–8 дополнительных конвенций: обработка ошибок, семантика именования, архитектурные привычки, паттерны API, структура модулей.",
    "Правила только с подтверждением минимум в 3 файлах образца: правило, увиденное дважды, ещё неотличимо от совпадения, а этот вывод уходит в постоянный журнал проекта.",
    "Формулируй фактами в формате «предмет — вердикт» (как «ошибки — возвращаются значением, не бросаются»).",
    "",
    jsonOnly('[{"area": "область", "statement": "предмет — вердикт", "evidence": ["файл1", "файл2", "файл3"], "confidence": 0.85}]')
  ].join(`
`);
}
function parseRules2(text, minEvidence = 3) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start)
      return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr))
      return [];
    return arr.filter((r) => typeof r?.area === "string" && typeof r?.statement === "string" && r.statement.trim().length >= 10 && Array.isArray(r?.evidence) && r.evidence.length >= minEvidence && typeof r?.confidence === "number" && r.confidence > 0 && r.confidence <= 1);
  } catch {
    return [];
  }
}
function ruleToFact(rule, sampleSize) {
  const tier = rule.confidence >= 0.8 && rule.evidence.length >= 3 ? "привычка" : "гипотеза";
  return {
    area: rule.area,
    statement: rule.statement,
    positive: rule.evidence.length,
    total: Math.max(sampleSize, rule.evidence.length),
    prevalence: Math.min(rule.confidence, 0.94),
    tier
  };
}
function runVerbalize(projectRoot, dataDir, caller) {
  const empty = { born: 0, updated: 0, superseded: 0 };
  const samples = buildSample(projectRoot, dataDir);
  if (samples.length === 0)
    return { model: null, rules: [], journal: empty, merges: [] };
  const db = openDb(join(dataDir, "passport.db"));
  try {
    const store = new FactStore(db);
    const laws = store.active().filter((f) => f.tier === "закон").map((f) => f.statement);
    const due = store.dueForReview().map((f) => f.statement);
    const res = caller(buildPrompt(laws, samples, due));
    if (!res)
      return { model: null, rules: [], journal: empty, merges: [] };
    try {
      const { writeFileSync } = __require("node:fs");
      writeFileSync(join(dataDir, "layer2-last.json"), JSON.stringify({ model: res.model, at: new Date().toISOString(), raw: res.text }, null, 1), "utf8");
    } catch {}
    const rules = parseRules2(res.text);
    const facts = rules.map((r) => ruleToFact(r, samples.length));
    const journal = store.assertAll(facts, `llm:layer2:${res.model}`);
    const merges = dedupeLlmFacts(db);
    return { model: res.model, rules, journal, merges };
  } finally {
    db.close();
  }
}

// src/layer1/run.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2, relative } from "node:path";
init_walk();
var MAX_FILE = 300000;
async function runLayer1(projectRoot, dataDir, budgetMs = Infinity) {
  const db = openDb(join2(dataDir, "passport.db"));
  const t0 = Date.now();
  try {
    db.run("CREATE TABLE IF NOT EXISTS layer1_cache(path TEXT PRIMARY KEY, hash TEXT NOT NULL, metrics TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS layer1_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ensureSymbols(db);
    const cacheGet = db.query("SELECT hash, metrics FROM layer1_cache WHERE path=?");
    const cachePut = db.query("INSERT INTO layer1_cache(path,hash,metrics) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, metrics=excluded.metrics");
    const files = codeFiles(walkFiles(projectRoot)).filter((f) => astSupported(f.ext) && f.size <= MAX_FILE);
    const present = new Set;
    let parsed = 0;
    let fromCache = 0;
    let pending = 0;
    for (const f of files) {
      const rel = relative(projectRoot, f.path).replaceAll("\\", "/");
      present.add(rel);
      let content;
      try {
        content = readFileSync2(f.path, "utf8");
      } catch {
        continue;
      }
      const hash = sha1(content);
      const cached = cacheGet.get(rel);
      const needMetrics = !cached || cached.hash !== hash;
      const needOutline = indexedHash(db, rel) !== hash;
      if (!needMetrics && !needOutline) {
        fromCache++;
        continue;
      }
      if (Date.now() - t0 > budgetMs) {
        pending++;
        continue;
      }
      const source = astSource(f.ext, content);
      if (source === null)
        continue;
      const got = await withRoot(f.ext, source, (root) => ({
        metrics: collectMetrics(root),
        outline: f.ext === ".vue" ? [] : collectOutline(root)
      }));
      if (got === null)
        continue;
      cachePut.run(rel, hash, JSON.stringify(got.metrics));
      storeOutline(db, rel, hash, got.outline);
      parsed++;
    }
    pruneSymbols(db, present);
    const cachedPaths = db.query("SELECT path FROM layer1_cache").all().map((r) => r.path);
    const del = db.query("DELETE FROM layer1_cache WHERE path=?");
    for (const p of cachedPaths)
      if (!present.has(p))
        del.run(p);
    let agg = zeroMetrics();
    for (const row of db.query("SELECT metrics FROM layer1_cache").all()) {
      try {
        agg = addMetrics(agg, JSON.parse(row.metrics));
      } catch {
        continue;
      }
    }
    const facts = deriveAstFacts(agg);
    let asserted = false;
    if (pending === 0) {
      const aggHash = sha1(JSON.stringify(agg));
      const prev = db.query("SELECT value FROM layer1_meta WHERE key='agg'").get()?.value;
      if (prev !== aggHash) {
        const store = new FactStore(db);
        store.assertAll(facts, "miner:layer1");
        store.retractMissingBySource("miner:layer1", new Set(facts.map((f) => keyOf(f))));
        db.query("INSERT INTO layer1_meta(key,value) VALUES('agg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(aggHash);
        asserted = true;
      }
    }
    return { parsed, fromCache, pending, facts, asserted };
  } finally {
    db.close();
  }
}

// src/gardener/corrections.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var MAX_PER_PASS = 5;
var MAX_CHARS = 2000;
function buildCorrectionsPrompt(items) {
  return [
    "Владелец проекта исправил код, написанный ИИ-ассистентом. Каждая правка — сигнал о неписаном правиле проекта, которое ассистент нарушил.",
    "",
    revisionsBlock(items.map((c) => ({ file: c.file, before: c.before.slice(0, MAX_CHARS), after: c.after.slice(0, MAX_CHARS) }))),
    "",
    "Выведи правила, которые объясняют эти правки (1–4 правила). Только то, что реально следует из диффов, без домыслов.",
    jsonOnly('[{"area": "область", "statement": "правило, которое нарушил ассистент и восстановил владелец", "evidence": ["файл1"], "confidence": 0.7}]')
  ].join(`
`);
}
function analyzeCorrections(db, projectRoot, caller) {
  const none = { analyzed: 0, born: 0, statements: [] };
  const hasTable = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='corrections'").get().n > 0;
  if (!hasTable)
    return none;
  const pending = db.query("SELECT id, file, before_content FROM corrections WHERE analyzed=0 ORDER BY id LIMIT ?").all(MAX_PER_PASS);
  if (pending.length === 0)
    return none;
  const items = pending.map((p) => {
    try {
      return { id: p.id, file: p.file, before: p.before_content, after: readFileSync3(join3(projectRoot, p.file), "utf8") };
    } catch {
      return { id: p.id, file: p.file, before: p.before_content, after: "" };
    }
  }).filter((c) => c.after.length > 0);
  const markAnalyzed = db.query("UPDATE corrections SET analyzed=1 WHERE id=?");
  if (items.length === 0) {
    for (const p of pending)
      markAnalyzed.run(p.id);
    return { analyzed: pending.length, born: 0, statements: [] };
  }
  const res = caller(buildCorrectionsPrompt(items));
  if (!res)
    return none;
  const rules = parseRules2(res.text, 1);
  const facts = rules.map((r) => ruleToFact(r, items.length));
  const store = new FactStore(db);
  const journal = store.assertAll(facts, `llm:corrections:${res.model}`);
  dedupeLlmFacts(db);
  const now = new Date().toISOString();
  for (const r of rules) {
    const file = Array.isArray(r.evidence) && r.evidence[0] || items[0].file;
    recordLesson(db, zoneOf(file), r.statement, `correction:${res.model}`, now);
  }
  for (const p of pending)
    markAnalyzed.run(p.id);
  return { analyzed: pending.length, born: journal.born, statements: rules.map((r) => r.statement) };
}

// src/gardener/works.ts
var deepCaller = (ctx, purpose, sink) => (prompt) => {
  const outcome = callClaudeDetailed(prompt, { intent: "deep", dataDir: ctx.dataDir, db: ctx.db, purpose });
  if (sink)
    sink.splice(0, sink.length, ...outcome.tried);
  return outcome.result;
};
var routineCaller = (ctx, purpose) => (prompt) => callClaudeDetailed(prompt, { intent: "routine", dataDir: ctx.dataDir, db: ctx.db, purpose }).result;
var tableExists = (ctx, name) => {
  try {
    return ctx.db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;
  } catch {
    return false;
  }
};
var countOf = (ctx, sql) => {
  try {
    return ctx.db.query(sql).get().n;
  } catch {
    return 0;
  }
};
var truthWork = {
  id: "truth",
  title: "аудит само-образа",
  cost: "cheap",
  cooldownH: 0,
  due: () => true,
  run: (ctx) => {
    const issues = auditTruth(ctx.db, ctx.projectRoot, ctx.dataDir);
    if (issues.length === 0)
      return null;
    const healed = healProjections(ctx.db, ctx.projectRoot);
    const lying = issues.filter((i) => !i.healable);
    const parts = [];
    if (healed.removed > 0)
      parts.push(t(`карта почищена: ${healed.removed} мёртвых записей`, `map cleaned: ${healed.removed} dead records`));
    if (lying.length > 0) {
      parts.push(t(`сводка расходится с журналом (${lying[0].count}) — пересборка назначена`, `the summary disagrees with the journal (${lying[0].count}) — a rebuild is scheduled`));
    }
    return parts.length > 0 ? parts.join(", ") : null;
  }
};
var repairWork = {
  id: "repair",
  title: "пересборка порченых проекций",
  cost: "cheap",
  cooldownH: 0,
  due: (ctx) => {
    const facts = countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE superseded_by IS NULL");
    if (facts === 0)
      return false;
    if (!existsSync2(join4(ctx.dataDir, "SUMMARY.md")))
      return true;
    return auditTruth(ctx.db, ctx.projectRoot, ctx.dataDir).some((i) => !i.healable);
  },
  run: (ctx) => {
    try {
      ctx.db.run("DELETE FROM memo");
      ctx.db.run("DELETE FROM deps");
    } catch {
      return null;
    }
    return t("проекции помечены к пересчёту (сводка пересоберётся при следующем старте)", "projections marked for recomputation (the summary will be rebuilt at the next start)");
  }
};
var layer1Work = {
  id: "layer1",
  title: "символьный слой",
  cost: "cheap",
  cooldownH: 0,
  due: (ctx) => countOf(ctx, "SELECT COUNT(*) n FROM fact_journal") >= 0,
  run: async (ctx) => {
    await runLayer1(ctx.projectRoot, ctx.dataDir);
    return null;
  }
};
var driftWork = {
  id: "drift",
  title: "снимок здоровья и зоны частых починок",
  cost: "cheap",
  cooldownH: 24,
  due: (ctx) => tableExists(ctx, "health_snapshot"),
  run: (ctx) => {
    const hotspots = hotspotsFromGit(ctx.projectRoot);
    const codeInputs = [];
    for (const f of codeFiles(walkFiles(ctx.projectRoot))) {
      try {
        codeInputs.push({ rel: relative2(ctx.projectRoot, f.path).replaceAll("\\", "/"), content: readFileSync4(f.path, "utf8") });
      } catch {}
    }
    const clones = findClones(codeInputs);
    const near = findNearClones(codeInputs);
    const parts = [];
    if (hotspots.length > 0)
      parts.push(t(`чаще всего чинят: ${hotspots[0].file} (${hotspots[0].fixes} починок × ${hotspots[0].size} строк)`, `repaired most often: ${hotspots[0].file} (${hotspots[0].fixes} fixes × ${hotspots[0].size} lines)`));
    if (clones.length > 0)
      parts.push(t(`клоны: блок ×${clones[0].count} (${clones[0].lines} строк)`, `clones: a block ×${clones[0].count} (${clones[0].lines} lines)`));
    if (near.length > 0)
      parts.push(t(`почти-дубли: ${near[0].a.file} ≈ ${near[0].b.file}`, `near-duplicates: ${near[0].a.file} ≈ ${near[0].b.file}`));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
};
var verbalizeWork = {
  id: "verbalize",
  title: "углубление паспорта",
  cost: "llm",
  cooldownH: 72,
  due: (ctx) => {
    const store = new FactStore(ctx.db);
    if (store.dueForReview(ctx.nowMs).length > 0)
      return true;
    const everRan = countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source LIKE 'llm:layer2:%'") > 0;
    const hasCode = countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source='miner:layer0'") > 0;
    return !everRan && hasCode;
  },
  run: (ctx) => {
    const tried = [];
    const v = runVerbalize(ctx.projectRoot, ctx.dataDir, deepCaller(ctx, "вербализация конвенций", tried));
    if (!v.model)
      throw new Error(explainNoAnswer(tried));
    if (v.journal.born === 0 && v.journal.updated === 0)
      return null;
    return t(`правил +${v.journal.born}, подтверждено ${v.journal.updated}`, `rules +${v.journal.born}, confirmed ${v.journal.updated}`);
  }
};
var correctionsWork = {
  id: "corrections",
  title: "разбор поправок владельца",
  cost: "llm",
  cooldownH: 12,
  due: (ctx) => countOf(ctx, "SELECT COUNT(*) n FROM corrections WHERE analyzed=0") > 0,
  run: (ctx) => {
    const c = analyzeCorrections(ctx.db, ctx.projectRoot, deepCaller(ctx, "разбор поправок владельца"));
    return c.analyzed > 0 ? t(`поправок разобрано ${c.analyzed} → правил ${c.born}`, `corrections analysed ${c.analyzed} → rules ${c.born}`) : null;
  }
};
var zsummaryWork = {
  id: "zsummary",
  title: "роли посещённых узлов",
  cost: "llm",
  cooldownH: 6,
  due: (ctx) => pendingSummaries(ctx.db, contentHashes(ctx.db), 1).length > 0,
  run: (ctx) => {
    const z = runZSummaries(ctx.db, ctx.projectRoot, routineCaller(ctx, "роли узлов"), new Date().toISOString(), undefined, ctx.dataDir);
    return z.stored > 0 ? t(`ролей выведено +${z.stored}`, `roles derived +${z.stored}`) : null;
  }
};
var contractRulesWork = {
  id: "contract",
  title: "вывод правил контракта среды",
  cost: "llm",
  cooldownH: 168,
  due: (ctx) => {
    const paths = walkFiles(ctx.projectRoot).map((f) => relative2(ctx.projectRoot, f.path).replaceAll("\\", "/"));
    return paths.some(isConfigFile);
  },
  run: (ctx) => {
    const paths = walkFiles(ctx.projectRoot).map((f) => relative2(ctx.projectRoot, f.path).replaceAll("\\", "/")).filter(isConfigFile).slice(0, 40);
    const entries = readConfigEntries(ctx.projectRoot, paths);
    if (entries.length === 0)
      return null;
    const outcome = callClaudeDetailed(buildRulesPrompt(entries), {
      intent: "deep",
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: "вывод правил контракта среды"
    });
    const res = outcome.result;
    if (!res)
      throw new Error(explainNoAnswer(outcome.tried));
    const rules = parseRules(res.text, res.model);
    const stored = storeRules(ctx.db, rules);
    return stored > 0 ? t(`правил среды выведено +${stored} (из ${entries.length} настроек проекта)`, `environment rules derived +${stored} (from ${entries.length} project settings)`) : null;
  }
};
var unknownMaterialWork = {
  id: "material",
  title: "обучение незнакомому материалу",
  cost: "llm",
  cooldownH: 168,
  due: (ctx) => countOf(ctx, "SELECT COUNT(*) n FROM fact_journal WHERE source='miner:unknown-material' AND superseded_by IS NULL") > 0,
  run: (ctx) => {
    const walked = walkFiles(ctx.projectRoot);
    const unknown = findUnknownMaterial(walked.map((f) => f.ext), {
      code: CODE_EXT,
      entity: ENTITY_EXT,
      office: new Set([...OFFICE, ...TEXT, ...CSVX])
    });
    if (unknown.kinds.length === 0)
      return null;
    const kind = unknown.kinds[0].ext;
    const samples = [];
    for (const f of walked) {
      if (samples.length >= 5)
        break;
      if ((f.ext || "(без расширения)") !== kind)
        continue;
      try {
        const content = readFileSync4(f.path, "utf8");
        if (content.includes("\x00"))
          continue;
        samples.push({ file: relative2(ctx.projectRoot, f.path).replaceAll("\\", "/"), content: content.slice(0, 3000) });
      } catch {}
    }
    if (samples.length < 2)
      return null;
    const outcome = callClaudeDetailed(buildUnknownPrompt(kind, samples), {
      intent: "deep",
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: `обучение материалу ${kind}`
    });
    const res = outcome.result;
    if (!res)
      throw new Error(explainNoAnswer(outcome.tried));
    const rules = parseRules2(res.text, 2);
    if (rules.length === 0)
      return null;
    const facts = rules.map((r) => ruleToFact(r, samples.length));
    const journal = new FactStore(ctx.db).assertAll(facts, `llm:material:${kind}`);
    return journal.born > 0 ? t(`материал ${kind}: выведено правил +${journal.born}`, `material ${kind}: rules derived +${journal.born}`) : null;
  }
};
var compositionWork = {
  id: "composition",
  title: "разбор устройства продукта",
  cost: "llm",
  cooldownH: 336,
  due: (ctx) => walkFiles(ctx.projectRoot).length >= 20,
  run: (ctx) => {
    const walked = walkFiles(ctx.projectRoot);
    const rel = (p) => relative2(ctx.projectRoot, p).replaceAll("\\", "/");
    const rels = walked.map((f) => rel(f.path));
    const lines = new Map;
    for (const f of walked.slice(0, 1500)) {
      try {
        if (f.size > 400000)
          continue;
        lines.set(rel(f.path), readFileSync4(f.path, "utf8").split(`
`).length);
      } catch {}
    }
    const cochange = [];
    try {
      for (const r of ctx.db.query("SELECT file_a, file_b, n FROM cochange").all()) {
        cochange.push({ a: r.file_a, b: r.file_b, n: r.n });
      }
    } catch {}
    const composition = buildComposition({ files: rels, lines, cochange });
    if (composition.formats.length < 2)
      return null;
    try {
      const observations = composition.formats.map((f) => ({
        ext: f.ext,
        pairsWith: composition.pairs.filter((p) => p.a === f.ext || p.b === f.ext).filter((p) => p.twinShare >= 0.5).map((p) => p.a === f.ext ? p.b : p.a),
        medianLines: f.medianLines
      }));
      mergeLearnedMaterials(dirname(ctx.dataDir), observations, basename(ctx.dataDir));
    } catch {}
    const outcome = callClaudeDetailed(buildCompositionPrompt(composition, basename(ctx.projectRoot)), {
      intent: "deep",
      dataDir: ctx.dataDir,
      db: ctx.db,
      purpose: "разбор устройства продукта"
    });
    const res = outcome.result;
    if (!res)
      throw new Error(explainNoAnswer(outcome.tried));
    const rules = parseRules2(res.text, 2);
    if (rules.length === 0)
      return null;
    const journal = new FactStore(ctx.db).assertAll(rules.map((r) => ruleToFact(r, composition.formats.length)), "llm:composition");
    return journal.born > 0 ? t(`устройство продукта: правил +${journal.born} (видов материала ${composition.formats.length})`, `product shape: rules +${journal.born} (${composition.formats.length} kinds of material)`) : null;
  }
};
var groundingWork = {
  id: "grounding",
  title: "перепроверка доменных стандартов",
  cost: "llm",
  cooldownH: 720,
  due: (ctx) => {
    const domains = activePlaybookDomains(ctx);
    return dueForGrounding(ctx.db, domains, ctx.nowMs) !== null;
  },
  run: (ctx) => {
    const domain = dueForGrounding(ctx.db, activePlaybookDomains(ctx), ctx.nowMs);
    if (!domain)
      return null;
    const pb = PLAYBOOKS.find((p) => p.domain === domain);
    if (!pb)
      return null;
    const res = callClaudeWithTools(buildGroundingPrompt(domain, pb.checklist, pb.thresholds ?? [], pb.source), {
      intent: "deep",
      dataDir: ctx.dataDir
    });
    if (!res)
      throw new Error("модели недоступны или нет сети");
    const answer = parseGrounding(res.text);
    if (!answer)
      return null;
    const nowIso = new Date().toISOString();
    storeGrounding(ctx.db, { domain, checkedAt: nowIso, correction: answer.changed ? answer.correction : "", source: answer.source });
    return answer.changed ? t(`стандарты «${domain}»: есть изменения — ${answer.correction.slice(0, 120)}`, `“${domain}” standards: there are changes — ${answer.correction.slice(0, 120)}`) : t(`стандарты «${domain}»: подтверждены без изменений`, `“${domain}” standards: confirmed unchanged`);
  }
};
function activePlaybookDomains(ctx) {
  try {
    const facts = new FactStore(ctx.db).active();
    const text = facts.map((f) => f.statement).join(" ").toLowerCase();
    return PLAYBOOKS.filter((p) => p.triggers.some((t2) => text.includes(t2.toLowerCase()))).map((p) => p.domain);
  } catch {
    return [];
  }
}
var WORKS = [truthWork, repairWork, layer1Work, driftWork, verbalizeWork, correctionsWork, zsummaryWork, contractRulesWork, unknownMaterialWork, compositionWork, groundingWork];

export { WORKS };
