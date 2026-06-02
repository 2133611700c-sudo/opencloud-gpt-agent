#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const tasksDir = path.resolve(repoRoot, "ops", "agent-control", "tasks");
const reportsDir = path.resolve(repoRoot, "ops", "agent-control", "reports");
const workerStatePath = path.resolve(reportsDir, "worker-state.json");
const inboxStatusPath = path.resolve(reportsDir, "worker-inbox-status.json");
const issueLabel = process.env.OPENCLAW_ISSUE_LABEL || "openclaw-task";
const repo = process.env.OPENCLAW_REPO || "2133611700c-sudo/opencloud-gpt-agent";
const runFromIssues = (process.env.OPENCLAW_TASK_INBOX_MODE || "files+issues") !== "files-only";
const maxSafeRetries = Number(process.env.OPENCLAW_MAX_SAFE_RETRIES || "1");
const mutateFileTaskStatus = (process.env.OPENCLAW_MUTATE_FILE_TASK_STATUS || "").toLowerCase() === "true";

const priorityOrder = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

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
  return files.map((file) => ({ source: "file", id: path.basename(file, ".json"), file, sortTimestamp: fs.statSync(file).mtimeMs }));
}
function listIssueTasks() {
  try {
    const out = shell("gh", ["issue", "list", "--repo", repo, "--label", issueLabel, "--state", "open", "--limit", "50", "--json", "number,title,body,labels,url,updatedAt"]);
    const items = JSON.parse(out);
    return items.map((it) => ({ source: "issue", id: `ISSUE-${it.number}`, issue: it, sortTimestamp: Date.parse(it.updatedAt || "") || 0 }));
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
    },
    priority: "P2",
    status: "pending",
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
function fingerprintTask(task) {
  return JSON.stringify({
    id: task.id,
    type: task.type,
    goal: task.goal,
    params: task.params || {},
    safety: task.safety || {},
  });
}
function parseSummary(stdoutText) {
  const lines = String(stdoutText || "").trim().split(/\r?\n/).filter(Boolean);
  const lastLine = lines[lines.length - 1] || "{}";
  try {
    return JSON.parse(lastLine);
  } catch {
    return { status: "FAIL", next_action: "Unable to parse task summary.", raw: stdoutText };
  }
}
function isRetrySafe(task, summary, attempts) {
  if ((task.safety || {}).customer_action) return false;
  if (summary.status === "BLOCKED" || summary.status === "PASS") return false;
  if (attempts >= maxSafeRetries) return false;
  return true;
}
function normalizeTaskStatus(task) {
  return String(task?.status || "pending").toLowerCase();
}
function isPendingTask(task) {
  return ["pending", "failed", "degraded"].includes(normalizeTaskStatus(task));
}
function sortQueueItems(a, b) {
  const taskA = a.task || {};
  const taskB = b.task || {};
  const priorityA = priorityOrder[String(taskA.priority || "P2")] ?? priorityOrder.P2;
  const priorityB = priorityOrder[String(taskB.priority || "P2")] ?? priorityOrder.P2;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return (a.sortTimestamp || 0) - (b.sortTimestamp || 0);
}
function runTask(task) {
  const tempTaskPath = path.resolve(reportsDir, ".inbox", `${lockKey(task.id)}.json`);
  fs.mkdirSync(path.dirname(tempTaskPath), { recursive: true });
  fs.writeFileSync(tempTaskPath, JSON.stringify(task, null, 2), "utf8");
  const env = { ...process.env, TASK_FILE: tempTaskPath, FORCE_RERUN: "true" };
  try {
    const out = execFileSync("node", ["scripts/openclaw-task-runner.mjs"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: out, summary: parseSummary(out) };
  } catch (err) {
    const output = String(err?.stdout || "") + String(err?.stderr || "");
    return { ok: false, output, summary: parseSummary(output) };
  }
}
function updateIssue(issueNumber, message) {
  try {
    shell("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body", message]);
  } catch {}
}
function writeInboxStatus(statusData) {
  writeJson(inboxStatusPath, statusData);
}
function updateFileTaskStatus(taskFile, nextStatus) {
  const task = readJsonSafe(taskFile, null);
  if (!task) return;
  task.status = nextStatus;
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2) + "\n", "utf8");
}
function commentIssueStatus(issueNumber, task, phase, extra = []) {
  const body = [
    `OpenClaw ${phase}`,
    `task_id: ${task.id}`,
    `task_type: ${task.type}`,
    ...extra,
  ].join("\n");
  updateIssue(issueNumber, body);
}

const state = readJsonSafe(workerStatePath, { tasks: {} });
const queue = [...listFileTasks(), ...(runFromIssues ? listIssueTasks() : [])]
  .map((item) => {
    const task = item.source === "file" ? readJsonSafe(item.file, null) : buildTaskFromIssue(item);
    return { ...item, task };
  })
  .filter((item) => item.task && item.task.id && isPendingTask(item.task))
  .sort(sortQueueItems);

const inboxStatus = {
  generated_at: new Date().toISOString(),
  queue_size: queue.length,
  entries: [],
};

for (const item of queue) {
  const task = item.task;
  const fingerprint = fingerprintTask(task);
  const stateEntry = state.tasks[task.id];
  if (stateEntry?.fingerprint === fingerprint && stateEntry?.last_status === "PASS") continue;

  if (item.source === "file" && mutateFileTaskStatus) updateFileTaskStatus(item.file, "locked");
  if (item.source === "issue") commentIssueStatus(item.issue.number, task, "LOCKED");

  const result = withLock(task.id, () => {
    if (item.source === "file" && mutateFileTaskStatus) updateFileTaskStatus(item.file, "running");
    if (item.source === "issue") commentIssueStatus(item.issue.number, task, "RUNNING");
    return runTask(task);
  });
  if (result?.skipped) continue;
  const summary = result.summary || { status: result.ok ? "PASS" : "FAIL", next_action: "Check worker output." };
  const attempts = Number(stateEntry?.attempts || 0) + 1;
  const finalStatus = String(summary.status || "FAIL").toUpperCase();
  const retryRecommended = isRetrySafe(task, summary, attempts);
  state.tasks[task.id] = {
    fingerprint,
    source: item.source,
    attempts,
    last_status: finalStatus,
    last_run_id: summary.run_id || "",
    last_report_file: summary.report_file || "",
    last_completed_at: new Date().toISOString(),
    last_next_action: summary.next_action || "",
    retry_recommended: retryRecommended,
  };
  writeJson(workerStatePath, state);

  if (item.source === "file" && mutateFileTaskStatus) {
    const mappedStatus = finalStatus === "PASS"
      ? "completed"
      : finalStatus === "BLOCKED"
        ? "blocked"
        : finalStatus === "DEGRADED"
          ? "degraded"
          : retryRecommended
            ? "failed"
            : "failed";
    updateFileTaskStatus(item.file, mappedStatus);
  }

  if (item.source === "issue") {
    commentIssueStatus(item.issue.number, task, finalStatus, [
      `run_id: ${summary.run_id || "unknown"}`,
      `report_file: ${summary.report_file || "n/a"}`,
      `next_action: ${summary.next_action || "n/a"}`,
      `retry_recommended: ${retryRecommended}`,
    ]);
  }

  inboxStatus.entries.push({
    task_id: task.id,
    task_type: task.type,
    source: item.source,
    status: finalStatus,
    run_id: summary.run_id || "",
    report_file: summary.report_file || "",
    next_action: summary.next_action || "",
    retry_recommended: retryRecommended,
  });
}

writeInboxStatus(inboxStatus);
console.log(JSON.stringify({ worker: "openclaw-worker", queue_size: queue.length, status_file: inboxStatusPath }));
