import assert from 'node:assert/strict';
import test from 'node:test';

import { persistGitHubIssueIntake } from '../../src/intake/github-issue-postgres-intake.mjs';
import { GitHubIssueIntakeError } from '../../src/intake/github-issue-intake.mjs';

const request = {
  schemaVersion: 1,
  goal: 'Find current OpenClaw V2 documentation.',
  maxResults: 3,
  constraints: { requiredDomains: ['github.com'] },
  requiredFields: ['title', 'sourceUrl'],
  budgetLimitUsd: '0.125000',
  tokenBudgetLimit: 12000,
  maxTotalSteps: 6,
  deadlineAt: '2026-10-15T01:00:00Z',
};

const event = () => ({
  action: 'opened',
  repository: { id: 1237196115, owner: { id: 237693146, login: 'owner' } },
  sender: { id: 237693146, login: 'owner' },
  issue: {
    id: 5857954999,
    number: 53,
    title: '[OPENCLAW V2] Verify intake binding',
    created_at: '2026-10-15T00:30:00Z',
    user: { id: 237693146, login: 'owner' },
    body: `\`\`\`openclaw-v2\n${JSON.stringify(request, null, 2)}\n\`\`\``,
  },
});

test('persists the normalized GitHub issue contract through one kernel create call', async () => {
  const calls = [];
  const kernel = {
    async createLiteResearchTask(input) {
      calls.push(input);
      return { taskId: 'task-1', created: true };
    },
  };
  const result = await persistGitHubIssueIntake({ event: event(), kernel });
  assert.deepEqual(result, {
    taskId: 'task-1',
    created: true,
    idempotencyKey: 'github:issue:1237196115:5857954999',
    source: { type: 'github_issue', repositoryId: 1237196115, issueId: 5857954999, issueNumber: 53, senderId: 237693146 },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    idempotencyKey: 'github:issue:1237196115:5857954999',
    goal: request.goal,
    requestPayload: {
      maxResults: 3,
      constraints: { requiredDomains: ['github.com'] },
      requiredFields: ['title', 'sourceUrl'],
      github: { repositoryId: 1237196115, issueId: 5857954999, issueNumber: 53 },
    },
    budgetLimitUsd: '0.125000',
    tokenBudgetLimit: 12000,
    maxTotalSteps: 6,
    deadlineAt: '2026-10-15T01:00:00.000Z',
  });
});

test('duplicate persistence preserves the same task identity and created=false', async () => {
  const kernel = { createLiteResearchTask: async () => ({ taskId: 'task-1', created: false }) };
  const result = await persistGitHubIssueIntake({ event: event(), kernel });
  assert.equal(result.taskId, 'task-1');
  assert.equal(result.created, false);
  assert.equal(result.idempotencyKey, 'github:issue:1237196115:5857954999');
});

test('invalid GitHub event fails before any database create call', async () => {
  let calls = 0;
  const kernel = { createLiteResearchTask: async () => { calls += 1; return { taskId: 'x', created: true }; } };
  const invalid = event();
  invalid.sender.id = 999;
  invalid.issue.user.id = 999;
  await assert.rejects(
    persistGitHubIssueIntake({ event: invalid, kernel }),
    (error) => error instanceof GitHubIssueIntakeError && error.code === 'SENDER_NOT_AUTHORIZED',
  );
  assert.equal(calls, 0);
});

test('fails closed when kernel persistence does not return a canonical result', async () => {
  await assert.rejects(
    persistGitHubIssueIntake({ event: event(), kernel: { createLiteResearchTask: async () => null } }),
    TypeError,
  );
  await assert.rejects(persistGitHubIssueIntake({ event: event(), kernel: {} }), TypeError);
});
