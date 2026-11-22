// src/layer2/evidence.ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// src/layer2/canon.ts
var LINE_MARKUP = /^\s*(?:(?:\/\/+|\/\*+|\*+\/?|#+|<!--|--|;+|[•·▪‣]|-(?=\s))\s*)*/;
function canonText(text) {
  return text.split(/\r?\n/).map((l) => l.replace(LINE_MARKUP, "")).join(" ").replace(/\s+/g, " ").trim();
}

// src/layer2/evidence.ts
var MIN_EVIDENCE = 3;
var MAX_FILE_BYTES = 1e6;
function ensure(db) {
  db.run("CREATE TABLE IF NOT EXISTS fact_evidence(fact_id INTEGER NOT NULL, file TEXT NOT NULL, quote TEXT NOT NULL, PRIMARY KEY(fact_id, file))");
}
function recordEvidence(db, factId, quotes) {
  try {
    ensure(db);
    db.query("DELETE FROM fact_evidence WHERE fact_id=?").run(factId);
    const add = db.query("INSERT OR REPLACE INTO fact_evidence(fact_id, file, quote) VALUES(?,?,?)");
    for (const q of quotes)
      add.run(factId, q.file, q.quote);
  } catch {}
}
function evidenceOf(db, projectRoot, factId) {
  let rows;
  try {
    rows = db.query("SELECT file, quote FROM fact_evidence WHERE fact_id=?").all(factId);
  } catch {
    return { recorded: 0, standing: 0 };
  }
  let standing = 0;
  for (const row of rows) {
    try {
      const path = join(projectRoot, row.file);
      if (statSync(path).size > MAX_FILE_BYTES)
        continue;
      if (canonText(readFileSync(path, "utf8")).includes(canonText(row.quote)))
        standing++;
    } catch {}
  }
  return { recorded: rows.length, standing };
}

export { canonText, MIN_EVIDENCE, recordEvidence, evidenceOf };
