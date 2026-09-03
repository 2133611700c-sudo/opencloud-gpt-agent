#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const taskFile = String(process.env.PHONE_CALL_TASK_FILE || process.argv[2] || "").trim();
const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const defaultAgentId = String(process.env.CALL2ME_AGENT_ID || "agent_f2949915a3f2").trim();
const apiBase = "https://api.call2me.app/v1";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(id) || id.includes("..")) fail("Invalid task id");
  return id;
}

function normalizeTaskPath(value) {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/"));
  if (!normalized.startsWith("ops/agent-control/phone-calls/") || !normalized.endsWith(".json") || normalized.includes("..")) {
    fail("Task file must be under ops/agent-control/phone-calls/*.json");
  }
  return normalized;
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function call2me(url, options = {}) {
  const response = await fetch(`${apiBase}${url}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = parseBody(text);
  if (!response.ok) {
    const detail = body?.detail || body?.message || body?.error || text || "request failed";
    const error = new Error(`Call2Me API ${response.status}: ${detail}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["phone_numbers", "numbers", "items", "data", "calls"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function phoneValue(entry) {
  return String(entry?.phone_number || entry?.number || entry?.e164 || "").trim();
}

function pickSummary(details) {
  return (
    details?.call_analysis?.summary ||
    details?.call_analysis?.call_summary ||
    details?.call_analysis?.summary_text ||
    details?.summary ||
    null
  );
}

if (!taskFile) fail("PHONE_CALL_TASK_FILE is required");
if (!apiKey) fail("CALL2ME_API_KEY is not configured");

const relativeTaskFile = normalizeTaskPath(taskFile);
const absoluteTaskFile = path.resolve(repoRoot, relativeTaskFile);
if (!fs.existsSync(absoluteTaskFile)) fail(`Task file not found: ${relativeTaskFile}`);

const task = JSON.parse(fs.readFileSync(absoluteTaskFile, "utf8"));
const taskId = safeId(task.id);
if (task.type !== "phone_call") fail("Task type must be phone_call");
if (task.status && task.status !== "pending") fail(`Task status must be pending, got ${task.status}`);
if (task.safety?.explicit_approval !== true) fail("explicit_approval=true is required");
if (task.safety?.purchase_authorized === true) fail("Purchases are blocked in phone_call");
if (task.safety?.payment_authorized === true) fail("Payments are blocked in phone_call");
if (task.safety?.reservation_authorized === true) fail("Reservations are blocked in phone_call");
if (task.safety?.recording_authorized === true) fail("Recording is disabled in the MVP phone runner");

const params = task.params || {};
const phoneNumber = String(params.phone_number || "").trim();
if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) fail("phone_number must be valid E.164");

const objective = String(params.objective || task.goal || "").trim();
if (objective.length < 5 || objective.length > 4000) fail("objective must be 5-4000 characters");

const language = String(params.language || "en").trim().slice(0, 20);
const callerName = String(params.caller_name || "Sergii's AI phone assistant").trim().slice(0, 200);
const onBehalfOf = String(params.on_behalf_of || "Sergii").trim().slice(0, 200);
const callerContext = String(params.caller_context || params.context || "").trim().slice(0, 4000);
const questions = Array.isArray(params.questions) ? params.questions.map((value) => String(value).trim()).filter(Boolean).slice(0, 12) : [];
const successCondition = String(params.success_condition || "Obtain a clear factual answer to the objective.").trim().slice(0, 1000);
const requestedFromNumber = String(params.from_number || process.env.CALL2ME_FROM_NUMBER || "").trim();
if (requestedFromNumber && !/^\+[1-9]\d{7,14}$/.test(requestedFromNumber)) fail("from_number must be valid E.164");

const agentId = String(params.agent_id || defaultAgentId).trim();
if (!/^agent_[A-Za-z0-9]+$/.test(agentId)) fail("Invalid Call2Me agent_id");

const pollSeconds = Math.min(15, Math.max(3, Number(params.poll_seconds || 5)));
const timeoutSeconds = Math.min(600, Math.max(60, Number(params.timeout_seconds || 300)));

const outDir = path.resolve(repoRoot, "ops/agent-control/reports/phone_call");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${taskId}.json`);
const mdPath = path.join(outDir, `${taskId}.md`);

if (fs.existsSync(mdPath)) {
  fail(`Idempotency stop: a committed summary already exists for task ${taskId}`);
}

const startedAt = new Date().toISOString();

const wallet = await call2me("/wallet/balance");
if (wallet?.can_proceed === false || Number(wallet?.balance_usd || 0) < Number(wallet?.min_balance || 0.01)) {
  fail(`Call2Me wallet cannot proceed: balance=${wallet?.balance_usd ?? "unknown"}, minimum=${wallet?.min_balance ?? "unknown"}`);
}

await call2me(`/agents/${encodeURIComponent(agentId)}`);

const ownedNumbersPayload = await call2me("/phone-numbers");
const ownedNumbers = listFromPayload(ownedNumbersPayload);
const ownedValues = ownedNumbers.map(phoneValue).filter(Boolean);
let fromNumber = requestedFromNumber;
if (fromNumber && !ownedValues.includes(fromNumber)) {
  fail(`Requested from_number is not owned by this Call2Me account: ${fromNumber}`);
}
if (!fromNumber) {
  const bound = ownedNumbers.find((entry) => String(entry?.agent_id || entry?.assigned_agent_id || "") === agentId);
  fromNumber = phoneValue(bound) || ownedValues[0] || "";
}
if (!fromNumber) fail("No production Call2Me phone number is owned by this account");

let callId = "";
let createResult = null;
const existingPayload = await call2me(`/calls?agent_id=${encodeURIComponent(agentId)}&direction=outbound&limit=100&offset=0`);
const existingCalls = listFromPayload(existingPayload);
const existing = existingCalls.find((entry) => String(entry?.metadata?.openclaw_task_id || "") === taskId);
if (existing?.call_id) {
  callId = String(existing.call_id);
  console.log(`Idempotency reuse: ${callId}`);
} else {
  const dynamicVariables = {
    language,
    caller_name: callerName,
    on_behalf_of: onBehalfOf,
    objective,
    caller_context: callerContext,
    questions: JSON.stringify(questions),
    success_condition: successCondition,
  };

  createResult = await call2me("/calls", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      to_number: phoneNumber,
      from_number: fromNumber,
      metadata: {
        openclaw_task_id: taskId,
        requested_by: String(task.requested_by || "Sergii").slice(0, 200),
        purpose: "universal_outbound_phone_call",
      },
      dynamic_variables: dynamicVariables,
    }),
  });
  callId = String(createResult?.call_id || "").trim();
  if (!callId) fail(`Call2Me did not return call_id: ${JSON.stringify(createResult)}`);
  console.log(`Call queued: ${callId}`);
}

const deadline = Date.now() + timeoutSeconds * 1000;
let details = null;
const terminal = new Set(["completed", "failed", "no_answer", "busy", "transferred", "ended"]);
while (Date.now() < deadline) {
  details = await call2me(`/calls/${encodeURIComponent(callId)}`);
  const status = String(details?.call_status || details?.status || "").toLowerCase();
  console.log(`Call ${callId}: ${status || "unknown"}`);
  if (terminal.has(status)) break;
  await sleep(pollSeconds * 1000);
}
if (!details) details = await call2me(`/calls/${encodeURIComponent(callId)}`);

const finalStatus = String(details?.call_status || details?.status || "unknown").toLowerCase();
const durationMs = Number.isFinite(Number(details?.duration_ms)) ? Number(details.duration_ms) : null;
const answered = !["failed", "no_answer", "busy"].includes(finalStatus) && (durationMs == null || durationMs > 0);
const finishedAt = new Date().toISOString();
const report = {
  schema_version: 1,
  provider: "Call2Me",
  task_id: taskId,
  task_file: relativeTaskFile,
  phone_number: phoneNumber,
  from_number: details?.from_number || fromNumber,
  agent_id: agentId,
  call_id: callId,
  status: finalStatus,
  answered,
  duration_seconds: durationMs == null ? null : Math.round(durationMs / 1000),
  started_at: startedAt,
  finished_at: finishedAt,
  objective,
  summary: pickSummary(details),
  call_analysis: details?.call_analysis ?? null,
  transcript: details?.transcript ?? null,
  transcript_object: details?.transcript_object ?? null,
  recording_url: details?.recording_url ?? null,
  disconnection_reason: details?.disconnection_reason ?? null,
  cost_usd: details?.cost_usd ?? details?.total_cost ?? details?.price ?? null,
  wallet_balance_before: wallet?.balance_usd ?? null,
  purchase_made: false,
  payment_made: false,
  reservation_made: false,
  recording_requested: false,
};

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const md = [
  `# Phone Call — ${taskId}`,
  "",
  `- provider: Call2Me`,
  `- to: ${phoneNumber}`,
  `- from: ${report.from_number || "unknown"}`,
  `- call_id: ${callId}`,
  `- status: ${finalStatus}`,
  `- answered: ${answered}`,
  `- duration_seconds: ${report.duration_seconds ?? "unknown"}`,
  `- cost_usd: ${report.cost_usd ?? "unknown"}`,
  `- recording_requested: false`,
  `- purchase_made: false`,
  `- payment_made: false`,
  `- reservation_made: false`,
  "",
  "## Objective",
  "",
  objective,
  "",
  "## Provider summary",
  "",
  report.summary || "No provider summary returned.",
  "",
  "## Disconnection",
  "",
  report.disconnection_reason || "unknown",
  "",
  "The full transcript and structured provider response are retained only in the private workflow artifact, not committed to the repository.",
  "",
].join("\n");
fs.writeFileSync(mdPath, md, "utf8");

console.log(JSON.stringify({
  report_json: path.relative(repoRoot, jsonPath),
  report_md: path.relative(repoRoot, mdPath),
  call_id: callId,
  status: finalStatus,
  answered,
  duration_seconds: report.duration_seconds,
  summary: report.summary,
}, null, 2));
