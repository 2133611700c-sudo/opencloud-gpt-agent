import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

// OpenClaw's configured agent identity is distinct from the Kernel role `researcher`.
export const RESEARCH_OPENCLAW_AGENT_ID = 'main';
export const RESEARCH_DEEPSEEK_AUTH_PROFILE_ID = 'deepseek:manual';
const AUTH_ARGS = Object.freeze(['models', 'auth', 'list', '--provider', 'deepseek', '--agent', RESEARCH_OPENCLAW_AGENT_ID, '--json']);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const SAFE_AUTH_ENV_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
]);

export class ResearchAuthScopeError extends Error {
  constructor(message, { code = 'RESEARCH_AUTH_SCOPE_ERROR' } = {}) {
    super(message);
    this.name = 'ResearchAuthScopeError';
    this.code = code;
  }
}

const fail = (message, code) => {
  throw new ResearchAuthScopeError(message, { code });
};

export function buildResearchAuthProbeEnv(env = process.env) {
  if (!env || typeof env !== 'object') throw new TypeError('env must be an object');
  const stateDir = env.OPENCLAW_STATE_DIR;
  if (typeof stateDir !== 'string' || stateDir.trim() === '' || !isAbsolute(stateDir)) {
    throw new TypeError('OPENCLAW_STATE_DIR must be an absolute path for the auth probe');
  }
  const childEnv = {};
  for (const key of SAFE_AUTH_ENV_KEYS) {
    if (typeof env[key] === 'string' && env[key] !== '') childEnv[key] = env[key];
  }
  childEnv.OPENCLAW_STATE_DIR = stateDir;
  return childEnv;
}

export function parseStoredDeepSeekAuth(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    fail('OpenClaw DeepSeek auth profile check returned empty output', 'AUTH_SCOPE_INVALID_OUTPUT');
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail('OpenClaw DeepSeek auth profile check returned invalid JSON', 'AUTH_SCOPE_INVALID_OUTPUT');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.profiles)) {
    fail('OpenClaw DeepSeek auth profile check omitted profiles array', 'AUTH_SCOPE_INVALID_OUTPUT');
  }
  if (parsed.provider !== 'deepseek') {
    fail('OpenClaw DeepSeek auth profile check returned unexpected provider', 'AUTH_SCOPE_PROVIDER_MISMATCH');
  }
  if (parsed.agentId !== RESEARCH_OPENCLAW_AGENT_ID) {
    fail('OpenClaw DeepSeek auth profile check returned unexpected agent', 'AUTH_SCOPE_AGENT_MISMATCH');
  }
  if (parsed.profiles.length === 0) {
    fail('stored DeepSeek API key is missing for the Research OpenClaw agent', 'STORED_DEEPSEEK_AUTH_MISSING');
  }
  if (parsed.profiles.length !== 1) {
    fail('OpenClaw DeepSeek auth profile check returned ambiguous profiles', 'AUTH_SCOPE_AMBIGUOUS_PROFILES');
  }
  const profile = parsed.profiles[0];
  if (!profile || profile.id !== RESEARCH_DEEPSEEK_AUTH_PROFILE_ID || profile.type !== 'api_key') {
    fail('OpenClaw DeepSeek auth profile check returned unexpected API key profile', 'AUTH_SCOPE_PROFILE_MISMATCH');
  }
  if (profile.provider !== 'deepseek') {
    fail('OpenClaw DeepSeek auth profile belongs to an unexpected provider', 'AUTH_SCOPE_PROVIDER_MISMATCH');
  }
  // Do not return CLI credential hints, auth paths, or other raw profile fields.
  return Object.freeze({ agentId: RESEARCH_OPENCLAW_AGENT_ID, provider: 'deepseek',
    profileId: RESEARCH_DEEPSEEK_AUTH_PROFILE_ID, type: 'api_key', profileCount: 1 });
}

export function runOpenClawAuthProbe({
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  spawnImpl = spawn,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('timeoutMs must be an integer between 1 and 60000');
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024) {
    throw new RangeError('maxOutputBytes must be an integer between 1 and 16777216');
  }
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    let child;
    let timer = null;

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      reject(error);
    };
    const killChild = () => {
      try { if (child && !child.killed) child.kill('SIGKILL'); } catch { /* best effort */ }
    };
    const overflow = () => {
      killChild();
      settleReject(new ResearchAuthScopeError('OpenClaw auth profile check exceeded output limit', {
        code: 'AUTH_SCOPE_OUTPUT_LIMIT',
      }));
    };

    let childEnv;
    try {
      childEnv = buildResearchAuthProbeEnv(env);
      child = spawnImpl('openclaw', AUTH_ARGS, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        settleReject(error);
      } else {
        settleReject(new ResearchAuthScopeError('failed to start OpenClaw auth profile check', {
          code: 'AUTH_SCOPE_CHECK_FAILED',
        }));
      }
      return;
    }

    timer = setTimeout(() => {
      killChild();
      settleReject(new ResearchAuthScopeError('OpenClaw auth profile check timed out', {
        code: 'AUTH_SCOPE_CHECK_TIMEOUT',
      }));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxOutputBytes) return overflow();
      stdoutChunks.push(buffer);
    });
    child.stderr?.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > maxOutputBytes) return overflow();
      stderrChunks.push(buffer);
    });
    child.on('error', () => {
      killChild();
      settleReject(new ResearchAuthScopeError('OpenClaw auth profile check process failed', {
        code: 'AUTH_SCOPE_CHECK_FAILED',
      }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (timer !== null) clearTimeout(timer);
      settled = true;
      if (code !== 0 || signal) {
        reject(new ResearchAuthScopeError('OpenClaw auth profile check exited unsuccessfully', {
          code: 'AUTH_SCOPE_CHECK_FAILED',
        }));
        return;
      }
      resolve(Object.freeze({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }));
    });
  });
}

export async function verifyStoredDeepSeekAuth({
  env = process.env,
  runCommand = runOpenClawAuthProbe,
} = {}) {
  if (typeof runCommand !== 'function') throw new TypeError('runCommand must be a function');
  let result;
  try {
    result = await runCommand({ env });
  } catch (error) {
    if (error instanceof ResearchAuthScopeError || error instanceof TypeError) throw error;
    throw new ResearchAuthScopeError('OpenClaw DeepSeek auth profile check failed', {
      code: 'AUTH_SCOPE_CHECK_FAILED',
    });
  }
  return parseStoredDeepSeekAuth(result?.stdout);
}

export const RESEARCH_AUTH_PROBE_ARGS = AUTH_ARGS;
