import {
  FactStore,
  openDb
} from "./session-start-q2jjr130.js";

// src/core/data-root.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
var segments = (p) => p.split(/[\\/]+/).filter((s) => s.length > 0);
function deriveStableRoot(legacyDataDir) {
  const segs = segments(legacyDataDir);
  const i = segs.findIndex((s, k) => s === "plugins" && segs[k + 1] === "cache");
  if (i === -1 || segs.length < i + 5)
    return null;
  const market = segs[i + 2];
  const plugin = segs[i + 3];
  const prefix = rebuildPrefix(legacyDataDir, i);
  if (!prefix)
    return null;
  return join(prefix, "data", `${plugin}-${market}`);
}
function rebuildPrefix(p, pluginsIdx) {
  const parts = p.split(/([\\/]+)/);
  let seg = -1;
  let out = "";
  for (const part of parts) {
    out += part;
    if (!/^[\\/]+$/.test(part) && part.length > 0) {
      seg++;
      if (seg === pluginsIdx)
        return out;
    }
  }
  return null;
}
function resolveDataRoot(legacyDataDir, argv = process.argv, env = process.env) {
  const flag = argv.indexOf("--data");
  if (flag !== -1 && argv[flag + 1] && !argv[flag + 1].includes("${")) {
    return { root: argv[flag + 1], mode: "argv", legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null };
  }
  const fromEnv = env.CLAUDE_PLUGIN_DATA?.trim();
  if (fromEnv) {
    return { root: fromEnv, mode: "env", legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null };
  }
  const derived = deriveStableRoot(legacyDataDir);
  if (derived) {
    return { root: derived, mode: "derived", legacyRoot: existsSync(legacyDataDir) ? legacyDataDir : null };
  }
  return { root: legacyDataDir, mode: "dev", legacyRoot: null };
}
function stripDataFlag(args) {
  const out = [];
  for (let i = 0;i < args.length; i++) {
    if (args[i] === "--data") {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}
function renderRootNotice(res) {
  if (res.mode !== "dev")
    return "";
  return `  корень данных выведен из пути (режим dev): ${res.root}`;
}
function isVersionedInstall(legacyDataDir) {
  const segs = segments(legacyDataDir);
  return segs.some((s, k) => s === "plugins" && segs[k + 1] === "cache");
}
function migrateLegacyPassports(res) {
  const report = { copiedSlugs: [], mergedLlmFacts: 0 };
  if (!res.legacyRoot || res.root === res.legacyRoot)
    return report;
  if (!isVersionedInstall(res.legacyRoot))
    return report;
  const versionDir = dirname(res.legacyRoot);
  const versionsRoot = dirname(versionDir);
  let versions;
  try {
    versions = readdirSync(versionsRoot).filter((v) => existsSync(join(versionsRoot, v, ".data")));
  } catch {
    return report;
  }
  versions.sort(compareVersionsDesc);
  mkdirSync(res.root, { recursive: true });
  const markerPath = join(res.root, ".migrated.json");
  let done = [];
  try {
    done = JSON.parse(readFileSync(markerPath, "utf8")).done ?? [];
  } catch {}
  const pending = versions.filter((v) => !done.includes(v));
  if (pending.length === 0)
    return report;
  for (const v of versions) {
    const dataDir = join(versionsRoot, v, ".data");
    let slugs;
    try {
      slugs = readdirSync(dataDir);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const src = join(dataDir, slug);
      const dst = join(res.root, slug);
      if (!existsSync(join(src, "passport.db")))
        continue;
      if (!existsSync(join(dst, "passport.db"))) {
        try {
          cpSync(src, dst, { recursive: true });
          report.copiedSlugs.push(slug);
        } catch {
          continue;
        }
      } else {
        report.mergedLlmFacts += mergeLlmFacts(join(src, "passport.db"), join(dst, "passport.db"));
      }
    }
  }
  try {
    writeFileSync(markerPath, JSON.stringify({ done: versions, at: new Date().toISOString() }, null, 1), "utf8");
  } catch {}
  return report;
}
function mergeLlmFacts(srcDb, dstDb) {
  let merged = 0;
  try {
    const src = openDb(srcDb, { readonly: true });
    const dst = openDb(dstDb);
    try {
      new FactStore(dst);
      const rows = src.query("SELECT * FROM fact_journal WHERE superseded_by IS NULL AND source LIKE 'llm:%'").all();
      const exists = dst.query("SELECT 1 AS x FROM fact_journal WHERE key=? AND superseded_by IS NULL");
      const ins = dst.query(`INSERT INTO fact_journal(key, area, statement, tier, prevalence, positive, total, source, asserted_at, seen_at, superseded_by, rating, deviation, confirmations)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`);
      for (const r of rows) {
        if (exists.get(r.key))
          continue;
        ins.run(r.key, r.area, r.statement, r.tier, r.prevalence, r.positive, r.total, r.source, r.asserted_at, r.seen_at, r.rating ?? null, r.deviation ?? null, r.confirmations ?? 0);
        merged++;
      }
    } finally {
      src.close();
      dst.close();
    }
  } catch {}
  return merged;
}
function compareVersionsDesc(a, b) {
  const sa = /^\d+\.\d+\.\d+$/.test(a);
  const sb = /^\d+\.\d+\.\d+$/.test(b);
  if (sa !== sb)
    return sa ? -1 : 1;
  if (!sa)
    return b.localeCompare(a);
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0;i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0)
      return d;
  }
  return 0;
}

export { resolveDataRoot, stripDataFlag, renderRootNotice, migrateLegacyPassports };
