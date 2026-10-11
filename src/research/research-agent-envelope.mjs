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

const nonNegativeNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a nonnegative finite number`, 'INVALID_TELEMETRY');
  }
  return value;
};

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

  let usage = null;
  if (envelope.usage != null) {
    const rawUsage = objectOrFail(envelope.usage, 'usage');
    const input = nonNegativeInteger(rawUsage.input, 'usage.input');
    const output = nonNegativeInteger(rawUsage.output, 'usage.output');
    const total = nonNegativeInteger(rawUsage.total, 'usage.total');
    if (total !== input + output) {
      fail('usage.total must equal input + output', 'INVALID_TELEMETRY');
    }
    usage = Object.freeze({ input, output, total });
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
      telemetryStatus: usage ? 'AVAILABLE' : 'NOT_EXPOSED',
      costUsd,
      assistantTurns,
      toolSummary: Object.freeze({
        calls: toolCalls,
        tools: Object.freeze(tools),
        totalToolTimeMs,
      }),
      sessionId: typeof envelope.sessionId === 'string' && envelope.sessionId.trim()
        ? envelope.sessionId.trim()
        : null,
    }),
  });
}
