import { access, readdir } from 'node:fs/promises';

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

console.log('FOUNDATION_PASS');
