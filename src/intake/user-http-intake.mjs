import { GitHubIssueIntakeError, parseBoundedResearchIntakeJson } from './github-issue-intake.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PRINCIPAL = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;

export class UserHttpIntakeError extends Error {
  constructor(code) {
    super(`User HTTP intake rejected (${code})`);
    this.name = 'UserHttpIntakeError';
    this.code = code;
  }
}

export function requireUserHttpPrincipal(principalId) {
  if (typeof principalId !== 'string' || !PRINCIPAL.test(principalId)) {
    throw new TypeError('principalId must contain 1 to 64 letters, digits, underscores or hyphens');
  }
  return principalId;
}

export function userHttpIdempotencyKey({ principalId, requestId } = {}) {
  requireUserHttpPrincipal(principalId);
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new UserHttpIntakeError('REQUEST_ID_INVALID');
  return `user:http:${principalId}:${requestId}`;
}

export function parseUserHttpIntake({ body, requestId, principalId, now = () => new Date() } = {}) {
  const idempotencyKey = userHttpIdempotencyKey({ principalId, requestId });
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const instant = now();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new TypeError('now must return a valid Date');

  let parsed;
  try {
    parsed = parseBoundedResearchIntakeJson(body);
  } catch (error) {
    if (error instanceof GitHubIssueIntakeError) throw new UserHttpIntakeError(error.code);
    throw error;
  }
  if (parsed.deadline.ms > instant.getTime() + MAX_DEADLINE_MS) {
    throw new UserHttpIntakeError('DEADLINE_OUT_OF_RANGE');
  }
  // SQL rejects an expired NEW request, while allowing an exact persisted replay.
  const source = Object.freeze({ type: 'authenticated_http', principalId, requestId });
  return Object.freeze({
    source,
    idempotencyKey,
    goal: parsed.research.goal,
    requestPayload: Object.freeze({
      maxResults: parsed.research.maxResults,
      constraints: parsed.research.constraints,
      requiredFields: parsed.research.requiredFields,
      source,
    }),
    budgetLimitUsd: parsed.budgetLimitUsd,
    tokenBudgetLimit: parsed.tokenBudgetLimit,
    maxTotalSteps: parsed.maxTotalSteps,
    deadlineAt: parsed.deadline.iso,
  });
}

export async function persistUserHttpIntake({ body, requestId, principalId, kernel, now } = {}) {
  if (!kernel || typeof kernel.createLiteResearchTask !== 'function') {
    throw new TypeError('kernel.createLiteResearchTask must be a function');
  }
  const { source, ...contract } = parseUserHttpIntake({ body, requestId, principalId, now });
  const result = await kernel.createLiteResearchTask(contract);
  if (!result || typeof result.taskId !== 'string' || !UUID.test(result.taskId) || typeof result.created !== 'boolean') {
    throw new TypeError('kernel.createLiteResearchTask returned an invalid task result');
  }
  return Object.freeze({ taskId: result.taskId, created: result.created, idempotencyKey: contract.idempotencyKey, source });
}
