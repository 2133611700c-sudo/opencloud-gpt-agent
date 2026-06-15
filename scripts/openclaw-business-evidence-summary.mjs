#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const reportDir = process.env.REPORT_DIR;
if (!reportDir) throw new Error("REPORT_DIR is required");

const summaryFile = path.join(reportDir, "summary.json");

if (process.argv.includes("--enforce")) {
  const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  if (summary.status === "FAIL") {
    console.error(`Collection failed: ${summary.total_candidates} candidates, ${summary.total_inspected} inspected.`);
    process.exitCode = 1;
  } else if (summary.status === "DEGRADED") {
    console.warn(`Collection degraded: ${summary.total_candidates} candidates, ${summary.fit_count} FIT.`);
  }
  process.exit();
}

const prospects = JSON.parse(fs.readFileSync(path.join(reportDir, "prospects.json"), "utf8"));
const drafts = JSON.parse(fs.readFileSync(path.join(reportDir, "outreach-drafts.json"), "utf8"));
const status = prospects.collection_status || (prospects.total_candidates === 0 ? "FAIL" : prospects.fit_count === 0 ? "DEGRADED" : "PASS");

const nextActionByStatus = {
  PASS: "Human review of evidence and drafts. No outreach has been sent.",
  DEGRADED: "Review search diagnostics and rejected prospects before approving outreach.",
  FAIL: "Fix the public search source or query strategy, then rerun. No outreach has been sent."
};

const summary = {
  status,
  task_id: process.env.TASK_ID || "NOT_SPECIFIED",
  task_type: "business_lead_collect",
  run_id: process.env.GITHUB_RUN_ID || "LOCAL",
  run_url: process.env.RUN_URL || "NOT_SPECIFIED",
  task_file: process.env.TASK_FILE || "NOT_SPECIFIED",
  report_file: summaryFile,
  evidence_files: [path.join(reportDir, "prospects.json"), path.join(reportDir, "outreach-drafts.json")],
  total_candidates: prospects.total_candidates,
  total_inspected: prospects.total_inspected,
  fit_count: prospects.fit_count,
  maybe_count: prospects.maybe_count,
  draft_count: drafts.total_drafts,
  next_action: nextActionByStatus[status] || nextActionByStatus.FAIL
};

fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify(summary));
