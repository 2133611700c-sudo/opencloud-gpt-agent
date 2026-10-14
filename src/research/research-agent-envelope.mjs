import { ResearchContractError, normalizeResearchResult } from './research-contract.mjs';

const ALLOWED_RESEARCH_TOOLS = new Set(['web_search', 'web_fetch']);

export class ResearchAgentEnvelopeError extends Error {
  constructor(message, { code = 'RESEARCH_AGENT_ENVELOPE_INVALID', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ResearchAgentEnvelopeError';
    this.code = code;
  }
}

const fail = (message, code, cause) => {
  throw new ResearchAgentEnvelopeError(message, { code, cause });
};

const objectOrFail = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'INVALID_ENVELOPE_SHAPE');
  }
  return value;
};

const nonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer`, 'INVALID_TELEMETRY');
  }
  return value;
};

const optionalNonNegativeInteger = (value, label) => {
  if (value == null) return null;
  return nonNegativeInteger(value, label);
};

const nonNegativeNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a nonnegative finite number`, 'INVALID_TELEMETRY');
  }
  return value;
};

const REJECTED_BILLING_REASON = 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY';

const safeBillingSession = (value, sensitiveValues) => {
  if (typeof value !== 'string') return null;
  const session = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(session)) return null;
  if (/(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i.test(session)) return null;
  if (Array.isArray(sensitiveValues) && sensitiveValues.some((secret) => typeof secret === 'string' && secret !== '' && session.includes(secret))) return null;
  return session;
};

// Billing remains independent of Research acceptance: a rejected final/tool result
// can still contain a charged, observed provider response. Never return its payload.
export function parseRejectedResearchBilling(stdout, { requestedModel, sensitiveValues = [] } = {}) {
  if (typeof requestedModel !== 'string' || !/^deepseek\/[A-Za-z0-9._:-]+$/.test(requestedModel)) {
    throw new TypeError('requestedModel must be a deepseek/<model> reference');
  }
  const fallback = Object.freeze({
    provider: null, model: null, usage: null, costUsd: null, sessionId: null,
    accountingFallbackReason: REJECTED_BILLING_REASON,
  });
  if (typeof stdout !== 'string' || stdout.trim() === '') return fallback;
  try {
    const envelope = objectOrFail(JSON.parse(stdout), 'agent envelope');
    const expectedModel = requestedModel.slice('deepseek/'.length);
    if (envelope.ok !== true || envelope.status !== 'ok' || envelope.provider !== 'deepseek'
      || (envelope.model !== expectedModel && envelope.model !== requestedModel)
      || envelope.usage == null || envelope.costUsd == null) return fallback;
    const rawUsage = objectOrFail(envelope.usage, 'usage');
    const input = nonNegativeInteger(rawUsage.input, 'usage.input');
    const output = nonNegativeInteger(rawUsage.output, 'usage.output');
    const total = nonNegativeInteger(rawUsage.total, 'usage.total');
    const cacheRead = optionalNonNegativeInteger(rawUsage.cacheRead, 'usage.cacheRead');
    const cacheWrite = optionalNonNegativeInteger(rawUsage.cacheWrite, 'usage.cacheWrite');
    if (total !== input + output + (cacheRead ?? 0) + (cacheWrite ?? 0)) return fallback;
    const costUsd = nonNegativeNumber(envelope.costUsd, 'costUsd');
    return Object.freeze({
      provider: 'deepseek', model: expectedModel,
      usage: Object.freeze({ input, output, total, cacheRead, cacheWrite }), costUsd,
      sessionId: safeBillingSession(envelope.sessionId, sensitiveValues),
      accountingFallbackReason: REJECTED_BILLING_REASON,
    });
  } catch {
    return fallback;
  }
}

export function parseResearchAgentEnvelope(stdout, { requestedModel } = {}) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    fail('OpenClaw agent stdout is empty', 'EMPTY_AGENT_STDOUT');
  }
  if (typeof requestedModel !== 'string' || !/^deepseek\/[A-Za-z0-9._:-]+$/.test(requestedModel)) {
    throw new TypeError('requestedModel must be a deepseek/<model> reference');
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    fail('OpenClaw agent stdout is not valid JSON', 'INVALID_AGENT_JSON', error);
  }
  objectOrFail(envelope, 'agent envelope');

  if (envelope.ok !== true || envelope.status !== 'ok') {
    fail('OpenClaw agent run did not report ok status', 'AGENT_RUN_FAILED');
  }
  if (envelope.provider !== 'deepseek') {
    fail(`unexpected provider: ${String(envelope.provider)}`, 'PROVIDER_MISMATCH');
  }

  const expectedModel = requestedModel.slice('deepseek/'.length);
  if (envelope.model !== expectedModel && envelope.model !== requestedModel) {
    fail(`unexpected model: ${String(envelope.model)}`, 'MODEL_MISMATCH');
  }
  if (envelope.codeModeEngaged !== false) {
    fail('research run did not prove direct code mode', 'CODE_MODE_NOT_DIRECT');
  }
  if (typeof envelope.final !== 'string' || envelope.final.trim() === '') {
    fail('OpenClaw agent final output is empty', 'EMPTY_AGENT_FINAL');
  }

  const toolSummary = objectOrFail(envelope.toolSummary, 'toolSummary');
  const toolCalls = nonNegativeInteger(toolSummary.calls, 'toolSummary.calls');
  const toolFailures = toolSummary.failures == null
    ? 0
    : nonNegativeInteger(toolSummary.failures, 'toolSummary.failures');
  if (toolFailures > toolCalls) {
    fail('toolSummary.failures cannot exceed toolSummary.calls', 'INVALID_TOOL_EVIDENCE');
  }
  if (!Array.isArray(toolSummary.tools)) {
    fail('toolSummary.tools must be an array', 'INVALID_TOOL_EVIDENCE');
  }
  const tools = [...new Set(toolSummary.tools.map((tool) => {
    if (typeof tool !== 'string' || tool.trim() === '') {
      fail('toolSummary contains an invalid tool name', 'INVALID_TOOL_EVIDENCE');
    }
    return tool.trim();
  }))];
  if (toolCalls < 1 || tools.length < 1) {
    fail('research run contains no tool evidence', 'NO_WEB_TOOL_EVIDENCE');
  }
  for (const tool of tools) {
    if (!ALLOWED_RESEARCH_TOOLS.has(tool)) {
      fail(`research run used disallowed tool: ${tool}`, 'DISALLOWED_TOOL_USED');
    }
  }
  if (!tools.includes('web_search')) {
    fail('research run did not use web_search', 'NO_WEB_SEARCH_EVIDENCE');
  }

  let unresolvedError = null;
  if (toolSummary.unresolvedError != null) {
    const rawUnresolved = objectOrFail(toolSummary.unresolvedError, 'toolSummary.unresolvedError');
    if (typeof rawUnresolved.toolName !== 'string' || rawUnresolved.toolName.trim() === '') {
      fail('toolSummary.unresolvedError.toolName must be a non-empty string', 'INVALID_TOOL_EVIDENCE');
    }
    const toolName = rawUnresolved.toolName.trim();
    if (!tools.includes(toolName)) {
      fail('toolSummary.unresolvedError references a tool absent from toolSummary.tools', 'INVALID_TOOL_EVIDENCE');
    }
    if (!ALLOWED_RESEARCH_TOOLS.has(toolName)) {
      fail(`research run has unresolved failure for disallowed tool: ${toolName}`, 'DISALLOWED_TOOL_USED');
    }
    if (toolFailures < 1) {
      fail('toolSummary.unresolvedError requires toolSummary.failures >= 1', 'INVALID_TOOL_EVIDENCE');
    }
    unresolvedError = Object.freeze({ toolName });
  }

  let rawResult;
  try {
    rawResult = JSON.parse(envelope.final);
  } catch (error) {
    fail('agent final output is not strict JSON', 'INVALID_RESEARCH_JSON', error);
  }

  let result;
  try {
    result = normalizeResearchResult(rawResult);
  } catch (error) {
    if (error instanceof ResearchContractError) {
      fail(`research result contract rejected output: ${error.message}`, 'INVALID_RESEARCH_RESULT', error);
    }
    throw error;
  }

  if (result.status === 'SUCCESS' && !tools.includes('web_fetch')) {
    fail('SUCCESS research run did not use web_fetch', 'NO_WEB_FETCH_EVIDENCE');
  }
  if (result.status === 'SUCCESS' && unresolvedError) {
    fail(`SUCCESS research run has unresolved tool failure: ${unresolvedError.toolName}`, 'UNRESOLVED_WEB_TOOL_FAILURE');
  }

  let usage = null;
  let telemetryStatus = 'NOT_EXPOSED';
  if (envelope.usage != null) {
    const rawUsage = objectOrFail(envelope.usage, 'usage');
    const input = nonNegativeInteger(rawUsage.input, 'usage.input');
    const output = nonNegativeInteger(rawUsage.output, 'usage.output');
    const total = nonNegativeInteger(rawUsage.total, 'usage.total');
    const cacheRead = optionalNonNegativeInteger(rawUsage.cacheRead, 'usage.cacheRead');
    const cacheWrite = optionalNonNegativeInteger(rawUsage.cacheWrite, 'usage.cacheWrite');
    const expectedTotal = input + output + (cacheRead ?? 0) + (cacheWrite ?? 0);
    if (total !== expectedTotal) {
      fail('usage.total must equal input + output + cacheRead + cacheWrite', 'INVALID_TELEMETRY');
    }
    usage = Object.freeze({ input, output, total, cacheRead, cacheWrite });
    telemetryStatus = cacheRead !== null && cacheWrite !== null ? 'AVAILABLE_FULL' : 'AVAILABLE_NO_CACHE_SPLIT';
  }

  const costUsd = envelope.costUsd == null ? null : nonNegativeNumber(envelope.costUsd, 'costUsd');
  const assistantTurns = envelope.assistantTurns == null
    ? null
    : nonNegativeInteger(envelope.assistantTurns, 'assistantTurns');
  const totalToolTimeMs = toolSummary.totalToolTimeMs == null
    ? null
    : nonNegativeInteger(toolSummary.totalToolTimeMs, 'toolSummary.totalToolTimeMs');

  return Object.freeze({
    result,
    telemetry: Object.freeze({
      provider: 'deepseek',
      model: expectedModel,
      usage,
      telemetryStatus,
      costUsd,
      assistantTurns,
      toolSummary: Object.freeze({
        calls: toolCalls,
        tools: Object.freeze(tools),
        failures: toolFailures,
        unresolvedError,
        totalToolTimeMs,
      }),
      sessionId: typeof envelope.sessionId === 'string' && envelope.sessionId.trim()
        ? envelope.sessionId.trim()
        : null,
    }),
  });
}
