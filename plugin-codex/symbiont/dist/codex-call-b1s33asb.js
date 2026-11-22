// src/core/host.ts
import { existsSync } from "node:fs";
import { join, delimiter, basename } from "node:path";
function agentHost(env = process.env) {
  if (env.SYMBIONT_HOST === "codex" || env.SYMBIONT_HOST === "claude")
    return env.SYMBIONT_HOST;
  const root = env.PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT ?? "";
  if (/[\\/]\.codex[\\/]/i.test(root))
    return "codex";
  if (/[\\/]\.claude[\\/]/i.test(root) || env.CLAUDECODE || env.CLAUDE_CODE_EXECPATH)
    return "claude";
  return env.CODEX_THREAD_ID || env.CODEX_MANAGED_BY_NPM || env.CODEX_MANAGED_BY_BUN ? "codex" : "claude";
}
function codexModels(env = process.env) {
  return [env.SYMBIONT_CODEX_MODEL?.trim() || "gpt-6-astra"];
}
function codexCommand(env = process.env) {
  const explicit = env.SYMBIONT_CODEX_BIN ?? env.CODEX_EXEC_PATH;
  if (explicit && /^codex(?:\.exe)?$/i.test(basename(explicit)) && existsSync(explicit))
    return { command: explicit, args: [] };
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    const native = join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(native))
      return { command: native, args: [] };
    if (process.platform === "win32") {
      const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
      const packaged = join(dir, "node_modules", "@openai", "codex", "node_modules", "@openai", `codex-win32-${process.arch}`, "vendor", target, "bin", "codex.exe");
      if (existsSync(packaged))
        return { command: packaged, args: [] };
    }
    const js = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(js))
      return { command: process.execPath, args: [js] };
  }
  return { command: "codex", args: [] };
}

export { agentHost, codexModels, codexCommand };
