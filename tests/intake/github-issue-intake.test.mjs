import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubIssueIntakeError, parseGitHubIssueIntake } from '../../src/intake/github-issue-intake.mjs';

const request = {
  schemaVersion: 1,
  goal: 'Find 5 current Toyota Highlander Hybrid XLE 2026 listings in California.',
  maxResults: 5,
  constraints: { region: 'CA', requiredDomains: ['toyota.com'] },
  requiredFields: ['dealer', 'price', 'sourceUrl', 'verificationDate'],
  budgetLimitUsd: '0.250000',
  tokenBudgetLimit: 50000,
  maxTotalSteps: 10,
  deadlineAt: '2026-10-15T01:00:00Z',
};

const event = (overrides = {}) => ({
  action: 'opened',
  repository: {
    id: 1237196115,
    owner: { id: 237693146, login: 'owner' },
  },
  sender: { id: 237693146, login: 'owner' },
  issue: {
    id: 5857954921,
    number: 52,
    title: '[OPENCLAW V2] Find Highlander listings',
    created_at: '2026-10-15T00:30:00Z',
    user: { id: 237693146, login: 'owner' },
    body: `\`\`\`openclaw-v2\n${JSON.stringify(request, null, 2)}\n\`\`\``,
  },
  ...overrides,
});

const rejectedWith = (fn, code) => assert.throws(fn, (error) => error instanceof GitHubIssueIntakeError && error.code === code);

test('normalizes an owner-opened GitHub issue into one stable lite task contract', () => {
  const result = parseGitHubIssueIntake(event());
  assert.equal(result.idempotencyKey, 'github:issue:1237196115:5857954921');
  assert.equal(result.goal, request.goal);
  assert.equal(result.budgetLimitUsd, '0.250000');
  assert.equal(result.tokenBudgetLimit, 50000);
  assert.equal(result.maxTotalSteps, 10);
  assert.equal(result.deadlineAt, '2026-10-15T01:00:00.000Z');
  assert.deepEqual(result.requestPayload, {
    maxResults: 5,
    constraints: { region: 'CA', requiredDomains: ['toyota.com'] },
    requiredFields: ['dealer', 'price', 'sourceUrl', 'verificationDate'],
    github: { repositoryId: 1237196115, issueId: 5857954921, issueNumber: 52 },
  });
});

test('duplicate delivery produces a deep-equal deterministic task contract', () => {
  const first = parseGitHubIssueIntake(event());
  const second = parseGitHubIssueIntake(structuredClone(event()));
  assert.deepEqual(second, first);
});

test('JSON property order and duplicate required fields normalize canonically', () => {
  const altered = structuredClone(request);
  altered.requiredFields = ['dealer', 'price', 'dealer'];
  const e = event();
  e.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({
    deadlineAt: altered.deadlineAt,
    maxTotalSteps: altered.maxTotalSteps,
    tokenBudgetLimit: altered.tokenBudgetLimit,
    budgetLimitUsd: altered.budgetLimitUsd,
    requiredFields: altered.requiredFields,
    constraints: altered.constraints,
    maxResults: altered.maxResults,
    goal: altered.goal,
    schemaVersion: 1,
  })}\n\`\`\``;
  const result = parseGitHubIssueIntake(e);
  assert.deepEqual(result.requestPayload.requiredFields, ['dealer', 'price']);
});

test('rejects non-owner senders before any task contract is produced', () => {
  const e = event();
  e.sender.id = 999;
  e.issue.user.id = 999;
  rejectedWith(() => parseGitHubIssueIntake(e), 'SENDER_NOT_AUTHORIZED');
});

test('rejects issue author mismatch, PR payloads and non-opened actions', () => {
  const mismatch = event();
  mismatch.issue.user.id = 999;
  rejectedWith(() => parseGitHubIssueIntake(mismatch), 'ISSUE_AUTHOR_MISMATCH');

  const pr = event();
  pr.issue.pull_request = { url: 'https://api.github.com/example' };
  rejectedWith(() => parseGitHubIssueIntake(pr), 'PULL_REQUEST_UNSUPPORTED');

  const edited = event({ action: 'edited' });
  rejectedWith(() => parseGitHubIssueIntake(edited), 'ACTION_UNSUPPORTED');
});

test('requires explicit title opt-in and a body consisting only of one fenced request', () => {
  const title = event();
  title.issue.title = 'Normal issue';
  rejectedWith(() => parseGitHubIssueIntake(title), 'TITLE_NOT_OPTED_IN');

  const prose = event();
  prose.issue.body = `Please run this\n${prose.issue.body}`;
  rejectedWith(() => parseGitHubIssueIntake(prose), 'BODY_FORMAT_INVALID');
});

test('rejects unknown and sensitive keys recursively', () => {
  const unknown = event();
  unknown.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, surprise: true })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(unknown), 'REQUEST_KEY_UNSUPPORTED');

  const sensitive = event();
  sensitive.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, constraints: { apiKey: 'do-not-accept' } })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(sensitive), 'SENSITIVE_REQUEST_KEY');
});

test('enforces bounded execution controls and deadline anchored to immutable issue creation time', () => {
  const tooMuch = event();
  tooMuch.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, budgetLimitUsd: '1.000001' })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(tooMuch), 'BUDGET_EXCEEDS_INTAKE_CAP');

  const tooManyTokens = event();
  tooManyTokens.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, tokenBudgetLimit: 200001 })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(tooManyTokens), 'TOKEN_BUDGET_INVALID');

  const tooManySteps = event();
  tooManySteps.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, maxTotalSteps: 51 })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(tooManySteps), 'STEP_BUDGET_INVALID');

  const beforeCreation = event();
  beforeCreation.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, deadlineAt: '2026-10-15T00:29:59Z' })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(beforeCreation), 'DEADLINE_OUT_OF_RANGE');

  const beyondDay = event();
  beyondDay.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify({ ...request, deadlineAt: '2026-10-16T00:30:01Z' })}\n\`\`\``;
  rejectedWith(() => parseGitHubIssueIntake(beyondDay), 'DEADLINE_OUT_OF_RANGE');
});
