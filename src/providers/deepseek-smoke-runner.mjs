import { spawn as nodeSpawn } from 'node:child_process';
import {
  buildDeepSeekInferInvocation,
  parseDeepSeekInferEnvelope,
} from './openclaw-deepseek-infer.mjs';

export class MissingDeepSeekCredentialError extends Error {
  constructor() {
    super('DEEPSEEK_API_KEY is required for live DeepSeek inference');
    this.name = 'MissingDeepSeekCredentialError';
    this.code = 'MISSING_DEEPSEEK_API_KEY';
  }
}

export class DeepSeekSmokeProcessError extends Error {
  constructor(message, { code = 'DEEPSEEK_SMOKE_PROCESS_ERROR', exitCode = null, signal = null } = {}) {
    super(message);
    this.name = 'DeepSeekSmokeProcessError';
    this.code = code;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export function redactSensitiveText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  // Only redact actual API-key-shaped `sk-...` tokens; avoid broad `sk...` false positives.
  return text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

const assertPositiveInteger = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
};

export function runDeepSeekInferSmoke({
  model,
  prompt = 'Reply with exactly: smoke-ok',
  thinking = 'off',
  env = process.env,
  timeoutMs = 60_000,
  maxStdoutBytes = 1_000_000,
  maxStderrBytes = 200_000,
  signal,
  spawnImpl = nodeSpawn,
} = {}) {
  const apiKey = env?.DEEPSEEK_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return Promise.reject(new MissingDeepSeekCredentialError());
  }
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertPositiveInteger(maxStdoutBytes, 'maxStdoutBytes');
  assertPositiveInteger(maxStderrBytes, 'maxStderrBytes');
  if (signal != null && !(signal instanceof AbortSignal)) {
    return Promise.reject(new TypeError('signal must be an AbortSignal'));
  }

  const invocation = buildDeepSeekInferInvocation({ model, prompt, thinking });

  return new Promise((resolve, reject) => {
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

    const killChild = () => {
      try {
        if (child && !child.killed) child.kill('SIGKILL');
      } catch {
        // Best-effort termination; the original failure remains authoritative.
      }
    };

    const failOutputLimit = (streamName) => {
      killChild();
      finishReject(new DeepSeekSmokeProcessError(
        `${streamName} exceeded configured byte limit`,
        { code: streamName === 'stdout' ? 'STDOUT_LIMIT_EXCEEDED' : 'STDERR_LIMIT_EXCEEDED' },
      ));
    };

    const onAbort = () => {
      killChild();
      finishReject(new DeepSeekSmokeProcessError('DeepSeek smoke aborted', { code: 'ABORTED' }));
    };

    const timer = setTimeout(() => {
      killChild();
      finishReject(new DeepSeekSmokeProcessError(
        `DeepSeek smoke timed out after ${timeoutMs} ms`,
        { code: 'TIMEOUT' },
      ));
    }, timeoutMs);

    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(new DeepSeekSmokeProcessError('DeepSeek smoke aborted', { code: 'ABORTED' }));
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child = spawnImpl(invocation.executable, [...invocation.args], {
        shell: false,
        env: { ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      return finishReject(new DeepSeekSmokeProcessError(
        `Failed to start OpenClaw infer: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'SPAWN_FAILED' },
      ));
    }

    child.stdout?.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxStdoutBytes) return failOutputLimit('stdout');
      stdoutChunks.push(buffer);
    });

    child.stderr?.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > maxStderrBytes) return failOutputLimit('stderr');
      stderrChunks.push(buffer);
    });

    child.on('error', (error) => {
      finishReject(new DeepSeekSmokeProcessError(
        `OpenClaw infer process error: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'SPAWN_FAILED' },
      ));
    });

    child.on('close', (exitCode, exitSignal) => {
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = redactSensitiveText(Buffer.concat(stderrChunks).toString('utf8'), [apiKey]);

      if (exitCode !== 0) {
        const detail = (stderr || redactSensitiveText(stdout, [apiKey]) || 'no process detail').trim();
        return finishReject(new DeepSeekSmokeProcessError(
          `OpenClaw infer exited nonzero: ${detail}`,
          { code: 'NONZERO_EXIT', exitCode, signal: exitSignal },
        ));
      }

      try {
        const parsed = parseDeepSeekInferEnvelope(stdout, { requestedModel: invocation.requestedModel });
        settled = true;
        cleanup();
        resolve(Object.freeze({
          ...parsed,
          process: Object.freeze({
            exitCode,
            signal: exitSignal,
            stderr: stderr.trim(),
          }),
        }));
      } catch (error) {
        finishReject(new DeepSeekSmokeProcessError(
          `Invalid OpenClaw infer success output: ${redactSensitiveText(error?.message, [apiKey])}`,
          { code: 'INVALID_SUCCESS_ENVELOPE', exitCode, signal: exitSignal },
        ));
      }
    });
  });
}
