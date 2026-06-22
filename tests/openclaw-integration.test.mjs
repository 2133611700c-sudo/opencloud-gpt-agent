import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  latestReportFile,
  normalizeRoutes,
  recentRunEntries,
  repoRoot,
  taskSchemaPath,
  tasksDir,
  validateSchema,
  validateTaskFilePath,
} from "../scripts/lib/openclaw-task-lib.mjs";

function taskPath(id) {
  return path.join(repoRoot, tasksDir, `${id}.json`);
}

function relativeTaskPath(id) {
  return `ops/agent-control/tasks/${id}.json`;
}

function writeTask(id, task) {
  fs.writeFileSync(taskPath(id), `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function removeIfExists(file) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true, recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runTask(taskFile, extraEnv = {}) {
  const latestPath = path.join(repoRoot, ".tmp", `${path.basename(taskFile, ".json")}-${Date.now()}.latest.json`);
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  const result = spawnSync("node", ["scripts/openclaw-task-runner.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TASK_FILE: taskFile,
      OPENCLAW_LATEST_FILE: latestPath,
      GITHUB_RUN_ID: `${Date.now()}`,
      GITHUB_RUN_URL: "https://example.test/run",
      GITHUB_ACTOR: "test",
      ...extraEnv,
    },
  });
  const latest = readJson(latestPath);
  return { result, latest, latestPath };
}

test("valid heartbeat task satisfies schema", () => {
  const task = readJson(taskPath("OC-CHATGPT-INTEGRATION-HEARTBEAT"));
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, true);
});

test("valid virtual browser audit satisfies schema", () => {
  const task = readJson(taskPath("OC-OPENCLAW-BROWSER-AUDIT-001"));
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, true);
});

test("missing requested_by is rejected", () => {
  const task = readJson(taskPath("OC-CHATGPT-INTEGRATION-HEARTBEAT"));
  delete task.requested_by;
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, false);
});

test("invalid expected_status is rejected", () => {
  const task = readJson(taskPath("OC-CHATGPT-INTEGRATION-HEARTBEAT"));
  task.expected_status = "SUCCESS";
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, false);
});

test("unsafe customer_action is rejected", () => {
  const task = readJson(taskPath("OC-CHATGPT-INTEGRATION-HEARTBEAT"));
  task.safety.customer_action = true;
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, false);
});

test("path traversal in task_file is rejected", () => {
  assert.equal(validateTaskFilePath("ops/agent-control/tasks/../../etc/passwd.json"), false);
});

test("http origin is rejected", () => {
  const task = readJson(taskPath("OC-OPENCLAW-BROWSER-AUDIT-001"));
  task.params.target_origin = "http://www.bls.gov";
  const validation = validateSchema(taskSchemaPath, task);
  assert.equal(validation.valid, false);
});

test("external route on another origin is rejected", () => {
  assert.throws(() => normalizeRoutes(["https://example.com/elsewhere"]));
});

test("multiple changed task files stay explicit", () => {
  const files = [
    "ops/agent-control/tasks/OC-CHATGPT-INTEGRATION-HEARTBEAT.json",
    "ops/agent-control/tasks/OC-OPENCLAW-BROWSER-AUDIT-001.json",
  ];
  assert.deepEqual(files.filter(validateTaskFilePath), files);
});

test("dedupe blocks immediate rerun", () => {
  const id = `OC-TEST-DEDUPE-${Date.now()}`;
  writeTask(id, {
    id,
    type: "heartbeat",
    requested_by: "ChatGPT",
    goal: "Verify dedupe enforcement on immediate rerun.",
    expected_status: "PASS",
    params: {},
    safety: {
      customer_action: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false,
    },
  });
  try {
    const first = runTask(relativeTaskPath(id));
    assert.equal(first.latest.status, "PASS");
    const second = runTask(relativeTaskPath(id));
    assert.equal(second.latest.status, "BLOCKED");
    assert.match(second.latest.error || "", /dedupe/i);
    removeIfExists(path.join(repoRoot, first.latest.report_file));
    removeIfExists(path.join(repoRoot, second.latest.report_file));
    removeIfExists(first.latestPath);
    removeIfExists(second.latestPath);
  } finally {
    removeIfExists(taskPath(id));
  }
});

test("force rerun bypasses dedupe", () => {
  const id = `OC-TEST-FORCE-${Date.now()}`;
  writeTask(id, {
    id,
    type: "heartbeat",
    requested_by: "ChatGPT",
    goal: "Verify force rerun bypasses the dedupe window.",
    expected_status: "PASS",
    params: {},
    safety: {
      customer_action: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false,
    },
  });
  try {
    const first = runTask(relativeTaskPath(id));
    const second = runTask(relativeTaskPath(id), { FORCE_RERUN: "true" });
    assert.equal(first.latest.status, "PASS");
    assert.equal(second.latest.status, "PASS");
    removeIfExists(path.join(repoRoot, first.latest.report_file));
    removeIfExists(path.join(repoRoot, second.latest.report_file));
    removeIfExists(first.latestPath);
    removeIfExists(second.latestPath);
  } finally {
    removeIfExists(taskPath(id));
  }
});

test("missing task file still generates openclaw-latest.json", () => {
  const latestPath = path.join(repoRoot, ".tmp", `missing-${Date.now()}.json`);
  const result = spawnSync("node", ["scripts/openclaw-task-runner.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TASK_FILE: "ops/agent-control/tasks/OC-DOES-NOT-EXIST.json",
      OPENCLAW_LATEST_FILE: latestPath,
      GITHUB_RUN_ID: `${Date.now()}`,
      GITHUB_RUN_URL: "https://example.test/run",
      GITHUB_ACTOR: "test",
    },
  });
  const latest = readJson(latestPath);
  assert.notEqual(result.status, 0);
  assert.ok(fs.existsSync(latestPath));
  assert.equal(latest.task_file, "ops/agent-control/tasks/OC-DOES-NOT-EXIST.json");
  removeIfExists(path.join(repoRoot, latest.report_file));
  removeIfExists(latestPath);
});

test("browser failure yields FAIL and evidence", () => {
  const id = `OC-TEST-BROWSER-${Date.now()}`;
  writeTask(id, {
    id,
    type: "virtual_browser_audit",
    requested_by: "ChatGPT",
    goal: "Verify browser failures still produce evidence.",
    expected_status: "PASS",
    params: {
      target_origin: "https://127.0.0.1",
      routes: ["/"],
      max_attempts: 1,
    },
    safety: {
      customer_action: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false,
    },
  });
  try {
    const run = runTask(relativeTaskPath(id));
    assert.equal(run.latest.status, "FAIL");
    assert.ok(fs.existsSync(path.join(repoRoot, run.latest.report_file)));
    removeIfExists(path.join(repoRoot, run.latest.report_file));
    removeIfExists(run.latestPath);
  } finally {
    removeIfExists(taskPath(id));
  }
});

test("status updater writes structured STATUS.md", () => {
  const latestPath = path.join(repoRoot, ".tmp", `status-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(
    latestPath,
    JSON.stringify(
      {
        task_id: "OC-STATUS-TEST",
        task_type: "heartbeat",
        task_file: "ops/agent-control/tasks/OC-STATUS-TEST.json",
        status: "PASS",
        expected_status: "PASS",
        timestamp_utc: "2026-06-21T00:00:00.000Z",
        run_id: "12345",
        run_url: "https://example.test/run/12345",
        git_sha: "deadbeef",
        actor: "test",
        report_file: "ops/agent-control/reports/heartbeat/20260621T000000Z.md",
        artifact_name: "openclaw-12345",
        dedupe_key: "heartbeat:pass",
        error: null,
        evidence_commit_sha: "abc123",
      },
      null,
      2,
    ),
  );
  execFileSync("node", ["scripts/update-openclaw-status.mjs", "--latest", latestPath, "--evidence-commit-sha", "abc123"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const statusText = fs.readFileSync(path.join(repoRoot, "ops/agent-control/STATUS.md"), "utf8");
  assert.match(statusText, /# OpenClaw Status/);
  assert.match(statusText, /latest_evidence_commit: abc123/);
  assert.match(statusText, /\| Timestamp \| Run ID \| Task ID \| Type \| Status \| Report \|/);
  removeIfExists(latestPath);
});

test("recent runs helper keeps latest entries bounded", () => {
  const entries = recentRunEntries(20);
  assert.ok(entries.length <= 20);
});
