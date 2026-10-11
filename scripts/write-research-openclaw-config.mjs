import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildResearchOpenClawConfig } from '../src/research/openclaw-research-runtime.mjs';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/write-research-openclaw-config.mjs <path>');
  process.exit(2);
}

const outputPath = resolve(target);
const config = buildResearchOpenClawConfig();
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(outputPath);
