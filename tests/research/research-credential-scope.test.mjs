import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hasStoredResearchCredentials,
  isSecureResearchStateDir,
} from '../../src/research/research-trust-root.mjs';

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-v2-credential-scope-'));
  chmodSync(root, 0o700);
  return root;
};

const withRoot = (fn) => {
  const root = makeRoot();
  try { return fn(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

test('private Research trust root remains valid with managed plugin installation tree only', () => withRoot((root) => {
  mkdirSync(join(root, 'npm', 'projects', 'duckduckgo'), { recursive: true });
  assert.equal(hasStoredResearchCredentials(root), false);
  assert.equal(isSecureResearchStateDir(root), true);
}));

test('shared OpenClaw auth/state database artifacts make Research credential scope fail closed', () => withRoot((root) => {
  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'openclaw.sqlite'), 'fixture');
  assert.equal(hasStoredResearchCredentials(root), true);
  assert.equal(isSecureResearchStateDir(root), false);
}));

test('agent-local auth profiles make Research credential scope fail closed', () => withRoot((root) => {
  const agentDir = join(root, 'agents', 'main', 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'auth-profiles.json'), '{}');
  assert.equal(hasStoredResearchCredentials(root), true);
  assert.equal(isSecureResearchStateDir(root), false);
}));

test('agent-local SQLite credential store artifacts make Research credential scope fail closed', () => withRoot((root) => {
  const agentDir = join(root, 'agents', 'researcher', 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'openclaw-agent.sqlite-wal'), 'fixture');
  assert.equal(hasStoredResearchCredentials(root), true);
  assert.equal(isSecureResearchStateDir(root), false);
}));
