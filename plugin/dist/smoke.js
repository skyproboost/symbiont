import {
  fileMetrics
} from "./session-start-penbn1w9.js";
import"./session-start-rvra3cez.js";

// src/bundle/smoke.ts
var m = await fileMetrics(".js", `try { f() } catch (e) {}
`);
console.log(JSON.stringify(m));
process.exit(m !== null && m.tryCount === 1 && m.catchCount === 1 ? 0 : 1);
