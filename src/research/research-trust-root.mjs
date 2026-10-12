import { lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const statOrNull = (path) => {
  try { return lstatSync(path); }
  catch { return null; }
};

const isPrivateStateRoot = (value) => {
  if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) return false;
  const stat = statOrNull(value);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return false;
  return (stat.mode & 0o077) === 0;
};

const containsCredentialDbArtifacts = (dir, prefix) => {
  const stat = statOrNull(dir);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) return true;
  try {
    return readdirSync(dir).some((name) => name === prefix || name.startsWith(`${prefix}-`));
  } catch {
    return true;
  }
};

export function hasStoredResearchCredentials(value) {
  if (!isPrivateStateRoot(value)) return true;

  // OpenClaw shared auth profiles live in state/openclaw.sqlite (plus SQLite sidecars).
  if (containsCredentialDbArtifacts(join(value, 'state'), 'openclaw.sqlite')) return true;

  // Agent-local auth can live in openclaw-agent.sqlite or legacy auth-profiles.json.
  const agentsDir = join(value, 'agents');
  const agentsStat = statOrNull(agentsDir);
  if (!agentsStat) return false;
  if (agentsStat.isSymbolicLink() || !agentsStat.isDirectory()) return true;

  let entries;
  try { entries = readdirSync(agentsDir, { withFileTypes: true }); }
  catch { return true; }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) return true;
    if (!entry.isDirectory()) continue;

    const agentDir = join(agentsDir, entry.name, 'agent');
    const agentStat = statOrNull(agentDir);
    if (!agentStat) continue;
    if (agentStat.isSymbolicLink() || !agentStat.isDirectory()) return true;
    if (statOrNull(join(agentDir, 'auth-profiles.json'))) return true;
    if (containsCredentialDbArtifacts(agentDir, 'openclaw-agent.sqlite')) return true;
  }

  return false;
}

export function isSecureResearchStateDir(value) {
  return isPrivateStateRoot(value) && !hasStoredResearchCredentials(value);
}
