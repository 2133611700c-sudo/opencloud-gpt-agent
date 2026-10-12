import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATA_RESULT_SCHEMA_VERSION,
  DataContractError,
  validateDataInput,
  validateDataOutput,
} from '../../src/data/data-contract.mjs';

const researchResult = () => ({
  status: 'SUCCESS',
  summary: 'Two sourced records.',
  confidence: 'HIGH',
  sources: [
    { id: 's1', url: 'https://example.com/a', title: 'A', checkedAt: '2026-10-12T19:00:00.000Z' },
    { id: 's2', url: 'https://example.com/b', title: 'B', checkedAt: '2026-10-12T19:01:00.000Z' },
  ],
  items: [
    { id: 'i1', title: 'One', data: { dealer: 'Dealer A', price: 42000, available: false }, sourceIds: ['s1'] },
    { id: 'i2', title: 'Two', data: { dealer: 'Dealer B', price: 43000, available: true }, sourceIds: ['s2'] },
  ],
  needsBrowser: [],
});

const output = () => ({
  schemaVersion: DATA_RESULT_SCHEMA_VERSION,
  status: 'SUCCESS',
  requiredFields: ['dealer', 'price'],
  sources: researchResult().sources,
  items: researchResult().items,
});

test('accepts Research SUCCESS input with required fields and valid source references', () => {
  const parsed = validateDataInput({
    requiredFields: ['dealer', 'price'],
    researchResult: researchResult(),
  });
  assert.equal(parsed.researchResult.status, 'SUCCESS');
  assert.deepEqual(parsed.requiredFields, ['dealer', 'price']);
  assert.equal(parsed.researchResult.items.length, 2);
});

test('rejects non-SUCCESS Research input', () => {
  const research = researchResult();
  research.status = 'NO_RESULTS';
  assert.throws(
    () => validateDataInput({ requiredFields: ['dealer'], researchResult: research }),
    (error) => error instanceof DataContractError && error.code === 'RESEARCH_NOT_SUCCESS',
  );
});

test('rejects an item missing a required field', () => {
  const research = researchResult();
  delete research.items[1].data.price;
  assert.throws(
    () => validateDataInput({ requiredFields: ['dealer', 'price'], researchResult: research }),
    (error) => error instanceof DataContractError && error.code === 'REQUIRED_FIELD_MISSING',
  );
});

test('treats false and zero as present required-field values', () => {
  const research = researchResult();
  research.items[0].data.price = 0;
  const parsed = validateDataInput({
    requiredFields: ['price', 'available'],
    researchResult: research,
  });
  assert.equal(parsed.researchResult.items[0].data.price, 0);
  assert.equal(parsed.researchResult.items[0].data.available, false);
});

test('rejects unknown source references', () => {
  const research = researchResult();
  research.items[0].sourceIds = ['missing'];
  assert.throws(
    () => validateDataInput({ requiredFields: [], researchResult: research }),
    (error) => error instanceof DataContractError && error.code === 'UNKNOWN_SOURCE_REFERENCE',
  );
});

test('rejects duplicate source ids and duplicate required fields', () => {
  const duplicateSource = researchResult();
  duplicateSource.sources[1].id = 's1';
  assert.throws(
    () => validateDataInput({ requiredFields: [], researchResult: duplicateSource }),
    (error) => error instanceof DataContractError && error.code === 'DUPLICATE_SOURCE_ID',
  );

  assert.throws(
    () => validateDataInput({ requiredFields: ['dealer', 'dealer'], researchResult: researchResult() }),
    (error) => error instanceof DataContractError && error.code === 'DUPLICATE_REQUIRED_FIELD',
  );
});

test('accepts the v1 deterministic Data output schema', () => {
  const parsed = validateDataOutput(output());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.status, 'SUCCESS');
  assert.equal(parsed.items.length, 2);
});

test('rejects unsupported output schema versions and unsourced output items', () => {
  const wrongVersion = output();
  wrongVersion.schemaVersion = 2;
  assert.throws(
    () => validateDataOutput(wrongVersion),
    (error) => error instanceof DataContractError && error.code === 'UNSUPPORTED_DATA_SCHEMA_VERSION',
  );

  const unsourced = output();
  unsourced.items[0].sourceIds = [];
  assert.throws(
    () => validateDataOutput(unsourced),
    (error) => error instanceof DataContractError && error.code === 'UNSOURCED_ITEM',
  );
});
