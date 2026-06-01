#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const tasksDir = path.resolve(repoRoot, "ops", "agent-control", "tasks");
const reportsDir = path.resolve(repoRoot, "ops", "agent-control", "reports");
const workerStatePath = path.resolve(reportsDir, "worker-state.json");
const issueLabel = process.env.OPENCLAW_ISSUE_LABEL || "openclaw-task";
const repo = process.env.OPENCLAW_REPO || "2133611700c-sudo/opencloud-gpt-agent";
const runFromIssues = (process.env.OPENCLAW_TASK_INBOX_MODE || "files+issues") !== "files-only";

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function shell(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function listFileTasks() {
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json")).map((f) => path.join(tasksDir, f));
  return files.map((file) => ({ source: "file", id: path.basename(file, ".json"), file }));
}
function listIssueTasks() {
  try {
    const out = shell("gh", ["issue", "list", "--repo", repo, "--label", issueLabel, "--state", "open", "--limit", "50", "--json", "number,title,body,labels,url,updatedAt"]);
    const items = JSON.parse(out);
    return items.map((it) => ({ source: "issue", id: `ISSUE-${it.number}`, issue: it }));
  } catch {
    return [];
  }
}
function buildTaskFromIssue(item) {
  const issue = item.issue;
  const lines = String(issue.body || "").split(/\r?\n/);
  const firstJsonLine = lines.find((l) => l.trim().startsWith("{") && l.trim().endsWith("}"));
  if (firstJsonLine) {
    try { return JSON.parse(firstJsonLine); } catch {}
  }
  return {
    id: `ISSUE-${issue.number}`,
    type: "worker_heartbeat",
    requested_by: "github-issue",
    goal: issue.title || "Issue-triggered OpenClaw task",
    expected_status: "PASS",
    params: {},
    safety: {
      production_code_change: false,
      customer_action: false,
      secrets_required: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false
    }
  };
}
function lockKey(taskId) {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function withLock(taskId, fn) {
  const lockFile = path.resolve(reportsDir, ".locks", `${lockKey(taskId)}.lock`);
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (fs.existsSync(lockFile)) return { skipped: true, reason: "lock_exists" };
  fs.writeFileSync(lockFile, new Date().toISOString(), "utf8");
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}
function runTask(task) {
  const tempTaskPath = path.resolve(reportsDir, ".inbox", `${lockKey(task.id)}.json`);
  fs.mkdirSync(path.dirname(tempTaskPath), { recursive: true });
  fs.writeFileSync(tempTaskPath, JSON.stringify(task, null, 2), "utf8");
  const env = { ...process.env, TASK_FILE: tempTaskPath, FORCE_RERUN: "true" };
  try {
    const out = execFileSync("node", ["scripts/openclaw-task-runner.mjs"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: String(err?.stdout || "") + String(err?.stderr || "") };
  }
}
function updateIssue(issueNumber, message) {
  try {
    shell("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body", message]);
  } catch {}
}

const state = readJsonSafe(workerStatePath, { processed: {} });
const queue = [...listFileTasks(), ...(runFromIssues ? listIssueTasks() : [])];

for (const item of queue) {
  const task = item.source === "file" ? readJsonSafe(item.file, null) : buildTaskFromIssue(item);
  if (!task || !task.id) continue;
  if (state.processed[task.id]) continue;

  const result = withLock(task.id, () => runTask(task));
  if (result?.skipped) continue;
  state.processed[task.id] = { completed_at: new Date().toISOString(), source: item.source };
  writeJson(workerStatePath, state);

  if (item.source === "issue") {
    const summaryPath = path.resolve(reportsDir, "openclaw-latest.json");
    const summary = readJsonSafe(summaryPath, { status: "DEGRADED", next_action: "Check worker logs." });
    updateIssue(item.issue.number, `OpenClaw result: ${summary.status}\nTask: ${summary.task_id}\nReport: ${summary.report_file}\nNext: ${summary.next_action}`);
  }
}

console.log(JSON.stringify({ worker: "openclaw-worker", queue_size: queue.length }));
