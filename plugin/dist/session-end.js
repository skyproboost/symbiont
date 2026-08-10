import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-03xp094k.js";
import {
  SessionLog,
  beat,
  initLang,
  init_i18n,
  openDb,
  slugOf
} from "./session-start-zxs5x1we.js";
import"./session-start-rvra3cez.js";

// src/hooks/session-end.ts
init_i18n();
import { existsSync } from "node:fs";
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
try {
  const input = readStdinJson();
  const cwd = input.cwd ?? process.cwd();
  const dataDir = join(resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root, slugOf(cwd));
  initLang(dataDir, cwd);
  beat(dataDir, "SessionEnd", { reason: input.reason ?? null });
  const dbPath = join(dataDir, "passport.db");
  if (input.session_id && existsSync(dbPath)) {
    const db = openDb(dbPath);
    new SessionLog(db).close(input.session_id, input.reason ?? "session-end");
    db.close();
  }
} catch {}
