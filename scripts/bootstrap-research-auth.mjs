import { spawnSync } from 'node:child_process';
import {
  buildResearchAuthProbeEnv,
  RESEARCH_OPENCLAW_AGENT_ID,
  verifyStoredDeepSeekAuth,
} from '../src/research/research-auth-scope.mjs';

// GitHub owns the durable credential. Each ephemeral runner provisions the same
// OpenClaw owner scope once; inference never receives the bootstrap environment.
const key = process.env.DEEPSEEK_API_KEY;
try {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('DEEPSEEK_API_KEY is required for Research auth bootstrap');
  }
  const env = buildResearchAuthProbeEnv(process.env);
  const result = spawnSync('openclaw', [
    'models', 'auth', 'paste-api-key', '--provider', 'deepseek',
    '--agent', RESEARCH_OPENCLAW_AGENT_ID,
  ], {
    env,
    input: `${key.trim()}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  // Never forward bootstrap stdout/stderr: an unexpected CLI error must not
  // turn the stdin credential into a workflow log or evidence artifact.
  if (result.error || result.status !== 0) {
    throw new Error('Research stored-auth bootstrap failed');
  }
  const auth = await verifyStoredDeepSeekAuth({ env });
  process.stdout.write(`${JSON.stringify({
    status: 'PASS', agentId: RESEARCH_OPENCLAW_AGENT_ID,
    provider: 'deepseek', credentialSource: 'stored-agent-profile',
    profileCount: auth.profileCount,
    directCredentialInChildEnvironment: false,
  })}\n`);
} catch {
  process.stderr.write('Research stored-auth bootstrap failed; no credential output retained.\n');
  process.exitCode = 1;
}
