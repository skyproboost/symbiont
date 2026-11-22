// src/hooks/stdin.ts
import { readFileSync } from "node:fs";
function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").replace(/^﻿/, "").trim();
    if (!raw)
      return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export { readStdinJson };
