const STATUS = new Set(['SUCCESS', 'NO_RESULTS', 'NEEDS_BROWSER']);
const CONFIDENCE = new Set(['LOW', 'MEDIUM', 'HIGH']);
const BROWSER_REASONS = new Set(['JAVASCRIPT_REQUIRED', 'LOGIN_REQUIRED', 'CAPTCHA', 'ACCESS_DENIED', 'FETCH_FAILED']);

export class ResearchContractError extends Error {
  constructor(message, { code = 'RESEARCH_CONTRACT_INVALID', path = null } = {}) {
    super(message);
    this.name = 'ResearchContractError';
    this.code = code;
    this.path = path;
  }
}

const fail = (message, path, code = 'RESEARCH_CONTRACT_INVALID') => {
  throw new ResearchContractError(message, { code, path });
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

const optionalString = (value, path, max = 4096) => {
  if (value == null) return null;
  return nonEmptyString(value, path, max);
};

const safeInteger = (value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${path} must be a safe integer between ${min} and ${max}`, path);
  }
  return value;
};

const isoInstant = (value, path) => {
  const raw = nonEmptyString(value, path, 64);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) fail(`${path} must be an ISO-8601 timestamp`, path);
  return new Date(ms).toISOString();
};

export function canonicalHttpUrl(value, path = 'url') {
  const raw = nonEmptyString(value, path, 4096);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${path} must be a valid URL`, path, 'INVALID_SOURCE_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`${path} must use http or https`, path, 'INVALID_SOURCE_URL');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  return url.toString();
}

const freeze = (value) => Object.freeze(value);

export function normalizeResearchRequest(input) {
  const root = plainObject(input, 'request');
  const goal = nonEmptyString(root.goal, 'request.goal', 12000);
  const maxResults = root.maxResults == null
    ? 10
    : safeInteger(root.maxResults, 'request.maxResults', { min: 1, max: 100 });

  const constraints = root.constraints == null
    ? freeze({})
    : freeze(structuredClone(plainObject(root.constraints, 'request.constraints')));

  const requiredFields = root.requiredFields == null ? [] : root.requiredFields;
  if (!Array.isArray(requiredFields)) fail('request.requiredFields must be an array', 'request.requiredFields');
  const normalizedFields = [...new Set(requiredFields.map((field, index) =>
    nonEmptyString(field, `request.requiredFields[${index}]`, 128),
  ))];

  return freeze({
    goal,
    maxResults,
    constraints,
    requiredFields: freeze(normalizedFields),
  });
}

export function normalizeResearchResult(input) {
  const root = plainObject(input, 'result');
  const status = nonEmptyString(root.status, 'result.status', 32).toUpperCase();
  if (!STATUS.has(status)) fail('result.status is unsupported', 'result.status');

  const summary = nonEmptyString(root.summary, 'result.summary', 12000);
  const confidence = nonEmptyString(root.confidence, 'result.confidence', 16).toUpperCase();
  if (!CONFIDENCE.has(confidence)) fail('result.confidence is unsupported', 'result.confidence');

  if (!Array.isArray(root.sources)) fail('result.sources must be an array', 'result.sources');
  if (!Array.isArray(root.items)) fail('result.items must be an array', 'result.items');

  // Dedupe sources by canonical URL and keep the oldest stable source id as the representative.
  const sources = [];
  const sourceByCanonicalUrl = new Map();
  const sourceAlias = new Map();

  root.sources.forEach((rawSource, index) => {
    const source = plainObject(rawSource, `result.sources[${index}]`);
    const id = nonEmptyString(source.id, `result.sources[${index}].id`, 128);
    if (sourceAlias.has(id)) fail(`duplicate source id: ${id}`, `result.sources[${index}].id`);

    const url = canonicalHttpUrl(source.url, `result.sources[${index}].url`);
    const checkedAt = isoInstant(source.checkedAt, `result.sources[${index}].checkedAt`);
    const title = optionalString(source.title, `result.sources[${index}].title`, 1024);

    const existing = sourceByCanonicalUrl.get(url);
    if (existing) {
      sourceAlias.set(id, existing.id);
      return;
    }

    const normalized = freeze({ id, url, checkedAt, ...(title ? { title } : {}) });
    sources.push(normalized);
    sourceByCanonicalUrl.set(url, normalized);
    sourceAlias.set(id, id);
  });

  const sourceIds = new Set(sources.map((source) => source.id));
  const itemIds = new Set();
  const items = root.items.map((rawItem, index) => {
    const item = plainObject(rawItem, `result.items[${index}]`);
    const id = nonEmptyString(item.id, `result.items[${index}].id`, 128);
    if (itemIds.has(id)) fail(`duplicate item id: ${id}`, `result.items[${index}].id`);
    itemIds.add(id);

    const title = nonEmptyString(item.title, `result.items[${index}].title`, 2048);
    if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
      fail('every research item must reference at least one source', `result.items[${index}].sourceIds`, 'UNSOURCED_ITEM');
    }

    const normalizedRefs = [...new Set(item.sourceIds.map((rawId, refIndex) => {
      const ref = nonEmptyString(rawId, `result.items[${index}].sourceIds[${refIndex}]`, 128);
      const canonical = sourceAlias.get(ref);
      if (!canonical || !sourceIds.has(canonical)) {
        fail(`item references unknown source: ${ref}`, `result.items[${index}].sourceIds[${refIndex}]`, 'UNKNOWN_SOURCE_REFERENCE');
      }
      return canonical;
    }))];

    const data = item.data == null ? {} : structuredClone(plainObject(item.data, `result.items[${index}].data`));
    return freeze({ id, title, data: freeze(data), sourceIds: freeze(normalizedRefs) });
  });

  const needsBrowserRaw = root.needsBrowser == null ? [] : root.needsBrowser;
  if (!Array.isArray(needsBrowserRaw)) fail('result.needsBrowser must be an array', 'result.needsBrowser');
  const needsBrowserSeen = new Set();
  const needsBrowser = needsBrowserRaw.map((rawEntry, index) => {
    const entry = plainObject(rawEntry, `result.needsBrowser[${index}]`);
    const url = canonicalHttpUrl(entry.url, `result.needsBrowser[${index}].url`);
    if (needsBrowserSeen.has(url)) fail(`duplicate needsBrowser URL: ${url}`, `result.needsBrowser[${index}].url`);
    needsBrowserSeen.add(url);
    const reason = nonEmptyString(entry.reason, `result.needsBrowser[${index}].reason`, 64).toUpperCase();
    if (!BROWSER_REASONS.has(reason)) fail('unsupported browser escalation reason', `result.needsBrowser[${index}].reason`);
    const detail = optionalString(entry.detail, `result.needsBrowser[${index}].detail`, 2048);
    return freeze({ url, reason, ...(detail ? { detail } : {}) });
  });

  if (status === 'SUCCESS' && items.length === 0) {
    fail('SUCCESS requires at least one sourced item', 'result.items');
  }
  if (status === 'NO_RESULTS' && items.length !== 0) {
    fail('NO_RESULTS must not contain items', 'result.items');
  }
  if (status === 'NEEDS_BROWSER' && needsBrowser.length === 0) {
    fail('NEEDS_BROWSER requires at least one escalation entry', 'result.needsBrowser');
  }

  return freeze({
    status,
    summary,
    confidence,
    items: freeze(items),
    sources: freeze(sources),
    needsBrowser: freeze(needsBrowser),
  });
}
