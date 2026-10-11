import { spawn as nodeSpawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { redactSensitiveText } from '../providers/deepseek-smoke-runner.mjs';
import {
  buildResearchAgentExecInvocation,
  buildResearchOpenClawConfig,
} from './openclaw-research-runtime.mjs';
import { parseResearchAgentEnvelope } from './research-agent-envelope.mjs';

const SAFE_ENV_KEYS = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  // Operator trust/plugin root. The per-run state remains OpenClaw-owned and ephemeral.
  'OPENCLAW_STATE_DIR',
]);

export class MissingResearchCredentialError extends Error {
  constructor() {
    super('DEEPSEEK_API_KEY is required for the Research agent');
    this.name = 'MissingResearchCredentialError';
    this.code = 'MISSING_DEEPSEEK_API_KEY';
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

const researchTimeoutSeconds = (timeoutMs) => {
  if (timeoutMs <= 15_000) return 10;
  return Math.max(10, Math.min(295, Math.floor((timeoutMs - 5_000) / 1000)));
};

export function buildResearchChildEnv(env = process.env) {
  const childEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (typeof env?.[key] === 'string' && env[key] !== '') childEnv[key] = env[key];
  }
  childEnv.DEEPSEEK_API_KEY = env?.DEEPSEEK_API_KEY;
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
  tempRoot = tmpdir(),
} = {}) {
  const apiKey = env?.DEEPSEEK_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new MissingResearchCredentialError();

  positiveInteger(timeoutMs, 'timeoutMs', 300_000);
  positiveInteger(maxStdoutBytes, 'maxStdoutBytes', 10_000_000);
  positiveInteger(maxStderrBytes, 'maxStderrBytes', 2_000_000);
  if (signal != null && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  if (signal?.aborted) throw new ResearchAgentProcessError('Research agent aborted before start', { code: 'ABORTED' });

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
    const childEnv = buildResearchChildEnv(env);

    return await new Promise((resolve, reject) => {
      let child;
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
        child = spawnImpl(invocation.executable, [...invocation.args], {
          shell: false,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        finishReject(new ResearchAgentProcessError(
          `Failed to start OpenClaw Research agent: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'SPAWN_FAILED', cause: error },
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
      child.on('error', (error) => finishReject(new ResearchAgentProcessError(
        `OpenClaw Research process error: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'SPAWN_FAILED', cause: error },
      )));
      child.stdin?.on('error', (error) => finishReject(new ResearchAgentProcessError(
        `OpenClaw Research stdin error: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'STDIN_FAILED', cause: error },
      )));

      try { child.stdin?.end(invocation.stdin); }
      catch (error) {
        finishReject(new ResearchAgentProcessError(
          `Failed to send Research prompt: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'STDIN_FAILED', cause: error },
        ));
        return;
      }

      child.on('close', (exitCode, exitSignal) => {
        if (settled) return;
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
            process: Object.freeze({ exitCode, signal: exitSignal, stdoutBytes, stderrBytes, stderrPresent: stderr.trim().length > 0 }),
          }));
        } catch (error) {
          finishReject(new ResearchAgentProcessError(
            `Invalid OpenClaw Research success output: ${redactSensitiveText(error?.message, [apiKey])}`,
            { code: 'INVALID_SUCCESS_ENVELOPE', exitCode, signal: exitSignal, cause: error },
          ));
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
