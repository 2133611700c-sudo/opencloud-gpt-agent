#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  compileSchema,
  dispatchSchemaPath,
  ensureReportDirectories,
  loadTask,
  repoRoot,
  supportedTaskTypes,
  taskSchemaPath,
  tasksDir,
  validateSchema,
} from "./lib/openclaw-task-lib.mjs";

const requiredFiles = [
  ".github/workflows/openclaw-task-runner.yml",
  ".github/workflows/openclaw-chatgpt-dispatch.yml",
  taskSchemaPath,
  dispatchSchemaPath,
  `${tasksDir}/OC-CHATGPT-INTEGRATION-HEARTBEAT.json`,
  "scripts/openclaw-task-runner.mjs",
  "scripts/openclaw-virtual-browser-audit.mjs",
  "scripts/create-openclaw-task.mjs",
  "scripts/read-openclaw-dispatch-request.mjs",
  "scripts/update-openclaw-status.mjs",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.resolve(repoRoot, file))) {
    throw new Error(`missing required file: ${file}`);
  }
}

compileSchema(taskSchemaPath);
compileSchema(dispatchSchemaPath);
const heartbeatTask = loadTask("ops/agent-control/tasks/OC-CHATGPT-INTEGRATION-HEARTBEAT.json").payload;
const validation = validateSchema(taskSchemaPath, heartbeatTask);
if (!validation.valid) throw new Error(`heartbeat task invalid: ${validation.errors.join("; ")}`);
if (!supportedTaskTypes.has(heartbeatTask.type)) throw new Error(`heartbeat task type unsupported: ${heartbeatTask.type}`);

ensureReportDirectories();

for (const script of [
  "scripts/openclaw-task-runner.mjs",
  "scripts/openclaw-virtual-browser-audit.mjs",
  "scripts/create-openclaw-task.mjs",
  "scripts/read-openclaw-dispatch-request.mjs",
  "scripts/update-openclaw-status.mjs",
]) {
  execFileSync("node", ["--check", script], { cwd: repoRoot, stdio: "inherit" });
}

for (const dependency of ["playwright", "ajv"]) {
  execFileSync("node", ["-e", `require.resolve('${dependency}')`], { cwd: repoRoot, stdio: "inherit" });
}

process.stdout.write("OpenClaw integration verification passed.\n");
