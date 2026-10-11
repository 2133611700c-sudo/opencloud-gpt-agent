#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  latestReportFile,
  loadTask,
  repoRoot,
  reportsRoot,
  sanitizeForReport,
  writeJson,
} from "./lib/openclaw-task-lib.mjs";
import { buildOrchestrationPlan } from "./lib/openclaw-ecc-router.mjs";
import {
  buildDeepSeekAdvisoryPrompt,
  deepseekAdvisoryModel,
  parseDeepSeekAdvisoryText,
  shouldRunDeepSeekAdvisory,
} from "./lib/openclaw-deepseek-advisor-lib.mjs";

const mode = String(process.argv[2] || "").trim();
if (!new Set(["plan", "judge"]).has(mode)) throw new Error("usage: openclaw-deepseek-advisor.mjs <plan|judge>");

const sourceTaskFile = String(process.env.TASK_FILE || "").trim();
if (!sourceTaskFile) throw new Error("TASK_FILE is required");

const { payload: task } = loadTask(sourceTaskFile);
const plan = buildOrchestrationPlan(task);
const safeId = String(task.id || "UNKNOWN").replace(/[^A-Za-z0-9._-]/g, "_");
const outDir = path.resolve(repoRoot, reportsRoot, "deepseek_advisory", safeId);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${mode}.json`);
const relativeOutFile = path.relative(repoRoot, outFile).replace(/\\/g, "/");

let latest = null;
let reportExcerpt = "";
if (mode === "judge" && fs.existsSync(path.resolve(repoRoot, latestReportFile))) {
  latest = JSON.parse(fs.readFileSync(path.resolve(repoRoot, latestReportFile), "utf8"));
  if (latest?.report_file) {
    const reportPath = path.resolve(repoRoot, latest.report_file);
    if (fs.existsSync(reportPath)) reportExcerpt = fs.readFileSync(reportPath, "utf8").slice(-12000);
  }
}

const base = {
  schema_version: 1,
  mode,
  task_id: task.id,
  model: deepseekAdvisoryModel,
  reasoning_effort: plan.model_route.reasoning_effort,
  orchestration_plan: plan,
  generated_at: new Date().toISOString(),
  source_task_file: sourceTaskFile,
};

function finish(payload) {
  writeJson(relativeOutFile, { ...base, ...payload });
  if (mode === "judge" && fs.existsSync(path.resolve(repoRoot, latestReportFile))) {
    const current = JSON.parse(fs.readFileSync(path.resolve(repoRoot, latestReportFile), "utf8"));
    current.deepseek_advisory = {
      model: deepseekAdvisoryModel,
      plan_file: path.posix.join(reportsRoot, "deepseek_advisory", safeId, "plan.json"),
      judge_file: relativeOutFile,
      judge_status: payload.status,
      judge_verdict: payload.advisory?.verdict || null,
    };
    writeJson(latestReportFile, current);
  }
  console.log(JSON.stringify({ status: payload.status, mode, file: relativeOutFile, verdict: payload.advisory?.verdict || null }));
}

if (!shouldRunDeepSeekAdvisory(task, plan)) {
  finish({ status: "SKIPPED_SIMPLE", reason: "router complexity below model-advisory threshold" });
  process.exit(0);
}

if (!String(process.env.DEEPSEEK_API_KEY || "").trim()) {
  finish({ status: "NOT_CONFIGURED", reason: "DEEPSEEK_API_KEY is not configured" });
  process.exit(0);
}

const prompt = buildDeepSeekAdvisoryPrompt({ mode, task, plan, latest, reportExcerpt });
let envelope;
try {
  const stdout = execFileSync(
    "openclaw",
    [
      "infer", "model", "run",
      "--local",
      "--model", deepseekAdvisoryModel,
      "--thinking", plan.model_route.reasoning_effort,
      "--prompt", prompt,
      "--json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  envelope = JSON.parse(stdout);
} catch (error) {
  finish({
    status: "MODEL_ERROR",
    reason: sanitizeForReport(String(error?.stderr || error?.message || error)).slice(-4000),
  });
  process.exit(0);
}

try {
  const text = envelope?.outputs?.[0]?.text;
  const advisory = parseDeepSeekAdvisoryText(text, mode);
  finish({
    status: "PASS",
    provider: envelope?.provider || null,
    executed_model: envelope?.model || null,
    advisory,
  });
} catch (error) {
  finish({
    status: "INVALID_OUTPUT",
    provider: envelope?.provider || null,
    executed_model: envelope?.model || null,
    reason: sanitizeForReport(String(error?.message || error)).slice(-4000),
  });
}
