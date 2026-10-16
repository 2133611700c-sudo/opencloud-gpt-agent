import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const outDir = 'artifacts/inventory';
await mkdir(outDir, { recursive: true });

function runHelp(parts) {
  try {
    return execFileSync('openclaw', [...parts, '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    return `${stdout}\n${stderr}`.trim();
  }
}

function parseSubcommands(help) {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'Commands:');
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      if (out.length) break;
      continue;
    }
    if (!/^\s{2,}\S/.test(line)) {
      if (out.length) break;
      continue;
    }
    const match = line.match(/^\s+([a-z0-9][a-z0-9-]*)(?:\s+|$)/i);
    if (!match) continue;
    const name = match[1];
    if (name === 'help') continue;
    out.push(name);
  }
  return [...new Set(out)];
}

const queue = [[]];
const seen = new Set();
const rows = [];
const maxDepth = 4;
while (queue.length) {
  const parts = queue.shift();
  const key = parts.join(' ');
  if (seen.has(key)) continue;
  seen.add(key);
  const help = runHelp(parts);
  const subs = parseSubcommands(help);
  rows.push({ path: key || '<root>', depth: parts.length, subcommands: subs });
  const safeName = (key || 'root').replace(/[^a-z0-9.-]+/gi, '__');
  await writeFile(`${outDir}/help__${safeName}.txt`, `${help}\n`, 'utf8');
  if (parts.length < maxDepth) {
    for (const sub of subs) queue.push([...parts, sub]);
  }
}

const root = rows.find((row) => row.path === '<root>');
const leafCount = rows.filter((row) => row.subcommands.length === 0).length;
const manifest = {
  openclawVersion: execFileSync('openclaw', ['--version'], { encoding: 'utf8' }).trim(),
  maxDepth,
  rootCommands: root?.subcommands ?? [],
  rootCommandCount: root?.subcommands.length ?? 0,
  discoveredCommandPaths: rows.length - 1,
  leafCommandPaths: leafCount,
  rows,
};
await writeFile(`${outDir}/cli-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  openclawVersion: manifest.openclawVersion,
  rootCommandCount: manifest.rootCommandCount,
  discoveredCommandPaths: manifest.discoveredCommandPaths,
  leafCommandPaths: manifest.leafCommandPaths,
}, null, 2));
