import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSecureResearchStateDir } from '../../src/research/research-trust-root.mjs';

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-v2-trust-root-'));
  chmodSync(root, 0o700);
  return root;
};

const withRoot = (fn) => {
  const root = makeRoot();
  try { return fn(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

test('private Research trust root stays structurally valid when OpenClaw creates state databases', () => withRoot((root) => {
  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'openclaw.sqlite'), 'fixture');
  assert.equal(isSecureResearchStateDir(root), true);
}));

test('private Research trust root stays structurally valid with managed plugin installation tree', () => withRoot((root) => {
  mkdirSync(join(root, 'npm', 'projects', 'duckduckgo'), { recursive: true });
  assert.equal(isSecureResearchStateDir(root), true);
}));

test('group/world permissions still fail closed independently of credential semantics', () => withRoot((root) => {
  chmodSync(root, 0o755);
  assert.equal(isSecureResearchStateDir(root), false);
}));
