import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = new Map();
for (const platform of ['x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']) {
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      [
        'metadata',
        '--manifest-path',
        path.join(root, 'src-tauri/Cargo.toml'),
        '--locked',
        '--offline',
        '--format-version',
        '1',
        '--filter-platform',
        platform,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ),
  );
  for (const pkg of metadata.packages) packages.set(pkg.id, pkg);
}
function texts(directory, depth = 0) {
  const result = [];
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!/^(licen[sc]e|copying|copyright|notice)([._-]|s$|$)/i.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isFile() && !/\.spdx$/i.test(entry.name))
      result.push(
        `--- ${entry.name} ---\n${fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').trim()}`,
      );
    else if (entry.isDirectory() && depth === 0)
      result.push(...texts(file, 1).map((s) => `${entry.name}/${s}`));
  }
  return result;
}
const components = [...packages.values()]
  .filter((p) => p.name !== 'adbshare')
  .map((p) => ({
    name: p.name,
    version: p.version,
    license: p.license || 'See upstream license file',
    url: p.repository || `https://crates.io/crates/${p.name}/${p.version}`,
    source: `https://crates.io/api/v1/crates/${p.name}/${p.version}/download`,
    texts: texts(path.dirname(p.manifest_path)),
    ecosystem: 'Cargo',
  }));
const supplements = JSON.parse(
  fs.readFileSync(path.join(root, 'licenses/supplements/sources.json'), 'utf8'),
);
for (const c of components.filter((c) => !c.texts.length)) {
  const source = supplements[`${c.name}@${c.version}`];
  if (source)
    c.texts.push(
      `--- Original upstream license (${source.url}) ---\n${fs
        .readFileSync(
          path.join(root, 'licenses/supplements', source.file || `${c.name}-${c.version}.txt`),
          'utf8',
        )
        .replaceAll('\r\n', '\n')
        .trim()}`,
    );
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// Include Vite as well: it may inject runtime helpers into the frontend bundle.
for (const name of [...Object.keys(pkg.dependencies || {}), 'vite']) {
  const directory = path.join(root, 'node_modules', name);
  const p = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  components.push({
    name,
    version: p.version,
    license: p.license,
    url: typeof p.repository === 'object' ? p.repository.url : p.repository,
    source: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${p.version}.tgz`,
    texts: texts(directory),
    ecosystem: 'npm',
  });
}
for (const c of components.filter((c) => !c.texts.length && c.ecosystem === 'npm')) {
  const source = supplements[`${c.name}@${c.version}`];
  if (source?.file)
    c.texts.push(
      `--- Original upstream license (${source.url}) ---\n${fs
        .readFileSync(path.join(root, 'licenses/supplements', source.file), 'utf8')
        .replaceAll('\r\n', '\n')
        .trim()}`,
    );
}
components.sort(
  (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
);
const missing = components.filter((c) => !c.texts.length);
if (missing.length)
  throw Error(`Missing original license text: ${missing.map((c) => c.name).join(', ')}`);
const header = `ADBShare third-party notices\n\nThis catalog covers the locked Windows x64 and Linux x64 Cargo dependency graphs\n(including build tools), production JavaScript dependencies, and Vite\n(which may inject runtime helpers). Entries are conservative: not every component\nis shipped on every platform. Components retain their original licenses.\nThe application is GPL-3.0-only; this does not replace third-party license terms.\nUnmodified upstream source archives are linked per component.\nWindows/WebView2 and external Android Platform Tools are not bundled.\n\nComponents: ${components.length}\n`;
const result =
  header +
  components
    .map(
      (c) =>
        `\n${'='.repeat(76)}\n${c.name} ${c.version} (${c.ecosystem})\nLicense: ${c.license}\nProject: ${c.url}\nSource: ${c.source}\n\n${c.texts.join('\n\n')}\n`,
    )
    .join('');
const target = path.join(root, 'THIRD_PARTY_NOTICES.txt');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== result)
    throw Error('Third-party notices are out of date. Run npm run notices.');
  console.log(`Third-party notices verified (${components.length} components).`);
} else {
  fs.writeFileSync(target, result);
  console.log(`Generated third-party notices (${components.length} components).`);
}
