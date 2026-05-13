#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const now = new Date();
const runId = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const tasksDir = "ops/agent-control/tasks";
const reportsRoot = "ops/agent-control/reports";
const schemaPath = "ops/agent-control/OPENCLAW_TASK_SCHEMA.v1.json";
const explicitTaskFile = process.env.TASK_FILE?.trim() || "";
const forceRerun = (process.env.FORCE_RERUN || "").toLowerCase() === "true";
const dedupeWindowMinutes = Number(process.env.DEDUPE_WINDOW_MINUTES || "15");
const actor = process.env.GITHUB_ACTOR || "unknown";
const sha = process.env.GITHUB_SHA || "unknown";
const runUrl = process.env.GITHUB_RUN_URL || "unknown";
const latestFile = process.env.OPENCLAW_LATEST_FILE || "ops/agent-control/reports/openclaw-latest.json";
const supportedTaskTypes = new Set(["heartbeat", "virtual_browser_audit", "synthetic_fail"]);
const prohibitedSafetyFlags = ["customer_action", "public_posting", "paid_ads_change", "destructive_action"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function lastChangedTaskFromPush() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD", "--", "ops/agent-control/tasks/*.json"], { encoding: "utf8" });
    const files = out.split("\n").map((x) => x.trim()).filter((x) => x.endsWith(".json") && fs.existsSync(x));
    if (files.length === 0) return null;
    return files[files.length - 1];
  } catch {
    return null;
  }
}
function latestTaskFile() {
  const changedTask = lastChangedTaskFromPush();
  if (changedTask) return changedTask;
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json")).map((f) => path.join(tasksDir, f));
  if (!files.length) throw new Error(`No task files found in ${tasksDir}`);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}
function safe(text) {
  return String(text)
    .replaceAll(/(postgres(?:ql)?:\/\/)\S+/gi, "$1***REDACTED***")
    .replaceAll(/(token|password|secret|service_role)[^\s]*/gi, "$1=***REDACTED***");
}
function writeReport(dir, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${runId}.md`);
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
  return out;
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function parseTaskReport(file) {
  const text = fs.readFileSync(file, "utf8");
  const get = (k) => {
    const m = text.match(new RegExp(`- ${k}: \`([^\`]+)\``));
    return m ? m[1] : "";
  };
  return { task_id: get("task_id"), timestamp_utc: get("timestamp_utc") };
}
function lastTaskExecution(taskId) {
  const dirs = ["openclaw-heartbeat", "openclaw-browser-audit"].map((d) => path.join(reportsRoot, d)).filter((d) => fs.existsSync(d));
  const files = [];
  for (const d of dirs) for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) files.push(path.join(d, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files.slice(0, 100)) {
    const parsed = parseTaskReport(f);
    if (parsed.task_id === taskId && parsed.timestamp_utc) return parsed.timestamp_utc;
  }
  return null;
}
function dedupeCheck(taskId) {
  if (forceRerun) return null;
  const last = lastTaskExecution(taskId);
  if (!last) return null;
  const deltaMin = (Date.now() - new Date(last).getTime()) / 60000;
  if (deltaMin < dedupeWindowMinutes) return `task dedupe window active (${deltaMin.toFixed(1)}m < ${dedupeWindowMinutes}m)`;
  return null;
}
function validateTask(task) {
  const errors = [];
  const req = ["id", "type", "requested_by", "goal", "safety", "expected_status"];
  for (const key of req) if (!(key in task)) errors.push(`missing required field: ${key}`);
  const statusAllowed = new Set(["PASS", "FAIL", "BLOCKED", "DEGRADED"]);
  if (task.expected_status && !statusAllowed.has(task.expected_status)) errors.push(`invalid expected_status: ${task.expected_status}`);
  const safetyReq = ["production_code_change", "customer_action", "secrets_required", "public_posting", "paid_ads_change", "destructive_action"];
  if (typeof task.safety !== "object" || task.safety === null) errors.push("safety must be an object");
  else for (const key of safetyReq) if (!(key in task.safety)) errors.push(`missing safety field: ${key}`);
  return errors;
}
function checkUnsafeSafety(task) {
  if (!task.safety || typeof task.safety !== "object") return null;
  for (const flag of prohibitedSafetyFlags) if (task.safety[flag] === true) return `unsafe task blocked by safety flag: ${flag}=true`;
  return null;
}
function runBrowserAudit(task) {
  const target = task.params?.target_origin || "https://handyandfriend.com";
  const routes = task.params?.routes || "/,/book,/pricing,/services,/messenger";
  const attempts = Number(task.params?.max_attempts || 2);
  const env = { ...process.env, TARGET_ORIGIN: target, ROUTES: routes, OUT_DIR: `ops/openclaw/reports/virtual-browser/${runId}` };
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      execFileSync("node", ["scripts/openclaw-virtual-browser-audit.mjs"], { stdio: "inherit", env });
      return { target, routes, attempts_used: i };
    } catch (err) {
      lastError = err;
      if (i < attempts) sleep(i * 2000);
    }
  }
  throw lastError;
}
function runHeartbeat() {
  return { runner_env: process.env.RUNNER_OS || "unknown", node_version: process.version };
}
function runSyntheticFail() {
  throw new Error("synthetic_fail drill requested by task");
}
function classifyFailure(taskType, status, errorText) {
  if (status === "BLOCKED") return "blocked_task";
  if (status === "PASS") return "pass";
  if (taskType === "synthetic_fail") return "synthetic_fail";
  if (/dedupe window active/i.test(errorText)) return "dedupe_window_active";
  if (/unsupported task type/i.test(errorText)) return "unsupported_task_type";
  if (/unsafe task blocked by safety flag/i.test(errorText)) return "blocked_task";
  if (/timeout|net::|ECONN|ENOTFOUND/i.test(errorText)) return "network_or_runtime";
  return "execution_error";
}
function nextActionFor(status, failureClass) {
  if (status === "PASS") return "No action required. Continue with next scoped task.";
  if (failureClass === "dedupe_window_active") return "Wait for dedupe window expiration or run with FORCE_RERUN=true.";
  if (failureClass === "unsupported_task_type") return "Add task type implementation or use an implemented type.";
  if (failureClass === "blocked_task") return "Adjust task safety/schema fields and re-dispatch.";
  return "Inspect error details, apply minimal safe fix, rerun task with force_rerun=true.";
}

function main() {
  const taskFile = explicitTaskFile || latestTaskFile();
  if (!fs.existsSync(schemaPath)) throw new Error(`missing schema file: ${schemaPath}`);
  readJson(schemaPath);
  const task = readJson(taskFile);
  const taskId = task.id || path.basename(taskFile, ".json");
  const taskType = task.type || "heartbeat";
  let status = "PASS";
  let details = {};
  let errorText = "";

  const schemaErrors = validateTask(task);
  if (schemaErrors.length > 0) {
    status = "BLOCKED";
    errorText = `schema validation failed: ${schemaErrors.join("; ")}`;
  }
  if (status === "PASS" && !supportedTaskTypes.has(taskType)) {
    status = "BLOCKED";
    errorText = `Unsupported task type: ${taskType}`;
  }
  if (status === "PASS") {
    const unsafeReason = checkUnsafeSafety(task);
    if (unsafeReason) {
      status = "BLOCKED";
      errorText = unsafeReason;
    }
  }
  const dedupeReason = status === "PASS" ? dedupeCheck(taskId) : null;
  if (status === "PASS" && dedupeReason) {
    status = "BLOCKED";
    errorText = dedupeReason;
  }
  if (status === "PASS") {
    try {
      if (taskType === "heartbeat") details = runHeartbeat();
      else if (taskType === "virtual_browser_audit") details = runBrowserAudit(task);
      else if (taskType === "synthetic_fail") runSyntheticFail();
    } catch (err) {
      status = "FAIL";
      errorText = err instanceof Error ? err.stack || err.message : String(err);
    }
  }
  const failureClass = classifyFailure(taskType, status, errorText);
  const nextAction = nextActionFor(status, failureClass);
  const reportDir = taskType === "virtual_browser_audit" ? path.join(reportsRoot, "openclaw-browser-audit") : path.join(reportsRoot, "openclaw-heartbeat");
  const reportFile = writeReport(reportDir, [
    "# OpenClaw Task Report",
    "",
    `- status: \`${status}\``,
    `- task_id: \`${taskId}\``,
    `- task_type: \`${taskType}\``,
    `- failure_class: \`${failureClass}\``,
    `- dedupe_key: \`${taskType}:${failureClass}\``,
    `- expected_status: \`${task.expected_status || "PASS"}\``,
    `- task_file: \`${taskFile}\``,
    `- run_id: \`${runId}\``,
    `- timestamp_utc: \`${now.toISOString()}\``,
    `- git_sha: \`${sha}\``,
    `- actor: \`${actor}\``,
    `- workflow_run_url: ${runUrl}`,
    "",
    "## Details",
    "```json",
    JSON.stringify(details, null, 2),
    "```",
    ...(errorText ? ["", "## Error", "```text", safe(errorText).slice(-5000), "```"] : []),
    "",
    "## Next action",
    "",
    nextAction,
  ]);
  const summary = {
    status,
    task_id: taskId,
    task_type: taskType,
    expected_status: task.expected_status || "PASS",
    failure_class: failureClass,
    dedupe_key: `${taskType}:${failureClass}`,
    report_file: reportFile,
    next_action: nextAction,
  };
  fs.mkdirSync(path.dirname(latestFile), { recursive: true });
  fs.writeFileSync(latestFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (status === "PASS") process.exit(0);
  if (status === "BLOCKED") process.exit(3);
  process.exit(1);
}

main();
