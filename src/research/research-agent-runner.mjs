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

export class MissingResearchCredentialError extends Error {
  constructor() {
    super('DEEPSEEK_API_KEY is required for the Research agent');
    this.name = 'MissingResearchCredentialError';
    this.code = 'MISSING_DEEPSEEK_API_KEY';
  }
}

export class ResearchAgentProcessError extends Error {
  constructor(message, { code = 'RESEARCH_AGENT_PROCESS_ERROR', exitCode = null, signal = null } = {}) {
    super(message);
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

const researchTimeoutSeconds = (timeoutMs) => Math.max(10, Math.min(300, Math.ceil(timeoutMs / 1000)));

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
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new MissingResearchCredentialError();
  }

  positiveInteger(timeoutMs, 'timeoutMs', 300_000);
  positiveInteger(maxStdoutBytes, 'maxStdoutBytes', 10_000_000);
  positiveInteger(maxStderrBytes, 'maxStderrBytes', 2_000_000);
  if (signal != null && !(signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (signal?.aborted) {
    throw new ResearchAgentProcessError('Research agent aborted before start', { code: 'ABORTED' });
  }

  const config = buildResearchOpenClawConfig(configOptions);
  const tempDir = await mkdtemp(join(tempRoot, 'openclaw-v2-research-'));
  const configPath = join(tempDir, 'openclaw.json');

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    // Explicit chmod closes the umask/platform ambiguity and makes the contract observable in tests.
    await chmod(configPath, 0o600);

    const invocation = buildResearchAgentExecInvocation({
      request,
      configPath,
      model,
      timeoutSeconds: researchTimeoutSeconds(timeoutMs),
    });

    return await new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks = [];
      const stderrChunks = [];

      const cleanupListeners = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        reject(error);
      };

      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resolve(value);
      };

      const killChild = () => {
        try {
          if (child && !child.killed) child.kill('SIGKILL');
        } catch {
          // Best effort. The initiating failure remains authoritative.
        }
      };

      const onAbort = () => {
        killChild();
        finishReject(new ResearchAgentProcessError('Research agent aborted', { code: 'ABORTED' }));
      };

      const timer = setTimeout(() => {
        killChild();
        finishReject(new ResearchAgentProcessError(
          `Research agent timed out after ${timeoutMs} ms`,
          { code: 'TIMEOUT' },
        ));
      }, timeoutMs);

      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        child = spawnImpl(invocation.executable, [...invocation.args], {
          shell: false,
          env: {
            ...env,
            OPENCLAW_CONFIG_PATH: configPath,
            OPENCLAW_CONFIG_READONLY: '1',
          },
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
          finishReject(new ResearchAgentProcessError('stdout exceeded configured byte limit', {
            code: 'STDOUT_LIMIT_EXCEEDED',
          }));
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
          finishReject(new ResearchAgentProcessError('stderr exceeded configured byte limit', {
            code: 'STDERR_LIMIT_EXCEEDED',
          }));
          return;
        }
        stderrChunks.push(buffer);
      });

      child.on('error', (error) => {
        finishReject(new ResearchAgentProcessError(
          `OpenClaw Research process error: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'SPAWN_FAILED' },
        ));
      });

      child.stdin?.on('error', (error) => {
        finishReject(new ResearchAgentProcessError(
          `OpenClaw Research stdin error: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'STDIN_FAILED' },
        ));
      });

      try {
        child.stdin?.end(invocation.stdin);
      } catch (error) {
        finishReject(new ResearchAgentProcessError(
          `Failed to send Research prompt: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'STDIN_FAILED' },
        ));
        return;
      }

      child.on('close', (exitCode, exitSignal) => {
        if (settled) return;
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = redactSensitiveText(Buffer.concat(stderrChunks).toString('utf8'), [apiKey]);

        if (exitCode !== 0) {
          const detail = (stderr || redactSensitiveText(stdout, [apiKey]) || 'no process detail').trim();
          finishReject(new ResearchAgentProcessError(
            `OpenClaw Research exited nonzero: ${detail}`,
            { code: 'NONZERO_EXIT', exitCode, signal: exitSignal },
          ));
          return;
        }

        try {
          const parsed = parseResearchAgentEnvelope(stdout, { requestedModel: invocation.model });
          finishResolve(Object.freeze({
            ...parsed,
            process: Object.freeze({
              exitCode,
              signal: exitSignal,
              stdoutBytes,
              stderrBytes,
              stderrPresent: stderr.trim().length > 0,
            }),
          }));
        } catch (error) {
          finishReject(new ResearchAgentProcessError(
            `Invalid OpenClaw Research success output: ${redactSensitiveText(error?.message, [apiKey])}`,
            { code: 'INVALID_SUCCESS_ENVELOPE', exitCode, signal: exitSignal },
          ));
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
