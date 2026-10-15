import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPhoneResult } from '../../src/phone/phone-result.mjs';

const deepLogUrl = 'https://github.com/2133611700c-sudo/opencloud-gpt-agent/actions/runs/123456789';

const freezeRecursively = (value) => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeRecursively);
    Object.freeze(value);
  }
  return value;
};

const successEvidence = () => ({
  task: {
    status: 'SUCCESS',
    terminalReason: 'ALL_NODES_SUCCEEDED',
    currentCostUsd: '0.000003',
    reservedCostUsd: '0.000000',
    reservedTokens: '0',
    currentSteps: 2,
  },
  nodes: [
    {
      nodeKey: 'research',
      status: 'SUCCESS',
      error: null,
      result: { status: 'SUCCESS' },
    },
    {
      nodeKey: 'data',
      status: 'SUCCESS',
      error: null,
      result: {
        status: 'SUCCESS',
        items: Array.from({ length: 7 }, (_, index) => ({
          id: `item-${index + 1}`,
          title: `Listing ${index + 1}`,
          data: {
            dealer: `Dealer ${index + 1}`,
            price: 42000 + index,
            verified: true,
            apiKey: `must-not-leak-${index + 1}`,
          },
          sourceIds: [`source-${index + 1}`],
        })),
      },
    },
  ],
  accounting: [{ costUsd: '0.000003' }],
  reservations: [{ status: 'RECONCILED' }],
  attemptCounters: { totalAttempts: '2' },
});

const failureEvidence = () => ({
  task: {
    status: 'FAIL_WITH_EVIDENCE',
    terminalReason: 'NODE_FAILED',
    currentCostUsd: '0.000003',
    reservedCostUsd: '0.000000',
    reservedTokens: '0',
    currentSteps: 1,
  },
  nodes: [
    {
      nodeKey: 'research',
      status: 'FAIL_WITH_EVIDENCE',
      error: { code: 'UNRESOLVED_WEB_TOOL_FAILURE' },
      result: null,
    },
    {
      nodeKey: 'data',
      status: 'BLOCKED',
      error: null,
      result: null,
    },
  ],
  accounting: [{ costUsd: '0.000003' }],
  reservations: [{ status: 'RECONCILED' }],
  attemptCounters: { totalAttempts: '1' },
});

test('formats SUCCESS from production Data with at most five phone result lines', () => {
  const result = formatPhoneResult({ evidence: successEvidence(), deepLogUrl });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.lines[0], '[SUCCESS]');
  const itemLines = result.lines.filter((line) => /^\d+\./.test(line));
  assert.equal(itemLines.length, 5);
  assert.match(itemLines[0], /Listing 1/);
  assert.match(itemLines[0], /dealer=Dealer 1/);
  assert.match(itemLines[0], /price=42000/);
  assert.doesNotMatch(result.text, /must-not-leak/);
  assert.match(result.text, /Cost: \$0\.000003/);
  assert.match(result.text, /Attempts: 2/);
  assert.match(result.text, /Deep log: https:\/\/github\.com\//);
});

test('formats FAIL_WITH_EVIDENCE with reason, progress and proof that paid work is closed', () => {
  const result = formatPhoneResult({ evidence: failureEvidence(), deepLogUrl });
  assert.equal(result.lines[0], '[FAIL_WITH_EVIDENCE]');
  assert.match(result.text, /Reason: NODE_FAILED \/ UNRESOLVED_WEB_TOOL_FAILURE/);
  assert.match(result.text, /Progress: 0\/2 nodes succeeded; steps=1/);
  assert.match(result.text, /Further calls: blocked by terminal task; unresolved reservations=0/);
  assert.match(result.text, /Cost: \$0\.000003/);
  assert.match(result.text, /Attempts: 1/);
});

test('formats recursively frozen SUCCESS Evidence without mutation', () => {
  const evidence = freezeRecursively(successEvidence());
  const before = structuredClone(evidence);
  const result = formatPhoneResult({ evidence, deepLogUrl });
  assert.equal(result.status, 'SUCCESS');
  assert.match(result.text, /Listing 1/);
  assert.deepEqual(evidence, before);
});

test('formats recursively frozen FAIL_WITH_EVIDENCE without mutation', () => {
  const evidence = freezeRecursively(failureEvidence());
  const before = structuredClone(evidence);
  const result = formatPhoneResult({ evidence, deepLogUrl });
  assert.equal(result.status, 'FAIL_WITH_EVIDENCE');
  assert.match(result.text, /Further calls: blocked by terminal task; unresolved reservations=0/);
  assert.deepEqual(evidence, before);
});

test('rejects task/accounting cost mismatch', () => {
  const evidence = successEvidence();
  evidence.accounting[0].costUsd = '0.000004';
  assert.throws(() => formatPhoneResult({ evidence, deepLogUrl }), /cost does not match accounting total/);
});

test('rejects non-terminal task state', () => {
  const evidence = successEvidence();
  evidence.task.status = 'RUNNING';
  assert.throws(() => formatPhoneResult({ evidence, deepLogUrl }), /terminal SUCCESS or FAIL_WITH_EVIDENCE/);
});

test('rejects failure output when unresolved reservation evidence exists', () => {
  const evidence = failureEvidence();
  evidence.reservations.push({ status: 'RESERVED' });
  assert.throws(() => formatPhoneResult({ evidence, deepLogUrl }), /cannot prove zero further paid calls/);
});

test('rejects failure output while task-level reserved budget remains', () => {
  const evidence = failureEvidence();
  evidence.task.reservedCostUsd = '0.100000';
  assert.throws(() => formatPhoneResult({ evidence, deepLogUrl }), /cannot prove zero further paid calls/);
});

test('requires production Data items for SUCCESS', () => {
  const evidence = successEvidence();
  evidence.nodes.find((node) => node.nodeKey === 'data').result.items = [];
  assert.throws(() => formatPhoneResult({ evidence, deepLogUrl }), /requires production Data items/);
});

test('requires public https deep-log links without embedded credentials', () => {
  const evidence = successEvidence();
  for (const bad of [
    'http://example.com/log',
    'https://user:pass@example.com/log',
    'https://localhost/log',
    'https://127.0.0.1/log',
    'https://192.168.1.9/log',
  ]) {
    assert.throws(() => formatPhoneResult({ evidence, deepLogUrl: bad }));
  }
});
