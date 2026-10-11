import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function isSecureResearchStateDir(value) {
  if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) return false;
  let stat;
  try {
    stat = lstatSync(value);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  return (stat.mode & 0o077) === 0;
}
