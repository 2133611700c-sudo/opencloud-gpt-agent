import { access, readFile, readdir } from 'node:fs/promises';

const required = [
  'README.md',
  'SYSTEM.md',
  'package.json',
  'src/health.mjs',
  'tests/health.test.mjs',
  '.github/workflows/v2-ci.yml'
];

for (const path of required) await access(path);

const root = new Set(await readdir('.'));
const forbiddenLegacyRoots = ['ops', 'products'];
for (const name of forbiddenLegacyRoots) {
  if (root.has(name)) throw new Error(`legacy root present in clean V2 tree: ${name}`);
}

const workflow = await readFile('.github/workflows/v2-ci.yml', 'utf8');
if (!workflow.includes('group: openclaw-v2-shared-hosted-state')) {
  throw new Error('V2 CI must serialize access to shared hosted state');
}
if (!workflow.includes('cancel-in-progress: false')) {
  throw new Error('V2 CI must not cancel an in-flight hosted live gate');
}

console.log('FOUNDATION_PASS');
