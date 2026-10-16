import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bootstrapScript = path.resolve(process.cwd(), "scripts/openclaw-deepseek-auth-bootstrap.mjs");

test("DeepSeek bootstrap passes the key only through paste-api-key stdin and verifies without env auth", { skip: process.platform === "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-bootstrap-test-"));
  const binDir = path.join(temp, "bin");
  const stateDir = path.join(temp, "state");
  const traceFile = path.join(temp, "trace.jsonl");
  const evidenceFile = path.join(temp, "evidence.json");
  const fakeKey = "ds_test_secret_boundary_123456";
  fs.mkdirSync(binDir, { recursive: true });

  const fakeOpenClaw = path.join(binDir, "openclaw");
  fs.writeFileSync(fakeOpenClaw, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
const trace = process.env.MOCK_OPENCLAW_TRACE;
fs.appendFileSync(trace, JSON.stringify({ args, envHasKey: Object.prototype.hasOwnProperty.call(process.env, "DEEPSEEK_API_KEY"), stdin }) + "\\n");
function out(value) { process.stdout.write(typeof value === "string" ? value : JSON.stringify(value)); }
if (args.length === 1 && args[0] === "--version") out("OpenClaw 2026.10.3\\n");
else if (args[0] === "agents" && args[1] === "list") out({ agents: [] });
else if (args[0] === "agents" && args[1] === "add") out({ id: "main" });
else if (args[0] === "config" && args[1] === "set") out("ok\\n");
else if (args[0] === "models" && args[1] === "auth" && args[2] === "paste-api-key") {
  if (stdin.trim() !== process.env.MOCK_EXPECTED_KEY) { process.stderr.write("wrong stdin secret"); process.exit(9); }
  out("saved\\n");
}
else if (args[0] === "models" && args[1] === "auth" && args[2] === "list") out({ profiles: [{ provider: "deepseek", id: "deepseek:main" }] });
else if (args[0] === "models" && args[1] === "set") out("ok\\n");
else if (args[0] === "models" && args[1] === "fallbacks" && args[2] === "add") out("ok\\n");
else if (args[0] === "models" && args[1] === "set-image") out("ok\\n");
else if (args[0] === "models" && args[1] === "status") out({ auth: { probes: [{ provider: "deepseek", status: "ok" }] } });
else if (args[0] === "agent" && args[1] === "exec") out({ ok: true, provider: "deepseek", model: "deepseek/deepseek-flash", final: "OPENCLAW_STORED_AUTH_OK" });
else { process.stderr.write("unexpected args: " + JSON.stringify(args)); process.exit(8); }
`, { mode: 0o755 });
  fs.chmodSync(fakeOpenClaw, 0o755);

  const result = spawnSync(process.execPath, [bootstrapScript, "--verify-live"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      OPENCLAW_VERSION: "2026.10.3",
      OPENCLAW_ADVISOR_VERSION: "2026.10.3",
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
      OPENCLAW_DEEPSEEK_AUTH_EVIDENCE: evidenceFile,
      DEEPSEEK_API_KEY: fakeKey,
      MOCK_EXPECTED_KEY: fakeKey,
      MOCK_OPENCLAW_TRACE: traceFile,
    },
  });

  assert.equal(result.status, 0, `bootstrap failed: ${result.stderr}`);
  assert.equal(result.stdout.includes(fakeKey), false);
  assert.equal(result.stderr.includes(fakeKey), false);

  const traces = fs.readFileSync(traceFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(traces.length >= 9, "expected bootstrap and live verification OpenClaw calls");
  assert.ok(traces.every((entry) => entry.envHasKey === false), "no OpenClaw child may receive DEEPSEEK_API_KEY in env");

  const pasteCalls = traces.filter((entry) => entry.args[0] === "models" && entry.args[1] === "auth" && entry.args[2] === "paste-api-key");
  assert.equal(pasteCalls.length, 1);
  assert.equal(pasteCalls[0].stdin.trim(), fakeKey);
  assert.ok(traces.filter((entry) => entry !== pasteCalls[0]).every((entry) => entry.stdin === ""));

  const evidenceText = fs.readFileSync(evidenceFile, "utf8");
  assert.equal(evidenceText.includes(fakeKey), false);
  const evidence = JSON.parse(evidenceText);
  assert.equal(evidence.auth_source, "openclaw_stored_auth");
  assert.equal(evidence.secret_transport, "stdin_only");
  assert.equal(evidence.secret_in_verification_env, false);
  assert.equal(evidence.auth_profile_visible, true);
  assert.equal(evidence.live_probe_pass, true);
  assert.equal(evidence.agent_exec_pass, true);
  assert.equal(evidence.executed_provider, "deepseek");
});
