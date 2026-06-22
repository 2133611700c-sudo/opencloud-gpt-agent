#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  normalizeRoutes,
  normalizeTaskId,
  repoRoot,
  taskSchemaPath,
  tasksDir,
  validateHttpsOrigin,
  validateSchema,
  validateTaskId,
  writeJson,
} from "./lib/openclaw-task-lib.mjs";

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const id = normalizeTaskId(readFlag("--id"));
const origin = readFlag("--origin").trim();
const routesValue = readFlag("--routes");
const goal = readFlag("--goal").trim();
const force = hasFlag("--force");

if (!validateTaskId(id)) throw new Error(`invalid --id value: ${id}`);
if (!validateHttpsOrigin(origin)) throw new Error(`invalid --origin value: ${origin}`);
if (goal.length < 10 || goal.length > 240) throw new Error("--goal must be between 10 and 240 characters");

const task = {
  id,
  type: "virtual_browser_audit",
  requested_by: "ChatGPT",
  goal,
  expected_status: "PASS",
  params: {
    target_origin: origin,
    routes: normalizeRoutes(routesValue),
    max_attempts: 2,
  },
  safety: {
    customer_action: false,
    public_posting: false,
    paid_ads_change: false,
    destructive_action: false,
  },
};

const validation = validateSchema(taskSchemaPath, task);
if (!validation.valid) throw new Error(`task does not satisfy schema: ${validation.errors.join("; ")}`);

const relativePath = path.join(tasksDir, `${id}.json`).replace(/\\/g, "/");
const absolutePath = path.resolve(repoRoot, relativePath);
if (fs.existsSync(absolutePath) && !force) throw new Error(`refusing to overwrite existing task without --force: ${relativePath}`);

writeJson(relativePath, task);
process.stdout.write(`${relativePath}\n`);
