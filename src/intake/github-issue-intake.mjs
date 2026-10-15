import { normalizeResearchRequest } from '../research/research-contract.mjs';

const TITLE_PREFIX = '[OPENCLAW V2]';
const ISSUE_BLOCK = /^\s*```openclaw-v2\s*\n([\s\S]*?)\n```\s*$/;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SENSITIVE_KEY = /(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|credential|private[_-]?key)/i;
const ALLOWED_REQUEST_KEYS = new Set([
  'schemaVersion',
  'goal',
  'maxResults',
  'constraints',
  'requiredFields',
  'budgetLimitUsd',
  'tokenBudgetLimit',
  'maxTotalSteps',
  'deadlineAt',
]);

const MAX_BODY_BYTES = 20_000;
const MAX_BUDGET_MICROS = 1_000_000n;
const MAX_TOKEN_BUDGET = 200_000;
const MAX_TOTAL_STEPS = 50;
const MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;

export class GitHubIssueIntakeError extends Error {
  constructor(code) {
    super(`GitHub issue intake rejected (${code})`);
    this.name = 'GitHubIssueIntakeError';
    this.code = code;
  }
}

const fail = (code) => { throw new GitHubIssueIntakeError(code); };

const object = (value, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
};

const positiveInteger = (value, code) => {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
};

const parseUsdMicros = (value) => {
  if (typeof value !== 'string') fail('BUDGET_INVALID');
  const match = DECIMAL.exec(value);
  if (!match) fail('BUDGET_INVALID');
  const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (micros > MAX_BUDGET_MICROS) fail('BUDGET_EXCEEDS_INTAKE_CAP');
  return `${micros / 1_000_000n}.${String(micros % 1_000_000n).padStart(6, '0')}`;
};

const parseInstant = (value, code) => {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) fail(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(code);
  return { ms, iso: new Date(ms).toISOString() };
};

const rejectSensitiveKeys = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null || typeof value !== 'object') return;
  if (depth > 32 || seen.has(value)) fail('REQUEST_JSON_INVALID');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) rejectSensitiveKeys(item, depth + 1, seen);
      return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail('REQUEST_JSON_INVALID');
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) fail('SENSITIVE_REQUEST_KEY');
      rejectSensitiveKeys(item, depth + 1, seen);
    }
  } finally {
    seen.delete(value);
  }
};

const parseBodyRequest = (body) => {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) fail('BODY_INVALID');
  const match = ISSUE_BLOCK.exec(body);
  if (!match) fail('BODY_FORMAT_INVALID');

  return parseBoundedResearchIntakeJson(match[1]);
};

// Shared request validation; this function creates no GitHub source identity.
export function parseBoundedResearchIntakeJson(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) fail('BODY_INVALID');
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    fail('REQUEST_JSON_INVALID');
  }
  object(raw, 'REQUEST_OBJECT_REQUIRED');
  for (const key of Object.keys(raw)) if (!ALLOWED_REQUEST_KEYS.has(key)) fail('REQUEST_KEY_UNSUPPORTED');
  rejectSensitiveKeys(raw);
  if (raw.schemaVersion !== 1) fail('SCHEMA_VERSION_UNSUPPORTED');

  let research;
  try {
    research = normalizeResearchRequest({
      goal: raw.goal,
      maxResults: raw.maxResults,
      constraints: raw.constraints,
      requiredFields: raw.requiredFields,
    });
  } catch {
    fail('RESEARCH_REQUEST_INVALID');
  }

  const budgetLimitUsd = parseUsdMicros(raw.budgetLimitUsd);
  if (!Number.isSafeInteger(raw.tokenBudgetLimit) || raw.tokenBudgetLimit < 1 || raw.tokenBudgetLimit > MAX_TOKEN_BUDGET) {
    fail('TOKEN_BUDGET_INVALID');
  }
  if (!Number.isSafeInteger(raw.maxTotalSteps) || raw.maxTotalSteps < 1 || raw.maxTotalSteps > MAX_TOTAL_STEPS) {
    fail('STEP_BUDGET_INVALID');
  }
  const deadline = parseInstant(raw.deadlineAt, 'DEADLINE_INVALID');

  return Object.freeze({ research, budgetLimitUsd, tokenBudgetLimit: raw.tokenBudgetLimit, maxTotalSteps: raw.maxTotalSteps, deadline });
}

export function parseGitHubIssueIntake(event) {
  const root = object(event, 'EVENT_INVALID');
  if (root.action !== 'opened') fail('ACTION_UNSUPPORTED');

  const repository = object(root.repository, 'REPOSITORY_INVALID');
  const repositoryId = positiveInteger(repository.id, 'REPOSITORY_ID_INVALID');
  const owner = object(repository.owner, 'REPOSITORY_OWNER_INVALID');
  const ownerId = positiveInteger(owner.id, 'REPOSITORY_OWNER_ID_INVALID');

  const sender = object(root.sender, 'SENDER_INVALID');
  const senderId = positiveInteger(sender.id, 'SENDER_ID_INVALID');
  if (senderId !== ownerId) fail('SENDER_NOT_AUTHORIZED');

  const issue = object(root.issue, 'ISSUE_INVALID');
  if (Object.hasOwn(issue, 'pull_request')) fail('PULL_REQUEST_UNSUPPORTED');
  const issueId = positiveInteger(issue.id, 'ISSUE_ID_INVALID');
  const issueNumber = positiveInteger(issue.number, 'ISSUE_NUMBER_INVALID');
  const issueUser = object(issue.user, 'ISSUE_USER_INVALID');
  if (positiveInteger(issueUser.id, 'ISSUE_USER_ID_INVALID') !== senderId) fail('ISSUE_AUTHOR_MISMATCH');
  if (typeof issue.title !== 'string' || !issue.title.startsWith(TITLE_PREFIX)) fail('TITLE_NOT_OPTED_IN');

  const created = parseInstant(issue.created_at, 'ISSUE_CREATED_AT_INVALID');
  const parsed = parseBodyRequest(issue.body);
  if (parsed.deadline.ms <= created.ms || parsed.deadline.ms - created.ms > MAX_DEADLINE_MS) fail('DEADLINE_OUT_OF_RANGE');

  const idempotencyKey = `github:issue:${repositoryId}:${issueId}`;
  if (idempotencyKey.length > 128) fail('IDEMPOTENCY_KEY_TOO_LONG');

  const requestPayload = Object.freeze({
    maxResults: parsed.research.maxResults,
    constraints: parsed.research.constraints,
    requiredFields: parsed.research.requiredFields,
    github: Object.freeze({ repositoryId, issueId, issueNumber }),
  });

  return Object.freeze({
    source: Object.freeze({ type: 'github_issue', repositoryId, issueId, issueNumber, senderId }),
    idempotencyKey,
    goal: parsed.research.goal,
    requestPayload,
    budgetLimitUsd: parsed.budgetLimitUsd,
    tokenBudgetLimit: parsed.tokenBudgetLimit,
    maxTotalSteps: parsed.maxTotalSteps,
    deadlineAt: parsed.deadline.iso,
  });
}
