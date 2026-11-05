import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Release bodies contain only these headings and unordered Markdown lists. */
export function formatReleaseNotes(entry) {
  const headings = ['Changed', 'Fixed', 'Docs'];
  const sections = new Map();
  const lines = entry.trim().split(/\r?\n/);
  if (/^## \[[^\]]+\](?: - \d{4}-\d{2}-\d{2})?$/.test(lines[0])) lines.shift();
  let current;
  for (const line of lines) {
    if (!line.trim()) continue;
    const heading = line.match(/^### (Changed|Fixed|Docs)$/)?.[1];
    if (heading) {
      if (sections.has(heading)) throw Error(`Duplicate release heading: ${heading}`);
      sections.set(heading, []);
      current = heading;
      continue;
    }
    const item = line.match(/^[-*+] (\S.*)$/)?.[1];
    if (current && item) sections.get(current).push(item.trim());
    else if (current && /^\s{2,}\S/.test(line) && sections.get(current).length) {
      const items = sections.get(current);
      items[items.length - 1] += ` ${line.trim()}`;
    } else throw Error('Release notes must contain only Changed, Fixed, Docs and unordered lists');
  }
  if ([...sections.keys()].join(',') !== headings.join(',')) {
    throw Error('Release headings must be ordered Changed, Fixed, Docs');
  }
  for (const heading of headings) {
    if (!sections.get(heading).length) throw Error(`Release section is empty: ${heading}`);
  }
  return (
    headings
      .map(
        (heading) =>
          `### ${heading}\n\n${sections
            .get(heading)
            .map((item) => `- ${item}`)
            .join('\n')}`,
      )
      .join('\n\n') + '\n'
  );
}

export function checkVersion(tag) {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml').match(
    /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
  )?.[1];
  const cargoLock = read('src-tauri/Cargo.lock').match(
    /\[\[package\]\]\s*\nname = "adbshare"\s*\nversion = "([^"]+)"/,
  )?.[1];
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error(`Invalid release version: ${version}`);
  for (const [file, value] of Object.entries({
    'package-lock.json': lock.version,
    'package-lock.json root': lock.packages[''].version,
    'tauri.conf.json': tauri.version,
    'Cargo.toml': cargo,
    'Cargo.lock': cargoLock,
  })) {
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
  return {
    version,
    notes: formatReleaseNotes(changelog.slice(start, next < 0 ? undefined : next)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const result = checkVersion(arg === '--notes' ? undefined : arg);
  process.stdout.write(arg === '--notes' ? result.notes : `Version verified: ${result.version}\n`);
}
