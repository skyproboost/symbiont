// src/gates/evidence.ts
import { existsSync, readFileSync } from "node:fs";
var CHECK_COMMAND = /\b(test|tests|spec|specs|pytest|jest|vitest|mocha|phpunit|rspec|cargo\s+(test|check|clippy)|go\s+(test|vet)|dotnet\s+test|gradle\w*\s+test|mvn\w*\s+(test|verify)|tsc\b|eslint|ruff|mypy|flake8|pylint|golangci-lint|canary|selflint|lint)\b/i;
var EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
var RECON_HEAD = /^(grep|egrep|rg|ag|ls|dir|cat|bat|head|tail|less|more|find|fd|sed|awk|wc|echo|printf|cd|pushd|git|diff|stat|file|type|sort|uniq|cut|tr|tee|sls|gc|gci|Select-String|Get-Content|Get-ChildItem|Test-Path)$/i;
function subcommands(command) {
  const flat = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q) => q.replace(/[|;&\n]/g, " "));
  return flat.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}
function headOf(segment) {
  const words = segment.replace(/^[({\s]+/, "").split(/\s+/);
  const head = words.find((w) => !/^\w+=/.test(w)) ?? "";
  return head.replace(/^.*[\\/]/, "");
}
var isCheckCommand = (command) => subcommands(command).some((s) => CHECK_COMMAND.test(s) && !RECON_HEAD.test(headOf(s)));
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
      if (SHELL_TOOLS.has(c.name)) {
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
var SUMMARY_RED = /\b[1-9]\d*\s+(fail|failed|failing|failures?)\b|\bFAILURES!|\bERRORS!|test result: FAILED|\bFailed:\s*[1-9]/;
var SUMMARY_GREEN = /\b0\s+(fail|failed|failures)\b|\b\d+\s+(pass|passed|passing)\b|\bOK \(\d+ tests?|test result: ok|\bPassed!/;
var ITEM_RED = /^\s*\(fail\)|^\s*(---\s+)?FAIL\b|^\s*FAILED\b|^not ok\b/;
var ITEM_GREEN = /^ok\s+\S+|^\s*PASS\b/;
var OTHER_RED = /\b[1-9]\d*\s+errors?\b|\berror TS\d+/;
var PASSED_ITEM = /^\s*(\(pass\)|✓|✔|√|ok\b|PASS\b)/;
function testVerdict(output) {
  let summary = "unknown";
  let itemRed = false;
  let itemGreen = false;
  for (const line of output.split(`
`)) {
    if (ITEM_RED.test(line))
      itemRed = true;
    else if (ITEM_GREEN.test(line))
      itemGreen = true;
    if (PASSED_ITEM.test(line))
      continue;
    if (SUMMARY_RED.test(line))
      summary = "red";
    else if (SUMMARY_GREEN.test(line))
      summary = "green";
  }
  if (summary !== "unknown")
    return summary;
  return itemRed ? "red" : itemGreen ? "green" : "unknown";
}
var testsFailed = (output) => testVerdict(output) === "red";
function verdictOf(output) {
  const tests = testVerdict(output);
  if (tests === "red")
    return "red";
  if (output.split(`
`).some((l) => !PASSED_ITEM.test(l) && OTHER_RED.test(l)))
    return "red";
  return tests;
}
function resultText(content) {
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return "";
  return content.map((c) => String(c.text ?? "")).join(`
`);
}
var MUTATING_SHELL = /\bsed\s+(-\w+\s+)*-\w*i|\bperl\s+-\w*i|(^|[^<>&\d-])>{1,2}\s*[\w./"'$~-]|\btee\s|\bgit\s+(checkout|restore|stash|apply|revert|reset|merge|rebase|cherry-pick|pull)\b|\b(patch|mv|cp|rm)\s|\b(Set-Content|Add-Content|Out-File|Move-Item|Copy-Item|Remove-Item)\b/i;
var MAX_REMOVED_LINES = 400;
function removedBy(oldText, newText) {
  const kept = new Map;
  for (const l of newText.split(`
`)) {
    const k = l.trim();
    if (k)
      kept.set(k, (kept.get(k) ?? 0) + 1);
  }
  const out = [];
  for (const l of oldText.split(`
`)) {
    const k = l.trim();
    if (!k)
      continue;
    const left = kept.get(k) ?? 0;
    if (left > 0)
      kept.set(k, left - 1);
    else
      out.push(k);
  }
  return out;
}
var DELETING_SHELL = /\b(rm|unlink|rmdir|del|Remove-Item|git\s+rm)\b/i;
function runHistory(transcriptPath, toRel) {
  const none = { episodes: [], created: new Set, deletions: [], lastRun: null, readable: false };
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
  const episodes = [];
  const created = new Set;
  const touched = new Set;
  const pendingChecks = new Set;
  const deletions = [];
  let afterRed = false;
  let murky = false;
  let gap = [];
  let removed = new Map;
  let lastRun = null;
  const reset = () => {
    afterRed = false;
    murky = false;
    gap = [];
    removed = new Map;
  };
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"') && !line.includes('"type":"user"'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "user" && !obj.isMeta && typeof obj.message?.content === "string") {
      const said = obj.message.content.trim();
      if (said && !said.startsWith("<"))
        reset();
      continue;
    }
    if (!Array.isArray(obj.message?.content))
      continue;
    for (const c of obj.message?.content) {
      if (c.type === "tool_use" && c.name && SHELL_TOOLS.has(c.name)) {
        const cmd = String(c.input?.command ?? "");
        if (isCheckCommand(cmd) && c.id)
          pendingChecks.add(c.id);
        if (afterRed && MUTATING_SHELL.test(cmd))
          murky = true;
        if (DELETING_SHELL.test(cmd))
          deletions.push(cmd);
        continue;
      }
      if (c.type === "tool_use" && c.name) {
        const abs = String(c.input?.file_path ?? c.input?.notebook_path ?? "");
        const rel = abs ? toRel(abs) : null;
        if (!rel)
          continue;
        if (EDIT_TOOLS.has(c.name)) {
          if (c.name === "Write" && !touched.has(rel))
            created.add(rel);
          if (afterRed) {
            if (!gap.includes(rel))
              gap.push(rel);
            const edits = c.name === "MultiEdit" && Array.isArray(c.input?.edits) ? c.input?.edits : c.name === "Edit" ? [c.input ?? {}] : null;
            const before = removed.get(rel);
            if (edits === null || before === null || edits.some((e) => typeof e.old_string !== "string"))
              removed.set(rel, null);
            else {
              const lost = edits.flatMap((e) => removedBy(String(e.old_string ?? ""), String(e.new_string ?? "")));
              removed.set(rel, [...before ?? [], ...lost].slice(0, MAX_REMOVED_LINES));
            }
          }
        }
        if (EDIT_TOOLS.has(c.name) || c.name === "Read")
          touched.add(rel);
        continue;
      }
      if (c.type !== "tool_result" || !c.tool_use_id || !pendingChecks.has(c.tool_use_id))
        continue;
      pendingChecks.delete(c.tool_use_id);
      const output = resultText(c.content);
      const verdict = verdictOf(output);
      if (verdict !== "unknown")
        lastRun = verdict;
      if (verdict === "red") {
        if (testsFailed(output))
          afterRed = true;
      } else if (verdict === "green") {
        if (afterRed && gap.length > 0 && !murky)
          episodes.push({ edited: gap, removed });
        reset();
      }
    }
  }
  return { episodes, created, deletions, lastRun, readable: true };
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

export { evidenceFromTranscript, runHistory, searchChurn };
