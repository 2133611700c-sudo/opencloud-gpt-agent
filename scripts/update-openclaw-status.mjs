#!/usr/bin/env node
import {
  latestReportFile,
  readJson,
  readText,
  recentRunEntries,
  statusFile,
  writeText,
} from "./lib/openclaw-task-lib.mjs";

const BEGIN = "<!-- OPENCLAW_CURRENT_STATUS:BEGIN -->";
const END = "<!-- OPENCLAW_CURRENT_STATUS:END -->";

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function mergeStatus(existing, block) {
  if (existing.startsWith("# Status")) {
    existing = existing.replace(/^# Status\b/, "# OpenClaw Status");
  }
  if (!existing.trim()) return `# OpenClaw Status\n\n${block}\n`;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    return existing.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
  }
  const firstLineEnd = existing.indexOf("\n");
  if (existing.startsWith("# ") && firstLineEnd !== -1) {
    return `${existing.slice(0, firstLineEnd)}\n\n${block}\n\n${existing.slice(firstLineEnd + 1).replace(/^\n+/, "")}`;
  }
  return `${block}\n\n${existing}`;
}

const latestPath = readFlag("--latest") || latestReportFile;
const evidenceCommitSha = readFlag("--evidence-commit-sha") || "";
const latest = readJson(latestPath);
if (evidenceCommitSha) latest.evidence_commit_sha = evidenceCommitSha;

const rows = recentRunEntries(20);
const block = [
  BEGIN,
  "## OpenClaw Current",
  `- latest_run_id: ${latest.run_id || ""}`,
  `- latest_task_id: ${latest.task_id || ""}`,
  `- latest_status: ${latest.status || ""}`,
  `- latest_timestamp: ${latest.timestamp_utc || ""}`,
  `- latest_report: ${latest.report_file || ""}`,
  `- latest_artifact: ${latest.artifact_name || ""}`,
  `- latest_evidence_commit: ${latest.evidence_commit_sha || ""}`,
  "",
  "## Recent OpenClaw Runs",
  "| Timestamp | Run ID | Task ID | Type | Status | Report |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((entry) => `| ${entry.timestamp_utc} | ${entry.run_id} | ${entry.task_id} | ${entry.task_type} | ${entry.status} | ${entry.report_file} |`),
  END,
].join("\n");

const existing = (() => {
  try {
    return readText(statusFile);
  } catch {
    return "";
  }
})();

writeText(statusFile, `${mergeStatus(existing, block).replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);
