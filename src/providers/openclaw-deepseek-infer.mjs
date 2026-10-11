const DEEPSEEK_PREFIX = 'deepseek/';
const THINKING_LEVELS = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'adaptive',
  'xhigh',
  'max',
]);

const requireNonBlankString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a nonblank string`);
  }
  return value;
};

export function validateDeepSeekModelRef(model) {
  requireNonBlankString(model, 'model');
  if (!model.startsWith(DEEPSEEK_PREFIX) || model.length <= DEEPSEEK_PREFIX.length) {
    throw new RangeError('model must be a full deepseek/<model> reference');
  }
  if (/\s/.test(model)) {
    throw new RangeError('model reference must not contain whitespace');
  }
  return model;
}

export function buildDeepSeekInferInvocation({
  model,
  prompt,
  thinking = 'off',
  executable = 'openclaw',
} = {}) {
  const normalizedModel = validateDeepSeekModelRef(model);
  const normalizedPrompt = requireNonBlankString(prompt, 'prompt');
  requireNonBlankString(executable, 'executable');

  if (!THINKING_LEVELS.has(thinking)) {
    throw new RangeError(`unsupported thinking level: ${thinking}`);
  }

  return Object.freeze({
    executable,
    args: Object.freeze([
      'infer',
      'model',
      'run',
      '--local',
      '--model',
      normalizedModel,
      '--prompt',
      normalizedPrompt,
      '--thinking',
      thinking,
      '--json',
    ]),
    envRequirements: Object.freeze(['DEEPSEEK_API_KEY']),
    expectedProvider: 'deepseek',
    requestedModel: normalizedModel,
    transport: 'local',
  });
}

const parseEnvelope = (value) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new TypeError(`OpenClaw infer output is not valid JSON: ${error.message}`);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('OpenClaw infer envelope must be an object or JSON object string');
  }
  return value;
};

const extractText = (outputs) => {
  if (!Array.isArray(outputs)) return '';
  return outputs
    .map((item) => (item && typeof item === 'object' && typeof item.text === 'string' ? item.text : ''))
    .filter((text) => text.trim() !== '')
    .join('\n')
    .trim();
};

const normalizeModel = (provider, model) => {
  if (typeof model !== 'string' || model.trim() === '') return null;
  return model.includes('/') ? model : `${provider}/${model}`;
};

const normalizeOptionalUsage = (usage) => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;

  const copyInteger = (field) => {
    const value = usage[field];
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };

  const normalized = {
    input: copyInteger('input'),
    output: copyInteger('output'),
    total: copyInteger('total'),
    cacheRead: copyInteger('cacheRead'),
    cacheWrite: copyInteger('cacheWrite'),
  };

  return Object.values(normalized).some((value) => value !== null)
    ? Object.freeze(normalized)
    : null;
};

export function parseDeepSeekInferEnvelope(value, { requestedModel } = {}) {
  const envelope = parseEnvelope(value);
  const expectedModel = validateDeepSeekModelRef(requestedModel);

  if (envelope.ok !== true) {
    const detail = typeof envelope.error === 'string'
      ? envelope.error
      : JSON.stringify(envelope.error ?? null);
    throw new Error(`OpenClaw infer failed: ${detail}`);
  }
  if (envelope.capability !== 'model.run') {
    throw new Error(`unexpected capability: ${String(envelope.capability)}`);
  }
  if (envelope.transport !== 'local') {
    throw new Error(`unexpected transport: ${String(envelope.transport)}`);
  }
  if (envelope.provider !== 'deepseek') {
    throw new Error(`unexpected provider: ${String(envelope.provider)}`);
  }

  const actualModel = normalizeModel(envelope.provider, envelope.model);
  if (actualModel !== expectedModel) {
    throw new Error(`model mismatch: requested=${expectedModel}, actual=${String(actualModel)}`);
  }

  const text = extractText(envelope.outputs);
  if (text === '') {
    throw new Error('OpenClaw infer returned no nonempty text output');
  }

  const usage = normalizeOptionalUsage(envelope.usage);
  const costUsd = typeof envelope.costUsd === 'number' && Number.isFinite(envelope.costUsd) && envelope.costUsd >= 0
    ? envelope.costUsd
    : null;

  return Object.freeze({
    provider: 'deepseek',
    model: actualModel,
    transport: 'local',
    text,
    attempts: Array.isArray(envelope.attempts) ? Object.freeze([...envelope.attempts]) : Object.freeze([]),
    telemetry: Object.freeze({
      usage,
      costUsd,
      usageFidelity: usage ? 'OBSERVED_PARTIAL_OR_FULL' : 'NOT_EXPOSED_BY_ENVELOPE',
      costFidelity: costUsd !== null ? 'OBSERVED' : 'NOT_EXPOSED_BY_ENVELOPE',
      cacheSplitInvented: false,
    }),
  });
}
