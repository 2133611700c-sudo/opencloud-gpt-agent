import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {
  buildResearchAuthProbeEnv,
  RESEARCH_OPENCLAW_AGENT_ID,
  verifyStoredDeepSeekAuth,
} from '../src/research/research-auth-scope.mjs';
import { buildResearchOpenClawConfig } from '../src/research/openclaw-research-runtime.mjs';

const model = process.env.OPENCLAW_AUTH_ACCEPTANCE_MODEL || 'deepseek/deepseek-v4-pro';
const marker = 'OPENCLAW_V2_STORED_AUTH_OK';
const steps = [];
let directory;
let failed = false;
let configSha256;
const safeText = (value) => String(value ?? '')
  .replace(/\bsk-[A-Za-z0-9_.-]+/g, '[REDACTED]')
  .replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED]');
const parse = (value) => JSON.parse(value.trim());
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };

try {
  requireTrue(!process.env.DEEPSEEK_API_KEY, 'DIRECT_CREDENTIAL_ENV_PRESENT');
  requireTrue(/^deepseek\/[A-Za-z0-9._:-]+$/.test(model), 'INVALID_ACCEPTANCE_MODEL');
  const env = buildResearchAuthProbeEnv(process.env);
  const auth = await verifyStoredDeepSeekAuth({ env });
  steps.push({ function: 'stored-auth', status: 'PASS', agentId: RESEARCH_OPENCLAW_AGENT_ID,
    profileCount: auth.profileCount, provider: 'deepseek' });
  directory = await mkdtemp(join(tmpdir(), 'openclaw-v2-auth-proof-'));
  const configPath = join(directory, 'openclaw.json');
  const base = buildResearchOpenClawConfig();
  const config = { ...base, agents: { ...base.agents, defaults: {
    ...base.agents.defaults, model: { primary: model, fallbacks: [] },
  } } };
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  configSha256 = createHash('sha256').update(`${JSON.stringify(config)}\n`).digest('hex');
  const childEnv = { ...env, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_CONFIG_READONLY: '1' };
  const run = (name, args, timeoutMs = 90_000, json = true) => {
    const started = performance.now();
    const result = spawnSync('openclaw', args, {
      env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
    });
    const step = { function: name, command: ['openclaw', ...args],
      executionMode: 'installed-product / stored-agent-auth / no-direct-env-key',
      agentId: RESEARCH_OPENCLAW_AGENT_ID, provider: 'deepseek', requestedModel: model,
      credentialSource: 'stored-agent-profile', processExit: result.status,
      elapsedMs: Math.ceil(performance.now() - started),
      stdout: safeText(result.stdout), stderr: safeText(result.stderr),
      nativeCleanupStatus: /cleanup failed|reclamation Worker failed|execution admission is closed/i.test(result.stderr || '')
        ? 'NOT_PROVEN' : 'NO_CLEANUP_ERROR_REPORTED', status: 'NOT_PROVEN' };
    steps.push(step);
    requireTrue(!result.error && result.status === 0,
      result.status === 2 || result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : `${name}_PROCESS_FAILED`);
    return { step, value: json ? parse(result.stdout) : result.stdout };
  };
  const version = run('version', ['--version'], 30_000, false);
  requireTrue(/^OpenClaw 2026\.10\.3(?:\s|$)/.test(version.step.stdout.trim()), 'VERSION_MISMATCH');
  version.step.status = 'PASS';
  const agents = run('agent-identity', ['agents', 'list', '--json']);
  requireTrue(Array.isArray(agents.value) && agents.value.some((a) =>
    a.id === RESEARCH_OPENCLAW_AGENT_ID && a.isDefault === true && a.model === model), 'AGENT_IDENTITY_MISMATCH');
  agents.step.status = 'PASS';
  const catalog = run('catalog-refresh', ['models', 'list', '--agent', RESEARCH_OPENCLAW_AGENT_ID,
    '--provider', 'deepseek', '--refresh', '--json']);
  requireTrue(!/could not refresh|showing the available published model list|fetch timeout/i.test(catalog.step.stderr),
    'CATALOG_REFRESH_FELL_BACK');
  const entries = Array.isArray(catalog.value) ? catalog.value : catalog.value.models;
  requireTrue(Array.isArray(entries) && entries.some((m) =>
    [m.key, m.id, m.model].includes(model) || [m.id, m.model].includes(model.slice(9))), 'CATALOG_MODEL_MISSING');
  catalog.step.status = 'PASS';
  const probe = run('provider-probe', ['models', 'status', '--agent', RESEARCH_OPENCLAW_AGENT_ID,
    '--probe', '--probe-provider', 'deepseek', '--probe-profile', 'deepseek:manual',
    '--probe-timeout', '30000', '--json']);
  requireTrue(probe.value.agentId === RESEARCH_OPENCLAW_AGENT_ID, 'PROBE_AGENT_MISMATCH');
  requireTrue(probe.value.auth?.probes?.results?.some((row) =>
    row.provider === 'deepseek' && row.model === model && row.profileId === 'deepseek:manual'
    && row.source === 'profile' && row.mode === 'api_key' && row.status === 'ok'), 'STORED_PROFILE_PROBE_NOT_PROVEN');
  probe.step.status = 'PASS';
  const execution = run('agent-exec', ['agent', 'exec', '--config', configPath, '--model', model,
    '--code-mode', 'direct', '--thinking', 'max', '--timeout', '60', '--json', `Reply exactly ${marker}`]);
  requireTrue(execution.value.ok === true && execution.value.status === 'ok'
    && execution.value.provider === 'deepseek' && execution.value.model === model.slice(9)
    && execution.value.final === marker, 'AGENT_RESULT_MISMATCH');
  execution.step.status = 'PASS';
  execution.step.thinking = 'max';
  execution.step.usage = execution.value.usage;
  execution.step.costUsd = execution.value.costUsd;
  execution.step.toolsUsed = execution.value.toolSummary?.successfulToolNames ?? null;
  execution.step.toolEvidenceFidelity = execution.value.toolSummary ? 'ENVELOPE' : 'NOT_EXPOSED_BY_ENVELOPE';
} catch (error) {
  failed = true;
  if (steps.at(-1)?.status === 'NOT_PROVEN') steps.at(-1).status = 'FAIL';
  steps.push({ function: 'acceptance-oracle', status: 'FAIL', code: safeText(error.message),
    classification: error.message === 'TIMEOUT' ? 'TIMEOUT'
      : /CATALOG/.test(error.message) ? 'CATALOG_DISCOVERY'
        : /PROFILE|CREDENTIAL|AUTH/.test(error.message) ? 'SECRET_AUTH' : 'EFFECT_MISMATCH' });
} finally {
  try {
    if (directory) await rm(directory, { recursive: true, force: true });
  } catch {
    failed = true;
    steps.push({ function: 'temporary-config-cleanup', status: 'FAIL', classification: 'CLEANUP_STATE' });
  }
}
process.stdout.write(`${JSON.stringify({ status: failed ? 'FAIL' : 'PASS',
  agentId: RESEARCH_OPENCLAW_AGENT_ID, model, credentialSource: 'stored-agent-profile',
  directCredentialInChildEnvironment: false, configSha256,
  nativeCleanupStatus: steps.some((step) => step.nativeCleanupStatus === 'NOT_PROVEN')
    ? 'NOT_PROVEN' : 'NO_CLEANUP_ERROR_REPORTED', steps })}\n`);
process.exitCode = failed ? 1 : 0;
