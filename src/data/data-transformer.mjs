import {
  DATA_RESULT_SCHEMA_VERSION,
  DataContractError,
  validateDataInput,
  validateDataOutput,
} from './data-contract.mjs';

const compareCodepoints = (left, right) => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
};

const sortedKeys = (value) => Object.keys(value).sort(compareCodepoints);
const setOwn = (object, key, value) => Object.defineProperty(object, key, {
  value, enumerable: true, configurable: true, writable: true,
});

const invalidJson = (path, detail) => {
  throw new DataContractError(`${path} must contain finite plain JSON: ${detail}`, {
    code: 'INVALID_DATA_JSON', path,
  });
};

// Inspect descriptors before reading values, so rejected accessors are never called.
const cloneJson = (value, path = 'input', ancestors = new WeakSet()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidJson(path, 'non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') invalidJson(path, `unsupported ${typeof value}`);
  if (ancestors.has(value)) invalidJson(path, 'cyclic reference');

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    invalidJson(path, 'custom object prototype');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (typeof key !== 'string') invalidJson(path, 'symbol property');
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) invalidJson(`${path}[${JSON.stringify(key)}]`, 'accessor property');
    if (!(array && key === 'length') && !descriptor.enumerable) {
      invalidJson(`${path}[${JSON.stringify(key)}]`, 'non-enumerable property');
    }
  }

  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      if (keys.length !== length + 1) invalidJson(path, 'sparse array or extra array property');
      for (const key of keys) {
        if (key === 'length') continue;
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
          invalidJson(`${path}[${JSON.stringify(key)}]`, 'extra array property');
        }
      }
      return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(descriptors, String(index))) invalidJson(`${path}[${index}]`, 'sparse array');
        return cloneJson(descriptors[index].value, `${path}[${index}]`, ancestors);
      });
    }

    const cloned = Object.create(null);
    for (const key of keys.sort(compareCodepoints)) {
      setOwn(cloned, key, cloneJson(descriptors[key].value, `${path}[${JSON.stringify(key)}]`, ancestors));
    }
    return cloned;
  } finally {
    ancestors.delete(value);
  }
};

const canonicalObject = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalObject);
  const object = {};
  for (const key of sortedKeys(value)) setOwn(object, key, canonicalObject(value[key]));
  return object;
};

// Explicit serialization also orders integer-like keys for duplicate comparison.
const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${sortedKeys(value).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

const recordKey = (record) => {
  const content = Object.create(null);
  for (const key of sortedKeys(record)) {
    if (key !== 'id') setOwn(content, key, record[key]);
  }
  return canonicalJson(content);
};

const deduplicate = (records) => {
  const groups = new Map();
  for (const record of records) {
    const key = recordKey(record);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { representative: record, ids: [record.id] });
    } else {
      existing.ids.push(record.id);
      if (compareCodepoints(record.id, existing.representative.id) < 0) existing.representative = record;
    }
  }

  const aliases = new Map();
  const unique = [];
  for (const { representative, ids } of groups.values()) {
    unique.push(representative);
    for (const id of ids) aliases.set(id, representative.id);
  }
  unique.sort((left, right) => compareCodepoints(left.id, right.id));
  return { records: unique, aliases };
};

export function transformData(input) {
  const validated = validateDataInput(cloneJson(input));
  const normalizedSources = validated.researchResult.sources.map((source) => {
    const normalized = canonicalObject(source);
    normalized.id = source.id.trim();
    normalized.url = new URL(source.url.trim()).toString();
    normalized.checkedAt = source.checkedAt.trim();
    if (source.title != null) normalized.title = source.title.trim();
    return normalized;
  });
  const { records: sources, aliases } = deduplicate(normalizedSources);

  const normalizedItems = validated.researchResult.items.map((item) => {
    const normalized = canonicalObject(item);
    normalized.id = item.id.trim();
    normalized.title = item.title.trim();
    normalized.sourceIds = [...new Set(item.sourceIds.map((id) => aliases.get(id.trim())))].sort(compareCodepoints);
    return normalized;
  });

  const output = validateDataOutput({
    schemaVersion: DATA_RESULT_SCHEMA_VERSION,
    status: 'SUCCESS',
    requiredFields: [...validated.requiredFields].sort(compareCodepoints),
    sources,
    items: deduplicate(normalizedItems).records,
  });
  return canonicalObject(output);
}
