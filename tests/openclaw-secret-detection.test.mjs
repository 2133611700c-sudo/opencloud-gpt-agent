import test from "node:test";
import assert from "node:assert/strict";
import { detectSensitiveStrings, sanitizeForReport } from "../scripts/lib/openclaw-task-lib.mjs";

test("ordinary skill names are not classified as secrets", () => {
  const payload = {
    goal: "Route skills through skill-comply and skip unsafe work",
    metadata: { skills: ["skill-comply", "skill-router"] },
  };
  assert.deepEqual(detectSensitiveStrings(payload), []);
  assert.match(sanitizeForReport(payload), /skill-comply/);
});

test("actual sk-prefixed API keys remain blocked and redacted", () => {
  const token = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
  assert.deepEqual(detectSensitiveStrings({ token }), ["task contains a token-like secret"]);
  assert.doesNotMatch(sanitizeForReport({ token }), /sk-proj-/);
});
