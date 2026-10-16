import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const requestedModel = 'deepseek/deepseek-v4-pro';
const marker = 'OPENCLAW_V2_STORED_AUTH_OK';
const fixtureKey = 'unit-only-bootstrap-credential';

// Auth metadata shape observed in the sanitized 2026.10.3 `models auth list`
// main-auth-after artifact. This fixture contains no real credential or audit path.
const storedAuth = () => ({
  agentId: 'main',
  agentDir: '/fixture/agents/main/agent',
  authStatePath: '/fixture/state/openclaw.sqlite',
  provider: 'deepseek',
  profiles: [{ id: 'deepseek:manual', provider: 'deepseek', type: 'api_key', label: 'deepseek:manual' }],
});

const goodProbe = () => ({
  agentId: 'main',
  auth: { probes: { results: [{
    provider: 'deepseek', model: requestedModel, profileId: 'deepseek:manual',
    source: 'profile', mode: 'api_key', status: 'ok',
  }] } },
});

const goodExecution = () => ({
  ok: true, status: 'ok', provider: 'deepseek', model: 'deepseek-v4-pro', final: marker,
  usage: { input: 10, output: 3, total: 13 }, costUsd: 0.00001,
  toolSummary: { calls: 0, successfulToolNames: [] },
});

const fakeOpenClaw = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const state = process.env.OPENCLAW_STATE_DIR;
const fixture = JSON.parse(readFileSync(join(state, 'fixture.json'), 'utf8'));
const args = process.argv.slice(2);
const is = (...prefix) => prefix.every((word, index) => args[index] === word);
let kind;
if (is('models', 'auth', 'paste-api-key')) kind = 'bootstrap';
else if (is('models', 'auth', 'list')) kind = 'auth';
else if (is('--version')) kind = 'version';
else if (is('agents', 'list')) kind = 'agent-identity';
else if (is('models', 'list')) kind = 'catalog-refresh';
else if (is('models', 'status')) kind = 'provider-probe';
else if (is('agent', 'exec')) kind = 'agent-exec';
else kind = 'unexpected';
const stdin = kind === 'bootstrap' ? readFileSync(0, 'utf8') : '';
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({
  kind, args, stdin, envKeys: Object.keys(process.env),
  directKey: process.env.DEEPSEEK_API_KEY ?? null,
  ambientProviderKey: process.env.OPENAI_API_KEY ?? null,
  ambientDatabaseUrl: process.env.DATABASE_URL ?? null,
  ambientGithubToken: process.env.GH_TOKEN ?? null,
  configPath: process.env.OPENCLAW_CONFIG_PATH ?? null,
}) + '\\n');
if (kind === 'bootstrap') {
  // Simulate a hostile/erroring CLI reflecting its stdin to both output streams.
  process.stdout.write('unexpected bootstrap stdout: ' + stdin);
  process.stderr.write('unexpected bootstrap stderr: ' + stdin);
} else if (kind === 'auth') process.stdout.write(fixture.authRaw ?? JSON.stringify(fixture.auth));
else if (kind === 'version') process.stdout.write('OpenClaw 2026.10.3 (fixture)\\n');
else if (kind === 'agent-identity') process.stdout.write(JSON.stringify(fixture.agents));
else if (kind === 'catalog-refresh') process.stdout.write(JSON.stringify(fixture.catalog));
else if (kind === 'provider-probe') process.stdout.write(JSON.stringify(fixture.probe));
else if (kind === 'agent-exec') process.stdout.write(JSON.stringify(fixture.execution));
else process.stderr.write('Unexpected command in fixture');
process.exitCode = fixture.exitCodes?.[kind] ?? (kind === 'unexpected' ? 91 : 0);
`;

const withFixture = (run, overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-auth-script-test-'));
  chmodSync(root, 0o700);
  for (const name of ['bin', 'home', 'state', 'tmp']) mkdirSync(join(root, name), { mode: 0o700 });
  const fixture = {
    auth: storedAuth(), probe: goodProbe(), execution: goodExecution(),
    agents: [{ id: 'main', isDefault: true, model: requestedModel }],
    catalog: { models: [{ key: requestedModel, available: true }] },
    ...overrides,
  };
  writeFileSync(join(root, 'state', 'fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
  writeFileSync(join(root, 'bin', 'openclaw'), fakeOpenClaw, { mode: 0o700 });
  const env = {
    PATH: `${join(root, 'bin')}:${dirname(process.execPath)}`,
    HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
    OPENCLAW_STATE_DIR: join(root, 'state'),
    OPENAI_API_KEY: 'unit-only-ambient-provider', DATABASE_URL: 'unit-only-ambient-database',
    GH_TOKEN: 'unit-only-ambient-github',
  };
  const execute = (script, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [join(repository, 'scripts', script)], {
      cwd: repository, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, `script process failed: ${result.error?.message}`);
    const log = join(root, 'state', 'calls.jsonl');
    let calls = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...result, calls };
  };
  try { return run(execute, root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

const assertCredentialAbsent = (result, key = fixtureKey) => {
  assert.equal(result.stdout.includes(key), false, 'stdout exposed the bootstrap credential');
  assert.equal(result.stderr.includes(key), false, 'stderr exposed the bootstrap credential');
  for (const call of result.calls) {
    assert.equal(call.args.some((arg) => arg.includes(key)), false, 'argv contains bootstrap credential');
    assert.equal(call.directKey, null, 'child environment contains direct DeepSeek credential');
    assert.equal(call.ambientProviderKey, null);
    assert.equal(call.ambientDatabaseUrl, null);
    assert.equal(call.ambientGithubToken, null);
  }
};

const assertRejected = (result) => {
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.steps.at(-1).function, 'acceptance-oracle');
  assert.equal(report.steps.at(-1).status, 'FAIL');
  return report;
};

test('bootstrap passes the trimmed key by stdin only, suppresses reflected output, and verifies main stored auth', () => withFixture((execute) => {
  const result = execute('bootstrap-research-auth.mjs', { DEEPSEEK_API_KEY: `  ${fixtureKey}  ` });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.agentId, 'main');
  assert.equal(report.provider, 'deepseek');
  assert.equal(report.credentialSource, 'stored-agent-profile');
  assert.equal(report.profileCount, 1);
  assert.equal(report.directCredentialInChildEnvironment, false);
  assert.equal(result.stderr, '');
  assertCredentialAbsent(result);
  assert.deepEqual(result.calls.map((call) => call.kind), ['bootstrap', 'auth']);
  assert.equal(result.calls[0].stdin, `${fixtureKey}\n`);
  assert.deepEqual(result.calls[0].args, ['models', 'auth', 'paste-api-key', '--provider', 'deepseek', '--agent', 'main']);
  assert.deepEqual(result.calls[1].args, ['models', 'auth', 'list', '--provider', 'deepseek', '--agent', 'main', '--json']);
}));

test('bootstrap failure cannot leak malicious CLI stdout/stderr or become PASS', () => withFixture((execute) => {
  const result = execute('bootstrap-research-auth.mjs', { DEEPSEEK_API_KEY: fixtureKey });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /bootstrap failed/);
  assertCredentialAbsent(result);
  assert.deepEqual(result.calls.map((call) => call.kind), ['bootstrap']);
}, { exitCodes: { bootstrap: 1 } }));

test('bootstrap rejects an empty credential before starting OpenClaw', () => withFixture((execute) => {
  const result = execute('bootstrap-research-auth.mjs', { DEEPSEEK_API_KEY: '   ' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(result.calls, []);
}));

for (const [name, auth] of [
  ['empty profiles', { ...storedAuth(), profiles: [] }],
  ['wrong agent', { ...storedAuth(), agentId: 'another-agent' }],
]) {
  test(`bootstrap rejects ${name} after installing, without exposing stdin`, () => withFixture((execute) => {
    const result = execute('bootstrap-research-auth.mjs', { DEEPSEEK_API_KEY: fixtureKey });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assertCredentialAbsent(result);
    assert.deepEqual(result.calls.map((call) => call.kind), ['bootstrap', 'auth']);
  }, { auth }));

  test(`acceptance rejects ${name} before any discovery/probe/model call`, () => withFixture((execute) => {
    const result = execute('verify-research-agent-live.mjs');
    assertRejected(result);
    assert.deepEqual(result.calls.map((call) => call.kind), ['auth']);
    assertCredentialAbsent(result);
  }, { auth }));
}

test('acceptance proves the main profile-backed API-key probe and exact requested-model execution', () => withFixture((execute) => {
  const result = execute('verify-research-agent-live.mjs');
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.agentId, 'main');
  assert.equal(report.model, requestedModel);
  assert.equal(report.credentialSource, 'stored-agent-profile');
  assert.equal(report.directCredentialInChildEnvironment, false);
  assert.match(report.configSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.steps.every((step) => step.status === 'PASS'), true);
  assert.deepEqual(result.calls.map((call) => call.kind), [
    'auth', 'version', 'agent-identity', 'catalog-refresh', 'provider-probe', 'agent-exec',
  ]);
  assertCredentialAbsent(result);
  const probe = result.calls.find((call) => call.kind === 'provider-probe');
  assert.equal(probe.args[probe.args.indexOf('--agent') + 1], 'main');
  assert.equal(probe.args[probe.args.indexOf('--probe-provider') + 1], 'deepseek');
  assert.equal(probe.args[probe.args.indexOf('--probe-profile') + 1], 'deepseek:manual');
  const execution = result.calls.find((call) => call.kind === 'agent-exec');
  assert.equal(execution.args[execution.args.indexOf('--model') + 1], requestedModel);
  assert.equal(execution.args[execution.args.indexOf('--thinking') + 1], 'max');
  assert.equal(execution.args[execution.args.indexOf('--code-mode') + 1], 'direct');
  assert.equal(execution.args.at(-1), `Reply exactly ${marker}`);
}));

for (const [name, rowOverride] of [
  ['top-level ok with failed provider probe', { status: 'error' }],
  ['successful probe for the wrong model', { model: 'deepseek/deepseek-flash' }],
  ['successful probe sourced from env', { source: 'env' }],
  ['successful probe with non-API-key mode', { mode: 'oauth' }],
  ['successful probe for the wrong stored profile', { profileId: 'deepseek:other' }],
]) {
  const probe = goodProbe();
  probe.ok = true;
  Object.assign(probe.auth.probes.results[0], rowOverride);
  test(`acceptance rejects ${name} and never executes the agent`, () => withFixture((execute) => {
    const result = execute('verify-research-agent-live.mjs');
    const report = assertRejected(result);
    assert.equal(report.steps.find((step) => step.function === 'provider-probe').status, 'FAIL');
    assert.equal(result.calls.some((call) => call.kind === 'agent-exec'), false);
  }, { probe }));
}

for (const [name, execution] of [
  ['correct marker only as a substring', { ...goodExecution(), final: `prefix ${marker} suffix` }],
  ['exact marker from the wrong model', { ...goodExecution(), model: 'deepseek-flash' }],
]) {
  test(`acceptance rejects ${name}`, () => withFixture((execute) => {
    const result = execute('verify-research-agent-live.mjs');
    const report = assertRejected(result);
    assert.equal(report.steps.find((step) => step.function === 'agent-exec').status, 'FAIL');
  }, { execution }));
}

test('acceptance classifies OpenClaw process exit 2 as TIMEOUT even with a success-shaped payload', () => withFixture((execute) => {
  const result = execute('verify-research-agent-live.mjs');
  const report = assertRejected(result);
  assert.equal(report.steps.at(-1).code, 'TIMEOUT');
  assert.equal(report.steps.at(-1).classification, 'TIMEOUT');
  assert.equal(report.steps.find((step) => step.function === 'agent-exec').processExit, 2);
}, { exitCodes: { 'agent-exec': 2 } }));

test('acceptance rejects a direct parent env key before starting any OpenClaw process', () => withFixture((execute) => {
  const result = execute('verify-research-agent-live.mjs', { DEEPSEEK_API_KEY: fixtureKey });
  const report = assertRejected(result);
  assert.equal(report.steps.at(-1).code, 'DIRECT_CREDENTIAL_ENV_PRESENT');
  assert.deepEqual(result.calls, []);
  assertCredentialAbsent(result);
}));
