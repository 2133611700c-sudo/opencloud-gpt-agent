#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const now = new Date();
const runId = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const tasksDir = resolveRepoPath("ops", "agent-control", "tasks");
const reportsRoot = resolveRepoPath("ops", "agent-control", "reports");
const schemaPath = resolveRepoPath("ops", "agent-control", "OPENCLAW_TASK_SCHEMA.v1.json");
const explicitTaskFile = process.env.TASK_FILE?.trim() || "";
const forceRerun = (process.env.FORCE_RERUN || "").toLowerCase() === "true";
const dedupeWindowMinutes = Number(process.env.DEDUPE_WINDOW_MINUTES || "15");
const actor = process.env.GITHUB_ACTOR || "unknown";
const sha = process.env.GITHUB_SHA || "unknown";
const runUrl = process.env.GITHUB_RUN_URL || "unknown";
const latestFile = process.env.OPENCLAW_LATEST_FILE
  ? path.resolve(process.env.OPENCLAW_LATEST_FILE)
  : resolveRepoPath("ops", "agent-control", "reports", "openclaw-latest.json");

const supportedTaskTypes = new Set([
  "heartbeat",
  "virtual_browser_audit",
  "synthetic_fail",
  "worker_heartbeat",
  "job_lead_collect",
  "job_lead_audit",
  "outreach_draft",
  "outreach_send_approved",
  "codex_delegate",
]);

function resolveRepoPath(...segments) {
  return path.resolve(repoRoot, ...segments);
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function safe(text) {
  return String(text)
    .replaceAll(/(postgres(?:ql)?:\/\/)\S+/gi, "$1***REDACTED***")
    .replaceAll(/(token|password|secret|service_role)[^\s]*/gi, "$1=***REDACTED***")
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "***REDACTED_EMAIL***");
}
function findCommand(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(finder, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}
function ensureRequiredBinaries() {
  const required = process.platform === "win32" ? ["node", "npm", "git"] : ["node", "npm", "git"];
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
function latestTaskFile() {
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json")).map((f) => path.join(tasksDir, f));
  if (!files.length) throw new Error(`No task files found in ${tasksDir}`);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}
function writeReport(dir, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${runId}.md`);
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
  return out;
}
function parseTaskReport(file) {
  const text = fs.readFileSync(file, "utf8");
  const get = (k) => {
    const m = text.match(new RegExp(`- ${k}: \`([^\`]+)\``));
    return m ? m[1] : "";
  };
  return { task_id: get("task_id"), timestamp_utc: get("timestamp_utc") };
}
function lastTaskExecution(taskId) {
  const dirs = ["openclaw-heartbeat", "worker-heartbeat", "openclaw-browser-audit", "job-lead-audit", "outreach-draft"].map((d) => path.join(reportsRoot, d)).filter((d) => fs.existsSync(d));
  const files = [];
  for (const d of dirs) for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) files.push(path.join(d, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files.slice(0, 200)) {
    const parsed = parseTaskReport(f);
    if (parsed.task_id === taskId && parsed.timestamp_utc) return parsed.timestamp_utc;
  }
  return null;
}
function dedupeCheck(taskId) {
  if (forceRerun) return null;
  const last = lastTaskExecution(taskId);
  if (!last) return null;
  const deltaMin = (Date.now() - new Date(last).getTime()) / 60000;
  if (deltaMin < dedupeWindowMinutes) return `task dedupe window active (${deltaMin.toFixed(1)}m < ${dedupeWindowMinutes}m)`;
  return null;
}
function validateTask(task) {
  const errors = [];
  const req = ["id", "type", "requested_by", "goal", "safety", "expected_status"];
  for (const key of req) if (!(key in task)) errors.push(`missing required field: ${key}`);
  const statusAllowed = new Set(["PASS", "FAIL", "BLOCKED", "DEGRADED"]);
  if (task.expected_status && !statusAllowed.has(task.expected_status)) errors.push(`invalid expected_status: ${task.expected_status}`);
  return errors;
}
function isUnsafeBlocked(task) {
  const s = task?.safety || {};
  const payload = JSON.stringify(task?.params || {}).toLowerCase();
  if (/\bssn\b|\bsocial security\b|\bdate of birth\b|\bdob\b|\bprivate address\b/.test(payload)) {
    return "unsafe task blocked by sensitive private data fields";
  }
  if (s.public_posting || s.paid_ads_change || s.destructive_action) return "unsafe task blocked by safety flags";
  if (task.type !== "outreach_send_approved" && s.customer_action === true) return "unsafe task blocked by safety flag: customer_action=true";
  return null;
}
function runBrowserAudit(task) {
  const target = task.params?.target_origin || "https://handyandfriend.com";
  const routes = task.params?.routes || "/,/book,/pricing,/services,/messenger";
  const attempts = Number(task.params?.max_attempts || 2);
  const outDir = resolveRepoPath("ops", "openclaw", "reports", "virtual-browser", runId);
  const env = { ...process.env, TARGET_ORIGIN: target, ROUTES: routes, OUT_DIR: outDir };
  for (let i = 1; i <= attempts; i += 1) {
    try {
      execFileSync("node", ["scripts/openclaw-virtual-browser-audit.mjs"], { stdio: "inherit", env });
      return { target, routes, attempts_used: i };
    } catch {
      if (i === attempts) throw new Error("virtual_browser_audit failed");
    }
  }
  return {};
}
function runHeartbeat() {
  return { runner_env: process.env.RUNNER_OS || "unknown", node_version: process.version };
}
function runWorkerHeartbeat() {
  const repoBranch = commandVersion("git", ["branch", "--show-current"]);
  return {
    machine_id: os.hostname(),
    hostname: os.hostname(),
    windows_version: process.platform === "win32"
      ? commandVersion("cmd", ["/c", "ver"])
      : `${os.platform()} ${os.release()}`,
    os: `${os.platform()} ${os.release()}`,
    node_version: process.version,
    npm_version: commandVersion("npm", ["-v"]),
    git_version: commandVersion("git", ["--version"]),
    gh_version: commandVersion("gh", ["--version"]).split("\n")[0],
    openclaw_version: commandVersion("npm", ["pkg", "get", "version"]),
    codex_availability: findCommand("codex") ? "AVAILABLE" : "NOT_AVAILABLE",
    current_repo_path: repoRoot,
    current_branch: repoBranch || "unknown",
    git_sha: sha,
    last_seen: now.toISOString(),
    worker_uptime_seconds: Math.floor(os.uptime()),
    runner_mode: process.env.CI ? "github-actions" : "local-worker",
  };
}
function runSyntheticFail() {
  throw new Error("synthetic_fail drill requested by task");
}
function runJobLeadCollect(task) {
  const queries = Array.isArray(task.params?.search_queries) ? task.params.search_queries : [];
  const seedUrls = Array.isArray(task.params?.seed_urls) ? task.params.seed_urls : [];
  if (queries.length === 0 && seedUrls.length === 0) {
    throw new Error("job_lead_collect requires search_queries and/or seed_urls");
  }
  const outDir = resolveRepoPath("ops", "agent-control", "reports", "job-lead-audit", runId);
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
  execFileSync("node", ["scripts/openclaw-job-lead-collector.mjs"], { stdio: "inherit", env });
  const collected = readJson(outJson);
  return {
    mode: "READ_ONLY_PUBLIC_LEAD_COLLECTION",
    total_collected: Array.isArray(collected.leads) ? collected.leads.length : 0,
    collection_output_file: outJson,
    leads: Array.isArray(collected.leads) ? collected.leads : [],
  };
}
function toCleanString(value, fallback = "NOT_SPECIFIED") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function includesAny(text, terms) {
  const t = text.toLowerCase();
  return terms.some((term) => t.includes(term.toLowerCase()));
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
  const hardExp = includesAny(text, ["3+ years", "3 years required", "minimum 3 years"]);
  const mandatoryYardi = includesAny(text, ["yardi required", "appfolio required", "must know yardi", "must know appfolio"]);
  const licenseReq = includesAny(text, ["license required", "licensed required"]);
  const scam = includesAny(text, ["fee required", "deposit before", "wire payment", "upfront fee", "application fee before tour"]);
  const unrelated = !includesAny(text, ["manager", "resident", "property", "caretaker", "building"]);
  const hasContact = (lead.apply_url && lead.apply_url !== "NOT_SPECIFIED") || (lead.public_contact_channel_if_visible && lead.public_contact_channel_if_visible !== "NOT_SPECIFIED");
  if (!hasHousing || hardExp || mandatoryYardi || licenseReq || scam || unrelated || !hasContact) {
    const reasons = [];
    if (!hasHousing) reasons.push("no housing");
    if (hardExp) reasons.push("3+ years required");
    if (mandatoryYardi) reasons.push("Yardi/AppFolio required");
    if (licenseReq) reasons.push("license required");
    if (scam) reasons.push("fee/deposit requested");
    if (unrelated) reasons.push("unrelated role");
    if (!hasContact) reasons.push("no apply/contact");
    return { fit_status: "REJECT", rejection_reason: reasons.join("; ") };
  }
  const maybe = includesAny(text, ["preferred", "nice to have", "plus"]);
  if (maybe) return { fit_status: "MAYBE", rejection_reason: "requirements not explicit hard-blockers" };
  return { fit_status: "FIT", rejection_reason: "" };
}
function runJobLeadAudit(task) {
  let leads = Array.isArray(task.params?.leads) ? task.params.leads : [];
  if (leads.length === 0 && typeof task.params?.collected_file === "string" && task.params.collected_file.trim()) {
    const collected = readJson(path.resolve(task.params.collected_file.trim()));
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
      next_action: fit.fit_status === "REJECT"
        ? "Skip lead. Continue read-only research."
        : "Manual human review for potential outreach draft.",
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
  const customerAction = task.safety?.customer_action === true;
  const approvedTargets = Array.isArray(task.params?.approved_targets) ? task.params.approved_targets : [];
  const approvedHash = typeof task.params?.approved_text_hash === "string" ? task.params.approved_text_hash.trim() : "";
  if (!explicit || !customerAction || approvedTargets.length === 0 || !approvedHash) {
    throw new Error("unsafe outreach_send_approved blocked: requires explicit_approval=true, customer_action=true, approved_targets, approved_text_hash");
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
    required_delivery_contract: [
      "branch name",
      "commit sha",
      "PR URL",
      "changed files",
      "validation results",
      "evidence path",
      "next_action",
    ],
    prepared_branch: branch,
    prepared_prompt_preview: prompt.slice(0, 500),
    next_action: "Run codex on worker with this prompt, commit in new branch, open PR (no auto-merge).",
  };
}
function classifyFailure(taskType, status, errorText) {
  if (status === "BLOCKED") return "blocked_task";
  if (status === "PASS") return "pass";
  if (taskType === "synthetic_fail") return "synthetic_fail";
  if (/dedupe window active/i.test(errorText)) return "dedupe_window_active";
  if (/unsupported task type/i.test(errorText)) return "unsupported_task_type";
  if (/unsafe|blocked/i.test(errorText)) return "blocked_task";
  if (/timeout|net::|ECONN|ENOTFOUND/i.test(errorText)) return "network_or_runtime";
  return "execution_error";
}
function nextActionFor(status, failureClass) {
  if (status === "PASS") return "No action required. Continue with next scoped task.";
  if (failureClass === "blocked_task") return "Adjust safety/approval fields and re-dispatch.";
  if (failureClass === "dedupe_window_active") return "Use FORCE_RERUN=true or wait dedupe window.";
  return "Inspect error details, apply minimal safe fix, rerun.";
}

function main() {
  ensureRequiredBinaries();
  const taskFile = path.resolve(explicitTaskFile || latestTaskFile());
  readJson(schemaPath);
  const task = readJson(taskFile);
  const taskId = task.id || path.basename(taskFile, ".json");
  const taskType = task.type || "heartbeat";
  let status = "PASS";
  let details = {};
  let errorText = "";

  const schemaErrors = validateTask(task);
  if (schemaErrors.length > 0) {
    status = "BLOCKED";
    errorText = `schema validation failed: ${schemaErrors.join("; ")}`;
  }
  if (status === "PASS" && !supportedTaskTypes.has(taskType)) {
    status = "BLOCKED";
    errorText = `Unsupported task type: ${taskType}`;
  }
  if (status === "PASS") {
    const unsafe = isUnsafeBlocked(task);
    if (unsafe) {
      status = "BLOCKED";
      errorText = unsafe;
    }
  }
  const dedupeReason = status === "PASS" ? dedupeCheck(taskId) : null;
  if (status === "PASS" && dedupeReason) {
    status = "BLOCKED";
    errorText = dedupeReason;
  }

  if (status === "PASS") {
    try {
      if (taskType === "heartbeat") details = runHeartbeat();
      else if (taskType === "worker_heartbeat") details = runWorkerHeartbeat();
      else if (taskType === "virtual_browser_audit") details = runBrowserAudit(task);
      else if (taskType === "synthetic_fail") runSyntheticFail();
      else if (taskType === "job_lead_collect") details = runJobLeadCollect(task);
      else if (taskType === "job_lead_audit") details = runJobLeadAudit(task);
      else if (taskType === "outreach_draft") details = runOutreachDraft(task);
      else if (taskType === "outreach_send_approved") details = runOutreachSendApproved(task);
      else if (taskType === "codex_delegate") details = runCodexDelegate(task);
    } catch (err) {
      const message = err instanceof Error ? (err.stack || err.message) : String(err);
      if (/^DEGRADED:/i.test(message)) {
        status = "DEGRADED";
      } else if (/blocked/i.test(message)) {
        status = "BLOCKED";
      } else {
        status = "FAIL";
      }
      errorText = message;
    }
  }

  const failureClass = classifyFailure(taskType, status, errorText);
  const nextAction = nextActionFor(status, failureClass);
  const reportDir = taskType === "virtual_browser_audit"
    ? path.join(reportsRoot, "openclaw-browser-audit")
    : taskType === "worker_heartbeat"
      ? path.join(reportsRoot, "worker-heartbeat")
    : taskType === "job_lead_collect" || taskType === "job_lead_audit"
      ? path.join(reportsRoot, "job-lead-audit")
      : taskType === "outreach_draft" || taskType === "outreach_send_approved"
        ? path.join(reportsRoot, "outreach-draft")
        : path.join(reportsRoot, "openclaw-heartbeat");
  const reportFile = writeReport(reportDir, [
    "# OpenClaw Task Report",
    "",
    `- status: \`${status}\``,
    `- task_id: \`${taskId}\``,
    `- task_type: \`${taskType}\``,
    `- failure_class: \`${failureClass}\``,
    `- dedupe_key: \`${taskType}:${failureClass}\``,
    `- expected_status: \`${task.expected_status || "PASS"}\``,
    `- task_file: \`${taskFile}\``,
    `- run_id: \`${runId}\``,
    `- timestamp_utc: \`${now.toISOString()}\``,
    `- git_sha: \`${sha}\``,
    `- actor: \`${actor}\``,
    `- workflow_run_url: ${runUrl}`,
    "",
    "## Details",
    "```json",
    JSON.stringify(details, null, 2),
    "```",
    ...(errorText ? ["", "## Error", "```text", safe(errorText).slice(-5000), "```"] : []),
    "",
    "## Next action",
    "",
    nextAction,
  ]);

  const summary = {
    status,
    task_id: taskId,
    task_type: taskType,
    run_id: runId,
    run_url: runUrl,
    worker_id: os.hostname(),
    started_at: now.toISOString(),
    completed_at: new Date().toISOString(),
    expected_status: task.expected_status || "PASS",
    failure_class: failureClass,
    dedupe_key: `${taskType}:${failureClass}`,
    report_file: reportFile,
    evidence_files: [reportFile],
    next_action: nextAction,
  };
  fs.mkdirSync(path.dirname(latestFile), { recursive: true });
  fs.writeFileSync(latestFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary));
  if (status === "PASS") process.exit(0);
  if (status === "BLOCKED") process.exit(3);
  process.exit(1);
}

main();
