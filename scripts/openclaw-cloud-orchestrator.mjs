#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildTimestamp,
  latestReportFile,
  loadTask,
  repoRoot,
  reportsRoot,
  sanitizeForReport,
  writeJson,
} from "./lib/openclaw-task-lib.mjs";
import { buildOrchestrationPlan } from "./lib/openclaw-ecc-router.mjs";

const sourceTaskFile = String(process.env.TASK_FILE || "").trim();
if (!sourceTaskFile) throw new Error("TASK_FILE is required");

const { payload: task } = loadTask(sourceTaskFile);
const plan = buildOrchestrationPlan(task);
const timestamp = buildTimestamp();
const safeId = String(task.id || "UNKNOWN").replace(/[^A-Za-z0-9._-]/g, "_");
const planFile = path.join(reportsRoot, "orchestration", `${timestamp}-${safeId}.json`).replace(/\\/g, "/");
const routedTaskFile = `ops/agent-control/tasks/_runtime/${safeId}-${process.pid}.json`;
const latestOutputFile = process.env.OPENCLAW_LATEST_FILE || latestReportFile;

writeJson(planFile, {
  ...plan,
  source_task_file: sourceTaskFile,
  generated_at: new Date().toISOString(),
  runtime: "github-actions-cloud",
});

writeJson(routedTaskFile, {
  ...task,
  metadata: {
    ...(task.metadata || {}),
    source_task_file: sourceTaskFile,
    orchestration_plan_file: planFile,
    orchestration_plan: plan,
  },
});

let exitCode = 0;
try {
  execFileSync("node", ["scripts/openclaw-task-runner.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TASK_FILE: routedTaskFile,
      OPENCLAW_ORCHESTRATION_PLAN_FILE: planFile,
      OPENCLAW_SOURCE_TASK_FILE: sourceTaskFile,
    },
  });
} catch (error) {
  exitCode = Number.isInteger(error?.status) ? error.status : 1;
} finally {
  try { fs.rmSync(path.resolve(repoRoot, routedTaskFile), { force: true }); } catch {}
}

const latestPath = path.resolve(repoRoot, latestOutputFile);
if (fs.existsSync(latestPath)) {
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  latest.task_file = sourceTaskFile;
  latest.orchestration_plan_file = planFile;
  latest.orchestration_model = plan.model_route;
  latest.orchestration_agents = plan.agents;
  latest.orchestration_skills = plan.skills;
  latest.orchestration_execution_rule = plan.execution_rule;
  writeJson(latestOutputFile, latest);

  if (latest.report_file) {
    const reportPath = path.resolve(repoRoot, latest.report_file);
    if (fs.existsSync(reportPath)) {
      const section = [
        "",
        "## ECC / OpenClaw Orchestration",
        "",
        `- source_task_file: \`${sourceTaskFile}\``,
        `- plan_file: \`${planFile}\``,
        `- execution_rule: \`${plan.execution_rule}\``,
        `- model_primary: \`${plan.model_route.primary}\``,
        `- reasoning_effort: \`${plan.model_route.reasoning_effort}\``,
        `- lanes: ${plan.lanes.map((value) => `\`${value}\``).join(", ")}`,
        `- agents: ${plan.agents.map((value) => `\`${value}\``).join(", ")}`,
        `- skills: ${plan.skills.map((value) => `\`${value}\``).join(", ")}`,
        "",
        "```json",
        sanitizeForReport(plan),
        "```",
        "",
      ].join("\n");
      fs.appendFileSync(reportPath, section, "utf8");
    }
  }
}

process.exitCode = exitCode;
