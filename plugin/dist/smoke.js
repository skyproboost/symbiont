import {
  fileMetrics
} from "./session-start-0xyqxcjv.js";
import"./session-start-70d7ckvt.js";

// src/bundle/smoke.ts
var m = await fileMetrics(".js", `try { f() } catch (e) {}
`);
console.log(JSON.stringify(m));
process.exit(m !== null && m.tryCount === 1 && m.catchCount === 1 ? 0 : 1);
