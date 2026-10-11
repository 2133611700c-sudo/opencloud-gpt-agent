import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ResearchContractError,
  canonicalHttpUrl,
  normalizeResearchRequest,
  normalizeResearchResult,
} from '../../src/research/research-contract.mjs';

const baseSource = (overrides = {}) => ({
  id: 'source-1',
  url: 'https://example.com/listing#details',
  title: 'Example listing',
  checkedAt: '2026-10-11T17:30:00-05:00',
  ...overrides,
});

const baseSuccess = (overrides = {}) => ({
  status: 'SUCCESS',
  summary: 'Verified result.',
  confidence: 'HIGH',
  sources: [baseSource()],
  items: [{
    id: 'item-1',
    title: 'Verified item',
    data: { price: 123 },
    sourceIds: ['source-1'],
  }],
  needsBrowser: [],
  ...overrides,
});

test('normalizes research request with bounded result count and unique required fields', () => {
  const result = normalizeResearchRequest({
    goal: ' Find five current listings ',
    maxResults: 5,
    constraints: { state: 'CA' },
    requiredFields: ['price', 'dealer', 'price'],
  });

  assert.equal(result.goal, 'Find five current listings');
  assert.equal(result.maxResults, 5);
  assert.deepEqual(result.constraints, { state: 'CA' });
  assert.deepEqual(result.requiredFields, ['price', 'dealer']);
  assert.ok(Object.isFrozen(result));
});

test('canonicalizes HTTP URLs without fragments and normalizes default ports', () => {
  assert.equal(
    canonicalHttpUrl('HTTPS://Example.COM:443/a?x=1#fragment'),
    'https://example.com/a?x=1',
  );
});

test('accepts a sourced SUCCESS result and canonicalizes source timestamp', () => {
  const result = normalizeResearchResult(baseSuccess());

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.sources[0].url, 'https://example.com/listing');
  assert.equal(result.sources[0].checkedAt, '2026-10-11T22:30:00.000Z');
  assert.deepEqual(result.items[0].sourceIds, ['source-1']);
});

test('rejects an unsourced research item', () => {
  assert.throws(
    () => normalizeResearchResult(baseSuccess({
      items: [{ id: 'item-1', title: 'No evidence', data: {}, sourceIds: [] }],
    })),
    (error) => error instanceof ResearchContractError && error.code === 'UNSOURCED_ITEM',
  );
});

test('rejects an item that references an unknown source', () => {
  assert.throws(
    () => normalizeResearchResult(baseSuccess({
      items: [{ id: 'item-1', title: 'Bad reference', data: {}, sourceIds: ['missing'] }],
    })),
    (error) => error instanceof ResearchContractError && error.code === 'UNKNOWN_SOURCE_REFERENCE',
  );
});

test('deduplicates identical canonical source URLs and rewrites aliases', () => {
  const result = normalizeResearchResult(baseSuccess({
    sources: [
      baseSource({ id: 'source-1', url: 'https://EXAMPLE.com/listing#one' }),
      baseSource({ id: 'source-2', url: 'https://example.com/listing#two' }),
    ],
    items: [{
      id: 'item-1',
      title: 'Same source twice',
      data: {},
      sourceIds: ['source-1', 'source-2'],
    }],
  }));

  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.items[0].sourceIds, ['source-1']);
});

test('rejects non-http source URLs', () => {
  assert.throws(
    () => normalizeResearchResult(baseSuccess({
      sources: [baseSource({ url: 'file:///etc/passwd' })],
    })),
    (error) => error instanceof ResearchContractError && error.code === 'INVALID_SOURCE_URL',
  );
});

test('NO_RESULTS cannot smuggle unsupported items', () => {
  assert.throws(
    () => normalizeResearchResult(baseSuccess({ status: 'NO_RESULTS' })),
    /NO_RESULTS must not contain items/,
  );
});

test('NEEDS_BROWSER requires a concrete URL and supported reason', () => {
  const result = normalizeResearchResult({
    status: 'NEEDS_BROWSER',
    summary: 'Dealer inventory requires JavaScript.',
    confidence: 'HIGH',
    sources: [],
    items: [],
    needsBrowser: [{
      url: 'https://dealer.example/inventory#cars',
      reason: 'JAVASCRIPT_REQUIRED',
      detail: 'web_fetch could not render inventory rows',
    }],
  });

  assert.equal(result.needsBrowser[0].url, 'https://dealer.example/inventory');
  assert.equal(result.needsBrowser[0].reason, 'JAVASCRIPT_REQUIRED');
});

test('NEEDS_BROWSER rejects vague escalation with no target', () => {
  assert.throws(
    () => normalizeResearchResult({
      status: 'NEEDS_BROWSER',
      summary: 'Need browser.',
      confidence: 'LOW',
      sources: [],
      items: [],
      needsBrowser: [],
    }),
    /requires at least one escalation entry/,
  );
});
