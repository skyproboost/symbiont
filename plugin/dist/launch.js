import {
  agentHost
} from "./codex-call-b1s33asb.js";
import"./codex-call-rvra3cez.js";

// src/core/launch.ts
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
process.env.SYMBIONT_HOST = process.env.PLUGIN_ROOT || /[\\/]\.codex[\\/]/i.test(fileURLToPath(import.meta.url)) ? "codex" : agentHost();
var event = process.argv[2];
var targets = {
  "session-start": "hooks",
  "user-prompt": "hooks",
  "pre-tool": "hooks",
  "post-tool": "hooks",
  "post-tool-failure": "hooks",
  stop: "hooks",
  "pre-compact": "hooks",
  "subagent-start": "hooks",
  "session-end": "hooks",
  server: "mcp",
  symbiont: "cli",
  init: "cli",
  charter: "cli",
  constitution: "cli",
  elevate: "cli",
  lang: "cli",
  export: "cli",
  mute: "cli"
};
if (!targets[event])
  throw new Error(`Unknown Symbiont entry: ${event}`);
process.argv.splice(2, 1);
var here = dirname(fileURLToPath(import.meta.url));
var source = import.meta.url.endsWith(".ts");
var target = source ? join(here, "..", targets[event], `${event}.ts`) : join(here, `${event}.js`);
await import(pathToFileURL(target).href);
