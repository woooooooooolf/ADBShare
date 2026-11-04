import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

export function checkVersion(tag) {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
  const cargoLock = read('src-tauri/Cargo.lock').match(/\[\[package\]\]\s*\nname = "adbshare"\s*\nversion = "([^"]+)"/)?.[1];
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error(`Invalid release version: ${version}`);
  for (const [file, value] of Object.entries({ 'package-lock.json': lock.version, 'package-lock.json root': lock.packages[''].version, 'tauri.conf.json': tauri.version, 'Cargo.toml': cargo, 'Cargo.lock': cargoLock })) {
    if (value !== version) throw Error(`${file}: expected ${version}, got ${value}`);
  }
  if (tag !== undefined && (!/^[vV]\d+\.\d+\.\d+$/.test(tag) || tag.slice(1) !== version)) {
    throw Error(`Tag ${tag} does not match version ${version}`);
  }
  const changelog = read('CHANGELOG.md');
  const heading = `## [${version}] - `;
  const start = changelog.indexOf(heading);
  if (start < 0) throw Error(`CHANGELOG.md has no entry for ${version}`);
  const next = changelog.indexOf('\n## ', start + heading.length);
  return { version, notes: changelog.slice(start, next < 0 ? undefined : next).trim() + '\n' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const result = checkVersion(arg === '--notes' ? undefined : arg);
  process.stdout.write(arg === '--notes' ? result.notes : `Version verified: ${result.version}\n`);
}
