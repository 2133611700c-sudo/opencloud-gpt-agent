import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { normalizeResearchResult } from '../research/research-contract.mjs';
import { validateDataInput, validateDataOutput } from '../data/data-contract.mjs';
import { transformData } from '../data/data-transformer.mjs';

export const EVIDENCE_SCHEMA_VERSION = 1;
const TERMINAL = new Set(['SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED']);
const BASIS = new Set(['OBSERVED_USAGE', 'RESERVATION_FALLBACK']);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const TRACE_EVENTS = new Set(['RESEARCH_STARTED', 'RESEARCH_COMPLETED', 'DATA_COMPLETED', 'ACCOUNTING_RECONCILED', 'RESERVATION_RELEASED', 'NODE_FAILED', 'LEASE_LOST', 'RUNTIME_FAILED', 'TASK_FINALIZED']);
const REDACTED = '[REDACTED]';
const normalizedName = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const PRIVATE_KEYS = new Set(['chainofthought', 'privatechainofthought', 'reasoning', 'reasoningcontent', 'reasoningtext', 'analysis', 'scratchpad', 'thinking', 'prompt', 'prompts', 'systemprompt', 'rawenvelope', 'rawresponse', 'stdout', 'stderr', 'env', 'environment', 'headers', 'cookies']);
const SECRET_KEY = /^(?:.*(?:password|passwd|secret|apikey|accesstoken|refreshtoken|authorization|credential|privatekey)|databaseurl|connectionstring)$/;
const PRIVATE_ALIAS = /^(?:(?:private|internal|hidden)?(?:chainofthought|reasoning|analysis|thinking|thoughts|scratchpad)(?:text|content|notes|trace)?|(?:system|user|developer|assistant|input|raw)?prompts?(?:text|content)?|(?:raw|agent|model|provider)(?:envelope|response)|(?:process|raw)(?:stdout|stderr)|(?:request|response|http)headers)$/;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/;

export class EvidenceContractError extends Error {
  constructor(code = 'EVIDENCE_INVALID') {
    // Errors deliberately contain neither values nor paths from an untrusted snapshot.
    super(`Evidence snapshot is invalid (${code})`);
    this.name = 'EvidenceContractError';
    this.code = code;
  }
}
const fail = (code) => { throw new EvidenceContractError(code); };
const assert = (condition, code = 'EVIDENCE_INVALID') => { if (!condition) fail(code); };
const own = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
const compare = (a, b) => {
  const left = Array.from(a, (c) => c.codePointAt(0));
  const right = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

// Descriptor inspection rejects accessors without invoking them, including on fields
// that projection would otherwise omit. Shared references are allowed; cycles are not.
const cloneJson = (value, ancestors = new WeakSet(), depth = 0) => {
  assert(depth <= 100, 'EVIDENCE_INVALID_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'EVIDENCE_INVALID_JSON');
    return Object.is(value, -0) ? 0 : value;
  }
  assert(typeof value === 'object' && !isProxy(value) && !ancestors.has(value), 'EVIDENCE_INVALID_JSON');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  assert(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'EVIDENCE_INVALID_JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    assert(typeof key === 'string' && Object.hasOwn(descriptors[key], 'value'), 'EVIDENCE_INVALID_JSON');
    assert((array && key === 'length') || descriptors[key].enumerable, 'EVIDENCE_INVALID_JSON');
  }
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length.value;
      assert(keys.length === length + 1, 'EVIDENCE_INVALID_JSON');
      for (const key of keys) assert(key === 'length' || (String(Number(key)) === key && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < length), 'EVIDENCE_INVALID_JSON');
      return Array.from({ length }, (_, i) => {
        assert(Object.hasOwn(descriptors, String(i)), 'EVIDENCE_INVALID_JSON');
        return cloneJson(descriptors[i].value, ancestors, depth + 1);
      });
    }
    const result = {};
    for (const key of keys.sort(compare)) own(result, key, cloneJson(descriptors[key].value, ancestors, depth + 1));
    return result;
  } finally { ancestors.delete(value); }
};
const object = (value) => { assert(value !== null && typeof value === 'object' && !Array.isArray(value)); return value; };
const array = (value) => { assert(Array.isArray(value)); return value; };
const text = (value, max = 12000) => { assert(typeof value === 'string' && value.trim() !== '' && value.length <= max); return value; };
const id = (value) => { assert(typeof value === 'string' && UUID.test(value) && value === value.toLowerCase(), 'EVIDENCE_ID_INVALID'); return value; };
const instantNs = (value) => {
  assert(typeof value === 'string', 'EVIDENCE_TIMESTAMP_INVALID');
  const match = INSTANT.exec(value); assert(match !== null, 'EVIDENCE_TIMESTAMP_INVALID');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  assert(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59, 'EVIDENCE_TIMESTAMP_INVALID');
  const zoneHours = match[10] == null ? 0 : Number(match[10]); const zoneMinutes = match[11] == null ? 0 : Number(match[11]);
  assert(zoneHours <= 23 && zoneMinutes <= 59, 'EVIDENCE_TIMESTAMP_INVALID');
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  const offset = (zoneHours * 60 + zoneMinutes) * 60_000 * (match[9] === '-' ? -1 : 1);
  return BigInt(date.getTime() - offset) * 1_000_000n + BigInt((match[7] ?? '').padEnd(9, '0'));
};
const instant = (value, optional = false) => {
  if (optional && value == null) return null;
  instantNs(value);
  return value;
};
const integer = (value, max = 2_147_483_647) => { assert(Number.isSafeInteger(value) && value >= 0 && value <= max, 'EVIDENCE_COUNTER_INVALID'); return value; };
const counter = (value) => {
  assert((typeof value === 'string' && /^\d+$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), 'EVIDENCE_COUNTER_INVALID');
  const parsed = BigInt(value);
  assert(parsed <= 9_223_372_036_854_775_807n, 'EVIDENCE_COUNTER_INVALID');
  return parsed;
};
const microUsd = (value) => {
  let parsed;
  if (typeof value === 'number') {
    const scaled = Math.round(value * 1_000_000);
    assert(Number.isFinite(value) && value >= 0 && Number.isSafeInteger(scaled) && scaled / 1_000_000 === value, 'EVIDENCE_MONEY_INVALID');
    parsed = BigInt(scaled);
  } else {
    assert(typeof value === 'string' && /^\d+(?:\.\d{1,6})?$/.test(value), 'EVIDENCE_MONEY_INVALID');
    const [whole, fraction = ''] = value.split('.');
    parsed = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  }
  assert(parsed <= 999_999_999_999n, 'EVIDENCE_MONEY_INVALID');
  return parsed;
};
const usd = (value) => { const amount = microUsd(value); return `${amount / 1_000_000n}.${String(amount % 1_000_000n).padStart(6, '0')}`; };
const unique = (rows, key) => {
  const map = new Map();
  for (const row of rows) { object(row); const value = row[key]; assert(!map.has(value), 'EVIDENCE_DUPLICATE'); map.set(value, row); }
  return map;
};
const sorted = (rows) => [...rows].sort((a, b) => compare(a.id, b.id));
const safeError = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['code', 'reason']) if (typeof value[key] === 'string' && CODE.test(value[key])) result[key] = value[key];
  return result;
};

const acceptance = (task) => {
  try {
    const request = task.request_payload == null ? {} : object(task.request_payload);
    const fields = request.requiredFields == null ? [] : array(request.requiredFields);
    const requiredFields = fields.map((field) => text(field, 128).trim());
    assert(new Set(requiredFields).size === requiredFields.length);
    const result = { goal: text(task.goal), valid: true, requiredFields };
    if (request.maxResults != null) { assert(integer(request.maxResults, 100) > 0); result.maxResults = request.maxResults; }
    if (request.constraints != null) result.constraints = object(request.constraints);
    return result;
  } catch (error) {
    if (!(error instanceof EvidenceContractError) || task.status === 'SUCCESS') throw error;
    return { goal: text(task.goal), valid: false, verification: 'NOT_PROVEN', reason: 'INVALID_REQUEST_PAYLOAD' };
  }
};
const resultProjection = (result, data = false) => {
  const projected = {
    status: result.status,
    // Contract-valid product extensions affect canonical dedupe and provenance.
    // Preserve them inside records; the recursive scrub still applies to all keys.
    items: result.items,
    sources: result.sources,
  };
  if (data) { projected.schemaVersion = result.schemaVersion; projected.requiredFields = result.requiredFields; }
  else { projected.summary = result.summary; projected.confidence = result.confidence; projected.needsBrowser = result.needsBrowser.map((entry) => ({ url: entry.url, reason: entry.reason })); }
  return projected;
};

// This boundary covers known credential patterns/keys and caller-supplied secrets.
// It cannot identify an arbitrary, undisclosed opaque secret embedded in prose.
const redactor = (sensitiveValues) => {
  const values = array(sensitiveValues).map((value) => text(value)).sort((a, b) => b.length - a.length || compare(a, b));
  const literals = [...new Set(values.flatMap((value) => [value, encodeURIComponent(value), encodeURIComponent(encodeURIComponent(value))]))];
  let applied = false;
  const replace = (value) => {
    let result = value;
    for (const secret of literals) result = result.split(secret).join(REDACTED);
    result = result.replace(/\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9]{12,}|github_pat_[a-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/gi, REDACTED)
      .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, REDACTED)
      .replace(/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g, REDACTED)
      .replace(/<(?:think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/(?:think|analysis|reasoning)\s*>|$)/gi, REDACTED)
      .replace(/\bBearer\s+[^\s,;"<>]+/gi, `Bearer ${REDACTED}`)
      .replace(/(?:postgres(?:ql)?|mysql|redis):\/\/[^\s"<>]+/gi, REDACTED)
      .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*)[^\s&,;"<>]+/gi, `$1${REDACTED}`);
    if (result !== value) applied = true;
    return result;
  };
  const sanitizeString = (value) => replace(value.replace(/https?:\/\/[^\s"<>]+/gi, (raw) => {
    let url;
    try { url = new URL(raw); } catch { return raw; }
    let changed = false;
    if (url.username || url.password) { url.username = ''; url.password = ''; changed = true; }
    const decoded = (part) => { let result = part; for (let i = 0; i < 2; i += 1) { try { const next = decodeURIComponent(result); if (next === result) break; result = next; } catch { break; } } return result; };
    for (const key of [...url.searchParams.keys()]) {
      const rawValues = url.searchParams.getAll(key);
      const safeValues = rawValues.map((item) => replace(decoded(item)));
      if (SECRET_KEY.test(normalizedName(key)) || /^(?:token|key|signature|sig|code)$/i.test(key)) { url.searchParams.set(key, REDACTED); changed = true; }
      else if (safeValues.some((item, i) => item !== decoded(rawValues[i]))) { url.searchParams.delete(key); for (const item of safeValues) url.searchParams.append(key, item); changed = true; }
    }
    for (const key of ['pathname', 'hash']) {
      const original = decoded(url[key]); const safe = replace(original);
      if (safe !== original) { url[key] = safe; changed = true; }
    }
    if (changed) applied = true;
    return changed ? url.toString() : raw;
  }));
  const sanitize = (value) => {
    if (typeof value === 'string') return sanitizeString(value);
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sanitize);
    const result = {};
    for (const key of Object.keys(value).sort(compare)) {
      if (PRIVATE_KEYS.has(normalizedName(key)) || PRIVATE_ALIAS.test(normalizedName(key))) { applied = true; continue; }
      const safeKey = sanitizeString(key);
      assert(!Object.hasOwn(result, safeKey), 'EVIDENCE_REDACTION_COLLISION');
      if (SECRET_KEY.test(normalizedName(key))) { own(result, safeKey, REDACTED); applied = true; }
      else own(result, safeKey, sanitize(value[key]));
    }
    return result;
  };
  return { sanitize, didApply: () => applied };
};
const freeze = (value) => {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export function buildEvidenceBundle(snapshot, options = {}) {
  const raw = object(cloneJson(snapshot));
  const config = object(cloneJson(options));
  const task = object(raw.task);
  const taskId = id(task.id);
  assert(TERMINAL.has(task.status), 'EVIDENCE_NOT_TERMINAL');
  const rawReason = text(task.terminal_reason, 256);
  const terminalReason = CODE.test(rawReason) ? rawReason : 'UNCLASSIFIED_TERMINAL_REASON';
  const terminalAt = instant(task.terminal_at);
  const createdAt = instant(task.created_at);
  assert(instantNs(terminalAt) >= instantNs(createdAt), 'EVIDENCE_TIMESTAMP_INVALID');
  instant(task.updated_at); instant(task.deadline_at);
  assert(microUsd(task.reserved_cost_usd) === 0n && counter(task.reserved_tokens) === 0n, 'EVIDENCE_UNRESOLVED_RESERVATION');
  const budget = microUsd(task.budget_limit_usd);
  const cost = microUsd(task.current_cost_usd);
  const tokens = counter(task.current_tokens);
  assert(cost <= budget && (task.token_budget_limit == null || tokens <= counter(task.token_budget_limit)), 'EVIDENCE_BUDGET_INVALID');
  assert(integer(task.current_steps) <= integer(task.max_total_steps) && task.max_total_steps > 0, 'EVIDENCE_COUNTER_INVALID');
  const criteria = acceptance(task);
  const nodes = array(raw.nodes);
  const nodeById = unique(nodes, 'id'); unique(nodes, 'node_key');
  const research = nodes.find((node) => node.node_key === 'research');
  const data = nodes.find((node) => node.node_key === 'data');
  for (const node of nodes) {
    id(node.id); assert(node.task_id === taskId, 'EVIDENCE_OWNERSHIP_INVALID'); text(node.node_key, 128); text(node.agent_id, 128);
    assert(TERMINAL.has(node.status), 'EVIDENCE_ACTIVE_NODE');
    assert(integer(node.attempt) <= integer(node.max_attempts) && node.max_attempts > 0, 'EVIDENCE_COUNTER_INVALID');
    if (node.status === 'SUCCESS') assert(node.attempt > 0 && node.started_at != null, 'EVIDENCE_COUNTER_INVALID');
    assert(microUsd(node.reserved_cost_usd) === 0n && counter(node.reserved_tokens) === 0n, 'EVIDENCE_UNRESOLVED_RESERVATION');
    instant(node.created_at); instant(node.updated_at); instant(node.started_at, true); instant(node.finished_at);
    assert(instantNs(node.created_at) >= instantNs(createdAt) && instantNs(node.finished_at) >= instantNs(node.created_at) && instantNs(node.finished_at) <= instantNs(terminalAt) && (node.started_at == null || (instantNs(node.started_at) >= instantNs(node.created_at) && instantNs(node.started_at) <= instantNs(node.finished_at))), 'EVIDENCE_TIMESTAMP_INVALID');
    if (node.node_key === 'research') assert(node.agent_id === 'researcher', 'EVIDENCE_AGENT_INVALID');
    if (node.node_key === 'data') assert(node.agent_id === 'data', 'EVIDENCE_AGENT_INVALID');
  }
  assert(BigInt(task.current_steps) === nodes.reduce((sum, node) => sum + BigInt(node.attempt), 0n), 'EVIDENCE_COUNTER_INVALID');
  const dependencies = array(raw.dependencies);
  unique(dependencies.map((edge) => ({ key: canonical([edge.node_id, edge.parent_node_id]) })), 'key');
  for (const edge of dependencies) assert(edge.task_id === taskId && nodeById.has(edge.node_id) && nodeById.has(edge.parent_node_id) && edge.node_id !== edge.parent_node_id, 'EVIDENCE_DEPENDENCY_INVALID');
  let researchResult = null;
  let dataResult = null;
  try {
    if (research?.output_data != null) researchResult = normalizeResearchResult(research.output_data);
    if (research?.status === 'SUCCESS') assert(researchResult !== null, 'EVIDENCE_RESULT_INVALID');
    if (data?.output_data != null) dataResult = validateDataOutput(data.output_data);
    if (data?.status === 'SUCCESS') {
      assert(research?.status === 'SUCCESS' && criteria.valid === true, 'EVIDENCE_RESULT_INVALID');
      assert(dataResult !== null && canonical(data.output_data) === canonical(transformData({ requiredFields: criteria.requiredFields, researchResult: research.output_data })), 'EVIDENCE_DATA_MISMATCH');
      assert(dependencies.some((edge) => edge.node_id === data.id && edge.parent_node_id === research.id), 'EVIDENCE_DEPENDENCY_INVALID');
    }
  } catch (error) { if (error instanceof EvidenceContractError) throw error; fail('EVIDENCE_RESULT_INVALID'); }
  if (task.status === 'SUCCESS') assert(nodes.length === 2 && nodes.every((node) => node.status === 'SUCCESS') && researchResult?.status === 'SUCCESS' && dataResult !== null && terminalReason === 'ALL_NODES_SUCCEEDED' && dependencies.length === 1, 'EVIDENCE_SUCCESS_INVALID');

  const accounting = array(raw.accounting);
  const reservations = array(raw.reservations);
  unique(accounting, 'id'); const accountingByKey = unique(accounting, 'call_key');
  unique(reservations, 'id'); const reservationByKey = unique(reservations, 'reservation_key');
  const ownership = (row) => { id(row.id); assert(row.task_id === taskId && nodeById.has(row.node_id), 'EVIDENCE_OWNERSHIP_INVALID'); assert(nodeById.get(row.node_id).attempt > 0, 'EVIDENCE_COUNTER_INVALID'); id(row.lease_token); assert(row.node_id !== data?.id, 'EVIDENCE_DATA_MODEL_CALL'); };
  let totalCost = 0n;
  let totalTokens = 0n;
  for (const row of accounting) {
    ownership(row); text(row.call_key, 160); text(row.provider, 64); text(row.model, 128); text(row.pricing_version, 64); instant(row.created_at); integer(row.latency_ms);
    assert(BASIS.has(row.accounting_basis), 'EVIDENCE_ACCOUNTING_INVALID');
    const tokenSum = counter(row.prompt_cache_hit_tokens) + counter(row.prompt_cache_miss_tokens) + counter(row.completion_tokens);
    assert(tokenSum === counter(row.total_tokens), 'EVIDENCE_ACCOUNTING_INVALID');
    const reservation = reservationByKey.get(row.call_key);
    assert(reservation?.status === 'RECONCILED' && reservation.task_id === row.task_id && reservation.node_id === row.node_id && reservation.lease_token === row.lease_token, 'EVIDENCE_LEDGER_INVALID');
    assert(microUsd(row.cost_usd) === microUsd(reservation.actual_cost_usd) && counter(row.total_tokens) === counter(reservation.actual_tokens) && row.accounting_basis === reservation.reconciliation_basis && microUsd(row.reserved_cost_usd) === microUsd(reservation.reserved_cost_usd), 'EVIDENCE_LEDGER_INVALID');
    if (row.accounting_basis === 'RESERVATION_FALLBACK') assert(counter(row.prompt_cache_hit_tokens) === 0n && counter(row.completion_tokens) === 0n && counter(row.total_tokens) === counter(reservation.reserved_tokens) && microUsd(row.cost_usd) === microUsd(reservation.reserved_cost_usd), 'EVIDENCE_LEDGER_INVALID');
    totalCost += microUsd(row.cost_usd); totalTokens += counter(row.total_tokens);
  }
  for (const row of reservations) {
    ownership(row); text(row.reservation_key, 160); instant(row.created_at); microUsd(row.reserved_cost_usd); counter(row.reserved_tokens);
    assert(row.status !== 'RESERVED', 'EVIDENCE_UNRESOLVED_RESERVATION');
    if (row.status === 'RECONCILED') {
      assert(accountingByKey.has(row.reservation_key) && BASIS.has(row.reconciliation_basis), 'EVIDENCE_LEDGER_INVALID');
      assert(microUsd(row.actual_cost_usd) <= microUsd(row.reserved_cost_usd) && counter(row.actual_tokens) <= counter(row.reserved_tokens), 'EVIDENCE_LEDGER_INVALID');
      instant(row.reconciled_at);
    } else {
      assert(row.status === 'RELEASED' && !accountingByKey.has(row.reservation_key) && row.actual_cost_usd == null && row.actual_tokens == null, 'EVIDENCE_LEDGER_INVALID');
      instant(row.released_at);
    }
  }
  assert(totalCost === cost && totalTokens === tokens, 'EVIDENCE_ACCOUNTING_MISMATCH');
  if (task.status === 'SUCCESS') assert(accounting.some((row) => row.node_id === research.id), 'EVIDENCE_ACCOUNTING_MISSING');

  const receipts = raw.runtimeReceipts == null ? [] : array(raw.runtimeReceipts);
  unique(receipts, 'id'); unique(receipts, 'call_key');
  const projectedReceipts = receipts.map((receipt) => {
    ownership(receipt); instant(receipt.recorded_at);
    const reservation = reservationByKey.get(receipt.call_key);
    assert(reservation && reservation.task_id === receipt.task_id && reservation.node_id === receipt.node_id && reservation.lease_token === receipt.lease_token, 'EVIDENCE_RECEIPT_INVALID');
    const result = { id: receipt.id, nodeId: receipt.node_id, reservationId: reservation.id, recordedAt: receipt.recorded_at, observed: null, configured: null, trace: [], error: safeError(receipt.error) };
    if (receipt.observed != null) {
      const observed = object(receipt.observed);
      const account = accountingByKey.get(receipt.call_key);
      text(observed.provider, 64); text(observed.model, 128);
      if (account) assert(account.provider === observed.provider && account.model === observed.model && (observed.sessionId ?? null) === (account.provider_request_id ?? null), 'EVIDENCE_RECEIPT_INVALID');
      result.observed = { provider: observed.provider, model: observed.model, sessionId: observed.sessionId == null ? null : text(observed.sessionId, 256), toolSummary: null };
      if (observed.toolSummary != null) {
        const summary = object(observed.toolSummary);
        const calls = integer(summary.calls); const failures = integer(summary.failures);
        const tools = array(summary.tools);
        assert(failures <= calls && calls >= tools.length && new Set(tools).size === tools.length && tools.every((tool) => tool === 'web_search' || tool === 'web_fetch') && ((calls === 0) === (tools.length === 0)), 'EVIDENCE_RECEIPT_INVALID');
        result.observed.toolSummary = { calls, failures, tools: [...tools].sort(compare), totalToolTimeMs: summary.totalToolTimeMs == null ? null : integer(summary.totalToolTimeMs) };
      }
    }
    if (receipt.configured != null) {
      const configured = object(receipt.configured); result.configured = {};
      for (const key of ['runtimeVersion', 'requestedModel', 'modelRelease', 'thinkingLevel']) if (configured[key] != null) result.configured[key] = text(configured[key], 256);
    }
    for (const trace of receipt.trace == null ? [] : array(receipt.trace)) {
      object(trace); assert(TRACE_EVENTS.has(trace.event), 'EVIDENCE_TRACE_INVALID'); instant(trace.at);
      result.trace.push({ event: trace.event, at: trace.at, ...(typeof trace.code === 'string' && CODE.test(trace.code) ? { code: trace.code } : {}) });
    }
    return result;
  });

  const projected = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    task: { id: taskId, status: task.status, terminalReason, terminalError: safeError(task.terminal_detail), createdAt, updatedAt: task.updated_at, terminalAt, deadlineAt: task.deadline_at, budgetLimitUsd: usd(task.budget_limit_usd), currentCostUsd: usd(task.current_cost_usd), reservedCostUsd: '0.000000', tokenBudgetLimit: task.token_budget_limit == null ? null : counter(task.token_budget_limit).toString(), currentTokens: tokens.toString(), reservedTokens: '0', maxTotalSteps: task.max_total_steps, currentSteps: task.current_steps },
    acceptanceCriteria: criteria,
    outcome: task.status === 'SUCCESS' ? `Production Data returned ${dataResult.items.length} sourced items.` : `Task ended ${task.status}: ${terminalReason}.`,
    nextAction: task.status === 'SUCCESS' ? null : 'Review durable evidence before retrying.',
    nodes: sorted(nodes).map((node) => ({ id: node.id, nodeKey: node.node_key, agentId: node.agent_id, status: node.status, attempt: node.attempt, maxAttempts: node.max_attempts, createdAt: node.created_at, updatedAt: node.updated_at, startedAt: node.started_at ?? null, finishedAt: node.finished_at, error: safeError(node.last_error), result: node.id === research?.id && researchResult ? resultProjection({ ...researchResult, items: node.output_data.items, sources: node.output_data.sources }) : node.id === data?.id && dataResult ? resultProjection(dataResult, true) : null })),
    dependencies: dependencies.map((edge) => ({ nodeId: edge.node_id, parentNodeId: edge.parent_node_id })).sort((a, b) => compare(canonical(a), canonical(b))),
    accounting: sorted(accounting).map((row) => ({ id: row.id, nodeId: row.node_id, reservationId: reservationByKey.get(row.call_key).id, provider: row.provider, model: row.model, pricingVersion: row.pricing_version, providerRequestId: row.provider_request_id == null ? null : text(row.provider_request_id, 256), basis: row.accounting_basis, promptCacheHitTokens: counter(row.prompt_cache_hit_tokens).toString(), promptCacheMissTokens: counter(row.prompt_cache_miss_tokens).toString(), completionTokens: counter(row.completion_tokens).toString(), totalTokens: counter(row.total_tokens).toString(), reservedCostUsd: usd(row.reserved_cost_usd), costUsd: usd(row.cost_usd), latencyMs: row.latency_ms, createdAt: row.created_at })),
    reservations: sorted(reservations).map((row) => ({ id: row.id, nodeId: row.node_id, accountingId: accountingByKey.get(row.reservation_key)?.id ?? null, status: row.status, reservedCostUsd: usd(row.reserved_cost_usd), reservedTokens: counter(row.reserved_tokens).toString(), actualCostUsd: row.actual_cost_usd == null ? null : usd(row.actual_cost_usd), actualTokens: row.actual_tokens == null ? null : counter(row.actual_tokens).toString(), basis: row.status === 'RECONCILED' ? row.reconciliation_basis : null, releaseReason: row.release_reason == null ? null : typeof row.release_reason === 'string' && CODE.test(row.release_reason) ? row.release_reason : 'UNCLASSIFIED_RELEASE_REASON', createdAt: row.created_at, reconciledAt: row.reconciled_at ?? null, releasedAt: row.released_at ?? null })),
    runtimeReceipts: sorted(projectedReceipts),
    agentsExecuted: sorted(nodes.filter((node) => node.attempt > 0)).map((node) => ({ nodeId: node.id, agentId: node.agent_id, attempts: node.attempt })),
    attemptCounters: { totalAttempts: nodes.reduce((sum, node) => sum + BigInt(node.attempt), 0n).toString() },
    integrity: { accountingReconciled: true, unresolvedReservations: 0, canonicalDataVerifiedBeforeRedaction: data?.status === 'SUCCESS', canonicalDataVerifiedAtRetrieval: false },
    coverage: { attemptHistory: 'NOT_PROVEN', runtimeReceiptsPresent: receipts.length > 0, toolMetadataPresent: receipts.some((receipt) => receipt.observed?.toolSummary != null), runtimeVerification: 'NOT_PROVEN', skillsProvenance: 'NOT_PROVEN', tests: 'NOT_PROVEN', repairs: 'NOT_PROVEN', judgeVerdict: 'NOT_PROVEN', githubReferences: 'NOT_PROVEN', relatedArtifacts: 'NOT_PROVEN', furtherCalls: 'NOT_PROVEN', terminalClaimIneligible: true },
  };
  const scrub = redactor(config.sensitiveValues ?? []);
  const bundle = scrub.sanitize(projected);
  bundle.redaction = { applied: scrub.didApply(), policy: 'ALLOWLIST_KNOWN_PATTERNS_AND_SUPPLIED_VALUES_V1' };
  bundle.integrity.canonicalDataVerifiedAtRetrieval = data?.status === 'SUCCESS' && !bundle.redaction.applied;
  // A redacted identifier or required-field key must not silently break linkage.
  try {
    for (const node of bundle.nodes) if (node.result?.status === 'SUCCESS') {
      if (node.nodeKey === 'data') validateDataOutput(node.result);
      else if (node.nodeKey === 'research') normalizeResearchResult(node.result);
    }
  } catch { fail('EVIDENCE_REDACTION_COLLISION'); }
  return validateEvidenceBundle(bundle);
}

const keys = (value, allowed, required = allowed) => {
  object(value);
  assert(Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key)), 'EVIDENCE_SCHEMA_INVALID');
};
const publicMoney = (value) => { assert(typeof value === 'string' && value === usd(value), 'EVIDENCE_MONEY_INVALID'); return microUsd(value); };
const publicCounter = (value) => { assert(typeof value === 'string' && value === counter(value).toString(), 'EVIDENCE_COUNTER_INVALID'); return counter(value); };
const publicError = (value) => { if (value === null) return; keys(value, ['code', 'reason'], []); for (const part of Object.values(value)) assert(typeof part === 'string' && CODE.test(part), 'EVIDENCE_UNSAFE_CONTENT'); };
const sourceFacts = (source) => {
  const result = { ...source, id: source.id.trim(), url: new URL(source.url.trim()).toString(), checkedAt: source.checkedAt.trim() };
  if (source.title != null) result.title = source.title.trim();
  return result;
};
const without = (value, omitted) => Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)));
const retainedFacts = (research, data) => {
  const researchSources = new Map(research.sources.map((source) => [source.id.trim(), sourceFacts(source)]));
  const dataSources = new Map(data.sources.map((source) => [source.id.trim(), sourceFacts(source)]));
  const content = (source) => canonical(without(source, ['id']));
  for (const source of data.sources) assert(canonical(source) === canonical(researchSources.get(source.id)), 'EVIDENCE_DATA_MISMATCH');
  const dataContents = new Set([...dataSources.values()].map(content));
  for (const source of researchSources.values()) assert(dataContents.has(content(source)), 'EVIDENCE_DATA_MISMATCH');
  const researchItems = new Map(research.items.map((item) => [item.id.trim(), item]));
  const itemFacts = (item, sources) => ({ record: without({ ...item, id: item.id.trim(), title: item.title.trim() }, ['id', 'sourceIds']), sourceContents: [...new Set(item.sourceIds.map((ref) => content(sources.get(ref.trim()))))].sort(compare) });
  const dataItemContents = new Set();
  for (const item of data.items) {
    const original = researchItems.get(item.id); assert(original !== undefined, 'EVIDENCE_DATA_MISMATCH');
    const facts = canonical(itemFacts(item, dataSources));
    assert(facts === canonical(itemFacts(original, researchSources)), 'EVIDENCE_DATA_MISMATCH');
    dataItemContents.add(facts);
  }
  for (const item of research.items) assert(dataItemContents.has(canonical(itemFacts(item, researchSources))), 'EVIDENCE_DATA_MISMATCH');
};

// Public-bundle validation is also the retrieval boundary. Historical fencing is
// checked only from the raw snapshot by the builder, never reconstructed here.
export function validateEvidenceBundle(input) {
  const bundle = object(cloneJson(input));
  keys(bundle, ['schemaVersion', 'task', 'acceptanceCriteria', 'outcome', 'nextAction', 'nodes', 'dependencies', 'accounting', 'reservations', 'runtimeReceipts', 'agentsExecuted', 'attemptCounters', 'integrity', 'coverage', 'redaction']);
  assert(bundle.schemaVersion === EVIDENCE_SCHEMA_VERSION, 'EVIDENCE_SCHEMA_INVALID');
  const task = bundle.task;
  keys(task, ['id', 'status', 'terminalReason', 'terminalError', 'createdAt', 'updatedAt', 'terminalAt', 'deadlineAt', 'budgetLimitUsd', 'currentCostUsd', 'reservedCostUsd', 'tokenBudgetLimit', 'currentTokens', 'reservedTokens', 'maxTotalSteps', 'currentSteps']);
  id(task.id); assert(TERMINAL.has(task.status), 'EVIDENCE_NOT_TERMINAL'); assert(typeof task.terminalReason === 'string' && CODE.test(task.terminalReason), 'EVIDENCE_UNSAFE_CONTENT'); publicError(task.terminalError);
  for (const field of ['createdAt', 'updatedAt', 'terminalAt', 'deadlineAt']) instant(task[field]);
  assert(instantNs(task.terminalAt) >= instantNs(task.createdAt), 'EVIDENCE_TIMESTAMP_INVALID');
  const cost = publicMoney(task.currentCostUsd); const tokens = publicCounter(task.currentTokens);
  assert(publicMoney(task.reservedCostUsd) === 0n && publicCounter(task.reservedTokens) === 0n, 'EVIDENCE_UNRESOLVED_RESERVATION');
  assert(cost <= publicMoney(task.budgetLimitUsd) && (task.tokenBudgetLimit === null || tokens <= publicCounter(task.tokenBudgetLimit)), 'EVIDENCE_BUDGET_INVALID');
  assert(integer(task.currentSteps) <= integer(task.maxTotalSteps) && task.maxTotalSteps > 0, 'EVIDENCE_COUNTER_INVALID');
  const criteria = bundle.acceptanceCriteria;
  keys(criteria, ['goal', 'valid', 'verification', 'requiredFields', 'maxResults', 'constraints', 'reason'], ['goal', 'valid']); text(criteria.goal);
  if (criteria.valid === true) {
    const fields = array(criteria.requiredFields); fields.forEach((field) => text(field, 128)); assert(new Set(fields).size === fields.length, 'EVIDENCE_SCHEMA_INVALID');
    assert(!Object.hasOwn(criteria, 'reason') && !Object.hasOwn(criteria, 'verification'), 'EVIDENCE_SCHEMA_INVALID');
    if (criteria.maxResults != null) assert(integer(criteria.maxResults, 100) > 0);
    if (criteria.constraints != null) object(criteria.constraints);
  } else assert(criteria.valid === false && criteria.verification === 'NOT_PROVEN' && task.status !== 'SUCCESS' && criteria.reason === 'INVALID_REQUEST_PAYLOAD' && !Object.hasOwn(criteria, 'requiredFields') && !Object.hasOwn(criteria, 'maxResults') && !Object.hasOwn(criteria, 'constraints'), 'EVIDENCE_SCHEMA_INVALID');
  text(bundle.outcome); assert(bundle.nextAction === null || typeof bundle.nextAction === 'string', 'EVIDENCE_SCHEMA_INVALID');
  const nodes = array(bundle.nodes); const nodeById = unique(nodes, 'id'); unique(nodes, 'nodeKey');
  const research = nodes.find((node) => node.nodeKey === 'research'); const data = nodes.find((node) => node.nodeKey === 'data');
  let totalAttempts = 0n;
  for (const node of nodes) {
    keys(node, ['id', 'nodeKey', 'agentId', 'status', 'attempt', 'maxAttempts', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'error', 'result']);
    id(node.id); text(node.nodeKey, 128); text(node.agentId, 128); assert(TERMINAL.has(node.status), 'EVIDENCE_ACTIVE_NODE');
    assert(integer(node.attempt) <= integer(node.maxAttempts) && node.maxAttempts > 0, 'EVIDENCE_COUNTER_INVALID'); totalAttempts += BigInt(node.attempt);
    if (node.status === 'SUCCESS') assert(node.attempt > 0 && node.startedAt !== null, 'EVIDENCE_COUNTER_INVALID');
    instant(node.createdAt); instant(node.updatedAt); instant(node.startedAt, true); instant(node.finishedAt); publicError(node.error);
    assert(instantNs(node.createdAt) >= instantNs(task.createdAt) && instantNs(node.finishedAt) >= instantNs(node.createdAt) && instantNs(node.finishedAt) <= instantNs(task.terminalAt) && (node.startedAt === null || (instantNs(node.startedAt) >= instantNs(node.createdAt) && instantNs(node.startedAt) <= instantNs(node.finishedAt))), 'EVIDENCE_TIMESTAMP_INVALID');
    if (node.nodeKey === 'research') assert(node.agentId === 'researcher', 'EVIDENCE_AGENT_INVALID');
    if (node.nodeKey === 'data') assert(node.agentId === 'data', 'EVIDENCE_AGENT_INVALID');
    try {
      if (node.result !== null) {
        if (node.nodeKey === 'research') { keys(node.result, ['status', 'summary', 'confidence', 'items', 'sources', 'needsBrowser']); normalizeResearchResult(node.result); }
        else if (node.nodeKey === 'data') { keys(node.result, ['schemaVersion', 'status', 'requiredFields', 'items', 'sources']); validateDataOutput(node.result); }
        else fail('EVIDENCE_RESULT_INVALID');
        for (const source of node.result.sources) instant(source.checkedAt);
      }
      if ((node.nodeKey === 'research' || node.nodeKey === 'data') && node.status === 'SUCCESS') assert(node.result !== null, 'EVIDENCE_RESULT_INVALID');
    } catch (error) { if (error instanceof EvidenceContractError) throw error; fail('EVIDENCE_RESULT_INVALID'); }
  }
  assert(BigInt(task.currentSteps) === totalAttempts, 'EVIDENCE_COUNTER_INVALID');
  const dependencies = array(bundle.dependencies); unique(dependencies.map((edge) => ({ key: canonical(edge) })), 'key');
  for (const edge of dependencies) { keys(edge, ['nodeId', 'parentNodeId']); assert(nodeById.has(edge.nodeId) && nodeById.has(edge.parentNodeId) && edge.nodeId !== edge.parentNodeId, 'EVIDENCE_DEPENDENCY_INVALID'); }
  keys(bundle.redaction, ['applied', 'policy']); assert(typeof bundle.redaction.applied === 'boolean' && bundle.redaction.policy === 'ALLOWLIST_KNOWN_PATTERNS_AND_SUPPLIED_VALUES_V1', 'EVIDENCE_SCHEMA_INVALID');
  if (data?.status === 'SUCCESS') {
    assert(research?.status === 'SUCCESS' && research.result?.status === 'SUCCESS' && criteria.valid === true && dependencies.some((edge) => edge.nodeId === data.id && edge.parentNodeId === research.id), 'EVIDENCE_DEPENDENCY_INVALID');
    assert(canonical([...data.result.requiredFields].sort(compare)) === canonical([...criteria.requiredFields].sort(compare)), 'EVIDENCE_DATA_MISMATCH');
    try {
      validateDataInput({ requiredFields: criteria.requiredFields, researchResult: research.result });
      retainedFacts(research.result, data.result);
    } catch (error) { if (error instanceof EvidenceContractError) throw error; fail('EVIDENCE_RESULT_INVALID'); }
    // Redaction may merge original record contents. The raw comparison precedes
    // redaction; retrieval must not claim an unchanged canonical result afterward.
    if (!bundle.redaction.applied) {
      try { assert(canonical(data.result) === canonical(transformData({ requiredFields: criteria.requiredFields, researchResult: research.result })), 'EVIDENCE_DATA_MISMATCH'); }
      catch (error) { if (error instanceof EvidenceContractError) throw error; fail('EVIDENCE_RESULT_INVALID'); }
    }
  }
  if (task.status === 'SUCCESS') assert(nodes.length === 2 && nodes.every((node) => node.status === 'SUCCESS') && data?.result && research?.result?.status === 'SUCCESS' && task.terminalReason === 'ALL_NODES_SUCCEEDED' && dependencies.length === 1, 'EVIDENCE_SUCCESS_INVALID');
  const accounting = array(bundle.accounting); const accountById = unique(accounting, 'id');
  const reservations = array(bundle.reservations); const reserveById = unique(reservations, 'id');
  unique(accounting, 'reservationId');
  let summedCost = 0n; let summedTokens = 0n;
  for (const row of accounting) {
    keys(row, ['id', 'nodeId', 'reservationId', 'provider', 'model', 'pricingVersion', 'providerRequestId', 'basis', 'promptCacheHitTokens', 'promptCacheMissTokens', 'completionTokens', 'totalTokens', 'reservedCostUsd', 'costUsd', 'latencyMs', 'createdAt']);
    id(row.id); id(row.reservationId); assert(nodeById.has(row.nodeId) && row.nodeId !== data?.id, 'EVIDENCE_OWNERSHIP_INVALID');
    assert(nodeById.get(row.nodeId).attempt > 0, 'EVIDENCE_COUNTER_INVALID');
    text(row.provider, 64); text(row.model, 128); text(row.pricingVersion, 64); if (row.providerRequestId !== null) text(row.providerRequestId, 256); integer(row.latencyMs); instant(row.createdAt); assert(BASIS.has(row.basis), 'EVIDENCE_ACCOUNTING_INVALID');
    const total = publicCounter(row.totalTokens); assert(publicCounter(row.promptCacheHitTokens) + publicCounter(row.promptCacheMissTokens) + publicCounter(row.completionTokens) === total, 'EVIDENCE_ACCOUNTING_INVALID');
    const reservation = reserveById.get(row.reservationId);
    assert(reservation?.accountingId === row.id && reservation.nodeId === row.nodeId && reservation.status === 'RECONCILED' && reservation.basis === row.basis, 'EVIDENCE_LEDGER_INVALID');
    assert(publicMoney(row.costUsd) === publicMoney(reservation.actualCostUsd) && total === publicCounter(reservation.actualTokens) && publicMoney(row.reservedCostUsd) === publicMoney(reservation.reservedCostUsd), 'EVIDENCE_LEDGER_INVALID');
    if (row.basis === 'RESERVATION_FALLBACK') assert(publicCounter(row.promptCacheHitTokens) === 0n && publicCounter(row.completionTokens) === 0n && total === publicCounter(reservation.reservedTokens) && publicMoney(row.costUsd) === publicMoney(row.reservedCostUsd), 'EVIDENCE_LEDGER_INVALID');
    summedCost += publicMoney(row.costUsd); summedTokens += total;
  }
  for (const row of reservations) {
    keys(row, ['id', 'nodeId', 'accountingId', 'status', 'reservedCostUsd', 'reservedTokens', 'actualCostUsd', 'actualTokens', 'basis', 'releaseReason', 'createdAt', 'reconciledAt', 'releasedAt']);
    id(row.id); assert(nodeById.has(row.nodeId) && row.nodeId !== data?.id, 'EVIDENCE_OWNERSHIP_INVALID'); publicMoney(row.reservedCostUsd); publicCounter(row.reservedTokens); instant(row.createdAt); instant(row.reconciledAt, true); instant(row.releasedAt, true); if (row.releaseReason !== null) assert(typeof row.releaseReason === 'string' && CODE.test(row.releaseReason), 'EVIDENCE_UNSAFE_CONTENT');
    assert(nodeById.get(row.nodeId).attempt > 0, 'EVIDENCE_COUNTER_INVALID');
    if (row.status === 'RECONCILED') { assert(accountById.get(row.accountingId)?.reservationId === row.id && row.reconciledAt !== null && BASIS.has(row.basis), 'EVIDENCE_LEDGER_INVALID'); assert(publicMoney(row.actualCostUsd) <= publicMoney(row.reservedCostUsd) && publicCounter(row.actualTokens) <= publicCounter(row.reservedTokens), 'EVIDENCE_LEDGER_INVALID'); }
    else assert(row.status === 'RELEASED' && row.accountingId === null && row.actualCostUsd === null && row.actualTokens === null && row.basis === null && row.releasedAt !== null, 'EVIDENCE_LEDGER_INVALID');
  }
  assert(summedCost === cost && summedTokens === tokens, 'EVIDENCE_ACCOUNTING_MISMATCH');
  if (task.status === 'SUCCESS') assert(accounting.some((row) => row.nodeId === research.id), 'EVIDENCE_ACCOUNTING_MISSING');
  const receipts = array(bundle.runtimeReceipts); unique(receipts, 'id'); unique(receipts, 'reservationId');
  for (const receipt of receipts) {
    keys(receipt, ['id', 'nodeId', 'reservationId', 'recordedAt', 'observed', 'configured', 'trace', 'error']); id(receipt.id); instant(receipt.recordedAt); publicError(receipt.error);
    const reservation = reserveById.get(receipt.reservationId); assert(reservation && reservation.nodeId === receipt.nodeId, 'EVIDENCE_RECEIPT_INVALID');
    if (receipt.observed !== null) {
      keys(receipt.observed, ['provider', 'model', 'sessionId', 'toolSummary']); const observed = receipt.observed; text(observed.provider, 64); text(observed.model, 128); if (observed.sessionId !== null) text(observed.sessionId, 256);
      const account = accountById.get(reservation.accountingId); if (account) assert(account.provider === observed.provider && account.model === observed.model && observed.sessionId === account.providerRequestId, 'EVIDENCE_RECEIPT_INVALID');
      if (observed.toolSummary !== null) {
        const summary = observed.toolSummary; keys(summary, ['calls', 'failures', 'tools', 'totalToolTimeMs']); integer(summary.calls); integer(summary.failures); array(summary.tools);
        assert(summary.failures <= summary.calls && summary.calls >= summary.tools.length && new Set(summary.tools).size === summary.tools.length && summary.tools.every((tool) => tool === 'web_search' || tool === 'web_fetch') && ((summary.calls === 0) === (summary.tools.length === 0)), 'EVIDENCE_RECEIPT_INVALID'); if (summary.totalToolTimeMs !== null) integer(summary.totalToolTimeMs);
      }
    }
    if (receipt.configured !== null) { keys(receipt.configured, ['runtimeVersion', 'requestedModel', 'modelRelease', 'thinkingLevel'], []); Object.values(receipt.configured).forEach((part) => text(part, 256)); }
    for (const trace of array(receipt.trace)) { keys(trace, ['event', 'at', 'code'], ['event', 'at']); assert(TRACE_EVENTS.has(trace.event), 'EVIDENCE_TRACE_INVALID'); instant(trace.at); if (trace.code != null) assert(typeof trace.code === 'string' && CODE.test(trace.code), 'EVIDENCE_UNSAFE_CONTENT'); }
  }
  keys(bundle.attemptCounters, ['totalAttempts']); assert(publicCounter(bundle.attemptCounters.totalAttempts) === totalAttempts, 'EVIDENCE_COUNTER_INVALID');
  const agents = array(bundle.agentsExecuted); unique(agents, 'nodeId');
  for (const agent of agents) { keys(agent, ['nodeId', 'agentId', 'attempts']); const node = nodeById.get(agent.nodeId); assert(node?.attempt > 0 && agent.agentId === node.agentId && agent.attempts === node.attempt, 'EVIDENCE_AGENT_INVALID'); }
  assert(agents.length === nodes.filter((node) => node.attempt > 0).length, 'EVIDENCE_AGENT_INVALID');
  keys(bundle.integrity, ['accountingReconciled', 'unresolvedReservations', 'canonicalDataVerifiedBeforeRedaction', 'canonicalDataVerifiedAtRetrieval']); assert(bundle.integrity.accountingReconciled === true && bundle.integrity.unresolvedReservations === 0 && bundle.integrity.canonicalDataVerifiedBeforeRedaction === (data?.status === 'SUCCESS') && bundle.integrity.canonicalDataVerifiedAtRetrieval === (data?.status === 'SUCCESS' && !bundle.redaction.applied), 'EVIDENCE_SCHEMA_INVALID');
  const unproven = ['attemptHistory', 'skillsProvenance', 'tests', 'repairs', 'judgeVerdict', 'githubReferences', 'relatedArtifacts'];
  keys(bundle.coverage, [...unproven, 'runtimeReceiptsPresent', 'toolMetadataPresent', 'runtimeVerification', 'furtherCalls', 'terminalClaimIneligible']);
  assert(unproven.every((field) => bundle.coverage[field] === 'NOT_PROVEN') && bundle.coverage.runtimeReceiptsPresent === (receipts.length > 0) && bundle.coverage.toolMetadataPresent === receipts.some((receipt) => receipt.observed?.toolSummary !== null && receipt.observed?.toolSummary !== undefined) && bundle.coverage.runtimeVerification === 'NOT_PROVEN' && bundle.coverage.furtherCalls === 'NOT_PROVEN' && bundle.coverage.terminalClaimIneligible === true, 'EVIDENCE_SCHEMA_INVALID');
  assert(canonical(redactor([]).sanitize(bundle)) === canonical(bundle), 'EVIDENCE_UNSAFE_CONTENT');
  return freeze(bundle);
}

export function createEvidenceArtifact(snapshot, options = {}) {
  const bundle = buildEvidenceBundle(snapshot, options);
  const serialized = canonical(bundle);
  return Object.freeze({ bundle, serialized, sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'), sizeBytes: Buffer.byteLength(serialized, 'utf8') });
}

export function serializeEvidenceBundle(bundle) {
  return canonical(validateEvidenceBundle(bundle));
}
