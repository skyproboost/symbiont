import {
  readStdinJson
} from "./codex-call-p89re5se.js";
import {
  isInternalCall
} from "./codex-call-5s7r4262.js";
import {
  resolveDataRoot
} from "./codex-call-f5867843.js";
import {
  SessionLog,
  beat,
  initLang,
  init_i18n,
  openDb,
  slugOf
} from "./codex-call-21dvb3ma.js";
import"./codex-call-b1s33asb.js";
import"./codex-call-rvra3cez.js";

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
