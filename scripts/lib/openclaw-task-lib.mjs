import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const tasksDir = "ops/agent-control/tasks";
export const dispatchDir = "ops/agent-control/dispatch";
export const reportsRoot = "ops/agent-control/reports";
export const latestReportFile = path.join(reportsRoot, "openclaw-latest.json");
export const statusFile = "ops/agent-control/STATUS.md";
export const taskSchemaPath = "ops/agent-control/OPENCLAW_TASK_SCHEMA.v1.json";
export const dispatchSchemaPath = "ops/agent-control/OPENCLAW_DISPATCH_SCHEMA.v1.json";
export const supportedTaskTypes = new Set([
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
export const allowedStatuses = new Set(["PASS", "FAIL", "BLOCKED", "DEGRADED"]);

const blockedSafetyFlags = [
  "production_code_change",
  "customer_action",
  "secrets_required",
  "public_posting",
  "paid_ads_change",
  "destructive_action",
];
const taskPrefix = `${tasksDir}/`;
const dispatchPrefix = `${dispatchDir}/`;
const redactionPatterns = [
  { pattern: /(postgres(?:ql)?:\/\/)\S+/gi, replacement: "$1***REDACTED***" },
  { pattern: /\b(sk|ghp|gho|xox[baprs]-)[A-Za-z0-9_-]+\b/g, replacement: "***REDACTED***" },
  { pattern: /\b(service_role|authorization|bearer|token|password|secret)\s*[:=]\s*\S+/gi, replacement: "$1=***REDACTED***" },
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatorCache = new Map();

function normalizeRepoRelativePath(relativePath) {
  if (typeof relativePath !== "string") return "";
  if (!path.isAbsolute(relativePath)) return relativePath.replace(/\\/g, "/").trim();
  const relative = path.relative(repoRoot, relativePath).replace(/\\/g, "/");
  return relative.startsWith("../") ? relativePath.replace(/\\/g, "/").trim() : relative;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(repoRoot, file), "utf8"));
}

export function writeJson(file, value) {
  const absolutePath = path.resolve(repoRoot, file);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readText(file) {
  return fs.readFileSync(path.resolve(repoRoot, file), "utf8");
}

export function writeText(file, value) {
  const absolutePath = path.resolve(repoRoot, file);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, value, "utf8");
}

export function sanitizeForReport(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  for (const entry of redactionPatterns) text = text.replace(entry.pattern, entry.replacement);
  return text;
}

export function buildTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function validateTaskId(id) {
  return typeof id === "string" && /^[A-Za-z0-9._:-]{3,120}$/.test(id) && !id.includes("..") && !id.includes("/");
}

export function normalizeTaskId(id) {
  return String(id || "").trim();
}

export function validateHttpsOrigin(origin) {
  if (typeof origin !== "string" || origin.trim().length === 0) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function normalizeRoutes(value) {
  const rawRoutes = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = [];
  for (const rawRoute of rawRoutes) {
    const route = String(rawRoute || "").trim();
    if (!route) continue;
    const parsed = new URL(route, "https://example.invalid");
    if (parsed.origin !== "https://example.invalid") throw new Error(`route must be relative: ${route}`);
    if (parsed.pathname.includes("..")) throw new Error(`route must not contain path traversal: ${route}`);
    const finalRoute = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!finalRoute.startsWith("/")) throw new Error(`route must start with /: ${route}`);
    normalized.push(finalRoute);
  }
  return [...new Set(normalized)];
}

export function isSafeRepoPath(relativePath, prefix) {
  if (typeof relativePath !== "string" || !relativePath.endsWith(".json") || relativePath.includes("\0")) return false;
  const trimmed = normalizeRepoRelativePath(relativePath);
  if (!trimmed.startsWith(prefix) || trimmed.includes("..") || path.isAbsolute(trimmed)) return false;
  return true;
}

export function validateTaskFilePath(relativePath) {
  return isSafeRepoPath(relativePath, taskPrefix) && !path.basename(relativePath).startsWith("TEMPLATE.");
}

export function validateDispatchFilePath(relativePath) {
  return isSafeRepoPath(relativePath, dispatchPrefix);
}

export function resolveTaskFilePath(taskFile) {
  const normalized = normalizeRepoRelativePath(taskFile);
  if (!validateTaskFilePath(normalized)) throw new Error(`unsafe task_file path: ${taskFile}`);
  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(path.resolve(repoRoot, tasksDir))) throw new Error(`task_file escaped tasks dir: ${taskFile}`);
  return absolutePath;
}

export function resolveDispatchFilePath(dispatchFile) {
  const normalized = normalizeRepoRelativePath(dispatchFile);
  if (!validateDispatchFilePath(normalized)) throw new Error(`unsafe dispatch file path: ${dispatchFile}`);
  const absolutePath = path.resolve(repoRoot, normalized);
  if (!absolutePath.startsWith(path.resolve(repoRoot, dispatchDir))) throw new Error(`dispatch file escaped dispatch dir: ${dispatchFile}`);
  return absolutePath;
}

export function listChangedTaskFiles(files) {
  return [...new Set(files.map((file) => String(file || "").trim()).filter(validateTaskFilePath))];
}

export function compileSchema(schemaFile) {
  if (!validatorCache.has(schemaFile)) {
    const schema = readJson(schemaFile);
    validatorCache.set(schemaFile, ajv.compile(schema));
  }
  return validatorCache.get(schemaFile);
}

export function validateSchema(schemaFile, payload) {
  const validate = compileSchema(schemaFile);
  const valid = validate(payload);
  return {
    valid,
    errors: valid
      ? []
      : (validate.errors || []).map((entry) => `${entry.instancePath || "/"} ${entry.message}`.trim()),
  };
}

export function detectSensitiveStrings(payload) {
  const text = JSON.stringify(payload);
  const errors = [];
  if (/\b(sk|ghp|gho|xox[baprs]-)[A-Za-z0-9_-]+\b/.test(text)) errors.push("task contains a token-like secret");
  if (/\bssn\b|\bsocial security\b|\bdate of birth\b|\bdob\b/i.test(text)) errors.push("task contains restricted private data markers");
  return errors;
}

export function validateSafetyFlags(task) {
  const errors = [];
  for (const flag of blockedSafetyFlags) {
    if (task?.safety?.[flag] === true) errors.push(`unsafe task blocked by safety flag: ${flag}=true`);
  }
  return errors;
}

export function taskReportDirectory(taskType) {
  return path.join(reportsRoot, taskType);
}

export function createLatestSummary({
  artifactName,
  error = null,
  expectedStatus,
  gitSha,
  reportFile,
  runId,
  runUrl,
  status,
  taskFile,
  taskId,
  taskType,
  timestampUtc,
  actor,
  dedupeKey,
  evidenceCommitSha = "",
  dispatchFile = "",
}) {
  return {
    task_id: taskId,
    task_type: taskType,
    task_file: taskFile,
    status,
    expected_status: expectedStatus,
    timestamp_utc: timestampUtc,
    run_id: runId,
    run_url: runUrl,
    git_sha: gitSha,
    actor,
    report_file: reportFile,
    artifact_name: artifactName,
    dedupe_key: dedupeKey,
    error,
    evidence_commit_sha: evidenceCommitSha,
    dispatch_file: dispatchFile,
  };
}

export function writeTaskReport(taskType, timestamp, lines) {
  const reportDirectory = path.resolve(repoRoot, taskReportDirectory(taskType));
  fs.mkdirSync(reportDirectory, { recursive: true });
  const file = path.join(reportDirectory, `${timestamp}.md`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

export function recentRunEntries(limit = 20) {
  const latest = fs.existsSync(path.resolve(repoRoot, latestReportFile)) ? readJson(latestReportFile) : null;
  const reportsDirectory = path.resolve(repoRoot, reportsRoot);
  if (!fs.existsSync(reportsDirectory)) return latest ? [latest] : [];
  const files = [];
  for (const entry of fs.readdirSync(reportsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskTypeDir = path.join(reportsDirectory, entry.name);
    for (const file of fs.readdirSync(taskTypeDir).filter((name) => name.endsWith(".md"))) {
      files.push(path.join(taskTypeDir, file));
    }
  }
  files.sort((left, right) => right.localeCompare(left));
  const runs = files.map((file) => extractReportMetadata(path.relative(repoRoot, file).replace(/\\/g, "/")));
  if (latest && latest.timestamp_utc && !runs.some((entry) => entry.timestamp_utc === latest.timestamp_utc && entry.task_id === latest.task_id)) {
    runs.unshift({
      timestamp_utc: latest.timestamp_utc || "",
      run_id: latest.run_id || "",
      task_id: latest.task_id || "",
      task_type: latest.task_type || "",
      status: latest.status || "",
      report_file: latest.report_file || "",
    });
  }
  return runs.filter((entry) => entry.task_id).slice(0, limit);
}

export function updateLatestEvidenceCommit(evidenceCommitSha, latestFile = latestReportFile) {
  const latest = readJson(latestFile);
  latest.evidence_commit_sha = evidenceCommitSha;
  writeJson(latestFile, latest);
  return latest;
}

export function ensureReportDirectories() {
  fs.mkdirSync(path.resolve(repoRoot, reportsRoot), { recursive: true });
  for (const taskType of [...supportedTaskTypes, "dispatch"]) {
    fs.mkdirSync(path.resolve(repoRoot, taskReportDirectory(taskType)), { recursive: true });
  }
}

export function loadTask(taskFile) {
  const absolutePath = resolveTaskFilePath(taskFile);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return { absolutePath, payload };
}

export function loadDispatch(dispatchFile) {
  const absolutePath = resolveDispatchFilePath(dispatchFile);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return { absolutePath, payload };
}

export function extractReportMetadata(relativeFile) {
  const text = fs.readFileSync(path.resolve(repoRoot, relativeFile), "utf8");
  const match = (key) => text.match(new RegExp(`- ${key}: \`([^\`]+)\``));
  return {
    timestamp_utc: match("timestamp_utc")?.[1] || "",
    run_id: match("run_id")?.[1] || "",
    task_id: match("task_id")?.[1] || "",
    task_type: match("task_type")?.[1] || "",
    status: match("status")?.[1] || "",
    dedupe_key: match("dedupe_key")?.[1] || "",
    report_file: relativeFile,
  };
}
