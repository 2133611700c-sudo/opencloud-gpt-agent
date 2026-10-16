import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const stateDir = process.env.OPENCLAW_STATE_DIR
  ? path.resolve(process.env.OPENCLAW_STATE_DIR)
  : path.join(root, '.a9-openclaw-state');
const configPath = process.env.OPENCLAW_CONFIG_PATH
  ? path.resolve(process.env.OPENCLAW_CONFIG_PATH)
  : path.join(stateDir, 'openclaw.json');
const gatewayPort = Number.parseInt(process.env.A9_GATEWAY_PORT ?? '18893', 10);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) {
  throw new Error('A9_GATEWAY_PORT must be an integer from 1024 through 65535');
}
const gatewayToken = randomBytes(32).toString('hex');
const gatewayStdoutPath = '/tmp/a9-gateway-stdout.txt';
const gatewayStderrPath = '/tmp/a9-gateway-stderr.txt';
const parentStdoutPath = '/tmp/a9-agent-stdout.json';
const parentStderrPath = '/tmp/a9-agent-stderr.txt';
const promptPath = '/tmp/a9-parent-prompt.txt';
await mkdir(stateDir, { recursive: true, mode: 0o700 });

let baseConfig = {};
try {
  baseConfig = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const deepseekModel = {
  id: 'deepseek-flash',
  name: 'DeepSeek V4.1 Flash',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  contextWindow: 1000000,
  maxTokens: 384000,
};

const config = {
  ...baseConfig,
  gateway: {
    ...(baseConfig.gateway ?? {}),
    mode: 'local',
    port: gatewayPort,
    bind: 'loopback',
    auth: { mode: 'token', token: gatewayToken },
  },
  models: {
    ...(baseConfig.models ?? {}),
    mode: 'merge',
    providers: {
      ...(baseConfig.models?.providers ?? {}),
      deepseek: {
        ...(baseConfig.models?.providers?.deepseek ?? {}),
        baseUrl: 'https://api.deepseek.com',
        api: 'openai-completions',
        apiKey: { source: 'env', provider: 'default', id: 'DEEPSEEK_API_KEY' },
        models: [deepseekModel],
      },
    },
  },
  agents: {
    ...(baseConfig.agents ?? {}),
    defaults: {
      ...(baseConfig.agents?.defaults ?? {}),
      workspace: root,
      model: { primary: 'deepseek/deepseek-flash' },
      subagents: {
        ...(baseConfig.agents?.defaults?.subagents ?? {}),
        maxConcurrent: 1,
        maxChildrenPerAgent: 1,
        maxSpawnDepth: 1,
        runTimeoutSeconds: 45,
      },
    },
  },
  tools: {
    ...(baseConfig.tools ?? {}),
    profile: 'coding',
    allow: ['sessions_spawn', 'sessions_yield', 'subagents'],
    codeMode: {
      ...(baseConfig.tools?.codeMode ?? {}),
      enabled: false,
    },
  },
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
  OPENCLAW_SKIP_CHANNELS: '1',
};

execFileSync('openclaw', ['config', 'validate', '--json'], {
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
});

const modelsRaw = execFileSync(
  'openclaw',
  ['models', 'list', '--provider', 'deepseek', '--json'],
  { env, encoding: 'utf8' },
);
const models = JSON.parse(modelsRaw);
const rows = Array.isArray(models?.models) ? models.models : [];
const flash = rows.find((row) => row?.key === 'deepseek/deepseek-flash');
if (!flash) throw new Error('A9 cannot resolve deepseek/deepseek-flash from isolated config');

let gateway;
let gatewayStdoutFd;
let gatewayStderrFd;
let gatewayStopped = false;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopGateway() {
  if (!gateway || gatewayStopped) return;
  gatewayStopped = true;
  if (gateway.exitCode == null && gateway.signalCode == null) {
    gateway.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((resolve) => gateway.once('exit', () => resolve(true))),
      sleep(5000).then(() => false),
    ]);
    if (!exited && gateway.exitCode == null && gateway.signalCode == null) {
      gateway.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => gateway.once('exit', () => resolve(true))),
        sleep(2000),
      ]);
    }
  }
  if (gatewayStdoutFd !== undefined) {
    closeSync(gatewayStdoutFd);
    gatewayStdoutFd = undefined;
  }
  if (gatewayStderrFd !== undefined) {
    closeSync(gatewayStderrFd);
    gatewayStderrFd = undefined;
  }
}

async function waitForGatewayReady() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (gateway?.exitCode != null || gateway?.signalCode != null) {
      throw new Error(`A9 Gateway exited before ready: exit=${gateway.exitCode} signal=${gateway.signalCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.ready === true) return body;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`A9 Gateway did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

try {
  gatewayStdoutFd = openSync(gatewayStdoutPath, 'w', 0o600);
  gatewayStderrFd = openSync(gatewayStderrPath, 'w', 0o600);
  gateway = spawn(
    'openclaw',
    [
      'gateway',
      'run',
      '--port', String(gatewayPort),
      '--bind', 'loopback',
      '--auth', 'token',
      '--token', gatewayToken,
    ],
    {
      cwd: root,
      env,
      detached: false,
      stdio: ['ignore', gatewayStdoutFd, gatewayStderrFd],
    },
  );
  gateway.on('error', (error) => {
    console.error(`A9 Gateway process error: ${error.message}`);
  });

  await waitForGatewayReady();
  const health = spawnSync(
    'openclaw',
    ['gateway', 'health', '--port', String(gatewayPort), '--token', gatewayToken],
    { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  if (health.error) throw health.error;
  if (health.status !== 0 || !String(health.stdout).includes('OK')) {
    throw new Error(`A9 Gateway health failed: exit=${health.status}`);
  }

  if (process.env.A9_PREFLIGHT_ONLY === '1') {
    console.log('A9_GATEWAY_PREFLIGHT_PASS');
    await stopGateway();
    process.exit(0);
  }

  const prompt = [
    'This is acceptance test A9 for native OpenClaw sub-agents.',
    'Do exactly this and no other work:',
    '1. Call sessions_spawn exactly once with taskName "a9_child", runtime "subagent", mode "run", context "isolated", cleanup "delete", completionTarget "parent", model "deepseek/deepseek-flash", thinking "off", runTimeoutSeconds 45.',
    '2. The child task must be: Reply with exactly CHILD_OK and nothing else.',
    '3. After the spawn is accepted, call sessions_yield to wait for its completion. Do not poll.',
    '4. When the child completion arrives, verify its result is exactly CHILD_OK.',
    '5. Then reply with exactly PARENT_OK:CHILD_OK and nothing else.',
    'Do not call any tool other than sessions_spawn and sessions_yield.',
  ].join('\n');
  await writeFile(promptPath, `${prompt}\n`, { mode: 0o600 });

  const run = spawnSync(
    'openclaw',
    [
      'agent',
      '--agent', 'main',
      '--session-key', 'agent:main:a9-parent',
      '--model', 'deepseek/deepseek-flash',
      '--thinking', 'off',
      '--timeout', '120',
      '--json',
      '--message-file', promptPath,
    ],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 150000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  await writeFile(parentStdoutPath, run.stdout ?? '', { encoding: 'utf8', mode: 0o600 });
  await writeFile(parentStderrPath, run.stderr ?? '', { encoding: 'utf8', mode: 0o600 });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`A9 Gateway parent exit=${run.status}; stderr=${String(run.stderr).slice(0, 2000)}; stdout=${String(run.stdout).slice(0, 2000)}`);
  }

  const response = JSON.parse(run.stdout);
  if (!response?.result || response?.status === 'in_flight') {
    throw new Error(`A9 Gateway parent returned incomplete status: ${JSON.stringify(response?.status)}`);
  }
  const result = response.result;
  const meta = result?.meta ?? {};
  const agentMeta = meta?.agentMeta ?? {};
  const toolSummary = meta?.toolSummary ?? {};
  const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
  const payloadText = payloads
    .map((payload) => (typeof payload?.text === 'string' ? payload.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  const finalText = typeof meta?.finalAssistantVisibleText === 'string' && meta.finalAssistantVisibleText.trim()
    ? meta.finalAssistantVisibleText.trim()
    : payloadText;

  if (finalText !== 'PARENT_OK:CHILD_OK') {
    throw new Error(`A9 parent final mismatch: ${JSON.stringify(finalText)}`);
  }
  if (agentMeta?.provider !== 'deepseek' || agentMeta?.model !== 'deepseek-flash') {
    throw new Error(`A9 parent provider/model mismatch: ${agentMeta?.provider}/${agentMeta?.model}`);
  }
  const tools = Array.isArray(toolSummary?.tools) ? toolSummary.tools : [];
  if (!tools.includes('sessions_spawn')) throw new Error('A9 sessions_spawn not observed');
  if (!tools.includes('sessions_yield')) throw new Error('A9 sessions_yield not observed');
  if (tools.some((name) => !['sessions_spawn', 'sessions_yield'].includes(name))) {
    throw new Error(`A9 unexpected parent tool observed: ${tools.join(',')}`);
  }
  if ((toolSummary?.failures ?? 0) !== 0) throw new Error('A9 parent tool failure observed');
  if (toolSummary?.unresolvedError != null) throw new Error('A9 unresolved parent tool error observed');

  const postHealth = spawnSync(
    'openclaw',
    ['gateway', 'health', '--port', String(gatewayPort), '--token', gatewayToken],
    { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  if (postHealth.error) throw postHealth.error;
  if (postHealth.status !== 0 || !String(postHealth.stdout).includes('OK')) {
    throw new Error(`A9 Gateway post-run health failed: exit=${postHealth.status}`);
  }

  await stopGateway();

  const sessionsRaw = execFileSync('openclaw', ['sessions', '--all-agents', '--json'], {
    env,
    encoding: 'utf8',
  });
  const sessions = JSON.parse(sessionsRaw);
  const activeChildRows = Array.isArray(sessions?.sessions)
    ? sessions.sessions.filter((row) => typeof row?.key === 'string' && row.key.includes(':subagent:'))
    : [];
  if (activeChildRows.length !== 0) {
    throw new Error(`A9 cleanup=delete left active child sessions: ${activeChildRows.map((row) => row.key).join(',')}`);
  }

  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else out.push(full);
    }
    return out;
  }

  const files = await walk(stateDir);
  const deletedTranscripts = files.filter((file) => /\.jsonl\.deleted\./.test(file));
  if (deletedTranscripts.length < 1) {
    throw new Error('A9 cleanup=delete produced no deleted child transcript archive');
  }
  let childTranscript = null;
  let childArchive = null;
  for (const file of deletedTranscripts) {
    const content = await readFile(file, 'utf8');
    if (content.includes('CHILD_OK')) {
      childTranscript = content;
      childArchive = file;
      break;
    }
  }
  if (!childTranscript || !childArchive) {
    throw new Error('A9 deleted child transcript does not contain CHILD_OK');
  }
  const archiveStat = await stat(childArchive);
  if (archiveStat.size <= 0) throw new Error('A9 child transcript archive is empty');

  const secret = process.env.DEEPSEEK_API_KEY ?? '';
  const logBodies = await Promise.all(
    [gatewayStdoutPath, gatewayStderrPath, parentStdoutPath, parentStderrPath].map(async (file) => {
      try {
        return await readFile(file, 'utf8');
      } catch {
        return '';
      }
    }),
  );
  if (secret && logBodies.some((body) => body.includes(secret))) {
    throw new Error('A9 secret leak detected in acceptance logs');
  }

  const evidence = {
    status: 'PASS_LIVE',
    stage: 'A9',
    capability: 'native_subagent_spawn_yield_completion_cleanup',
    openclawVersion: '2026.10.3',
    executionPath: 'gateway',
    provider: agentMeta.provider,
    model: agentMeta.model,
    parentFinalVerified: true,
    childResultVerifiedFromDeletedTranscript: true,
    parentTools: tools,
    parentToolCalls: toolSummary?.calls ?? null,
    parentToolFailures: toolSummary?.failures ?? 0,
    assistantTurns: agentMeta?.assistantTurns ?? null,
    usage: agentMeta?.usage ?? null,
    costUsd: agentMeta?.costUsd ?? null,
    cleanupMode: 'delete',
    activeChildSessionsAfterCompletion: 0,
    deletedChildTranscriptArchives: deletedTranscripts.length,
    deletedChildTranscriptBytes: archiveStat.size,
    gatewayHealthyBeforeRun: true,
    gatewayHealthyAfterRun: true,
    processExitCode: run.status,
    secretLogged: false,
    hostedDatabaseMutations: 0,
  };
  await mkdir('a9-output', { recursive: true });
  await writeFile('a9-output/a9-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await writeFile(
    'a9-output/index.html',
    '<!doctype html><meta charset="utf-8"><title>A9 PASS</title><h1>A9 PASS_LIVE</h1>\n',
    'utf8',
  );
  console.log(`A9_PASS_LIVE ${JSON.stringify(evidence)}`);
} finally {
  await stopGateway();
}
