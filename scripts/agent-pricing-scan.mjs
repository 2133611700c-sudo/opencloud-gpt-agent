#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const allowedExt = new Set([".html", ".js"]);
const denyDirs = new Set([".git", "node_modules", "ops", "docs", ".github"]);
const checks = [
  { id: "legacy_185_price", re: /\$185\b/i },
  { id: "legacy_105_price", re: /\$105\b/i }
];
const findings = [];

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

const files = walk(root);
for (const file of files) {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    checks.forEach((c) => {
      if (c.re.test(line)) findings.push({ file: rel, line: i + 1, id: c.id });
    });
  });
}

console.log(JSON.stringify({ files_scanned: files.length, findings: findings.length }, null, 2));
