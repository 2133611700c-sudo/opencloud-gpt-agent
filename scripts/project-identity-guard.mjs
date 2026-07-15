#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(repoRoot, "ops/agent-control/PROJECT_REGISTRY.json");
const schemaPath = path.join(repoRoot, "ops/agent-control/OPENCLAW_TASK_SCHEMA.v1.json");

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function indexRegistry(registry) {
  if (registry?.schema_version !== 1) throw new Error("PROJECT_REGISTRY schema_version must be 1");
  if (!Array.isArray(registry.records) || registry.records.length === 0) {
    throw new Error("PROJECT_REGISTRY records must be a non-empty array");
  }
  const byId = new Map();
  const byRepo = new Map();
  for (const record of registry.records) {
    if (!record.project_id || !record.canonical_repository || !record.role || !record.lifecycle) {
      throw new Error("Every registry record requires project_id, canonical_repository, role, and lifecycle");
    }
    if (byId.has(record.project_id)) throw new Error(`Duplicate project_id: ${record.project_id}`);
    if (byRepo.has(record.canonical_repository)) throw new Error(`Duplicate canonical_repository: ${record.canonical_repository}`);
    byId.set(record.project_id, record);
    byRepo.set(record.canonical_repository, record);
  }
  return { byId, byRepo };
}

export function validateRegistry(registry) {
  const { byId } = indexRegistry(registry);
  const expected = {
    "messenginfo-immigration": ["2133611700c-sudo/uscis-helper", "ACTIVE_PRODUCT"],
    "messenginfo-legacy-company-checker": ["2133611700c-sudo/messenginfo", "LEGACY_PRODUCT"],
    "uscis-helper-ci-mirror": ["2133611700c-sudo/uscis-helper-ci", "CI_MIRROR"],
    "openclaw-control-plane": ["2133611700c-sudo/opencloud-gpt-agent", "CONTROL_PLANE"],
  };
  for (const [projectId, [repository, role]] of Object.entries(expected)) {
    const record = byId.get(projectId);
    if (!record) throw new Error(`Missing mandatory registry record: ${projectId}`);
    if (record.canonical_repository !== repository) {
      throw new Error(`${projectId} must map to ${repository}, got ${record.canonical_repository}`);
    }
    if (record.role !== role) throw new Error(`${projectId} must have role ${role}, got ${record.role}`);
  }
  const active = [...byId.values()].filter((record) => record.role === "ACTIVE_PRODUCT");
  if (active.length !== 1 || active[0].project_id !== "messenginfo-immigration") {
    throw new Error("Exactly one ACTIVE_PRODUCT is allowed and it must be messenginfo-immigration");
  }
  const mirror = byId.get("uscis-helper-ci-mirror");
  if (mirror.source_repository !== "2133611700c-sudo/uscis-helper") {
    throw new Error("uscis-helper-ci-mirror source_repository must be the canonical uscis-helper repo");
  }
  return true;
}

export function validateTaskIdentity(task, registry) {
  const errors = [];
  const { byId } = indexRegistry(registry);
  const repoTypes = new Set(["codex_delegate", "repo_audit", "repo_patch", "supabase_check", "regression_check"]);
  const hasRepository = typeof task?.repository === "string" && task.repository.trim() !== "";
  const requiresIdentity = hasRepository || repoTypes.has(task?.type);

  if (requiresIdentity && !task?.project_id) errors.push("project_id is required for repository-targeted tasks");
  if (requiresIdentity && !hasRepository) errors.push("repository is required for repository-targeted tasks");

  if (task?.project_id) {
    const record = byId.get(task.project_id);
    if (!record) {
      errors.push(`unknown project_id: ${task.project_id}`);
    } else if (hasRepository && task.repository !== record.canonical_repository) {
      errors.push(`PROJECT_IDENTITY_MISMATCH: ${task.project_id} requires ${record.canonical_repository}, got ${task.repository}`);
    }
  }

  const text = JSON.stringify(task || {}).toLowerCase();
  const currentProductIntent = [
    "messenginfo.com",
    "uscis helper",
    "tps",
    "ead",
    "i-821",
    "i-765",
    "immigration",
    "translation",
  ].some((term) => text.includes(term));

  if (
    currentProductIntent &&
    task?.repository === "2133611700c-sudo/messenginfo" &&
    task?.project_id !== "messenginfo-legacy-company-checker"
  ) {
    errors.push("Current Messenginfo/USCIS Helper intent cannot be routed to the legacy messenginfo repository");
  }
  if (
    task?.project_id === "messenginfo-immigration" &&
    task?.repository !== "2133611700c-sudo/uscis-helper"
  ) {
    errors.push("Current Messenginfo work must fail closed unless repository is 2133611700c-sudo/uscis-helper");
  }
  return errors;
}

export function validateSchemaRegistryParity(schema, registry) {
  const registryIds = registry.records.map((record) => record.project_id).sort();
  const schemaIds = [...(schema?.properties?.project_id?.enum || [])].sort();
  if (JSON.stringify(registryIds) !== JSON.stringify(schemaIds)) {
    throw new Error(`Task schema project_id enum differs from PROJECT_REGISTRY: ${schemaIds.join(", ")}`);
  }
  return true;
}

function parseTaskArg(argv) {
  const index = argv.indexOf("--task");
  return index >= 0 ? argv[index + 1] : "";
}

export function run(argv = process.argv.slice(2)) {
  const registry = readJson(registryPath);
  validateRegistry(registry);
  validateSchemaRegistryParity(readJson(schemaPath), registry);
  const taskArg = parseTaskArg(argv);
  if (taskArg) {
    const absolute = path.resolve(repoRoot, taskArg);
    if (!absolute.startsWith(path.join(repoRoot, "ops/agent-control/tasks"))) {
      throw new Error(`Unsafe task path: ${taskArg}`);
    }
    const errors = validateTaskIdentity(readJson(absolute), registry);
    if (errors.length) throw new Error(errors.join("; "));
  }
  process.stdout.write("PASS project identity registry and task routing guard\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`BLOCKED PROJECT_IDENTITY_GUARD: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
