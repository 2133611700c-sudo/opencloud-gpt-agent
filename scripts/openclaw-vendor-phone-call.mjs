#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const taskFile = String(process.env.VENDOR_CALL_TASK_FILE || process.argv[2] || "").trim();
const apiKey = String(process.env.BLAND_API_KEY || "").trim();
const apiBase = "https://api.bland.ai/v1";

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
  if (!normalized.startsWith("ops/agent-control/vendor-calls/") || !normalized.endsWith(".json") || normalized.includes("..")) {
    fail("Task file must be under ops/agent-control/vendor-calls/*.json");
  }
  return normalized;
}

async function bland(url, options = {}) {
  const response = await fetch(`${apiBase}${url}`, {
    ...options,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Bland API ${response.status}: ${body?.message || body?.error || text || "request failed"}`);
  }
  return body;
}

if (!taskFile) fail("VENDOR_CALL_TASK_FILE is required");
if (!apiKey) fail("BLAND_API_KEY is not configured");

const relativeTaskFile = normalizeTaskPath(taskFile);
const absoluteTaskFile = path.resolve(repoRoot, relativeTaskFile);
if (!fs.existsSync(absoluteTaskFile)) fail(`Task file not found: ${relativeTaskFile}`);

const task = JSON.parse(fs.readFileSync(absoluteTaskFile, "utf8"));
const taskId = safeId(task.id);
if (task.type !== "vendor_phone_call") fail("Task type must be vendor_phone_call");
if (task.status && task.status !== "pending") fail(`Task status must be pending, got ${task.status}`);
if (task.safety?.explicit_approval !== true) fail("explicit_approval=true is required");
if (task.safety?.purchase_authorized === true) fail("Purchases are blocked in vendor_phone_call");
if (task.safety?.payment_authorized === true) fail("Payments are blocked in vendor_phone_call");
if (task.safety?.recording_authorized === true) fail("Call recording is disabled in this runner");

const params = task.params || {};
const phoneNumber = String(params.phone_number || "").trim();
if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) fail("phone_number must be E.164, for example +18164837274");

const vendorName = String(params.vendor_name || "vendor").trim().slice(0, 200);
const objective = String(params.objective || "").trim();
if (objective.length < 10 || objective.length > 4000) fail("objective must be 10-4000 characters");

const firstSentence = String(
  params.first_sentence || `Hi, I'm an AI assistant calling on behalf of Sergii. I'm checking current inventory and pickup availability with ${vendorName}.`,
).trim().slice(0, 500);
const maxDuration = Math.min(5, Math.max(1, Number(params.max_duration_minutes || 3)));
const pollSeconds = Math.min(20, Math.max(5, Number(params.poll_seconds || 8)));
const timeoutSeconds = Math.min(420, Math.max(60, Number(params.timeout_seconds || 300)));

const taskPrompt = [
  `You are an AI assistant calling on behalf of Sergii to contact ${vendorName}.`,
  "At the beginning, clearly identify yourself as an AI assistant calling on behalf of Sergii.",
  `Objective: ${objective}`,
  "Ask only factual questions needed to complete the objective.",
  "Confirm whether the exact item is physically in stock now, quantity if available, current price, exact pickup address, and whether it can be picked up today.",
  "Repeat the model/part number back to the employee when one is provided in the objective.",
  "Do not buy, reserve, order, place a deposit, provide payment details, accept contractual terms, or make commitments.",
  "Do not invent an answer. If the employee cannot verify stock, say that verification was not obtained.",
  "Keep the call concise. Once the required facts are confirmed or cannot be confirmed, thank them and end the call.",
].join("\n");

const startedAt = new Date().toISOString();
const createResult = await bland("/calls", {
  method: "POST",
  body: JSON.stringify({
    phone_number: phoneNumber,
    task: taskPrompt,
    first_sentence: firstSentence,
    wait_for_greeting: true,
    max_duration: maxDuration,
    record: false,
    metadata: {
      openclaw_task_id: taskId,
      vendor_name: vendorName,
    },
    summary_prompt:
      "Summarize only verified facts from the call: exact item/model discussed, in-stock yes/no/unclear, quantity, current price, pickup-today yes/no/unclear, exact pickup address, employee name if given, and any caveat. Do not infer missing facts.",
  }),
});

const callId = String(createResult.call_id || "").trim();
if (!callId) throw new Error(`Bland did not return call_id: ${JSON.stringify(createResult)}`);
console.log(`Call queued: ${callId}`);

const deadline = Date.now() + timeoutSeconds * 1000;
let details = null;
while (Date.now() < deadline) {
  await sleep(pollSeconds * 1000);
  details = await bland(`/calls/${encodeURIComponent(callId)}`);
  const status = String(details.status || details.queue_status || "").toLowerCase();
  console.log(`Call ${callId}: ${status || "unknown"}`);
  if (details.completed === true || ["completed", "complete", "failed", "busy", "no-answer", "canceled"].includes(status)) break;
}

if (!details) details = await bland(`/calls/${encodeURIComponent(callId)}`);

const finishedAt = new Date().toISOString();
const outDir = path.resolve(repoRoot, "ops/agent-control/reports/vendor_phone_call");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${taskId}.json`);
const mdPath = path.join(outDir, `${taskId}.md`);

const report = {
  schema_version: 1,
  task_id: taskId,
  task_file: relativeTaskFile,
  vendor_name: vendorName,
  phone_number: phoneNumber,
  call_id: callId,
  started_at: startedAt,
  finished_at: finishedAt,
  completed: details.completed === true,
  status: details.status || details.queue_status || "unknown",
  answered_by: details.answered_by ?? null,
  call_length_minutes: details.call_length ?? null,
  price_usd: details.price ?? null,
  from_number: details.from ?? null,
  to_number: details.to ?? phoneNumber,
  summary: details.summary ?? null,
  transcript: details.concatenated_transcript ?? null,
  error_message: details.error_message ?? null,
  purchase_made: false,
  payment_made: false,
  recording_enabled: false,
};

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const md = [
  `# Vendor Phone Call — ${taskId}`,
  "",
  `- vendor: ${vendorName}`,
  `- to: ${phoneNumber}`,
  `- call_id: ${callId}`,
  `- status: ${report.status}`,
  `- answered_by: ${report.answered_by ?? "unknown"}`,
  `- call_length_minutes: ${report.call_length_minutes ?? "unknown"}`,
  `- price_usd: ${report.price_usd ?? "unknown"}`,
  `- recording_enabled: false`,
  `- purchase_made: false`,
  `- payment_made: false`,
  "",
  "## Verified call summary",
  "",
  report.summary || "No summary returned.",
  "",
  "## Error",
  "",
  report.error_message || "none",
  "",
  "Raw transcript is retained only in the workflow artifact and is not intended for repository commit.",
  "",
].join("\n");
fs.writeFileSync(mdPath, md, "utf8");

console.log(JSON.stringify({ report_json: path.relative(repoRoot, jsonPath), report_md: path.relative(repoRoot, mdPath), ...report }, null, 2));

const finalStatus = String(report.status || "").toLowerCase();
if (["failed", "busy", "no-answer", "canceled"].includes(finalStatus)) process.exitCode = 2;
