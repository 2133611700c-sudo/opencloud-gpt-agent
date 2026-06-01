#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const latestFile = path.resolve(repoRoot, "ops", "agent-control", "reports", "openclaw-latest.json");
const heartbeatTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-OPENCLAW-HEARTBEAT-001.json");
const leadAuditTask = path.resolve(repoRoot, "ops", "agent-control", "tasks", "OC-JOB-LEAD-AUDIT-SAMPLE.json");

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
  const out = execFileSync("node", ["scripts/openclaw-task-runner.mjs"], {
    encoding: "utf8",
    cwd: repoRoot,
    env,
  });
  return JSON.parse(out.trim());
}
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  ensure(fs.existsSync(heartbeatTask), `missing heartbeat task: ${heartbeatTask}`);
  ensure(fs.existsSync(leadAuditTask), `missing lead audit task: ${leadAuditTask}`);

  runOrThrow("npm ci");
  const heartbeat = runTask(heartbeatTask);
  const leadAudit = runTask(leadAuditTask);
  const latest = JSON.parse(fs.readFileSync(latestFile, "utf8"));

  ensure(heartbeat.status === "PASS", `heartbeat failed with status=${heartbeat.status}`);
  ensure(heartbeat.task_type === "heartbeat", `unexpected heartbeat task_type=${heartbeat.task_type}`);
  ensure(leadAudit.status === "PASS", `job_lead_audit failed with status=${leadAudit.status}`);
  ensure(leadAudit.task_type === "job_lead_audit", `unexpected job lead task_type=${leadAudit.task_type}`);
  ensure(latest.task_type === "job_lead_audit", `openclaw-latest.json not updated to job_lead_audit: ${latest.task_type}`);

  const summary = {
    status: "PASS",
    checks: {
      npm_ci: "PASS",
      heartbeat: heartbeat.report_file,
      job_lead_audit: leadAudit.report_file,
      latest_file: latestFile,
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
