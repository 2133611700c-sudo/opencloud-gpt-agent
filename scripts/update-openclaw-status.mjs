#!/usr/bin/env node
import {
  latestReportFile,
  readJson,
  readText,
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

function parseExistingRows(existing) {
  const beginIndex = existing.indexOf(BEGIN);
  const endIndex = existing.indexOf(END);
  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) return [];
  const block = existing.slice(beginIndex, endIndex);
  const lines = block.split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("Timestamp") || line.includes("---")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    rows.push({
      timestamp_utc: cells[0],
      run_id: cells[1],
      task_id: cells[2],
      task_type: cells[3],
      status: cells[4],
      report_file: cells[5],
    });
  }
  return rows;
}

function mergeRecentRows(latest, existingRows, limit = 20) {
  const merged = [
    {
      timestamp_utc: latest.timestamp_utc || "",
      run_id: String(latest.run_id || ""),
      task_id: latest.task_id || "",
      task_type: latest.task_type || "",
      status: latest.status || "",
      report_file: latest.report_file || "",
    },
    ...existingRows,
  ];
  const deduped = [];
  const seen = new Set();
  for (const entry of merged) {
    const key = [entry.timestamp_utc, entry.run_id, entry.task_id, entry.report_file].join("|");
    if (!entry.task_id || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

const latestPath = readFlag("--latest") || latestReportFile;
const evidenceCommitSha = readFlag("--evidence-commit-sha") || "";
const latest = readJson(latestPath);
if (evidenceCommitSha) latest.evidence_commit_sha = evidenceCommitSha;

const existing = (() => {
  try {
    return readText(statusFile);
  } catch {
    return "";
  }
})();

const rows = mergeRecentRows(latest, parseExistingRows(existing), 20);
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

writeText(statusFile, `${mergeStatus(existing, block).replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);
