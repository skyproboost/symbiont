import {
  ENTITY_EXT,
  analyzeJs,
  buildResolveIndex,
  detectIndent,
  extractContentLinks,
  init_i18n,
  resolveContentTarget,
  t
} from "./session-start-spcqe6t1.js";

// src/gates/checks.ts
init_i18n();
var JS_FAMILY = new Set([".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".vue"]);
function checkAgainstLaws(content, ext, laws) {
  if (!JS_FAMILY.has(ext))
    return [];
  const out = [];
  const s = analyzeJs(content);
  const indent = detectIndent(content);
  const q = s.quotes;
  const quoteVerdict = q.single + q.double < 5 ? null : q.single >= q.double * 2 ? "single" : q.double >= q.single * 2 ? "double" : null;
  const sm = s.semiLines;
  const semiVerdict = sm.with + sm.without < 8 ? null : sm.with >= sm.without * 2 ? "with" : sm.without >= sm.with * 2 ? "without" : null;
  const add = (law, detail) => out.push({ law: law.statement, detail });
  for (const law of laws) {
    const st = law.statement;
    if (st.includes("переменные — только var")) {
      const n = s.decl.let + s.decl.const;
      if (n > 0)
        add(law, `let/const: ${n}`);
    } else if (st.includes("const/let")) {
      if (s.decl.var > 0)
        add(law, `var: ${s.decl.var}`);
    } else if (st.includes("стрелочные функции — не используются")) {
      if (s.fn.arrow > 0)
        add(law, `${t("стрелочных", "arrow functions")}: ${s.fn.arrow}`);
    } else if (st.includes("filter/map/reduce — не используются")) {
      const n = s.fmr.filter + s.fmr.map + s.fmr.reduce;
      if (n > 0)
        add(law, `filter/map/reduce: ${n}`);
    } else if (st.includes("деструктуризация в параметрах — не используется")) {
      if (s.destructuredParams > 0)
        add(law, `${t("деструктуризаций в параметрах", "destructured parameters")}: ${s.destructuredParams}`);
    } else if (st.includes("отступы — табы")) {
      if (indent === "s2" || indent === "s4")
        add(law, t("отступы пробелами", "indented with spaces"));
    } else if (st.includes("отступы — 2 пробела")) {
      if (indent === "tab" || indent === "s4") {
        add(law, indent === "tab" ? t("отступы табами", "indented with tabs") : t("отступы 4 пробелами", "indented with 4 spaces"));
      }
    } else if (st.includes("отступы — 4 пробела")) {
      if (indent === "tab" || indent === "s2") {
        add(law, indent === "tab" ? t("отступы табами", "indented with tabs") : t("отступы 2 пробелами", "indented with 2 spaces"));
      }
    } else if (st.includes("кавычки — одинарные")) {
      if (quoteVerdict === "double")
        add(law, `${t("двойные кавычки", "double quotes")}: ${q.double}`);
    } else if (st.includes("кавычки — двойные")) {
      if (quoteVerdict === "single")
        add(law, `${t("одинарные кавычки", "single quotes")}: ${q.single}`);
    } else if (st.includes("точки с запятой — используются")) {
      if (semiVerdict === "without")
        add(law, `${t("строк без ;", "lines without ;")}: ${sm.without}`);
    } else if (st.includes("точки с запятой — не используются")) {
      if (semiVerdict === "with")
        add(law, `${t("строк с ;", "lines with ;")}: ${sm.with}`);
    } else if (st.includes("<script setup>")) {
      if (ext === ".vue" && /<script(?![^>]*\bsetup\b)[^>]*>/.test(content))
        add(law, t("компонент без <script setup>", "component without <script setup>"));
    } else if (st.includes("Options API")) {
      if (ext === ".vue" && /<script[^>]*\bsetup\b/.test(content))
        add(law, t("компонент на <script setup>", "component using <script setup>"));
    }
  }
  return out;
}

// src/verifiers/content.ts
function makeResolver(entityRels) {
  const index = buildResolveIndex(entityRels);
  return (fromRel, target) => resolveContentTarget(fromRel, target, index);
}
function contentVerifierActive(ext) {
  return ENTITY_EXT.has(ext.toLowerCase());
}
function loadEntityResolver(db) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='entity_nodes'").get().n > 0;
    if (!has)
      return;
    const rels = db.query("SELECT file FROM entity_nodes").all().map((r) => r.file);
    return rels.length > 0 ? makeResolver(rels) : undefined;
  } catch {
    return;
  }
}
var CYRILLIC = /[Ѐ-ӿ]/;
var LATIN = /[A-Za-z]/;
var WORD_RE = /[A-Za-zЀ-ӿ][A-Za-zЀ-ӿ\d]*/g;
function stripNonProse(text) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/gi, " ").replace(/\b[\w.-]+\/[\w./-]+/g, " ");
}
function mixedScriptTokens(text) {
  const out = [];
  const seen = new Set;
  for (const m of stripNonProse(text).matchAll(WORD_RE)) {
    const tok = m[0];
    if (CYRILLIC.test(tok) && LATIN.test(tok) && !seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}
var MAX_EXAMPLES = 5;
function checkAlphabetPurity(content) {
  const bad = mixedScriptTokens(content);
  if (bad.length === 0)
    return [];
  const examples = bad.slice(0, MAX_EXAMPLES).map((t2) => `«${t2}»`).join(", ");
  return [
    {
      verifier: "чистота алфавита (кир/лат микс в слове)",
      detail: `${bad.length} слов со смешением алфавитов: ${examples}${bad.length > MAX_EXAMPLES ? " …" : ""}`
    }
  ];
}
function checkContentLinks(rel, content, ext, resolve) {
  const links = extractContentLinks(ext, content);
  const broken = [];
  const emptyAnchors = [];
  const anchorTargets = new Map;
  for (const link of links) {
    if (!link.explicit)
      continue;
    if (link.anchor.length === 0) {
      if (emptyAnchors.length < MAX_EXAMPLES)
        emptyAnchors.push(link.target);
      continue;
    }
    if (resolve) {
      const res = resolve(rel, link.target);
      if (res.kind === "broken") {
        broken.push(link.target);
        continue;
      }
      if (res.kind === "entity") {
        const set = anchorTargets.get(link.anchor) ?? new Set;
        set.add(res.rel);
        anchorTargets.set(link.anchor, set);
      }
    }
  }
  const out = [];
  if (broken.length > 0) {
    out.push({
      verifier: "битая внутренняя ссылка",
      detail: `${broken.length}: ${broken.slice(0, MAX_EXAMPLES).map((t2) => `→ ${t2}`).join(", ")}${broken.length > MAX_EXAMPLES ? " …" : ""}`
    });
  }
  const dup = [...anchorTargets.entries()].filter((pair) => pair[1].size >= 2);
  if (dup.length > 0) {
    out.push({
      verifier: "один анкор на разные цели",
      detail: dup.slice(0, MAX_EXAMPLES).map((pair) => `«${pair[0]}» → ${pair[1].size} целей`).join(", ")
    });
  }
  if (emptyAnchors.length > 0) {
    out.push({
      verifier: "ссылка без текста (a11y/SEO)",
      detail: `${emptyAnchors.length}: ${emptyAnchors.map((t2) => `→ ${t2}`).join(", ")}`
    });
  }
  return out;
}
function runContentVerifiers(rel, content, ext, ctx = {}) {
  if (!contentVerifierActive(ext))
    return [];
  return [...checkAlphabetPurity(content), ...checkContentLinks(rel, content, ext, ctx.resolve)];
}

export { checkAgainstLaws, contentVerifierActive, loadEntityResolver, runContentVerifiers };
