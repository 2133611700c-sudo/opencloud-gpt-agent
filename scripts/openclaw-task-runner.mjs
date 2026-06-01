#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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
const supportedTaskTypes = new Set(["heartbeat", "virtual_browser_audit", "synthetic_fail", "job_lead_collect", "job_lead_audit"]);
const prohibitedSafetyFlags = ["customer_action", "public_posting", "paid_ads_change", "destructive_action"];

function resolveRepoPath(...segments) {
  return path.resolve(repoRoot, ...segments);
}
function findCommand(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(finder, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
  } catch {
    if (process.platform === "win32") {
      try {
        const out = execFileSync("pwsh", ["-NoProfile", "-Command", `(Get-Command ${command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const resolved = out.trim();
        return resolved || null;
      } catch {
        return null;
      }
    }
    return null;
  }
}
function ensureRequiredBinaries() {
  const required = process.platform === "win32"
    ? ["node", "npm", "git", "gh", "pwsh"]
    : ["node", "npm", "git"];
  const missing = required.filter((bin) => !findCommand(bin));
  if (missing.length > 0) {
    if (process.env.CI) {
      throw new Error(`missing required binaries: ${missing.join(", ")}`);
    }
    console.warn(`warning: missing binaries not enforced outside CI: ${missing.join(", ")}`);
  }
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function lastChangedTaskFromPush() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD", "--", "ops/agent-control/tasks/*.json"], { encoding: "utf8" });
    const files = out.split("\n").map((x) => x.trim()).filter((x) => x.endsWith(".json") && fs.existsSync(x));
    if (files.length === 0) return null;
    return files[files.length - 1];
  } catch {
    return null;
  }
}
function latestTaskFile() {
  const changedTask = lastChangedTaskFromPush();
  if (changedTask) return changedTask;
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json")).map((f) => path.join(tasksDir, f));
  if (!files.length) throw new Error(`No task files found in ${tasksDir}`);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}
function safe(text) {
  return String(text)
    .replaceAll(/(postgres(?:ql)?:\/\/)\S+/gi, "$1***REDACTED***")
    .replaceAll(/(token|password|secret|service_role)[^\s]*/gi, "$1=***REDACTED***");
}
function writeReport(dir, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${runId}.md`);
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
  return out;
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  const dirs = ["openclaw-heartbeat", "openclaw-browser-audit", "job-lead-audit"].map((d) => path.join(reportsRoot, d)).filter((d) => fs.existsSync(d));
  const files = [];
  for (const d of dirs) for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) files.push(path.join(d, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files.slice(0, 100)) {
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
  const safetyReq = ["production_code_change", "customer_action", "secrets_required", "public_posting", "paid_ads_change", "destructive_action"];
  if (typeof task.safety !== "object" || task.safety === null) errors.push("safety must be an object");
  else for (const key of safetyReq) if (!(key in task.safety)) errors.push(`missing safety field: ${key}`);
  return errors;
}
function checkUnsafeSafety(task) {
  if (!task.safety || typeof task.safety !== "object") return null;
  for (const flag of prohibitedSafetyFlags) if (task.safety[flag] === true) return `unsafe task blocked by safety flag: ${flag}=true`;
  return null;
}
function runBrowserAudit(task) {
  const target = task.params?.target_origin || "https://handyandfriend.com";
  const routes = task.params?.routes || "/,/book,/pricing,/services,/messenger";
  const attempts = Number(task.params?.max_attempts || 2);
  const outDir = resolveRepoPath("ops", "openclaw", "reports", "virtual-browser", runId);
  const env = { ...process.env, TARGET_ORIGIN: target, ROUTES: routes, OUT_DIR: outDir };
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      execFileSync("node", ["scripts/openclaw-virtual-browser-audit.mjs"], { stdio: "inherit", env });
      return { target, routes, attempts_used: i };
    } catch (err) {
      lastError = err;
      if (i < attempts) sleep(i * 2000);
    }
  }
  throw lastError;
}
function runHeartbeat() {
  return { runner_env: process.env.RUNNER_OS || "unknown", node_version: process.version };
}
function runSyntheticFail() {
  throw new Error("synthetic_fail drill requested by task");
}
function runJobLeadCollect(task) {
  if (task?.safety?.customer_action === true) {
    throw new Error("unsafe task blocked by safety flag: customer_action=true");
  }
  const queries = Array.isArray(task.params?.search_queries) ? task.params.search_queries.filter((x) => typeof x === "string" && x.trim()) : [];
  const seedUrls = Array.isArray(task.params?.seed_urls) ? task.params.seed_urls.filter((x) => typeof x === "string" && x.trim()) : [];
  if (queries.length === 0 && seedUrls.length === 0) {
    throw new Error("job_lead_collect requires task.params.search_queries and/or task.params.seed_urls");
  }
  const outDir = resolveRepoPath("ops", "agent-control", "reports", "job-lead-audit", runId);
  const outJson = path.join(outDir, "collected-leads.json");
  const env = {
    ...process.env,
    OPENCLAW_COLLECT_QUERIES: JSON.stringify(queries),
    OPENCLAW_COLLECT_SEED_URLS: JSON.stringify(seedUrls),
    OPENCLAW_COLLECT_MAX_LEADS: String(Number(task.params?.max_leads || 25)),
    OPENCLAW_COLLECT_OUT_DIR: outDir,
    OPENCLAW_COLLECT_OUT_FILE: outJson,
  };
  execFileSync("node", ["scripts/openclaw-job-lead-collector.mjs"], { stdio: "inherit", env });
  const collected = readJson(outJson);
  return {
    mode: "READ_ONLY_PUBLIC_LEAD_COLLECTION",
    safety_guards: [
      "READ ONLY only",
      "Do not apply",
      "Do not submit forms",
      "Do not send emails",
      "Do not create accounts",
      "Do not pay fees",
      "Do not disclose personal data",
    ],
    total_collected: Array.isArray(collected.leads) ? collected.leads.length : 0,
    collection_output_file: outJson,
    leads: Array.isArray(collected.leads) ? collected.leads : [],
  };
}
function toCleanString(value, fallback = "NOT_SPECIFIED") {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}
function asOptionalString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
function includesAnyTerm(text, terms) {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term.toLowerCase()));
}
function classifyLeadFit(lead) {
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
  const hasHousingExplicit = includesAnyTerm(text, [
    "free apartment",
    "free unit",
    "unit included",
    "housing provided",
    "live-in unit",
    "lodging credit",
    "rent credit",
    "onsite apartment included",
  ]);
  const hasHardExperience = includesAnyTerm(text, ["3+ years", "3 years required", "minimum 3 years"]);
  const hasMandatorySoftware = includesAnyTerm(text, ["yardi required", "appfolio required", "must know yardi", "must know appfolio"]);
  const hasLicenseRequired = includesAnyTerm(text, ["license required", "licensed required"]);
  const hasFeeOrScam = includesAnyTerm(text, ["fee required", "deposit before", "wire payment", "upfront fee"]);
  const unrelatedRole = !includesAnyTerm(text, ["manager", "property", "resident", "caretaker", "onsite"]);
  const hasContact = (lead.apply_url && lead.apply_url !== "NOT_SPECIFIED") || (lead.public_contact_channel_if_visible && lead.public_contact_channel_if_visible !== "NOT_SPECIFIED");

  if (!hasHousingExplicit || hasHardExperience || hasMandatorySoftware || hasLicenseRequired || hasFeeOrScam || unrelatedRole || !hasContact) {
    const reasons = [];
    if (!hasHousingExplicit) reasons.push("no explicit housing terms");
    if (hasHardExperience) reasons.push("3+ years required");
    if (hasMandatorySoftware) reasons.push("Yardi/AppFolio required");
    if (hasLicenseRequired) reasons.push("license required");
    if (hasFeeOrScam) reasons.push("fee/deposit or scam indicators");
    if (unrelatedRole) reasons.push("role appears unrelated");
    if (!hasContact) reasons.push("no public apply/contact channel");
    return { fit_status: "REJECT", rejection_reason: reasons.join("; ") };
  }
  return { fit_status: "FIT", rejection_reason: "" };
}
function runJobLeadAudit(task) {
  if (task?.safety?.customer_action === true) {
    throw new Error("unsafe task blocked by safety flag: customer_action=true");
  }
  let leads = Array.isArray(task.params?.leads) ? task.params.leads : [];
  if (leads.length === 0 && typeof task.params?.collected_file === "string" && task.params.collected_file.trim()) {
    const collectedPath = path.resolve(task.params.collected_file.trim());
    if (!fs.existsSync(collectedPath)) throw new Error(`collected_file not found: ${collectedPath}`);
    const collected = readJson(collectedPath);
    leads = Array.isArray(collected.leads) ? collected.leads : [];
  }
  if (leads.length === 0) throw new Error("job_lead_audit requires task.params.leads or task.params.collected_file with at least one public lead item");
  const results = leads.map((rawLead) => {
    const lead = {
      company: toCleanString(rawLead?.company),
      role: toCleanString(rawLead?.role),
      location: toCleanString(rawLead?.location),
      listing_url: toCleanString(rawLead?.listing_url || rawLead?.apply_url),
      source_site: toCleanString(rawLead?.source_site || rawLead?.source),
      housing_terms: toCleanString(rawLead?.housing_terms),
      housing_evidence_quote: toCleanString(rawLead?.housing_evidence_quote || rawLead?.excerpt),
      compensation: toCleanString(rawLead?.compensation),
      compensation_evidence_quote: toCleanString(rawLead?.compensation_evidence_quote || rawLead?.excerpt),
      experience_requirements: toCleanString(rawLead?.experience_requirements),
      software_requirements: toCleanString(rawLead?.software_requirements),
      license_requirements: toCleanString(rawLead?.license_requirements),
      public_contact_channel_if_visible: toCleanString(rawLead?.public_contact_channel_if_visible),
      apply_url: toCleanString(rawLead?.apply_url),
      screenshot_path_if_available: toCleanString(rawLead?.screenshot_path_if_available || rawLead?.screenshot_path),
    };
    const fit = classifyLeadFit(lead);
    return {
      ...lead,
      fit_status: fit.fit_status,
      rejection_reason: fit.rejection_reason,
      next_action: fit.fit_status === "REJECT"
        ? "Skip and continue to next lead. Read-only audit only."
        : "Review details and decide whether to manually apply later. Do not apply or contact from this task.",
    };
  });
  return {
    mode: "READ_ONLY_PUBLIC_LEAD_AUDIT",
    safety_guards: [
      "READ ONLY only",
      "Do not apply",
      "Do not submit forms",
      "Do not send emails",
      "Do not create accounts",
      "Do not pay fees",
      "Do not disclose personal data",
    ],
    source_notes: asOptionalString(task.params?.source_notes),
    leads_reviewed: results.length,
    counts: {
      fit: results.filter((x) => x.fit_status === "FIT").length,
      maybe: results.filter((x) => x.fit_status === "MAYBE").length,
      reject: results.filter((x) => x.fit_status === "REJECT").length,
    },
    leads: results,
  };
}
function classifyFailure(taskType, status, errorText) {
  if (status === "BLOCKED") return "blocked_task";
  if (status === "PASS") return "pass";
  if (taskType === "synthetic_fail") return "synthetic_fail";
  if (/dedupe window active/i.test(errorText)) return "dedupe_window_active";
  if (/unsupported task type/i.test(errorText)) return "unsupported_task_type";
  if (/unsafe task blocked by safety flag/i.test(errorText)) return "blocked_task";
  if (/timeout|net::|ECONN|ENOTFOUND/i.test(errorText)) return "network_or_runtime";
  return "execution_error";
}
function nextActionFor(status, failureClass) {
  if (status === "PASS") return "No action required. Continue with next scoped task.";
  if (failureClass === "dedupe_window_active") return "Wait for dedupe window expiration or run with FORCE_RERUN=true.";
  if (failureClass === "unsupported_task_type") return "Add task type implementation or use an implemented type.";
  if (failureClass === "blocked_task") return "Adjust task safety/schema fields and re-dispatch.";
  return "Inspect error details, apply minimal safe fix, rerun task with force_rerun=true.";
}

function main() {
  ensureRequiredBinaries();
  const taskFile = path.resolve(explicitTaskFile || latestTaskFile());
  if (!fs.existsSync(schemaPath)) throw new Error(`missing schema file: ${schemaPath}`);
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
    const unsafeReason = checkUnsafeSafety(task);
    if (unsafeReason) {
      status = "BLOCKED";
      errorText = unsafeReason;
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
      else if (taskType === "virtual_browser_audit") details = runBrowserAudit(task);
      else if (taskType === "synthetic_fail") runSyntheticFail();
      else if (taskType === "job_lead_collect") details = runJobLeadCollect(task);
      else if (taskType === "job_lead_audit") details = runJobLeadAudit(task);
    } catch (err) {
      status = "FAIL";
      errorText = err instanceof Error ? err.stack || err.message : String(err);
    }
  }
  const failureClass = classifyFailure(taskType, status, errorText);
  const nextAction = nextActionFor(status, failureClass);
  const reportDir = taskType === "virtual_browser_audit"
    ? path.join(reportsRoot, "openclaw-browser-audit")
    : taskType === "job_lead_audit"
      ? path.join(reportsRoot, "job-lead-audit")
      : taskType === "job_lead_collect"
      ? path.join(reportsRoot, "job-lead-audit")
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
    expected_status: task.expected_status || "PASS",
    failure_class: failureClass,
    dedupe_key: `${taskType}:${failureClass}`,
    report_file: reportFile,
    next_action: nextAction,
  };
  fs.mkdirSync(path.dirname(latestFile), { recursive: true });
  fs.writeFileSync(latestFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (status === "PASS") process.exit(0);
  if (status === "BLOCKED") process.exit(3);
  process.exit(1);
}

main();
