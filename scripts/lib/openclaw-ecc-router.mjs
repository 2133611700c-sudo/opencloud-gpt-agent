import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPolicyPath = path.resolve(here, "../../ops/agent-control/ecc/ECC_ORCHESTRATION_POLICY.v1.json");

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedText(task) {
  return [
    task.type,
    task.goal,
    task.objective,
    task.instructions,
    JSON.stringify(task.context || {}),
    JSON.stringify(task.metadata || {}),
    JSON.stringify(task.params || {}),
  ].filter(Boolean).join(" ").toLowerCase();
}

function pathCandidates(task) {
  return uniq([
    ...(Array.isArray(task.allowed_paths) ? task.allowed_paths : []),
    task.params?.target_file,
    task.params?.path,
    task.context?.file,
    ...(Array.isArray(task.context?.files) ? task.context.files : []),
  ].map((value) => typeof value === "string" ? value : ""));
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function loadPolicy(policyPath = defaultPolicyPath) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

export function buildOrchestrationPlan(task, options = {}) {
  const policy = options.policy || loadPolicy(options.policyPath);
  const text = normalizedText(task);
  const paths = pathCandidates(task);
  const extSet = uniq(paths.map((candidate) => path.extname(candidate).toLowerCase()).filter(Boolean));
  const repairIntent = hasAny(text, policy.keyword_routes.repair);
  const architectureIntent = hasAny(text, policy.keyword_routes.architecture);
  const securityIntent = hasAny(text, policy.keyword_routes.security) || task.type === "codex_delegate" || text.includes("openclaw");
  const testingIntent = hasAny(text, policy.keyword_routes.testing);
  const docsIntent = hasAny(text, policy.keyword_routes.documentation);
  const isCodeChange = task.type === "repo_patch" || paths.length > 0 || /implement|add|change|modify|code|feature/.test(text);
  const isAgentic = /agent|openclaw|llm|model|tool call|mcp|skill/.test(text) || task.type === "codex_delegate";
  const usesVision = Boolean(task.params?.image || task.params?.images || task.context?.image || task.metadata?.vision);

  const lanes = ["supervisor", "discovery"];
  if (architectureIntent) lanes.push("architecture");
  if (repairIntent) lanes.push("repair");
  if (isCodeChange) lanes.push("review");
  lanes.push("verification");
  if (docsIntent) lanes.push("documentation");

  const agents = ["chief-of-staff", "planner"];
  if (architectureIntent) agents.push("architect", "code-architect");
  if (repairIntent) agents.push("build-error-resolver", "silent-failure-hunter");
  if (isCodeChange) agents.push("code-reviewer");
  if (securityIntent || isAgentic) agents.push("security-reviewer");
  if (testingIntent || isCodeChange) agents.push("pr-test-analyzer", "tdd-guide");
  agents.push("agent-evaluator");
  if (docsIntent) agents.push("doc-updater");

  const skills = [...policy.base_skills, ...policy.orchestration_skills];
  if (repairIntent) skills.push(...policy.failure_skills);
  if (isAgentic) skills.push("agent-architecture-audit", "agent-introspection-debugging");
  if (testingIntent || isCodeChange) skills.push("ai-regression-testing");
  if (securityIntent) skills.push("security-review");
  if (/browser|playwright|ui|route|website/.test(text)) skills.push("browser-qa");
  if (/repo|github|pull request|workflow|actions/.test(text)) skills.push("repo-scan", "github-ops");
  skills.push(...policy.learning_skills);

  for (const ext of extSet) {
    const route = policy.extension_routes[ext];
    if (!route) continue;
    if (isCodeChange) agents.push(...(route.review || []));
    if (repairIntent) agents.push(...(route.repair || []));
  }

  let complexity = 1;
  if (architectureIntent) complexity += 1;
  if (repairIntent) complexity += 1;
  if (securityIntent) complexity += 1;
  if (paths.length > 3) complexity += 1;
  if (isAgentic) complexity += 1;
  complexity = Math.min(complexity, 5);

  const reasoningEffort = complexity >= 4
    ? policy.deepseek.reasoning.complex
    : complexity <= 1
      ? policy.deepseek.reasoning.simple
      : policy.deepseek.reasoning.default;

  const blocked = Object.entries(task.safety || {}).some(([key, value]) => value === true && [
    "customer_action",
    "public_posting",
    "paid_ads_change",
    "destructive_action",
  ].includes(key));

  const phases = policy.phases.map((phase) => ({
    phase,
    mode: ["discover", "review"].includes(phase) ? "parallel-safe-read-only" : "sequential-gated",
  }));

  return {
    policy_version: policy.schema_version,
    task_id: task.id || "UNKNOWN",
    classification: {
      repairIntent,
      architectureIntent,
      securityIntent,
      testingIntent,
      docsIntent,
      isCodeChange,
      isAgentic,
      usesVision,
      complexity,
    },
    model_route: {
      primary: usesVision ? policy.deepseek.image_model : policy.deepseek.primary,
      fallbacks: policy.deepseek.fallbacks,
      reasoning_effort: reasoningEffort,
      context_window: policy.deepseek.context_window,
      max_output_tokens: policy.deepseek.max_output_tokens,
    },
    lanes: uniq(lanes),
    agents: uniq(agents),
    skills: uniq(skills),
    phases,
    gates: policy.gates,
    blocked,
    execution_rule: blocked ? "BLOCK" : "PLAN_BUILD_JUDGE",
  };
}
