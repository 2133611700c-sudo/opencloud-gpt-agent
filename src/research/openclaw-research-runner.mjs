import { spawn as nodeSpawn } from 'node:child_process';
import { buildResearchAgentExecInvocation } from './openclaw-research-runtime.mjs';
import { normalizeResearchResult } from './research-contract.mjs';
import { redactSensitiveText } from '../providers/deepseek-smoke-runner.mjs';

const ALLOWED_TOOLS = new Set(['web_search', 'web_fetch']);
const SAFE_ENV_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
]);

export class ResearchRunnerError extends Error {
  constructor(message, {
    code = 'RESEARCH_RUNNER_ERROR',
    exitCode = null,
    signal = null,
    cause = undefined,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ResearchRunnerError';
    this.code = code;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

const positiveInteger = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
};

const safeUsage = (usage) => {
  if (usage == null) return null;
  if (typeof usage !== 'object' || Array.isArray(usage)) {
    throw new ResearchRunnerError('OpenClaw usage telemetry is malformed', { code: 'INVALID_USAGE' });
  }
  const input = usage.input;
  const output = usage.output;
  const total = usage.total;
  if (![input, output, total].every(Number.isSafeInteger)
      || input < 0 || output < 0 || total < 0 || input + output !== total) {
    throw new ResearchRunnerError('OpenClaw usage telemetry is inconsistent', { code: 'INVALID_USAGE' });
  }
  return Object.freeze({ input, output, total });
};

const expectedModelId = (requestedModel) => requestedModel.replace(/^deepseek\//, '');

export function parseResearchAgentEnvelope(raw, { requestedModel } = {}) {
  if (typeof requestedModel !== 'string' || !requestedModel.startsWith('deepseek/')) {
    throw new TypeError('requestedModel must be a deepseek/<model> reference');
  }

  let envelope;
  try {
    envelope = JSON.parse(String(raw ?? ''));
  } catch (error) {
    throw new ResearchRunnerError('OpenClaw agent exec returned invalid JSON', {
      code: 'INVALID_AGENT_ENVELOPE',
      cause: error,
    });
  }
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ResearchRunnerError('OpenClaw agent exec envelope must be an object', {
      code: 'INVALID_AGENT_ENVELOPE',
    });
  }
  if (envelope.ok !== true || envelope.status !== 'ok') {
    throw new ResearchRunnerError('OpenClaw agent exec did not report a successful turn', {
      code: envelope.status === 'timeout' ? 'AGENT_TIMEOUT' : 'AGENT_FAILED',
    });
  }
  if (envelope.provider !== 'deepseek') {
    throw new ResearchRunnerError('Unexpected model provider in agent result', {
      code: 'PROVIDER_MISMATCH',
    });
  }

  const expectedModel = expectedModelId(requestedModel);
  const returnedModel = envelope.model;
  if (returnedModel !== expectedModel && returnedModel !== requestedModel) {
    throw new ResearchRunnerError('Unexpected model in agent result', { code: 'MODEL_MISMATCH' });
  }
  if (envelope.codeModeEngaged === true) {
    throw new ResearchRunnerError('Code Mode was unexpectedly engaged for Research', {
      code: 'UNEXPECTED_CODE_MODE',
    });
  }

  const toolSummary = envelope.toolSummary;
  if (toolSummary === null || typeof toolSummary !== 'object' || Array.isArray(toolSummary)) {
    throw new ResearchRunnerError('Research run is missing tool attestation', {
      code: 'MISSING_TOOL_ATTESTATION',
    });
  }
  if (!Array.isArray(toolSummary.tools)) {
    throw new ResearchRunnerError('Research tool attestation is malformed', {
      code: 'INVALID_TOOL_ATTESTATION',
    });
  }
  const tools = [...new Set(toolSummary.tools.map((tool) => String(tool)))];
  for (const tool of tools) {
    if (!ALLOWED_TOOLS.has(tool)) {
      throw new ResearchRunnerError(`Unexpected Research tool: ${tool}`, {
        code: 'UNEXPECTED_TOOL',
      });
    }
  }
  if (!tools.includes('web_search')) {
    throw new ResearchRunnerError('Research run did not attest web_search usage', {
      code: 'WEB_SEARCH_NOT_ATTESTED',
    });
  }

  if (typeof envelope.final !== 'string' || envelope.final.trim() === '') {
    throw new ResearchRunnerError('Research run returned no final JSON', {
      code: 'MISSING_FINAL_RESULT',
    });
  }

  let finalPayload;
  try {
    finalPayload = JSON.parse(envelope.final);
  } catch (error) {
    throw new ResearchRunnerError('Research final output is not valid JSON', {
      code: 'INVALID_FINAL_JSON',
      cause: error,
    });
  }

  let result;
  try {
    result = normalizeResearchResult(finalPayload);
  } catch (error) {
    throw new ResearchRunnerError(`Research result contract failed: ${error.message}`, {
      code: 'INVALID_RESEARCH_RESULT',
      cause: error,
    });
  }

  if (result.status === 'SUCCESS' && !tools.includes('web_fetch')) {
    throw new ResearchRunnerError('SUCCESS requires attested web_fetch usage', {
      code: 'WEB_FETCH_NOT_ATTESTED',
    });
  }

  const usage = safeUsage(envelope.usage);
  let costUsd = null;
  if (envelope.costUsd != null) {
    if (typeof envelope.costUsd !== 'number' || !Number.isFinite(envelope.costUsd) || envelope.costUsd < 0) {
      throw new ResearchRunnerError('OpenClaw cost telemetry is malformed', { code: 'INVALID_COST' });
    }
    costUsd = envelope.costUsd;
  }

  return Object.freeze({
    result,
    provider: 'deepseek',
    model: requestedModel,
    usage,
    costUsd,
    telemetryStatus: usage ? 'AVAILABLE' : 'NOT_EXPOSED',
    toolSummary: Object.freeze({
      calls: Number.isSafeInteger(toolSummary.calls) && toolSummary.calls >= 0 ? toolSummary.calls : null,
      tools: Object.freeze(tools),
      totalToolTimeMs: Number.isSafeInteger(toolSummary.totalToolTimeMs) && toolSummary.totalToolTimeMs >= 0
        ? toolSummary.totalToolTimeMs
        : null,
    }),
    sessionId: typeof envelope.sessionId === 'string' && envelope.sessionId.trim() ? envelope.sessionId : null,
  });
}

export function buildResearchChildEnv(env, stateDir) {
  const childEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (typeof env?.[key] === 'string' && env[key] !== '') childEnv[key] = env[key];
  }
  childEnv.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
  childEnv.OPENCLAW_STATE_DIR = stateDir;
  childEnv.OPENCLAW_EXEC_SHELL_SNAPSHOT = '0';
  return Object.freeze(childEnv);
}

export function runResearchAgent({
  request,
  configPath,
  stateDir,
  model,
  env = process.env,
  timeoutMs = 150_000,
  maxStdoutBytes = 2_000_000,
  maxStderrBytes = 250_000,
  signal,
  spawnImpl = nodeSpawn,
} = {}) {
  const apiKey = env?.DEEPSEEK_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return Promise.reject(new ResearchRunnerError('DEEPSEEK_API_KEY is required', {
      code: 'MISSING_DEEPSEEK_API_KEY',
    }));
  }
  positiveInteger(timeoutMs, 'timeoutMs');
  positiveInteger(maxStdoutBytes, 'maxStdoutBytes');
  positiveInteger(maxStderrBytes, 'maxStderrBytes');
  if (signal != null && !(signal instanceof AbortSignal)) {
    return Promise.reject(new TypeError('signal must be an AbortSignal'));
  }

  const invocation = buildResearchAgentExecInvocation({ request, configPath, stateDir, model });
  const childEnv = buildResearchChildEnv(env, invocation.stateDir);

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
        // Best effort. The triggering failure remains authoritative.
      }
    };
    const failLimit = (stream) => {
      killChild();
      finishReject(new ResearchRunnerError(`${stream} exceeded configured byte limit`, {
        code: stream === 'stdout' ? 'STDOUT_LIMIT_EXCEEDED' : 'STDERR_LIMIT_EXCEEDED',
      }));
    };
    const onAbort = () => {
      killChild();
      finishReject(new ResearchRunnerError('Research agent aborted', { code: 'ABORTED' }));
    };

    const timer = setTimeout(() => {
      killChild();
      finishReject(new ResearchRunnerError(`Research agent timed out after ${timeoutMs} ms`, {
        code: 'TIMEOUT',
      }));
    }, timeoutMs);

    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(new ResearchRunnerError('Research agent aborted', { code: 'ABORTED' }));
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child = spawnImpl(invocation.executable, [...invocation.args], {
        shell: false,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      return finishReject(new ResearchRunnerError(
        `Failed to start Research agent: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'SPAWN_FAILED', cause: error },
      ));
    }

    child.stdout?.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxStdoutBytes) return failLimit('stdout');
      stdoutChunks.push(buffer);
    });
    child.stderr?.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > maxStderrBytes) return failLimit('stderr');
      stderrChunks.push(buffer);
    });
    child.on('error', (error) => {
      finishReject(new ResearchRunnerError(
        `Research agent process error: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'SPAWN_FAILED', cause: error },
      ));
    });

    child.stdin?.on('error', (error) => {
      finishReject(new ResearchRunnerError(
        `Research agent stdin error: ${redactSensitiveText(error?.message, [apiKey])}`,
        { code: 'STDIN_FAILED', cause: error },
      ));
    });
    child.stdin?.end(invocation.stdin);

    child.on('close', (exitCode, exitSignal) => {
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = redactSensitiveText(Buffer.concat(stderrChunks).toString('utf8'), [apiKey]);

      if (exitCode !== 0) {
        const detail = (stderr || redactSensitiveText(stdout, [apiKey]) || 'no process detail').trim();
        return finishReject(new ResearchRunnerError(
          `OpenClaw Research agent exited nonzero: ${detail}`,
          {
            code: exitCode === 2 ? 'AGENT_TIMEOUT' : 'NONZERO_EXIT',
            exitCode,
            signal: exitSignal,
          },
        ));
      }

      try {
        const parsed = parseResearchAgentEnvelope(stdout, { requestedModel: invocation.model });
        settled = true;
        cleanup();
        resolve(Object.freeze({
          ...parsed,
          process: Object.freeze({ exitCode, signal: exitSignal, stderr: stderr.trim() }),
        }));
      } catch (error) {
        finishReject(error instanceof ResearchRunnerError
          ? error
          : new ResearchRunnerError(`Invalid Research success output: ${error.message}`, {
            code: 'INVALID_SUCCESS_OUTPUT',
            cause: error,
          }));
      }
    });
  });
}
