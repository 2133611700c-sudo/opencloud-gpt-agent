import { spawn as nodeSpawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { redactSensitiveText } from '../providers/deepseek-smoke-runner.mjs';
import {
  buildResearchAgentExecInvocation,
  buildResearchOpenClawConfig,
} from './openclaw-research-runtime.mjs';
import {
  ResearchAgentEnvelopeError,
  parseRejectedResearchBilling,
  parseResearchAgentEnvelope,
} from './research-agent-envelope.mjs';
import { isSecureResearchStateDir } from './research-trust-root.mjs';
import { verifyStoredDeepSeekAuth } from './research-auth-scope.mjs';

const SAFE_ENV_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
]);

const rejectedResearchBilling = new WeakMap();
const ENVELOPE_REJECTION_CODES = new Set([
  'RESEARCH_AGENT_ENVELOPE_INVALID', 'EMPTY_AGENT_STDOUT', 'INVALID_ENVELOPE_SHAPE',
  'INVALID_AGENT_JSON', 'AGENT_RUN_FAILED', 'PROVIDER_MISMATCH', 'MODEL_MISMATCH',
  'CODE_MODE_NOT_DIRECT', 'EMPTY_AGENT_FINAL', 'INVALID_TELEMETRY', 'INVALID_TOOL_EVIDENCE',
  'NO_WEB_TOOL_EVIDENCE', 'DISALLOWED_TOOL_USED', 'NO_WEB_SEARCH_EVIDENCE',
  'INVALID_RESEARCH_JSON', 'INVALID_RESEARCH_RESULT', 'NO_WEB_FETCH_EVIDENCE',
  'UNRESOLVED_WEB_TOOL_FAILURE',
]);

// Only errors created after a measured native exit-zero rejection are registered.
// No caller-visible property or error name/code can fabricate this identity.
export function getRejectedResearchBilling(error) {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? rejectedResearchBilling.get(error) ?? null
    : null;
}

export class ResearchTrustRootError extends Error {
  constructor() {
    super('OPENCLAW_STATE_DIR must be an existing private non-symlink absolute directory');
    this.name = 'ResearchTrustRootError';
    this.code = 'INVALID_OPENCLAW_STATE_DIR';
  }
}

export class ResearchAgentProcessError extends Error {
  constructor(message, { code = 'RESEARCH_AGENT_PROCESS_ERROR', exitCode = null, signal = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ResearchAgentProcessError';
    this.code = code;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

const positiveInteger = (value, field, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${field} must be a positive safe integer <= ${max}`);
  }
};

const invalidLatency = () => new ResearchAgentProcessError('Research process latency measurement is invalid', {
  code: 'INVALID_PROCESS_LATENCY',
});

const readClock = (nowMs) => {
  try {
    const value = nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidLatency();
    return value;
  } catch {
    throw invalidLatency();
  }
};

const measuredLatency = (startedAt, endedAt) => {
  const elapsed = endedAt - startedAt;
  const latencyMs = Math.max(1, Math.ceil(elapsed));
  if (elapsed < 0 || !Number.isSafeInteger(latencyMs) || latencyMs > 2_147_483_647) throw invalidLatency();
  return latencyMs;
};

const researchTimeoutSeconds = (timeoutMs) => {
  if (timeoutMs <= 15_000) return 10;
  return Math.max(10, Math.min(295, Math.floor((timeoutMs - 5_000) / 1000)));
};

const requireStateDir = (env) => {
  const stateDir = env?.OPENCLAW_STATE_DIR;
  if (typeof stateDir !== 'string' || stateDir.trim() === '' || !isAbsolute(stateDir)) {
    throw new ResearchTrustRootError();
  }
  return stateDir;
};

export function buildResearchChildEnv(env = process.env) {
  const stateDir = requireStateDir(env);
  const childEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (typeof env?.[key] === 'string' && env[key] !== '') childEnv[key] = env[key];
  }
  childEnv.OPENCLAW_STATE_DIR = stateDir;
  childEnv.OPENCLAW_CONFIG_READONLY = '1';
  childEnv.OPENCLAW_EXEC_SHELL_SNAPSHOT = '0';
  return Object.freeze(childEnv);
}

export async function runResearchAgent({
  request,
  model = 'deepseek/deepseek-flash',
  configOptions = {},
  env = process.env,
  timeoutMs = 120_000,
  maxStdoutBytes = 2_000_000,
  maxStderrBytes = 200_000,
  signal,
  spawnImpl = nodeSpawn,
  verifyAuthScopeImpl = verifyStoredDeepSeekAuth,
  nowMs = () => performance.now(),
  tempRoot = tmpdir(),
} = {}) {
  const apiKey = env?.DEEPSEEK_API_KEY;
  if (!isSecureResearchStateDir(env?.OPENCLAW_STATE_DIR)) throw new ResearchTrustRootError();

  positiveInteger(timeoutMs, 'timeoutMs', 300_000);
  positiveInteger(maxStdoutBytes, 'maxStdoutBytes', 10_000_000);
  positiveInteger(maxStderrBytes, 'maxStderrBytes', 2_000_000);
  if (typeof nowMs !== 'function') throw invalidLatency();
  if (typeof verifyAuthScopeImpl !== 'function') throw new TypeError('verifyAuthScopeImpl must be a function');
  if (signal != null && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  if (signal?.aborted) throw new ResearchAgentProcessError('Research agent aborted before start', { code: 'ABORTED' });

  const childEnv = buildResearchChildEnv(env);
  // Direct callers must satisfy the same stored-profile contract as production.
  // This runs before temporary config creation or any paid agent execution.
  await verifyAuthScopeImpl({ env: childEnv });
  if (signal?.aborted) throw new ResearchAgentProcessError('Research agent aborted during auth verification', { code: 'ABORTED' });
  const config = buildResearchOpenClawConfig(configOptions);
  const tempDir = await mkdtemp(join(tempRoot, 'openclaw-v2-research-'));
  const configPath = join(tempDir, 'openclaw.json');

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    if (signal?.aborted) throw new ResearchAgentProcessError('Research agent aborted during setup', { code: 'ABORTED' });

    const invocation = buildResearchAgentExecInvocation({
      request,
      configPath,
      model,
      timeoutSeconds: researchTimeoutSeconds(timeoutMs),
    });

    return await new Promise((resolve, reject) => {
      let child;
      let startedAt;
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks = [];
      const stderrChunks = [];

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const killChild = () => {
        try { if (child && !child.killed) child.kill('SIGKILL'); } catch { /* best effort */ }
      };
      const rejectTransport = (message, code, error) => {
        killChild();
        finishReject(new ResearchAgentProcessError(
          `${message}: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code },
        ));
      };
      const onAbort = () => {
        killChild();
        finishReject(new ResearchAgentProcessError('Research agent aborted', { code: 'ABORTED' }));
      };

      const timer = setTimeout(() => {
        killChild();
        finishReject(new ResearchAgentProcessError(`Research agent timed out after ${timeoutMs} ms`, { code: 'TIMEOUT' }));
      }, timeoutMs);

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }

      try {
        startedAt = readClock(nowMs);
      } catch (error) {
        finishReject(error);
        return;
      }
      try {
        child = spawnImpl(invocation.executable, [...invocation.args], {
          shell: false,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        finishReject(new ResearchAgentProcessError(
          `Failed to start OpenClaw Research agent: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'SPAWN_FAILED' },
        ));
        return;
      }

      child.stdout?.on('data', (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += buffer.length;
        if (stdoutBytes > maxStdoutBytes) {
          killChild();
          finishReject(new ResearchAgentProcessError('stdout exceeded configured byte limit', { code: 'STDOUT_LIMIT_EXCEEDED' }));
          return;
        }
        stdoutChunks.push(buffer);
      });
      child.stderr?.on('data', (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stderrBytes += buffer.length;
        if (stderrBytes > maxStderrBytes) {
          killChild();
          finishReject(new ResearchAgentProcessError('stderr exceeded configured byte limit', { code: 'STDERR_LIMIT_EXCEEDED' }));
          return;
        }
        stderrChunks.push(buffer);
      });
      child.on('error', (error) => rejectTransport('OpenClaw Research process error', 'SPAWN_FAILED', error));
      child.stdin?.on('error', (error) => rejectTransport('OpenClaw Research stdin error', 'STDIN_FAILED', error));

      try { child.stdin?.end(invocation.stdin); }
      catch (error) {
        rejectTransport('Failed to send Research prompt', 'STDIN_FAILED', error);
        return;
      }

      child.on('close', (exitCode, exitSignal) => {
        if (settled) return;
        // Aggregate native runtime wall duration, including tools; not provider HTTP latency.
        let latencyMs;
        try { latencyMs = measuredLatency(startedAt, readClock(nowMs)); }
        catch (error) { finishReject(error); return; }
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = redactSensitiveText(Buffer.concat(stderrChunks).toString('utf8'), [apiKey]);

        if (exitCode !== 0) {
          const detail = (stderr || redactSensitiveText(stdout, [apiKey]) || 'no process detail').trim();
          finishReject(new ResearchAgentProcessError(`OpenClaw Research exited nonzero: ${detail}`, {
            code: exitCode === 2 ? 'AGENT_TIMEOUT' : 'NONZERO_EXIT', exitCode, signal: exitSignal,
          }));
          return;
        }

        try {
          const parsed = parseResearchAgentEnvelope(stdout, { requestedModel: invocation.model });
          finishResolve(Object.freeze({
            ...parsed,
            process: Object.freeze({ exitCode, signal: exitSignal, stdoutBytes, stderrBytes, stderrPresent: stderr.trim().length > 0, latencyMs }),
          }));
        } catch (error) {
          const originalCode = error instanceof ResearchAgentEnvelopeError && ENVELOPE_REJECTION_CODES.has(error.code)
            ? error.code : 'RESEARCH_AGENT_ENVELOPE_INVALID';
          const rejection = new ResearchAgentProcessError(
            `Invalid OpenClaw Research success output (${originalCode})`,
            { code: 'INVALID_SUCCESS_ENVELOPE', exitCode, signal: exitSignal },
          );
          rejectedResearchBilling.set(rejection, Object.freeze({
            research: Object.freeze({
              telemetry: parseRejectedResearchBilling(stdout, {
                requestedModel: invocation.model, sensitiveValues: [apiKey],
              }),
              process: Object.freeze({ latencyMs }),
            }),
            originalCode,
          }));
          finishReject(rejection);
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
