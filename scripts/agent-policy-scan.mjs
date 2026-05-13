#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = ["."];
const allowedExt = new Set([".html", ".js"]);
const denyDirs = new Set([".git", "node_modules", "ops", "docs", ".github"]);
const findings = [];
const patterns = [
  { id: "forbidden_best_claim", re: /best in la|#1/i },
  { id: "forbidden_license_claim", re: /licensed|bonded|certified/i }
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relParts = path.relative(root, full).split(path.sep);
    if (relParts.some((p) => denyDirs.has(p))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (allowedExt.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = scanRoots.flatMap((d) => walk(path.join(root, d)));
for (const file of files) {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    patterns.forEach((p) => {
      if (p.re.test(line)) findings.push({ file: rel, line: i + 1, id: p.id });
    });
  });
}

console.log(JSON.stringify({ files_scanned: files.length, findings: findings.length }, null, 2));
