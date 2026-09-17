#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const taskFile = String(process.env.PHONE_CALL_TASK_FILE || process.argv[2] || "").trim();
const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const defaultAgentId = String(process.env.CALL2ME_AGENT_ID || "agent_f2949915a3f2").trim();
const apiBase = "https://api.call2me.app/v1";
const allowedTaskPrefixes = ["ops/agent-control/phone-calls/", "ops/agent-control/tasks/"];

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
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
  const allowed = allowedTaskPrefixes.some((prefix) => normalized.startsWith(prefix));
  if (!allowed || !normalized.endsWith(".json") || normalized.includes("..")) {
    fail("Task file must be under ops/agent-control/tasks/*.json or ops/agent-control/phone-calls/*.json");
  }
  return normalized;
}

function readTaskFile(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const allowedRoots = allowedTaskPrefixes.map((prefix) => `${path.resolve(repoRoot, prefix)}${path.sep}`);
  if (!allowedRoots.some((root) => absolutePath.startsWith(root))) fail("Task path escapes allowed task directories");

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd;
  try {
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail("Task path is not a regular file");
    if (stat.size < 2 || stat.size > 65536) fail("Task file size is invalid");
    return fs.readFileSync(fd, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail(`Task file not found: ${relativePath}`);
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function call2me(endpoint, options = {}) {
  if (!endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("\\")) {
    fail("Invalid Call2Me endpoint");
  }

  const response = await fetch(`${apiBase}${endpoint}`, {
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
    const error = new Error(`Call2Me API request failed with HTTP ${response.status}`);
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
  const value = String(entry?.phone_number || entry?.number || entry?.e164 || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : "";
}

function providerSummary(details) {
  const value =
    details?.call_analysis?.summary ||
    details?.call_analysis?.call_summary ||
    details?.call_analysis?.summary_text ||
    details?.summary ||
    null;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 4000) : null;
}

function providerExtraction(details) {
  return (
    details?.call_analysis?.extracted_data ||
    details?.call_analysis?.custom_analysis_data ||
    details?.extracted_data ||
    details?.post_call_extraction ||
    details?.extraction ||
    null
  );
}

function embeddedTranscript(details) {
  return details?.transcript || details?.transcript_object || details?.conversation || null;
}

function canonicalStatus(value) {
  switch (String(value || "").toLowerCase()) {
    case "queued": return "queued";
    case "ringing": return "ringing";
    case "in_progress": return "in_progress";
    case "completed": return "completed";
    case "failed": return "failed";
    case "no_answer": return "no_answer";
    case "busy": return "busy";
    case "transferred": return "transferred";
    case "ended": return "ended";
    default: return "unknown";
  }
}

function safeDurationSeconds(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0 || ms > 3600000) return null;
  return Math.round(ms / 1000);
}

function acquireTaskLock(outDir, taskId) {
  const lockPath = path.join(outDir, `${taskId}.lock`);
  let fd;
  try {
    fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") fail(`Idempotency stop: task ${taskId} is already running or needs lock cleanup`);
    throw error;
  }
  return { fd, lockPath };
}

function releaseTaskLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

async function fetchTranscriptEvidence(callId, details) {
  let transcript = embeddedTranscript(details);
  let source = transcript ? "call_detail" : "unavailable";
  let endpointStatus = "not_needed";

  try {
    const payload = await call2me(`/calls/${encodeURIComponent(callId)}/transcript`);
    if (payload && Object.keys(payload).length > 0) {
      transcript = payload;
      source = "transcript_endpoint";
    }
    endpointStatus = "success";
  } catch (error) {
    endpointStatus = `http_${Number(error?.status || 0) || "error"}`;
  }

  return { transcript, source, endpointStatus };
}

async function main() {
  if (!taskFile) fail("PHONE_CALL_TASK_FILE is required");
  if (!apiKey) fail("CALL2ME_API_KEY is not configured");
  if (!/^agent_[A-Za-z0-9]+$/.test(defaultAgentId)) fail("Invalid configured Call2Me agent_id");

  const relativeTaskFile = normalizeTaskPath(taskFile);
  const task = JSON.parse(readTaskFile(relativeTaskFile));
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
  const questions = Array.isArray(params.questions)
    ? params.questions.map((value) => String(value).trim().slice(0, 500)).filter(Boolean).slice(0, 12)
    : [];
  const successCondition = String(params.success_condition || "Obtain a clear factual answer to the objective.").trim().slice(0, 1000);
  const requestedFromNumber = String(params.from_number || process.env.CALL2ME_FROM_NUMBER || "").trim();
  if (requestedFromNumber && !/^\+[1-9]\d{7,14}$/.test(requestedFromNumber)) fail("from_number must be valid E.164");

  const agentId = defaultAgentId;
  const pollSeconds = Math.min(15, Math.max(3, Number(params.poll_seconds || 5)));
  const timeoutSeconds = Math.min(600, Math.max(60, Number(params.timeout_seconds || 300)));

  const outDir = path.resolve(repoRoot, "ops/agent-control/reports/phone_call");
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, `${taskId}.md`);
  const resultMarkerPath = path.join(outDir, `${taskId}.result.json`);
  const privateDir = path.resolve(process.env.PHONE_CALL_PRIVATE_DIR || path.join(process.env.RUNNER_TEMP || os.tmpdir(), "openclaw-phone-private"));
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const privateEvidencePath = path.join(privateDir, `${taskId}.private.json`);
  const lock = acquireTaskLock(outDir, taskId);

  try {
    const wallet = await call2me("/wallet/balance");
    if (wallet?.can_proceed === false || Number(wallet?.balance_usd || 0) < Number(wallet?.min_balance || 0.01)) {
      fail(`Call2Me wallet cannot proceed: balance=${Number(wallet?.balance_usd || 0)}, minimum=${Number(wallet?.min_balance || 0.01)}`);
    }

    await call2me(`/agents/${encodeURIComponent(agentId)}`);

    const ownedNumbersPayload = await call2me("/phone-numbers");
    const ownedNumbers = listFromPayload(ownedNumbersPayload);
    const ownedValues = ownedNumbers.map(phoneValue).filter(Boolean);
    let fromNumber = requestedFromNumber;
    if (fromNumber && !ownedValues.includes(fromNumber)) {
      fail("Requested from_number is not owned by this Call2Me account");
    }
    if (!fromNumber) {
      const bound = ownedNumbers.find((entry) => String(entry?.agent_id || entry?.assigned_agent_id || "") === agentId);
      fromNumber = phoneValue(bound) || ownedValues[0] || "";
    }
    if (!fromNumber) fail("No production Call2Me phone number is owned by this account");

    let callId = "";
    const existingPayload = await call2me(`/calls?agent_id=${encodeURIComponent(agentId)}&direction=outbound&limit=100&offset=0`);
    const existingCalls = listFromPayload(existingPayload);
    const existing = existingCalls.find((entry) => String(entry?.metadata?.openclaw_task_id || "") === taskId);
    if (existing?.call_id) {
      callId = String(existing.call_id).trim();
      if (!/^[A-Za-z0-9._:-]{3,200}$/.test(callId)) fail("Provider returned invalid existing call_id");
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

      const createResult = await call2me("/calls", {
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
      if (!/^[A-Za-z0-9._:-]{3,200}$/.test(callId)) fail("Call2Me did not return a valid call_id");
      console.log(`Call queued: ${callId}`);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let details = null;
    const terminal = new Set(["completed", "failed", "no_answer", "busy", "transferred", "ended"]);
    while (Date.now() < deadline) {
      details = await call2me(`/calls/${encodeURIComponent(callId)}`);
      const status = canonicalStatus(details?.call_status || details?.status);
      console.log(`Call ${callId}: ${status}`);
      if (terminal.has(status)) break;
      await sleep(pollSeconds * 1000);
    }
    if (!details) details = await call2me(`/calls/${encodeURIComponent(callId)}`);

    const finalStatus = canonicalStatus(details?.call_status || details?.status);
    const durationSeconds = safeDurationSeconds(details?.duration_ms);
    const answered = !["failed", "no_answer", "busy"].includes(finalStatus) && (durationSeconds == null || durationSeconds > 0);
    const summary = providerSummary(details);
    const extraction = providerExtraction(details);
    const transcriptEvidence = await fetchTranscriptEvidence(callId, details);
    const transcriptAvailable = Boolean(transcriptEvidence.transcript);
    const recordingAvailable = Boolean(details?.recording_url);
    const analysisAvailable = Boolean(details?.call_analysis);
    const extractionAvailable = Boolean(extraction);

    const privateEvidence = {
      schema_version: 1,
      provider: "Call2Me",
      task_id: taskId,
      call_id: callId,
      task: {
        objective,
        language,
        caller_name: callerName,
        on_behalf_of: onBehalfOf,
        caller_context: callerContext,
        questions,
        success_condition: successCondition,
      },
      call: {
        status: finalStatus,
        answered,
        duration_seconds: durationSeconds,
        disconnection_reason: details?.disconnection_reason || null,
      },
      provider_summary: summary,
      provider_extraction: extraction,
      provider_call_analysis: details?.call_analysis || null,
      transcript_source: transcriptEvidence.source,
      transcript_endpoint_status: transcriptEvidence.endpointStatus,
      transcript: transcriptEvidence.transcript || null,
    };
    fs.writeFileSync(privateEvidencePath, `${JSON.stringify(privateEvidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    const safeResult = {
      schema_version: 3,
      provider: "Call2Me",
      task_id: taskId,
      task_file: relativeTaskFile,
      call_id: callId,
      agent_id: agentId,
      status: finalStatus,
      answered,
      duration_seconds: durationSeconds,
      summary_available: Boolean(summary),
      transcript_available: transcriptAvailable,
      transcript_source: transcriptEvidence.source,
      transcript_endpoint_status: transcriptEvidence.endpointStatus,
      extraction_available: extractionAvailable,
      recording_available: recordingAvailable,
      analysis_available: analysisAvailable,
      private_evidence_available: true,
      private_evidence_filename: path.basename(privateEvidencePath),
      purchase_made: false,
      payment_made: false,
      reservation_made: false,
      recording_requested: false,
    };

    fs.writeFileSync(resultMarkerPath, `${JSON.stringify(safeResult, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    const md = [
      `# Phone Call — ${taskId}`,
      "",
      "- provider: Call2Me",
      `- call_id: ${callId}`,
      `- status: ${finalStatus}`,
      `- answered: ${answered}`,
      `- duration_seconds: ${durationSeconds ?? "unknown"}`,
      `- summary_available: ${Boolean(summary)}`,
      `- transcript_available: ${transcriptAvailable}`,
      `- transcript_source: ${transcriptEvidence.source}`,
      `- extraction_available: ${extractionAvailable}`,
      `- recording_available: ${recordingAvailable}`,
      "- private_evidence_available: true",
      "- recording_requested: false",
      "- purchase_made: false",
      "- payment_made: false",
      "- reservation_made: false",
      "",
      "Conversational content, destination phone number, provider response bodies, transcript, analysis and extraction values are intentionally not persisted in Git.",
      "",
    ].join("\n");
    fs.writeFileSync(mdPath, md, { encoding: "utf8", mode: 0o600 });

    console.log(JSON.stringify({
      report_json: path.relative(repoRoot, resultMarkerPath),
      report_md: path.relative(repoRoot, mdPath),
      private_evidence_filename: path.basename(privateEvidencePath),
      call_id: callId,
      status: finalStatus,
      answered,
      duration_seconds: durationSeconds,
      summary_available: Boolean(summary),
      transcript_available: transcriptAvailable,
      extraction_available: extractionAvailable,
      recording_available: recordingAvailable,
    }, null, 2));
  } finally {
    releaseTaskLock(lock);
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.message || "Phone call runner failed");
  process.exit(Number(error?.exitCode || 1));
}
