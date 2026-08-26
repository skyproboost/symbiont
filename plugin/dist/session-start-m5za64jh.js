// src/layer1/symbols.ts
var KIND_OF = [
  [/^(class_declaration|class_definition|class_specifier)$/, "class"],
  [/^(interface_declaration|interface_type)$/, "interface"],
  [/^(struct_item|struct_specifier)$/, "struct"],
  [/^(enum_declaration|enum_item|enum_specifier)$/, "enum"],
  [/^trait_item$/, "trait"],
  [/^impl_item$/, "impl"],
  [/^(module|object_definition|namespace_definition)$/, "module"],
  [/^(method_definition|method_declaration|constructor_declaration)$/, "method"],
  [/^(function_declaration|function_definition|function_item|func_literal|function_signature)$/, "function"],
  [/^(type_alias_declaration|type_declaration|type_spec|type_item)$/, "type"]
];
var CONTAINERS = new Set(["class", "interface", "struct", "trait", "impl", "enum", "module"]);
var IS_DECLARATOR = /^(variable_declarator|assignment|short_var_declaration)$/;
var IS_CALL = /^(call_expression|call|method_invocation|function_call_expression|invocation_expression)$/;
var IS_STRING = /string/;
function caseOf(node) {
  const call = node.type === "expression_statement" ? node.namedChild(0) : node;
  if (!call || !IS_CALL.test(call.type))
    return null;
  const fn = call.childForFieldName?.("function") ?? call.namedChild(0);
  const args = call.childForFieldName?.("arguments") ?? call.namedChild(1);
  if (!fn || !args || args.namedChildCount === 0)
    return null;
  const first = args.namedChild(0);
  if (!IS_STRING.test(first.type))
    return null;
  const title = (first.text ?? "").replace(/^[`'"]|[`'"]$/g, "").split(`
`)[0].trim().slice(0, 80);
  const callee = (fn.text ?? "").split(`
`)[0].trim().slice(0, 40);
  if (!title || !callee)
    return null;
  return { callee, title, call };
}
var IS_FN_VALUE = /^(arrow_function|function_expression|lambda|function|closure_expression)$/;
var MAX_SYMBOLS = 300;
var kindOf = (type) => {
  for (const [re, kind] of KIND_OF)
    if (re.test(type))
      return kind;
  return null;
};
function nameOf(node) {
  const field = node.childForFieldName?.("name");
  const direct = field?.text?.trim();
  if (direct)
    return direct.split(`
`)[0].slice(0, 120);
  for (let i = 0;i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (/identifier|^name$|^word$|constant/.test(c.type)) {
      const text = c.text.trim();
      if (text)
        return text.split(`
`)[0].slice(0, 120);
    }
  }
  return null;
}
var hasFnValue = (node) => {
  for (let i = 0;i < node.namedChildCount; i++)
    if (IS_FN_VALUE.test(node.namedChild(i).type))
      return true;
  return false;
};
function collectOutline(root) {
  const out = [];
  const walk = (node, prefix, casesOnly = false) => {
    if (out.length >= MAX_SYMBOLS)
      return;
    for (let i = 0;i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (out.length >= MAX_SYMBOLS)
        return;
      const cs = caseOf(child);
      if (cs) {
        const start2 = child.startPosition?.row;
        const end2 = child.endPosition?.row;
        if (start2 !== undefined && end2 !== undefined) {
          const full2 = `${prefix ? `${prefix}.` : ""}${cs.callee}(${cs.title})`;
          out.push({ name: full2, kind: "case", line: start2 + 1, endLine: end2 + 1, chars: Math.max(0, (child.endIndex ?? 0) - (child.startIndex ?? 0)) });
          walk(cs.call, full2, true);
          continue;
        }
      }
      if (casesOnly) {
        walk(child, prefix, true);
        continue;
      }
      let kind = kindOf(child.type);
      if (!kind && IS_DECLARATOR.test(child.type) && hasFnValue(child))
        kind = "function";
      if (!kind) {
        walk(child, prefix);
        continue;
      }
      const name = nameOf(child);
      const start = child.startPosition?.row;
      const end = child.endPosition?.row;
      if (name === null || start === undefined || end === undefined) {
        walk(child, prefix);
        continue;
      }
      const full = prefix ? `${prefix}.${name}` : name;
      const startIndex = child.startIndex ?? 0;
      const endIndex = child.endIndex ?? 0;
      out.push({ name: full, kind, line: start + 1, endLine: end + 1, chars: Math.max(0, endIndex - startIndex) });
      if (CONTAINERS.has(kind))
        walk(child, full);
    }
  };
  walk(root, "");
  return out;
}
function ensureSymbols(db) {
  db.run("CREATE TABLE IF NOT EXISTS symbols(file TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, chars INTEGER NOT NULL, PRIMARY KEY(file, ord))");
  db.run("CREATE TABLE IF NOT EXISTS symbols_meta(file TEXT PRIMARY KEY, hash TEXT NOT NULL, n INTEGER NOT NULL)");
}
function indexedHash(db, file) {
  try {
    return db.query("SELECT hash FROM symbols_meta WHERE file=?").get(file)?.hash ?? null;
  } catch {
    return null;
  }
}
function storeOutline(db, file, hash, rows) {
  ensureSymbols(db);
  db.query("DELETE FROM symbols WHERE file=?").run(file);
  const put = db.query("INSERT INTO symbols(file, ord, name, kind, line, end_line, chars) VALUES(?,?,?,?,?,?,?)");
  rows.forEach((r, i) => put.run(file, i, r.name, r.kind, r.line, r.endLine, r.chars));
  db.query("INSERT INTO symbols_meta(file, hash, n) VALUES(?,?,?) ON CONFLICT(file) DO UPDATE SET hash=excluded.hash, n=excluded.n").run(file, hash, rows.length);
}
function pruneSymbols(db, present) {
  try {
    const files = db.query("SELECT file FROM symbols_meta").all().map((r) => r.file);
    const delRows = db.query("DELETE FROM symbols WHERE file=?");
    const delMeta = db.query("DELETE FROM symbols_meta WHERE file=?");
    for (const f of files) {
      if (present.has(f))
        continue;
      delRows.run(f);
      delMeta.run(f);
    }
  } catch {}
}
function readOutline(db, file) {
  try {
    return db.query("SELECT name, kind, line, end_line, chars FROM symbols WHERE file=? ORDER BY ord").all(file).map((r) => ({ name: r.name, kind: r.kind, line: r.line, endLine: r.end_line, chars: r.chars }));
  } catch {
    return [];
  }
}
var tokensOf = (chars) => Math.max(1, Math.round(chars / 4));
var OUTLINE_LINE_OVERHEAD = 24;
var outlineTokens = (rows) => rows.length === 0 ? 0 : tokensOf(rows.reduce((s, r) => s + r.name.length + r.kind.length + OUTLINE_LINE_OVERHEAD, 0));
var heaviestTokens = (rows) => rows.length === 0 ? 0 : tokensOf(Math.max(...rows.map((r) => r.chars)));
function resolveIndexed(db, needle) {
  const wanted = needle.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!wanted)
    return null;
  try {
    const row = db.query("SELECT file FROM symbols_meta WHERE file = ? OR file LIKE '%/' || ? ORDER BY LENGTH(file) LIMIT 1").get(wanted, wanted);
    return row?.file ?? null;
  } catch {
    return null;
  }
}
function outlineView(db, file, readFile, hashOf) {
  const rows = readOutline(db, file);
  const content = readFile(file);
  const fresh = content !== null && indexedHash(db, file) === hashOf(content);
  return { file, rows, fresh, wholeFileTokens: content === null ? 0 : tokensOf(content.length) };
}

export { collectOutline, ensureSymbols, indexedHash, storeOutline, pruneSymbols, tokensOf, outlineTokens, heaviestTokens, resolveIndexed, outlineView };
