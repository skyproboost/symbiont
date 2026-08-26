// src/gates/evidence.ts
import { existsSync, readFileSync } from "node:fs";
var CHECK_COMMAND = /\b(test|tests|spec|specs|pytest|jest|vitest|mocha|phpunit|rspec|cargo\s+(test|check|clippy)|go\s+(test|vet)|dotnet\s+test|gradle\w*\s+test|mvn\w*\s+(test|verify)|tsc\b|eslint|ruff|mypy|flake8|pylint|golangci-lint|canary|selflint|lint)\b/i;
var EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var isCheckCommand = (command) => CHECK_COMMAND.test(command);
var TAIL_LINES = 4000;
function evidenceFromTranscript(transcriptPath, own, toRel) {
  const none = { uncheckedFiles: [], checkedOnce: false, readable: false };
  if (!transcriptPath || !existsSync(transcriptPath))
    return none;
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split(`
`);
  } catch {
    return none;
  }
  if (lines.length > TAIL_LINES)
    lines = lines.slice(-TAIL_LINES);
  const unchecked = new Set;
  let checkedOnce = false;
  for (const line of lines) {
    if (!line.includes('"tool_use"'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content))
      continue;
    for (const c of obj.message?.content ?? []) {
      if (c.type !== "tool_use" || !c.name)
        continue;
      if (c.name === "Bash") {
        const cmd = String(c.input?.command ?? "");
        if (isCheckCommand(cmd)) {
          unchecked.clear();
          checkedOnce = true;
        }
        continue;
      }
      if (EDIT_TOOLS.has(c.name)) {
        const abs = String(c.input?.file_path ?? c.input?.notebook_path ?? "");
        const rel = abs ? toRel(abs) : null;
        if (rel && own.has(rel))
          unchecked.add(rel);
      }
    }
  }
  return { uncheckedFiles: [...unchecked], checkedOnce, readable: true };
}
var SEARCH_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
var SEARCH_BASH = /\b(grep|rg|find|ls|cat|head|tail|sed\s+-n|git\s+(log|show|grep|blame))\b/;
function searchChurn(transcriptPath, toRel) {
  const none = { steps: 0, files: [] };
  if (!transcriptPath || !existsSync(transcriptPath))
    return none;
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split(`
`);
  } catch {
    return none;
  }
  if (lines.length > TAIL_LINES)
    lines = lines.slice(-TAIL_LINES);
  let steps = 0;
  const files = new Set;
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"type":"user"'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user") {
      const c = obj.message?.content;
      const isText = typeof c === "string" || Array.isArray(c) && c.some((x) => x.type === "text");
      if (isText) {
        steps = 0;
        files.clear();
      }
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content))
      continue;
    for (const c of obj.message?.content) {
      if (c.type !== "tool_use" || !c.name)
        continue;
      if (EDIT_TOOLS.has(c.name)) {
        steps = 0;
        files.clear();
      } else if (SEARCH_TOOLS.has(c.name) || c.name === "Bash" && SEARCH_BASH.test(String(c.input?.command ?? ""))) {
        steps++;
        const abs = String(c.input?.file_path ?? "");
        const rel = abs ? toRel(abs) : null;
        if (rel)
          files.add(rel);
      }
    }
  }
  return { steps, files: [...files].slice(0, 8) };
}

export { evidenceFromTranscript, searchChurn };
