import { spawnSync as nodeSpawnSync } from 'node:child_process';

const MODEL_RE = /^deepseek\/[A-Za-z0-9._:-]+$/;
const DEFAULT_MODEL = 'deepseek/deepseek-flash';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export class DeepSeekCatalogRefreshError extends Error {
  constructor(message, { code = 'DEEPSEEK_CATALOG_REFRESH_FAILED' } = {}) {
    super(message);
    this.name = 'DeepSeekCatalogRefreshError';
    this.code = code;
  }
}

const redact = (value, secret) => {
  let text = String(value ?? '');
  if (typeof secret === 'string' && secret.length > 0) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
};

const catalogContainsModel = (catalog, model) => {
  const shortModel = model.slice('deepseek/'.length);
  const visit = (value) => {
    if (typeof value === 'string') return value === model || value === shortModel;
    if (Array.isArray(value)) return value.some(visit);
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([key, child]) => key === model || key === shortModel || visit(child));
    }
    return false;
  };
  return visit(catalog);
};

export function refreshDeepSeekModelCatalog({
  model = DEFAULT_MODEL,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  spawnSyncImpl = nodeSpawnSync,
} = {}) {
  if (typeof model !== 'string' || !MODEL_RE.test(model)) {
    throw new TypeError('model must be a deepseek/<model> reference');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError('timeoutMs must be an integer between 1 and 120000');
  }
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1 || maxBufferBytes > 16 * 1024 * 1024) {
    throw new RangeError('maxBufferBytes must be an integer between 1 and 16777216');
  }
  if (typeof spawnSyncImpl !== 'function') throw new TypeError('spawnSyncImpl must be a function');

  const result = spawnSyncImpl(
    'openclaw',
    ['models', 'list', '--refresh', '--provider', 'deepseek', '--json'],
    {
      env: { ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes,
    },
  );

  const secret = env?.DEEPSEEK_API_KEY;
  if (result?.error) {
    throw new DeepSeekCatalogRefreshError(
      `OpenClaw DeepSeek catalog refresh failed to start: ${redact(result.error.message, secret)}`,
      { code: 'DEEPSEEK_CATALOG_REFRESH_SPAWN_FAILED' },
    );
  }
  if (result?.status !== 0) {
    const detail = redact(result?.stderr || result?.stdout || 'no process detail', secret).trim().slice(-2000);
    throw new DeepSeekCatalogRefreshError(
      `OpenClaw DeepSeek catalog refresh exited ${result?.status ?? 'UNKNOWN'}: ${detail}`,
      { code: 'DEEPSEEK_CATALOG_REFRESH_NONZERO' },
    );
  }

  let catalog;
  try {
    catalog = JSON.parse(String(result?.stdout || '').trim());
  } catch {
    throw new DeepSeekCatalogRefreshError(
      'OpenClaw DeepSeek catalog refresh returned invalid JSON',
      { code: 'DEEPSEEK_CATALOG_REFRESH_INVALID_JSON' },
    );
  }

  if (!catalogContainsModel(catalog, model)) {
    throw new DeepSeekCatalogRefreshError(
      `Requested model ${model} is absent after DeepSeek catalog refresh`,
      { code: 'DEEPSEEK_MODEL_NOT_DISCOVERED' },
    );
  }

  return Object.freeze({
    provider: 'deepseek',
    model,
    refreshed: true,
  });
}

export const DEFAULT_DEEPSEEK_CATALOG_MODEL = DEFAULT_MODEL;
