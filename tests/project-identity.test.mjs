import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  indexRegistry,
  validateRegistry,
  validateSchemaRegistryParity,
  validateTaskIdentity,
} from "../scripts/project-identity-guard.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, "ops/agent-control/PROJECT_REGISTRY.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "ops/agent-control/OPENCLAW_TASK_SCHEMA.v1.json"), "utf8"));

test("registry has one canonical active Messenginfo product", () => {
  assert.equal(validateRegistry(registry), true);
  const { byId } = indexRegistry(registry);
  assert.equal(byId.get("messenginfo-immigration").canonical_repository, "2133611700c-sudo/uscis-helper");
});

test("task schema project IDs match registry", () => {
  assert.equal(validateSchemaRegistryParity(schema, registry), true);
});

test("current Messenginfo task is accepted only in uscis-helper", () => {
  const task = {
    type: "codex_delegate",
    project_id: "messenginfo-immigration",
    repository: "2133611700c-sudo/uscis-helper",
    goal: "Audit current Messenginfo TPS and EAD flow.",
  };
  assert.deepEqual(validateTaskIdentity(task, registry), []);
});

test("current Messenginfo task is blocked in legacy messenginfo repo", () => {
  const task = {
    type: "codex_delegate",
    project_id: "messenginfo-immigration",
    repository: "2133611700c-sudo/messenginfo",
    goal: "Fix current Messenginfo immigration translations.",
  };
  assert.match(validateTaskIdentity(task, registry).join(" "), /PROJECT_IDENTITY_MISMATCH|must fail closed/);
});

test("CI mirror cannot masquerade as canonical product", () => {
  const task = {
    type: "repo_patch",
    project_id: "messenginfo-immigration",
    repository: "2133611700c-sudo/uscis-helper-ci",
    goal: "Change canonical product code.",
  };
  assert.match(validateTaskIdentity(task, registry).join(" "), /PROJECT_IDENTITY_MISMATCH/);
});

test("repository-targeted task requires explicit project_id", () => {
  const task = {
    type: "codex_delegate",
    repository: "2133611700c-sudo/uscis-helper",
    goal: "Audit current application.",
  };
  assert.match(validateTaskIdentity(task, registry).join(" "), /project_id is required/);
});
