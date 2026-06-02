#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const latestFile = path.resolve(repoRoot, "ops", "agent-control", "reports", "openclaw-latest.json");
const heartbeatTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-OPENCLAW-HEARTBEAT-001.json");
const workerHeartbeatTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-WORKER-HEARTBEAT-SAMPLE.json");
const leadCollectTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-JOB-LEAD-COLLECT-SAMPLE.json");
const leadAuditTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-JOB-LEAD-AUDIT-SAMPLE.json");
const outreachDraftTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-OUTREACH-DRAFT-SAMPLE.json");
const blockedTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-UNSAFE-CUSTOMER-ACTION-BLOCKED-SAMPLE.json");

function runOrThrow(command, env = process.env) {
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", command], { stdio: "inherit", cwd: repoRoot, env });
    return;
  }
  execFileSync("sh", ["-lc", command], { stdio: "inherit", cwd: repoRoot, env });
}
function runTask(taskFile) {
  const env = {
    ...process.env,
    TASK_FILE: taskFile,
    FORCE_RERUN: "true",
    OPENCLAW_LATEST_FILE: latestFile,
  };
  let out = "";
  try {
    out = execFileSync("node", ["scripts/openclaw-task-runner.mjs"], {
      encoding: "utf8",
      cwd: repoRoot,
      env,
    });
  } catch (error) {
    out = String(error?.stdout || "");
    if (!out.trim()) throw error;
  }
  const lines = out.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  ensure(fs.existsSync(heartbeatTask), `missing heartbeat task: ${heartbeatTask}`);
  ensure(fs.existsSync(workerHeartbeatTask), `missing worker heartbeat task: ${workerHeartbeatTask}`);
  ensure(fs.existsSync(leadCollectTask), `missing lead collect task: ${leadCollectTask}`);
  ensure(fs.existsSync(leadAuditTask), `missing lead audit task: ${leadAuditTask}`);
  ensure(fs.existsSync(outreachDraftTask), `missing outreach draft task: ${outreachDraftTask}`);
  ensure(fs.existsSync(blockedTask), `missing blocked task: ${blockedTask}`);

  runOrThrow("npm ci");
  const heartbeat = runTask(heartbeatTask);
  const workerHeartbeat = runTask(workerHeartbeatTask);
  const leadCollect = runTask(leadCollectTask);
  const leadAudit = runTask(leadAuditTask);
  const outreachDraft = runTask(outreachDraftTask);
  const blocked = runTask(blockedTask);
  const latest = JSON.parse(fs.readFileSync(latestFile, "utf8"));

  ensure(heartbeat.status === "PASS", `heartbeat failed with status=${heartbeat.status}`);
  ensure(heartbeat.task_type === "heartbeat", `unexpected heartbeat task_type=${heartbeat.task_type}`);
  ensure(workerHeartbeat.status === "PASS", `worker_heartbeat failed with status=${workerHeartbeat.status}`);
  ensure(workerHeartbeat.task_type === "worker_heartbeat", `unexpected worker heartbeat task_type=${workerHeartbeat.task_type}`);
  ensure(leadCollect.status === "PASS", `job_lead_collect failed with status=${leadCollect.status}`);
  ensure(leadCollect.task_type === "job_lead_collect", `unexpected job lead collect task_type=${leadCollect.task_type}`);
  ensure(leadAudit.status === "PASS", `job_lead_audit failed with status=${leadAudit.status}`);
  ensure(leadAudit.task_type === "job_lead_audit", `unexpected job lead task_type=${leadAudit.task_type}`);
  ensure(outreachDraft.status === "PASS", `outreach_draft failed with status=${outreachDraft.status}`);
  ensure(outreachDraft.task_type === "outreach_draft", `unexpected outreach draft task_type=${outreachDraft.task_type}`);
  ensure(blocked.status === "BLOCKED", `unsafe task should be BLOCKED, got ${blocked.status}`);
  ensure(latest.task_type === "outreach_send_approved", `openclaw-latest.json not updated to blocked sample: ${latest.task_type}`);

  const summary = {
    status: "PASS",
    checks: {
      npm_ci: "PASS",
      heartbeat: heartbeat.report_file,
      worker_heartbeat: workerHeartbeat.report_file,
      job_lead_collect: leadCollect.report_file,
      job_lead_audit: leadAudit.report_file,
      outreach_draft: outreachDraft.report_file,
      unsafe_customer_action: blocked.report_file,
      latest_file: latestFile,
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
