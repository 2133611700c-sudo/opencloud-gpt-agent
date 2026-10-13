import assert from 'node:assert/strict';
import test from 'node:test';

import { DataContractError, validateDataOutput } from '../../src/data/data-contract.mjs';
import { transformData } from '../../src/data/data-transformer.mjs';

const input = () => ({
  requiredFields: [' price ', 'active'],
  researchResult: {
    status: 'SUCCESS',
    sources: [
      { id: ' s2 ', url: ' HTTPS://Example.COM:443/a?b=2&a=1&a=3#part ', title: ' Official A ', checkedAt: ' 2026-10-12T19:00:00.000Z ', metadata: { z: 2, a: 1 } },
      { id: 's1', url: 'https://example.com/a?b=2&a=1&a=3#part', title: 'Official A', checkedAt: '2026-10-12T19:00:00.000Z', metadata: { a: 1, z: 2 } },
      { id: 's9', url: 'https://example.com/unused', checkedAt: '2026-10-12T19:00:00.000Z' },
    ],
    items: [
      { id: ' i2 ', title: ' Result ', data: { price: -0, active: false, text: '  preserve \n', nested: { z: 2, a: 1 }, ordered: ['b', 'a'] }, sourceIds: [' s2 ', 's1'], extra: 'kept' },
      { id: 'i1', title: 'Result', data: { ordered: ['b', 'a'], nested: { a: 1, z: 2 }, text: '  preserve \n', active: false, price: 0 }, sourceIds: ['s1'], extra: 'kept' },
    ],
  },
});

const setOwn = (object, key, value) => Object.defineProperty(object, key, {
  value, enumerable: true, configurable: true, writable: true,
});
const reverseKeys = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reverseKeys);
  const object = {};
  for (const key of Object.keys(value).reverse()) setOwn(object, key, reverseKeys(value[key]));
  return object;
};
const invalidJson = (value) => {
  const changed = input();
  changed.researchResult.items[0].data.extra = value;
  return changed;
};
const rejectsJson = (value) => assert.throws(
  () => transformData(value),
  (error) => error instanceof DataContractError && error.code === 'INVALID_DATA_JSON' && error.path.startsWith('input'),
);

test('normalizes declared fields, deduplicates records, remaps aliases, and retains unused sources', () => {
  const output = transformData(input());
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.status, 'SUCCESS');
  assert.deepEqual(output.requiredFields, ['active', 'price']);
  assert.deepEqual(output.sources.map((source) => source.id), ['s1', 's9']);
  assert.equal(output.sources[0].url, 'https://example.com/a?b=2&a=1&a=3#part');
  assert.equal(output.sources[0].title, 'Official A');
  assert.equal(output.sources[0].checkedAt, '2026-10-12T19:00:00.000Z');
  assert.equal(output.items.length, 1);
  assert.equal(output.items[0].id, 'i1');
  assert.equal(output.items[0].title, 'Result');
  assert.deepEqual(output.items[0].sourceIds, ['s1']);
  assert.equal(output.items[0].extra, 'kept');
  assert.equal(output.items[0].data.active, false);
  assert.equal(Object.is(output.items[0].data.price, -0), false);
  assert.deepEqual(validateDataOutput(output), {
    schemaVersion: output.schemaVersion, status: output.status, requiredFields: output.requiredFields,
    items: output.items, sources: output.sources,
  });
});

test('input and record permutations produce byte-identical canonical output', () => {
  const original = input();
  const expected = JSON.stringify(transformData(original));
  for (let rotation = 0; rotation < original.researchResult.sources.length; rotation += 1) {
    const permuted = reverseKeys(input());
    const sources = permuted.researchResult.sources;
    permuted.researchResult.sources = [...sources.slice(rotation), ...sources.slice(0, rotation)].reverse();
    permuted.researchResult.items.reverse();
    permuted.researchResult.items.forEach((item) => item.sourceIds.reverse());
    permuted.requiredFields.reverse();
    assert.equal(JSON.stringify(transformData(permuted)), expected);
  }
  assert.deepEqual(Object.keys(transformData(original)), ['items', 'requiredFields', 'schemaVersion', 'sources', 'status']);
});

test('arbitrary content strings, field spellings, Unicode, case, and nested array order are preserved', () => {
  const changed = input();
  changed.researchResult.items[0].data[' spaced '] = '  value  ';
  changed.researchResult.items[0].data.Name = 'A';
  changed.researchResult.items[0].data.name = 'a';
  changed.researchResult.items[0].data['e\u0301'] = 'decomposed';
  changed.researchResult.items[0].data['\u00e9'] = 'composed';
  const output = transformData(changed);
  const record = output.items.find((item) => item.id === 'i2');
  assert.equal(record.data.text, '  preserve \n');
  assert.deepEqual(record.data.ordered, ['b', 'a']);
  assert.equal(record.data[' spaced '], '  value  ');
  assert.equal(record.data.Name, 'A');
  assert.equal(record.data.name, 'a');
  assert.equal(record.data['e\u0301'], 'decomposed');
  assert.equal(record.data['\u00e9'], 'composed');
  assert.equal(output.items.length, 2);
});

test('source observations differing in title, time, extra content, or URL semantics remain distinct', () => {
  for (const update of [
    { title: 'Another title' },
    { checkedAt: '2026-10-12T19:01:00.000Z' },
    { metadata: { a: 1, z: 3 } },
    { url: 'https://example.com/a?a=1&b=2&a=3#part' },
    { url: 'https://example.com/a?b=2&a=1&a=3#other' },
    { url: 'https://example.com/a/?b=2&a=1&a=3#part' },
    { url: 'http://example.com/a?b=2&a=1&a=3#part' },
    { url: 'https://example.com/a?b=2&a=1#part' },
  ]) {
    const changed = input();
    Object.assign(changed.researchResult.sources[0], update);
    assert.equal(transformData(changed).sources.length, 3, JSON.stringify(update));
  }
});

test('missing and null optional source titles remain distinct and are preserved', () => {
  const changed = input();
  delete changed.researchResult.sources[0].title;
  changed.researchResult.sources[1].title = null;
  const output = transformData(changed);
  assert.equal(output.sources.length, 3);
  assert.equal(Object.hasOwn(output.sources.find((source) => source.id === 's2'), 'title'), false);
  assert.equal(output.sources.find((source) => source.id === 's1').title, null);
});

test('identical content with distinct provenance or record extras is retained', () => {
  const changed = input();
  changed.researchResult.items[0].sourceIds = ['s9'];
  let output = transformData(changed);
  assert.equal(output.items.length, 2);
  assert.deepEqual(output.items.map((item) => item.sourceIds), [['s1'], ['s9']]);
  changed.researchResult.items[0].sourceIds = ['s1'];
  changed.researchResult.items[0].extra = 'different';
  output = transformData(changed);
  assert.equal(output.items.length, 2);
});

test('source reference sets are remapped, deduplicated, and stably sorted', () => {
  const changed = input();
  changed.researchResult.items[0].sourceIds = ['s9', 's2', 's1'];
  changed.researchResult.items[1].sourceIds = ['s1', 's9'];
  const output = transformData(changed);
  assert.equal(output.items.length, 1);
  assert.deepEqual(output.items[0].sourceIds, ['s1', 's9']);
});

test('zero, false, and string zero remain valid distinct required-field values', () => {
  const changed = input();
  changed.requiredFields = ['price'];
  changed.researchResult.items = [0, false, '0'].map((price, index) => ({
    id: `i${index}`, title: 'Value', data: { price }, sourceIds: ['s1'],
  }));
  const output = transformData(changed);
  assert.deepEqual(output.items.map((item) => item.data.price), [0, false, '0']);
});

test('true Unicode codepoint order chooses representative ids and object keys', () => {
  const changed = input();
  changed.researchResult.sources[0].id = '\u{10000}';
  changed.researchResult.sources[1].id = '\ue000';
  changed.researchResult.items[0].id = '\u{10000}';
  changed.researchResult.items[1].id = '\ue000';
  changed.researchResult.items[0].sourceIds = ['\u{10000}'];
  changed.researchResult.items[1].sourceIds = ['\ue000'];
  for (const item of changed.researchResult.items) {
    item.data.unicode = { '\u{10000}': 1, '\ue000': 2, a: 3, A: 4 };
  }
  const output = transformData(changed);
  assert.deepEqual(output.sources.map((source) => source.id), ['s9', '\ue000']);
  assert.equal(output.items[0].id, '\ue000');
  assert.deepEqual(Object.keys(output.items[0].data.unicode), ['A', 'a', '\ue000', '\u{10000}']);
});

test('own __proto__ and constructor keys are preserved without prototype mutation', () => {
  const changed = input();
  for (const item of changed.researchResult.items) {
    item.data.special = JSON.parse('{"__proto__":{"polluted":true},"constructor":"content","10":10,"2":2}');
  }
  const output = transformData(changed);
  const special = output.items[0].data.special;
  assert.equal(output.items.length, 1);
  assert.equal(Object.hasOwn(special, '__proto__'), true);
  assert.deepEqual(special.__proto__, { polluted: true });
  assert.equal(special.constructor, 'content');
  assert.equal(special.polluted, undefined);
  assert.equal(Object.getPrototypeOf(special), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('prototype-shaped ids and required fields remain ordinary own content', () => {
  const changed = input();
  changed.requiredFields = ['__proto__', 'constructor', 'toString'];
  changed.researchResult.sources[0].id = '__proto__';
  changed.researchResult.sources[1].id = 'constructor';
  changed.researchResult.items[0].id = '__proto__';
  changed.researchResult.items[1].id = 'constructor';
  changed.researchResult.items[0].sourceIds = ['__proto__'];
  changed.researchResult.items[1].sourceIds = ['constructor'];
  for (const item of changed.researchResult.items) {
    item.data = JSON.parse('{"__proto__":0,"constructor":false,"toString":"0"}');
  }
  const output = transformData(changed);
  assert.equal(output.items.length, 1);
  assert.equal(output.items[0].id, '__proto__');
  assert.deepEqual(output.items[0].sourceIds, ['__proto__']);
  assert.deepEqual(output.items[0].data, JSON.parse('{"__proto__":0,"constructor":false,"toString":"0"}'));
  assert.equal(Object.getPrototypeOf(output.items[0].data), Object.prototype);
});

test('shared references and null-prototype JSON objects are accepted as independent content', () => {
  const changed = input();
  const shared = Object.create(null);
  shared.z = 2;
  shared.a = 1;
  for (const item of changed.researchResult.items) item.data.shared = { one: shared, two: shared };
  const output = transformData(changed);
  assert.equal(output.items.length, 1);
  assert.deepEqual(output.items[0].data.shared, { one: { a: 1, z: 2 }, two: { a: 1, z: 2 } });
  assert.notEqual(output.items[0].data.shared.one, output.items[0].data.shared.two);
});

test('transformation does not mutate or retain aliases into the input and is idempotent', () => {
  const original = input();
  const before = structuredClone(original);
  const output = transformData(original);
  assert.deepEqual(original, before);
  const repeated = transformData({
    requiredFields: output.requiredFields,
    researchResult: { status: 'SUCCESS', sources: output.sources, items: output.items },
  });
  assert.equal(JSON.stringify(repeated), JSON.stringify(output));
  output.items[0].data.nested.a = 999;
  assert.deepEqual(original, before);
});

test('frozen valid input is accepted', () => {
  const original = input();
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  assert.equal(transformData(freeze(original)).items.length, 1);
});

test('undefined, non-finite numbers, bigint, functions, and symbols are rejected before lossy cloning', () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => {}, Symbol('value')]) {
    rejectsJson(invalidJson(value));
  }
});

test('custom instances and custom array prototypes are rejected', () => {
  class Custom {}
  class CustomArray extends Array {}
  for (const value of [new Date(), new Map(), new Set(), /pattern/, new Uint8Array([1]), new Number(1), new Custom(), new CustomArray(1)]) {
    rejectsJson(invalidJson(value));
  }
});

test('object and array cycles are rejected', () => {
  const object = {};
  object.self = object;
  const array = [];
  array.push(array);
  rejectsJson(invalidJson(object));
  rejectsJson(invalidJson(array));
});

test('sparse arrays and named extra array properties are rejected', () => {
  const sparse = [1, , 3];
  const extra = [1];
  extra.named = 2;
  const nonIndex = [1];
  nonIndex['01'] = 2;
  for (const value of [sparse, extra, nonIndex]) rejectsJson(invalidJson(value));
});

test('symbol and non-enumerable properties are rejected on objects and arrays', () => {
  for (const value of [{}, [1]]) {
    value[Symbol('hidden')] = true;
    rejectsJson(invalidJson(value));
  }
  const hiddenObject = {};
  Object.defineProperty(hiddenObject, 'hidden', { value: true });
  const hiddenArray = [1];
  Object.defineProperty(hiddenArray, '0', { value: 1, enumerable: false });
  rejectsJson(invalidJson(hiddenObject));
  rejectsJson(invalidJson(hiddenArray));
});

test('accessors on contract fields, extras, and arrays are rejected without invoking getters', () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error('must not execute'); };
  const contractAccessor = input();
  Object.defineProperty(contractAccessor.researchResult.sources[0], 'url', { get: getter, enumerable: true });
  rejectsJson(contractAccessor);
  const extraAccessor = {};
  Object.defineProperty(extraAccessor, 'value', { get: getter, enumerable: true });
  rejectsJson(invalidJson(extraAccessor));
  const arrayAccessor = [1];
  Object.defineProperty(arrayAccessor, '0', { get: getter, enumerable: true });
  rejectsJson(invalidJson(arrayAccessor));
  assert.equal(calls, 0);
});

test('invalid Research status, sources, items, and required fields remain fail-closed', () => {
  const cases = [
    ['RESEARCH_NOT_SUCCESS', (changed) => { changed.researchResult.status = 'FAIL_WITH_EVIDENCE'; }],
    ['SOURCES_REQUIRED', (changed) => { changed.researchResult.sources = []; }],
    ['ITEMS_REQUIRED', (changed) => { changed.researchResult.items = []; }],
    ['INVALID_SOURCE_URL', (changed) => { changed.researchResult.sources[0].url = 'file:///tmp/source'; }],
    ['DUPLICATE_SOURCE_ID', (changed) => { changed.researchResult.sources[0].id = ' s1 '; }],
    ['DUPLICATE_ITEM_ID', (changed) => { changed.researchResult.items[0].id = ' i1 '; }],
    ['DUPLICATE_REQUIRED_FIELD', (changed) => { changed.requiredFields = ['price', ' price ']; }],
    ['DUPLICATE_ITEM_SOURCE', (changed) => { changed.researchResult.items[0].sourceIds = ['s1', ' s1 ']; }],
    ['UNKNOWN_SOURCE_REFERENCE', (changed) => { changed.researchResult.items[0].sourceIds = ['missing']; }],
    ['UNSOURCED_ITEM', (changed) => { changed.researchResult.items[0].sourceIds = []; }],
    ['REQUIRED_FIELD_MISSING', (changed) => { changed.researchResult.items[0].data.price = null; }],
    ['REQUIRED_FIELD_MISSING', (changed) => { changed.researchResult.items[0].data.price = '  '; }],
    ['REQUIRED_FIELD_MISSING', (changed) => { delete changed.researchResult.items[0].data.price; }],
  ];
  for (const [code, mutate] of cases) {
    const changed = input();
    mutate(changed);
    assert.throws(() => transformData(changed), (error) => error instanceof DataContractError && error.code === code, code);
  }
});
