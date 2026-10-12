export const DATA_RESULT_SCHEMA_VERSION = 1;

export class DataContractError extends Error {
  constructor(message, { code = 'DATA_CONTRACT_INVALID', path = null } = {}) {
    super(message);
    this.name = 'DataContractError';
    this.code = code;
    this.path = path;
  }
}

const fail = (message, path, code = 'DATA_CONTRACT_INVALID') => {
  throw new DataContractError(message, { code, path });
};

const plainObject = (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`, path);
  }
  return value;
};

const nonEmptyString = (value, path, max = 4096) => {
  if (typeof value !== 'string') fail(`${path} must be a string`, path);
  const trimmed = value.trim();
  if (!trimmed) fail(`${path} must not be empty`, path);
  if (trimmed.length > max) fail(`${path} exceeds ${max} characters`, path);
  return trimmed;
};

const httpUrl = (value, path) => {
  const raw = nonEmptyString(value, path, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${path} must be a valid URL`, path, 'INVALID_SOURCE_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`${path} must use http or https`, path, 'INVALID_SOURCE_URL');
  }
  return raw;
};

const requiredFields = (value, path) => {
  if (!Array.isArray(value)) fail(`${path} must be an array`, path, 'INVALID_REQUIRED_FIELDS');
  const seen = new Set();
  return Object.freeze(value.map((field, index) => {
    const normalized = nonEmptyString(field, `${path}[${index}]`, 128);
    if (seen.has(normalized)) fail(`${path} contains duplicate field: ${normalized}`, `${path}[${index}]`, 'DUPLICATE_REQUIRED_FIELD');
    seen.add(normalized);
    return normalized;
  }));
};

const hasRequiredValue = (data, field) => {
  if (!Object.prototype.hasOwnProperty.call(data, field)) return false;
  const value = data[field];
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
};

const validateSources = (value, path) => {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must contain at least one source`, path, 'SOURCES_REQUIRED');
  }
  const ids = new Set();
  const sources = value.map((raw, index) => {
    const sourcePath = `${path}[${index}]`;
    const source = plainObject(raw, sourcePath);
    const id = nonEmptyString(source.id, `${sourcePath}.id`, 128);
    if (ids.has(id)) fail(`duplicate source id: ${id}`, `${sourcePath}.id`, 'DUPLICATE_SOURCE_ID');
    ids.add(id);
    httpUrl(source.url, `${sourcePath}.url`);
    nonEmptyString(source.checkedAt, `${sourcePath}.checkedAt`, 64);
    if (source.title != null) nonEmptyString(source.title, `${sourcePath}.title`, 1024);
    return structuredClone(source);
  });
  return { ids, sources: Object.freeze(sources) };
};

const validateItems = (value, path, sourceIds, fields) => {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must contain at least one item`, path, 'ITEMS_REQUIRED');
  }
  const itemIds = new Set();
  const items = value.map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    const item = plainObject(raw, itemPath);
    const id = nonEmptyString(item.id, `${itemPath}.id`, 128);
    if (itemIds.has(id)) fail(`duplicate item id: ${id}`, `${itemPath}.id`, 'DUPLICATE_ITEM_ID');
    itemIds.add(id);
    nonEmptyString(item.title, `${itemPath}.title`, 2048);
    const data = plainObject(item.data, `${itemPath}.data`);

    if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
      fail(`${itemPath}.sourceIds must contain at least one source id`, `${itemPath}.sourceIds`, 'UNSOURCED_ITEM');
    }
    const itemSourceIds = new Set();
    item.sourceIds.forEach((rawSourceId, sourceIndex) => {
      const sourceId = nonEmptyString(rawSourceId, `${itemPath}.sourceIds[${sourceIndex}]`, 128);
      if (itemSourceIds.has(sourceId)) {
        fail(`duplicate item source id: ${sourceId}`, `${itemPath}.sourceIds[${sourceIndex}]`, 'DUPLICATE_ITEM_SOURCE');
      }
      itemSourceIds.add(sourceId);
      if (!sourceIds.has(sourceId)) {
        fail(`item references unknown source: ${sourceId}`, `${itemPath}.sourceIds[${sourceIndex}]`, 'UNKNOWN_SOURCE_REFERENCE');
      }
    });

    for (const field of fields) {
      if (!hasRequiredValue(data, field)) {
        fail(`item ${id} is missing required field: ${field}`, `${itemPath}.data.${field}`, 'REQUIRED_FIELD_MISSING');
      }
    }
    return structuredClone(item);
  });
  return Object.freeze(items);
};

const validateResearchSuccess = (value, fields, path) => {
  const research = plainObject(value, path);
  if (research.status !== 'SUCCESS') {
    fail(`${path}.status must be SUCCESS`, `${path}.status`, 'RESEARCH_NOT_SUCCESS');
  }
  const { ids: sourceIds, sources } = validateSources(research.sources, `${path}.sources`);
  const items = validateItems(research.items, `${path}.items`, sourceIds, fields);
  return Object.freeze({ ...structuredClone(research), sources, items });
};

export function validateDataInput(input) {
  const root = plainObject(input, 'input');
  const fields = requiredFields(root.requiredFields, 'input.requiredFields');
  const research = validateResearchSuccess(root.researchResult, fields, 'input.researchResult');
  return Object.freeze({ requiredFields: fields, researchResult: research });
}

export function validateDataOutput(output) {
  const root = plainObject(output, 'output');
  if (root.schemaVersion !== DATA_RESULT_SCHEMA_VERSION) {
    fail(`output.schemaVersion must be ${DATA_RESULT_SCHEMA_VERSION}`, 'output.schemaVersion', 'UNSUPPORTED_DATA_SCHEMA_VERSION');
  }
  if (root.status !== 'SUCCESS') {
    fail('output.status must be SUCCESS', 'output.status', 'DATA_OUTPUT_NOT_SUCCESS');
  }
  const fields = requiredFields(root.requiredFields, 'output.requiredFields');
  const { ids: sourceIds, sources } = validateSources(root.sources, 'output.sources');
  const items = validateItems(root.items, 'output.items', sourceIds, fields);
  return Object.freeze({
    schemaVersion: DATA_RESULT_SCHEMA_VERSION,
    status: 'SUCCESS',
    requiredFields: fields,
    items,
    sources,
  });
}
