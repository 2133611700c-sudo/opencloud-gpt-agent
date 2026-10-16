import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { buildResearchAuthProbeEnv, RESEARCH_OPENCLAW_AGENT_ID } from '../research/research-auth-scope.mjs';

const MODEL_RE = /^deepseek\/[A-Za-z0-9._:-]+$/;
const DEFAULT_MODEL = 'deepseek/deepseek-flash';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const SAFE_ENV_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
]);

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
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || !Array.isArray(catalog.models)) return false;
  return catalog.models.some((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.available === false) return false;
    if (Object.hasOwn(record, 'provider') && record.provider !== 'deepseek') return false;
    return ['key', 'id', 'model'].some((field) => record[field] === model || record[field] === shortModel);
  });
};

export function refreshDeepSeekModelCatalog({
  model = DEFAULT_MODEL,
  env = process.env,
  credentialMode = 'stored-agent',
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
  if (!['stored-agent', 'environment'].includes(credentialMode)) {
    throw new TypeError('credentialMode must be stored-agent or environment');
  }
  let childEnv;
  if (credentialMode === 'stored-agent') {
    childEnv = buildResearchAuthProbeEnv(env);
  } else {
    if (typeof env?.DEEPSEEK_API_KEY !== 'string' || env.DEEPSEEK_API_KEY.trim() === '') {
      throw new TypeError('DEEPSEEK_API_KEY is required for environment catalog discovery');
    }
    childEnv = env.OPENCLAW_STATE_DIR ? buildResearchAuthProbeEnv(env) : {};
    for (const key of SAFE_ENV_KEYS) {
      if (typeof env[key] === 'string' && env[key] !== '') childEnv[key] = env[key];
    }
    childEnv.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
  }

  const result = spawnSyncImpl(
    'openclaw',
    ['models', 'list', '--refresh', '--provider', 'deepseek', '--agent', RESEARCH_OPENCLAW_AGENT_ID, '--json'],
    {
      env: childEnv,
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
  // OpenClaw can exit zero while showing only the published catalog after a
  // provider discovery failure. Presence in that fallback is not live discovery.
  if (/model discovery could not refresh|showing available published model list|failed to (?:refresh|discover)|fetch (?:failed|timed?\s*out|timeout)/i.test(String(result?.stderr ?? ''))) {
    throw new DeepSeekCatalogRefreshError('OpenClaw DeepSeek discovery returned a published-catalog fallback', {
      code: 'DEEPSEEK_CATALOG_DISCOVERY_FAILED',
    });
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
