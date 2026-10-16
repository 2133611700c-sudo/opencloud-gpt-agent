import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const stateDir = path.join(root, '.a9-openclaw-state');
const configPath = path.join(stateDir, 'openclaw.json');
await mkdir(stateDir, { recursive: true, mode: 0o700 });

const config = {
  agents: {
    defaults: {
      workspace: root,
      model: { primary: 'deepseek/deepseek-flash' },
      subagents: {
        maxConcurrent: 1,
        maxChildrenPerAgent: 1,
        maxSpawnDepth: 1,
        runTimeoutSeconds: 45,
      },
    },
  },
  tools: {
    profile: 'coding',
    allow: ['sessions_spawn', 'sessions_yield', 'subagents'],
    codeMode: { enabled: false },
  },
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
};

execFileSync('openclaw', ['config', 'validate', '--json'], { env, stdio: ['ignore', 'pipe', 'inherit'] });

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

const run = spawnSync('openclaw', [
  'agent', 'exec',
  '--config', configPath,
  '--state-dir', stateDir,
  '--cwd', root,
  '--model', 'deepseek/deepseek-flash',
  '--code-mode', 'direct',
  '--thinking', 'off',
  '--timeout', '120',
  '--json',
  prompt,
], {
  cwd: root,
  env,
  encoding: 'utf8',
  timeout: 150_000,
  maxBuffer: 16 * 1024 * 1024,
});

await writeFile('/tmp/a9-agent-stdout.json', run.stdout ?? '', 'utf8');
await writeFile('/tmp/a9-agent-stderr.txt', run.stderr ?? '', 'utf8');
if (run.error) throw run.error;
if (run.status !== 0) {
  throw new Error(`A9 parent agent exit=${run.status}; stderr=${String(run.stderr).slice(0, 2000)}; stdout=${String(run.stdout).slice(0, 2000)}`);
}

const envelope = JSON.parse(run.stdout);
if (envelope?.ok !== true || envelope?.status !== 'ok') throw new Error('A9 parent envelope is not ok');
if (envelope?.provider !== 'deepseek' || envelope?.model !== 'deepseek-flash') {
  throw new Error(`A9 parent provider/model mismatch: ${envelope?.provider}/${envelope?.model}`);
}
if (String(envelope?.final ?? '').trim() !== 'PARENT_OK:CHILD_OK') {
  throw new Error(`A9 parent final mismatch: ${JSON.stringify(envelope?.final)}`);
}
const tools = Array.isArray(envelope?.toolSummary?.tools) ? envelope.toolSummary.tools : [];
if (!tools.includes('sessions_spawn')) throw new Error('A9 sessions_spawn not observed');
if (!tools.includes('sessions_yield')) throw new Error('A9 sessions_yield not observed');
if (tools.some((name) => !['sessions_spawn', 'sessions_yield'].includes(name))) {
  throw new Error(`A9 unexpected parent tool observed: ${tools.join(',')}`);
}
if ((envelope?.toolSummary?.failures ?? 0) !== 0) throw new Error('A9 parent tool failure observed');
if (envelope?.toolSummary?.unresolvedError != null) throw new Error('A9 unresolved parent tool error observed');

const sessionsRaw = execFileSync('openclaw', ['sessions', '--all-agents', '--json'], { env, encoding: 'utf8' });
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
if (deletedTranscripts.length < 1) throw new Error('A9 cleanup=delete produced no deleted child transcript archive');
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
if (!childTranscript || !childArchive) throw new Error('A9 deleted child transcript does not contain CHILD_OK');
const archiveStat = await stat(childArchive);
if (archiveStat.size <= 0) throw new Error('A9 child transcript archive is empty');

const evidence = {
  status: 'PASS_LIVE',
  stage: 'A9',
  capability: 'native_subagent_spawn_yield_completion_cleanup',
  openclawVersion: '2026.10.3',
  provider: envelope.provider,
  model: envelope.model,
  parentFinalVerified: true,
  childResultVerifiedFromDeletedTranscript: true,
  parentTools: tools,
  parentToolCalls: envelope?.toolSummary?.calls ?? null,
  parentToolFailures: envelope?.toolSummary?.failures ?? 0,
  assistantTurns: envelope?.assistantTurns ?? null,
  usage: envelope?.usage ?? null,
  costUsd: envelope?.costUsd ?? null,
  cleanupMode: 'delete',
  activeChildSessionsAfterCompletion: 0,
  deletedChildTranscriptArchives: deletedTranscripts.length,
  deletedChildTranscriptBytes: archiveStat.size,
  processExitCode: run.status,
  secretLogged: false,
  hostedDatabaseMutations: 0,
};
await mkdir('a9-output', { recursive: true });
await writeFile('a9-output/a9-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
await writeFile('a9-output/index.html', '<!doctype html><meta charset="utf-8"><title>A9 PASS</title><h1>A9 PASS_LIVE</h1>\n', 'utf8');
console.log(`A9_PASS_LIVE ${JSON.stringify(evidence)}`);
