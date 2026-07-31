import {
  readStdinJson
} from "./session-start-p89re5se.js";
import {
  isInternalCall
} from "./session-start-5s7r4262.js";
import {
  resolveDataRoot
} from "./session-start-ah2h903t.js";
import {
  SessionLog,
  beat,
  openDb,
  slugOf
} from "./session-start-a6061n0b.js";
import"./session-start-70d7ckvt.js";

// src/hooks/session-end.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
if (isInternalCall())
  process.exit(0);
try {
  const input = readStdinJson();
  const cwd = input.cwd ?? process.cwd();
  const dataDir = join(resolveDataRoot(join(import.meta.dirname, "..", "..", ".data")).root, slugOf(cwd));
  beat(dataDir, "SessionEnd", { reason: input.reason ?? null });
  const dbPath = join(dataDir, "passport.db");
  if (input.session_id && existsSync(dbPath)) {
    const db = openDb(dbPath);
    new SessionLog(db).close(input.session_id, input.reason ?? "session-end");
    db.close();
  }
} catch {}
