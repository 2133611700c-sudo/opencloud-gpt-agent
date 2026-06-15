#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const taskFile = process.env.OPENCLAW_BUSINESS_TASK_FILE || "products/call-rescue-kit/tasks/OC-CALL-RESCUE-PROSPECTING-001.json";
const reportDir = process.env.REPORT_DIR || path.resolve("ops", "agent-control", "reports", "business-lead-audit", `run-${process.env.GITHUB_RUN_ID || Date.now()}`);
const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
if (task.type !== "business_lead_collect") throw new Error(`Unsupported task type: ${task.type}`);

const params = task.params || {};
fs.mkdirSync(reportDir, { recursive: true });

function run(script, env = {}, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env }
  });
  if (result.error) throw result.error;
  if ((result.status || 0) !== 0) process.exit(result.status || 1);
}

run("scripts/openclaw-business-lead-collector.mjs", {
  OPENCLAW_BUSINESS_QUERIES: JSON.stringify(params.search_queries || []),
  OPENCLAW_BUSINESS_SEED_URLS: JSON.stringify(params.seed_urls || []),
  OPENCLAW_BUSINESS_MAX_PROSPECTS: String(params.max_prospects || 30),
  OPENCLAW_BUSINESS_SCREENSHOTS: String(Boolean(params.screenshots)),
  OPENCLAW_BUSINESS_OUT_DIR: reportDir,
  OPENCLAW_BUSINESS_OUT_FILE: path.join(reportDir, "prospects.json")
});

run("scripts/openclaw-business-outreach-draft.mjs", {
  OPENCLAW_BUSINESS_INPUT_FILE: path.join(reportDir, "prospects.json"),
  OPENCLAW_BUSINESS_DRAFT_FILE: path.join(reportDir, "outreach-drafts.json"),
  OPENCLAW_BUSINESS_MAX_DRAFTS: String(params.max_drafts || 20),
  CALL_RESCUE_PRODUCT_URL: process.env.CALL_RESCUE_PRODUCT_URL || "https://callrescuekit.com",
  CALL_RESCUE_SENDER_NAME: process.env.CALL_RESCUE_SENDER_NAME || "Call Rescue Kit"
});

run("scripts/openclaw-business-evidence-summary.mjs", {
  REPORT_DIR: reportDir,
  TASK_ID: task.id,
  TASK_FILE: taskFile,
  RUN_URL: process.env.RUN_URL || "NOT_SPECIFIED"
});
