import test from "node:test";
import assert from "node:assert/strict";
import { buildOrchestrationPlan } from "../scripts/lib/openclaw-ecc-router.mjs";

test("routes JS agent repair through repair, security, review and max reasoning", () => {
  const plan = buildOrchestrationPlan({
    id: "T-AGENT-FIX",
    type: "repo_patch",
    goal: "Fix broken OpenClaw agent tool-call orchestration and add regression tests",
    allowed_paths: ["scripts/agent.ts", "tests/agent.test.ts"],
    params: {},
    safety: { customer_action: false, public_posting: false, paid_ads_change: false, destructive_action: false },
  });
  assert.equal(plan.model_route.primary, "deepseek/deepseek-flash");
  assert.equal(plan.model_route.reasoning_effort, "max");
  assert.ok(plan.lanes.includes("repair"));
  assert.ok(plan.agents.includes("build-error-resolver"));
  assert.ok(plan.agents.includes("typescript-reviewer"));
  assert.ok(plan.agents.includes("security-reviewer"));
  assert.ok(plan.agents.includes("agent-evaluator"));
  assert.ok(plan.skills.includes("agent-security-hardening"));
  assert.ok(plan.skills.includes("verification-loop"));
  assert.equal(plan.blocked, false);
});

test("routes vision to canonical DeepSeek V4.1 Flash", () => {
  const plan = buildOrchestrationPlan({
    id: "T-VISION",
    type: "virtual_browser_audit",
    goal: "Audit screenshot layout",
    params: { image: true },
    safety: {},
  });
  assert.equal(plan.classification.usesVision, true);
  assert.equal(plan.model_route.primary, "deepseek/deepseek-flash");
});

test("simple heartbeat stays low effort but keeps independent judge", () => {
  const plan = buildOrchestrationPlan({
    id: "T-HB",
    type: "heartbeat",
    goal: "Check worker heartbeat only",
    params: {},
    safety: {},
  });
  assert.equal(plan.model_route.reasoning_effort, "low");
  assert.ok(plan.agents.includes("agent-evaluator"));
});

test("unsafe external action fails closed", () => {
  const plan = buildOrchestrationPlan({
    id: "T-BLOCK",
    type: "repo_patch",
    goal: "Post customer message",
    params: {},
    safety: { customer_action: true, public_posting: false, paid_ads_change: false, destructive_action: false },
  });
  assert.equal(plan.blocked, true);
  assert.equal(plan.execution_rule, "BLOCK");
});
