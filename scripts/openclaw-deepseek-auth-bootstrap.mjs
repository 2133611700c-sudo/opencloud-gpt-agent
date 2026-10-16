#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const verifyLive = process.argv.includes("--verify-live");
const expectedVersion = String(process.env.OPENCLAW_ADVISOR_VERSION || process.env.OPENCLAW_VERSION || "2026.10.3").trim();
const stateDir = String(process.env.OPENCLAW_STATE_DIR || "").trim();
const configPath = String(process.env.OPENCLAW_CONFIG_PATH || "").trim();
let apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
const evidenceFile = String(process.env.OPENCLAW_DEEPSEEK_AUTH_EVIDENCE || "").trim();

function fail(message, exitCode = 1) {
  console.error(`DeepSeek stored-auth bootstrap failed: ${message}`);
  process.exit(exitCode);
}

if (!stateDir) fail("OPENCLAW_STATE_DIR is required", 2);
if (!configPath) fail("OPENCLAW_CONFIG_PATH is required", 2);
if (!apiKey) fail("DEEPSEEK_API_KEY is not configured in GitHub Actions Secrets", 2);

fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });

const cleanEnv = { ...process.env };
delete cleanEnv.DEEPSEEK_API_KEY;

function assertNoSecretLeak(text, label) {
  const value = String(text || "");
  if (apiKey && value.includes(apiKey)) {
    fail(`${label} unexpectedly exposed the DeepSeek secret`, 4);
  }
}

function runOpenClaw(args, { input = undefined, allowFailure = false } = {}) {
  const result = spawnSync("openclaw", args, {
    cwd: process.cwd(),
    env: cleanEnv,
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  assertNoSecretLeak(result.stdout, `openclaw ${args.slice(0, 3).join(" ")} stdout`);
  assertNoSecretLeak(result.stderr, `openclaw ${args.slice(0, 3).join(" ")} stderr`);
  if (result.error) {
    if (allowFailure) return result;
    fail(`could not execute openclaw ${args[0]}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const stderr = String(result.stderr || "").trim().slice(-1600);
    fail(`openclaw ${args.join(" ")} exited ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

function parseJson(text, label) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    fail(`${label} did not return valid JSON`);
  }
}

function containsString(value, needle) {
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((item) => containsString(item, needle));
  if (value && typeof value === "object") return Object.values(value).some((item) => containsString(item, needle));
  return false;
}

function hasAgentId(value, agentId) {
  if (Array.isArray(value)) return value.some((item) => hasAgentId(item, agentId));
  if (!value || typeof value !== "object") return false;
  if (value.id === agentId || value.agentId === agentId) return true;
  return Object.values(value).some((item) => hasAgentId(item, agentId));
}

const versionResult = runOpenClaw(["--version"]);
const versionText = String(versionResult.stdout || "").trim();
if (!versionText.includes(expectedVersion)) {
  fail(`OpenClaw version mismatch: expected ${expectedVersion}, got ${versionText || "UNKNOWN"}`);
}

const agentsResult = runOpenClaw(["agents", "list", "--json"]);
const agentsJson = parseJson(agentsResult.stdout, "openclaw agents list --json");
if (!hasAgentId(agentsJson, "main")) {
  const workspace = path.join(stateDir, "workspace-main");
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  runOpenClaw(["agents", "add", "main", "--workspace", workspace, "--non-interactive", "--json"]);
}
runOpenClaw(["config", "set", "agents.defaults.systemAgent.agentId", "main"]);

// The secret is supplied only on stdin. It is deliberately removed from the
// child environment so subsequent OpenClaw commands can prove stored-auth use.
runOpenClaw(
  ["models", "auth", "paste-api-key", "--provider", "deepseek", "--agent", "main"],
  { input: `${apiKey}\n` },
);

// Configure the canonical project route after the provider has been installed.
runOpenClaw(["models", "set", "deepseek/deepseek-flash"]);
runOpenClaw(["models", "fallbacks", "add", "deepseek/deepseek-v4-pro"]);
runOpenClaw(["models", "set-image", "deepseek/deepseek-flash"]);

const authListResult = runOpenClaw(["models", "auth", "list", "--provider", "deepseek", "--agent", "main", "--json"]);
const authListJson = parseJson(authListResult.stdout, "openclaw models auth list --json");
if (!containsString(authListJson, "deepseek")) {
  fail("DeepSeek stored auth profile was not visible for agent main");
}

// Drop the in-process reference before all live verification. The child env has
// already been stripped of DEEPSEEK_API_KEY.
apiKey = "";

const evidence = {
  schema_version: 1,
  timestamp_utc: new Date().toISOString(),
  openclaw_version: versionText,
  provider: "deepseek",
  agent: "main",
  auth_source: "openclaw_stored_auth",
  secret_transport: "stdin_only",
  secret_in_verification_env: false,
  primary_model: "deepseek/deepseek-flash",
  fallback_model: "deepseek/deepseek-v4-pro",
  vision_model: "deepseek/deepseek-flash",
  auth_profile_visible: true,
  live_probe_pass: null,
  agent_exec_pass: null,
  executed_provider: null,
  executed_model: null,
};

if (verifyLive) {
  const probeResult = runOpenClaw([
    "models", "status", "--agent", "main", "--json", "--probe",
    "--probe-provider", "deepseek", "--probe-max-tokens", "8", "--probe-timeout", "30000",
  ]);
  const probeJson = parseJson(probeResult.stdout, "openclaw models status --probe --json");
  if (!containsString(probeJson, "deepseek") || !containsString(probeJson, "ok")) {
    fail("DeepSeek live probe did not report an ok DeepSeek probe result");
  }
  evidence.live_probe_pass = true;

  const execResult = runOpenClaw([
    "agent", "exec",
    "Reply with exactly: OPENCLAW_STORED_AUTH_OK. Do not use tools.",
    "--model", "deepseek/deepseek-flash",
    "--fallback", "deepseek/deepseek-v4-pro",
    "--thinking", "low",
    "--code-mode", "direct",
    "--timeout", "120",
    "--json",
  ]);
  const envelope = parseJson(execResult.stdout, "openclaw agent exec --json");
  if (envelope?.ok !== true) fail("agent exec returned ok != true");
  if (envelope?.provider !== "deepseek") fail(`agent exec provider was ${envelope?.provider || "UNKNOWN"}`);
  if (!containsString(envelope, "OPENCLAW_STORED_AUTH_OK")) fail("agent exec did not return the required marker");
  evidence.agent_exec_pass = true;
  evidence.executed_provider = envelope.provider;
  evidence.executed_model = envelope.model || null;
}

if (evidenceFile) {
  const outputPath = path.resolve(evidenceFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

console.log(JSON.stringify({
  status: "PASS",
  provider: evidence.provider,
  agent: evidence.agent,
  auth_source: evidence.auth_source,
  live_verified: verifyLive,
  evidence_file: evidenceFile || null,
}));
