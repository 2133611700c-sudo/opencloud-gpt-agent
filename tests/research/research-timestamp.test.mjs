import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeResearchResult } from '../../src/research/research-contract.mjs';

const resultWithTimestamp = (checkedAt) => ({
  status: 'SUCCESS',
  summary: 'Timestamp validation.',
  confidence: 'HIGH',
  sources: [{
    id: 's1',
    url: 'https://example.com/item',
    checkedAt,
  }],
  items: [{
    id: 'i1',
    title: 'Item',
    data: {},
    sourceIds: ['s1'],
  }],
  needsBrowser: [],
});

test('rejects date-only evidence timestamp', () => {
  assert.throws(
    () => normalizeResearchResult(resultWithTimestamp('2026-10-11')),
    /explicit timezone/,
  );
});

test('rejects timestamp without timezone', () => {
  assert.throws(
    () => normalizeResearchResult(resultWithTimestamp('2026-10-11T17:30:00')),
    /explicit timezone/,
  );
});

test('accepts Z and offset timestamps', () => {
  assert.equal(
    normalizeResearchResult(resultWithTimestamp('2026-10-11T22:30:00Z')).sources[0].checkedAt,
    '2026-10-11T22:30:00.000Z',
  );
  assert.equal(
    normalizeResearchResult(resultWithTimestamp('2026-10-11T17:30:00-05:00')).sources[0].checkedAt,
    '2026-10-11T22:30:00.000Z',
  );
});
