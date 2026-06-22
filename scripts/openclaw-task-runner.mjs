#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  allowedStatuses,
  buildTimestamp,
  createLatestSummary,
  detectSensitiveStrings,
  ensureReportDirectories,
  extractReportMetadata,
  latestReportFile,
  loadTask,
  normalizeRoutes,
  readJson,
  reportsRoot,
  repoRoot,
  sanitizeForReport,
  supportedTaskTypes,
  taskSchemaPath,
  validateHttpsOrigin,
  validateSafetyFlags,
  validateSchema,
  validateTaskFilePath,
  writeJson,
  writeTaskReport,
} from "./lib/openclaw-task-lib.mjs";

const now = new Date();
const timestamp = buildTimestamp(now);
const requestedTaskFile = (process.env.TASK_FILE || "").trim();
const forceRerun = (process.env.FORCE_RERUN || "false").toLowerCase() === "true";
const runId = String(process.env.GITHUB_RUN_ID || timestamp);
const runUrl = process.env.GITHUB_RUN_URL || "";
const actor = process.env.GITHUB_ACTOR || "local";
const gitSha = process.env.GITHUB_SHA || localGitSha();
const artifactName = process.env.OPENCLAW_ARTIFACT_NAME || `openclaw-${runId}`;
const dispatchFile = (process.env.DISPATCH_FILE || "").trim();
const latestOutputFile = process.env.OPENCLAW_LATEST_FILE || latestReportFile;
const dedupeWindowMinutes = Number(process.env.DEDUPE_WINDOW_MINUTES || "15");
const outputDirectory = process.env.OPENCLAW_OUTPUT_DIR || path.join(reportsRoot, "_runtime");

function localGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function writeLatest(summary) {
  writeJson(latestOutputFile, summary);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function findCommand(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(finder, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

function ensureRequiredBinaries() {
  const required = ["node", "npm", "git"];
  const missing = required.filter((bin) => !findCommand(bin));
  if (missing.length > 0 && process.env.CI) {
    throw new Error(`missing required binaries: ${missing.join(", ")}`);
  }
}

function commandVersion(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "NOT_AVAILABLE";
  }
}

function findRecentTaskRun(taskId) {
  const reportsDirectory = path.resolve(repoRoot, reportsRoot);
  if (!fs.existsSync(reportsDirectory)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(reportsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskTypeDir = path.join(reportsDirectory, entry.name);
    for (const file of fs.readdirSync(taskTypeDir).filter((name) => name.endsWith(".md"))) {
      candidates.push(path.relative(repoRoot, path.join(taskTypeDir, file)).replace(/\\/g, "/"));
    }
  }
  candidates.sort().reverse();
  for (const file of candidates.slice(0, 300)) {
    const metadata = extractReportMetadata(file);
    if (metadata.task_id === taskId && metadata.timestamp_utc) return metadata;
  }
  return null;
}

function dedupeCheck(taskId) {
  if (forceRerun) return "";
  const lastRun = findRecentTaskRun(taskId);
  if (!lastRun?.timestamp_utc) return "";
  const deltaMinutes = (Date.now() - new Date(lastRun.timestamp_utc).getTime()) / 60000;
  if (deltaMinutes < dedupeWindowMinutes) {
    return `task dedupe window active (${deltaMinutes.toFixed(1)}m < ${dedupeWindowMinutes}m)`;
  }
  return "";
}

function runHeartbeat() {
  return {
    runner_os: process.env.RUNNER_OS || process.platform,
    node_version: process.version,
    cwd: repoRoot,
  };
}

function runWorkerHeartbeat() {
  const repoBranch = commandVersion("git", ["branch", "--show-current"]);
  return {
    machine_id: os.hostname(),
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    node_version: process.version,
    npm_version: commandVersion("npm", ["-v"]),
    git_version: commandVersion("git", ["--version"]),
    gh_version: commandVersion("gh", ["--version"]).split("\n")[0],
    openclaw_version: commandVersion("npm", ["pkg", "get", "version"]),
    codex_availability: findCommand("codex") ? "AVAILABLE" : "NOT_AVAILABLE",
    current_repo_path: repoRoot,
    current_branch: repoBranch || "unknown",
    git_sha: gitSha,
    last_seen: now.toISOString(),
    worker_uptime_seconds: Math.floor(os.uptime()),
    runner_mode: process.env.CI ? "github-actions" : "local-worker",
  };
}

function runSyntheticFail() {
  throw new Error("synthetic_fail drill requested by task");
}

function runBrowserAudit(task) {
  const targetOrigin = task.params.target_origin;
  const routes = normalizeRoutes(task.params.routes);
  const attempts = Number(task.params.max_attempts || 1);
  const env = {
    ...process.env,
    TARGET_ORIGIN: targetOrigin,
    ROUTES: routes.join(","),
    OUT_DIR: path.resolve(repoRoot, outputDirectory, task.id),
  };
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSync("node", ["scripts/openclaw-virtual-browser-audit.mjs"], {
        cwd: repoRoot,
        stdio: "inherit",
        env,
      });
      return {
        target_origin: targetOrigin,
        routes,
        attempts_used: attempt,
        out_dir: path.relative(repoRoot, env.OUT_DIR).replace(/\\/g, "/"),
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) sleep(attempt * 1000);
    }
  }
  throw lastError;
}

function runJobLeadCollect(task) {
  const queries = Array.isArray(task.params?.search_queries) ? task.params.search_queries : [];
  const seedUrls = Array.isArray(task.params?.seed_urls) ? task.params.seed_urls : [];
  if (queries.length === 0 && seedUrls.length === 0) {
    throw new Error("job_lead_collect requires search_queries and/or seed_urls");
  }
  const outDir = path.resolve(repoRoot, reportsRoot, "job_lead_collect", runId);
  const outJson = path.join(outDir, "collected-leads.json");
  const env = {
    ...process.env,
    OPENCLAW_COLLECT_QUERIES: JSON.stringify(queries),
    OPENCLAW_COLLECT_SEED_URLS: JSON.stringify(seedUrls),
    OPENCLAW_COLLECT_MAX_LEADS: String(Number(task.params?.max_leads || 25)),
    OPENCLAW_COLLECT_LOCATION: String(task.params?.location || ""),
    OPENCLAW_COLLECT_TARGET_PROFILE: JSON.stringify(task.params?.target_profile || {}),
    OPENCLAW_COLLECT_OUT_DIR: outDir,
    OPENCLAW_COLLECT_OUT_FILE: outJson,
  };
  execFileSync("node", ["scripts/openclaw-job-lead-collector.mjs"], { cwd: repoRoot, stdio: "inherit", env });
  const collected = readJson(path.relative(repoRoot, outJson));
  return {
    mode: "READ_ONLY_PUBLIC_LEAD_COLLECTION",
    total_collected: Array.isArray(collected.leads) ? collected.leads.length : 0,
    collection_output_file: path.relative(repoRoot, outJson).replace(/\\/g, "/"),
    leads: Array.isArray(collected.leads) ? collected.leads : [],
  };
}

function toCleanString(value, fallback = "NOT_SPECIFIED") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function includesAny(text, terms) {
  const haystack = text.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function classifyLead(lead) {
  const text = [
    lead.role,
    lead.housing_terms,
    lead.housing_evidence_quote,
    lead.compensation,
    lead.compensation_evidence_quote,
    lead.experience_requirements,
    lead.software_requirements,
    lead.license_requirements,
  ].join(" ").toLowerCase();
  const hasHousing = includesAny(text, ["free apartment", "free unit", "unit included", "housing provided", "live-in housing", "lodging credit", "rent credit"]);
  const hardExperience = includesAny(text, ["3+ years", "3 years required", "minimum 3 years"]);
  const mandatorySoftware = includesAny(text, ["yardi required", "appfolio required", "must know yardi", "must know appfolio"]);
  const licenseRequired = includesAny(text, ["license required", "licensed required"]);
  const scam = includesAny(text, ["fee required", "deposit before", "wire payment", "upfront fee", "application fee before tour"]);
  const unrelated = !includesAny(text, ["manager", "resident", "property", "caretaker", "building"]);
  const hasContact = (lead.apply_url && lead.apply_url !== "NOT_SPECIFIED") || (lead.public_contact_channel_if_visible && lead.public_contact_channel_if_visible !== "NOT_SPECIFIED");
  if (!hasHousing || hardExperience || mandatorySoftware || licenseRequired || scam || unrelated || !hasContact) {
    const reasons = [];
    if (!hasHousing) reasons.push("no housing");
    if (hardExperience) reasons.push("3+ years required");
    if (mandatorySoftware) reasons.push("Yardi/AppFolio required");
    if (licenseRequired) reasons.push("license required");
    if (scam) reasons.push("fee/deposit requested");
    if (unrelated) reasons.push("unrelated role");
    if (!hasContact) reasons.push("no apply/contact");
    return { fit_status: "REJECT", rejection_reason: reasons.join("; ") };
  }
  if (includesAny(text, ["preferred", "nice to have", "plus"])) {
    return { fit_status: "MAYBE", rejection_reason: "requirements not explicit hard-blockers" };
  }
  return { fit_status: "FIT", rejection_reason: "" };
}

function runJobLeadAudit(task) {
  let leads = Array.isArray(task.params?.leads) ? task.params.leads : [];
  if (leads.length === 0 && typeof task.params?.collected_file === "string" && task.params.collected_file.trim()) {
    const collected = readJson(task.params.collected_file.trim());
    leads = Array.isArray(collected.leads) ? collected.leads : [];
  }
  if (leads.length === 0) throw new Error("job_lead_audit requires leads or collected_file");
  const audited = leads.map((raw) => {
    const lead = {
      company: toCleanString(raw.company),
      role: toCleanString(raw.role),
      location: toCleanString(raw.location),
      listing_url: toCleanString(raw.listing_url || raw.apply_url),
      source_site: toCleanString(raw.source_site || raw.source),
      housing_terms: toCleanString(raw.housing_terms),
      housing_evidence_quote: toCleanString(raw.housing_evidence_quote || raw.excerpt),
      compensation: toCleanString(raw.compensation),
      compensation_evidence_quote: toCleanString(raw.compensation_evidence_quote || raw.excerpt),
      experience_requirements: toCleanString(raw.experience_requirements),
      software_requirements: toCleanString(raw.software_requirements),
      license_requirements: toCleanString(raw.license_requirements),
      public_contact_channel_if_visible: toCleanString(raw.public_contact_channel_if_visible),
      apply_url: toCleanString(raw.apply_url),
      screenshot_path_if_available: toCleanString(raw.screenshot_path_if_available || raw.screenshot_path),
    };
    const fit = classifyLead(lead);
    return {
      ...lead,
      fit_status: fit.fit_status,
      rejection_reason: fit.rejection_reason,
      next_action: fit.fit_status === "REJECT" ? "Skip lead. Continue read-only research." : "Manual human review for potential outreach draft.",
    };
  });
  return { leads_reviewed: audited.length, leads: audited };
}

function candidateProfile() {
  return {
    full_name: "Sergii Kuropiatnyk",
    phone: "213-361-1700",
    email: "2133611700c@gmail.com",
    site: "https://handyandfriend.com",
    traits: ["responsible", "calm", "clean", "organized", "no bad habits"],
    background: [
      "Worked as a lawyer in Europe for 4 years",
      "Practical handyman/service background through Handy & Friend",
      "Looking for long-term live-in opportunity",
    ],
    constraints: [
      "Do not claim property management license",
      "Do not claim formal U.S. property-management experience",
    ],
  };
}

function runOutreachDraft(task) {
  const leads = Array.isArray(task.params?.leads) ? task.params.leads : [];
  if (leads.length === 0) throw new Error("outreach_draft requires task.params.leads");
  const profile = candidateProfile();
  const drafts = leads.map((lead) => {
    const subject = `Interest in ${toCleanString(lead.role)} opportunity`;
    const body = `Hello,\n\nI am interested in your ${toCleanString(lead.role)} opportunity at ${toCleanString(lead.company)}.\nI am ${profile.full_name}. I am ${profile.traits.join(", ")}.\nI worked as a lawyer in Europe for 4 years and have practical handyman/service background through Handy & Friend (${profile.site}).\nI am looking for a long-term live-in opportunity.\n\nI do not hold a U.S. property management license and I do not claim formal U.S. property-management experience.\n\nIf relevant, I would appreciate discussing next steps.\n\nThank you,\n${profile.full_name}\n${profile.phone}\n${profile.email}`;
    return {
      company: toCleanString(lead.company),
      recipient: toCleanString(lead.public_contact_channel_if_visible || lead.apply_url),
      draft_subject: subject,
      draft_text: body,
      text_hash: crypto.createHash("sha256").update(body, "utf8").digest("hex"),
      recommended_action: "Human review and manual send only.",
    };
  });
  return { mode: "DRAFT_ONLY", profile, drafts };
}

function runOutreachSendApproved(task) {
  const explicit = task.params?.explicit_approval === true;
  const approvedTargets = Array.isArray(task.params?.approved_targets) ? task.params.approved_targets : [];
  const approvedHash = typeof task.params?.approved_text_hash === "string" ? task.params.approved_text_hash.trim() : "";
  if (!explicit || approvedTargets.length === 0 || !approvedHash) {
    throw new Error("unsafe outreach_send_approved blocked: requires explicit_approval=true, approved_targets, approved_text_hash");
  }
  return {
    mode: "APPROVED_SEND_GATE_ONLY",
    status: "BLOCKED",
    reason: "Send execution is intentionally disabled in OpenClaw runner. Use human-approved external sender.",
    approved_targets_count: approvedTargets.length,
  };
}

function runCodexDelegate(task) {
  const codexBin = findCommand("codex");
  if (!codexBin) {
    throw new Error("DEGRADED: codex CLI not available on worker");
  }
  const branch = String(task.params?.target_branch || `codex/task-${task.id}`.toLowerCase());
  const prompt = String(task.params?.codex_prompt || task.goal || "Codex delegated task");
  return {
    mode: "CODEX_DELEGATE_DRY_RUN",
    codex_available: true,
    codex_binary: codexBin,
    required_delivery_contract: ["branch name", "commit sha", "PR URL", "changed files", "validation results", "evidence path", "next_action"],
    prepared_branch: branch,
    prepared_prompt_preview: prompt.slice(0, 500),
    next_action: "Run codex on worker with this prompt, commit in new branch, open PR (no auto-merge).",
  };
}

function classifyFailure(status, errorText) {
  if (status === "PASS") return "pass";
  if (status === "BLOCKED" && /dedupe/i.test(errorText)) return "dedupe";
  if (status === "BLOCKED" && /unsafe task blocked/i.test(errorText)) return "safety_block";
  if (status === "BLOCKED" && /schema/i.test(errorText)) return "schema_error";
  if (status === "BLOCKED") return "blocked";
  if (/timeout|net::|ECONN|ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(errorText)) return "browser_failure";
  if (/synthetic_fail/i.test(errorText)) return "synthetic_fail";
  return "execution_error";
}

function nextAction(status, failureClass) {
  if (status === "PASS") return "No action required.";
  if (failureClass === "dedupe") return "Use force_rerun=true or wait for the dedupe window to expire.";
  if (failureClass === "schema_error") return "Fix the task payload to satisfy OPENCLAW_TASK_SCHEMA.v1.json.";
  if (failureClass === "safety_block") return "Keep all safety flags false for read-only OpenClaw tasks.";
  return "Inspect the report and rerun only after the root cause is understood.";
}

function validateTask(taskFile, task) {
  const errors = [];
  if (!validateTaskFilePath(taskFile)) errors.push(`unsafe task_file path: ${taskFile}`);
  const schemaValidation = validateSchema(taskSchemaPath, task);
  if (!schemaValidation.valid) errors.push(`schema validation failed: ${schemaValidation.errors.join("; ")}`);
  if (!supportedTaskTypes.has(task.type)) errors.push(`unsupported task type: ${task.type}`);
  if (task.type === "virtual_browser_audit" && !validateHttpsOrigin(task.params?.target_origin || "")) {
    errors.push(`target_origin must be an https origin: ${task.params?.target_origin || ""}`);
  }
  if (task.type === "virtual_browser_audit") {
    try {
      normalizeRoutes(task.params?.routes || []);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  errors.push(...validateSafetyFlags(task));
  errors.push(...detectSensitiveStrings(task));
  return errors;
}

function buildReportLines({ task, taskFile, status, errorText, failureClass, details, dedupeKey }) {
  return [
    "# OpenClaw Task Report",
    "",
    `- status: \`${status}\``,
    `- task_id: \`${task.id}\``,
    `- task_type: \`${task.type}\``,
    `- expected_status: \`${task.expected_status}\``,
    `- dedupe_key: \`${dedupeKey}\``,
    `- task_file: \`${taskFile}\``,
    `- run_id: \`${runId}\``,
    `- timestamp_utc: \`${now.toISOString()}\``,
    `- git_sha: \`${gitSha}\``,
    `- actor: \`${actor}\``,
    `- workflow_run_url: \`${runUrl}\``,
    "",
    "## Goal",
    "",
    task.goal,
    "",
    "## Details",
    "```json",
    sanitizeForReport(details),
    "```",
    "",
    "## Failure Class",
    "",
    failureClass,
    ...(errorText
      ? [
          "",
          "## Error",
          "```text",
          sanitizeForReport(errorText).slice(-12000),
          "```",
        ]
      : []),
    "",
    "## Next Action",
    "",
    nextAction(status, failureClass),
  ];
}

function writeDispatchReport(taskFile, status) {
  if (!dispatchFile) return "";
  return writeTaskReport("dispatch", timestamp, [
    "# OpenClaw Dispatch Report",
    "",
    `- status: \`${status}\``,
    `- dispatch_file: \`${dispatchFile}\``,
    `- task_file: \`${taskFile}\``,
    `- run_id: \`${runId}\``,
    `- timestamp_utc: \`${now.toISOString()}\``,
    `- actor: \`${actor}\``,
  ]);
}

function enforceExpectedStatus(latest) {
  if (!allowedStatuses.has(latest.status)) {
    process.exitCode = 1;
    return;
  }
  if (latest.status === "BLOCKED") {
    process.exitCode = 3;
    return;
  }
  if (latest.status === "PASS" || latest.status === "DEGRADED") {
    process.exitCode = 0;
    return;
  }
  process.exitCode = 1;
}

function main() {
  ensureRequiredBinaries();
  ensureReportDirectories();

  const fallbackTask = {
    id: path.basename(requestedTaskFile || "unknown", ".json") || "UNKNOWN",
    type: "heartbeat",
    requested_by: actor,
    goal: "Recover a truthful OpenClaw evidence report.",
    params: {},
    safety: {
      production_code_change: false,
      customer_action: false,
      secrets_required: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false,
    },
    expected_status: "PASS",
  };

  let task = fallbackTask;
  let status = "PASS";
  let errorText = "";
  let details = {};
  let taskFile = requestedTaskFile;

  try {
    if (!requestedTaskFile) throw new Error("TASK_FILE is required");
    const loaded = loadTask(requestedTaskFile);
    task = loaded.payload;
    taskFile = requestedTaskFile;
    const errors = validateTask(taskFile, task);
    if (errors.length > 0) {
      status = "BLOCKED";
      errorText = errors.join("; ");
    }
  } catch (error) {
    status = "BLOCKED";
    errorText = error instanceof Error ? error.message : String(error);
  }

  if (status === "PASS") {
    const dedupeReason = dedupeCheck(task.id);
    if (dedupeReason) {
      status = "BLOCKED";
      errorText = dedupeReason;
    }
  }

  if (status === "PASS") {
    try {
      switch (task.type) {
        case "heartbeat":
          details = runHeartbeat();
          break;
        case "worker_heartbeat":
          details = runWorkerHeartbeat();
          break;
        case "virtual_browser_audit":
          details = runBrowserAudit(task);
          break;
        case "synthetic_fail":
          runSyntheticFail();
          break;
        case "job_lead_collect":
          details = runJobLeadCollect(task);
          break;
        case "job_lead_audit":
          details = runJobLeadAudit(task);
          break;
        case "outreach_draft":
          details = runOutreachDraft(task);
          break;
        case "outreach_send_approved":
          details = runOutreachSendApproved(task);
          break;
        case "codex_delegate":
          details = runCodexDelegate(task);
          break;
        default:
          throw new Error(`unsupported task type: ${task.type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      if (/^DEGRADED:/i.test(message)) status = "DEGRADED";
      else if (/blocked/i.test(message)) status = "BLOCKED";
      else status = "FAIL";
      errorText = message;
    }
  }

  const failureClass = classifyFailure(status, errorText);
  const dedupeKey = `${task.type}:${failureClass}`;
  const reportFile = writeTaskReport(task.type, timestamp, buildReportLines({
    task,
    taskFile,
    status,
    errorText,
    failureClass,
    details,
    dedupeKey,
  }));

  const latest = createLatestSummary({
    artifactName,
    error: errorText ? sanitizeForReport(errorText).slice(-12000) : null,
    expectedStatus: task.expected_status,
    gitSha,
    reportFile,
    runId,
    runUrl,
    status,
    taskFile,
    taskId: task.id,
    taskType: task.type,
    timestampUtc: now.toISOString(),
    actor,
    dedupeKey,
    dispatchFile,
  });

  writeLatest(latest);
  const dispatchReport = writeDispatchReport(taskFile, status);
  if (dispatchReport) latest.dispatch_report_file = dispatchReport;
  writeLatest(latest);
  process.stdout.write(`${JSON.stringify(latest)}\n`);
  enforceExpectedStatus(latest);
}

main();
