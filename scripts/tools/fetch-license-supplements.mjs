// Manual maintenance tool; normal builds use the committed, pinned originals.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../version.mjs';
process.chdir(root);
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--locked',
      '--offline',
      '--format-version',
      '1',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ),
);
const names = [
  'alloc-stdlib',
  'selectors',
  'webview2-com',
  'webview2-com-macros',
  'webview2-com-sys',
];
await fs.mkdir('licenses/supplements', { recursive: true });
const records = JSON.parse(await fs.readFile('licenses/supplements/sources.json', 'utf8'));
for (const p of metadata.packages.filter((p) => names.includes(p.name))) {
  const vcs = JSON.parse(
    await fs.readFile(path.join(path.dirname(p.manifest_path), '.cargo_vcs_info.json'), 'utf8'),
  );
  const repo = p.repository.replace('https://github.com/', '');
  let found = false;
  if (p.name === 'selectors') {
    // This upstream version references MPL-2.0 in its source header but does not
    // ship a full license file. Preserve that header and add the canonical text.
    const url = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/MPL-2.0.txt';
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(response.status);
    const header = (await fs.readFile(path.join(path.dirname(p.manifest_path), 'lib.rs'), 'utf8'))
      .split('\n')
      .slice(0, 3)
      .join('\n');
    await fs.writeFile(
      `licenses/supplements/${p.name}-${p.version}.txt`,
      header + '\n\n' + (await response.text()),
    );
    records[`${p.name}@${p.version}`] = {
      url,
      commit: vcs.git.sha1,
      headerSource: `https://raw.githubusercontent.com/${repo}/${vcs.git.sha1}/selectors/lib.rs`,
    };
    await fs.writeFile(
      'licenses/supplements/sources.json',
      JSON.stringify(records, null, 2) + '\n',
    );
    console.log(p.name, 'source header + MPL-2.0');
    continue;
  }
  for (const file of ['LICENSE', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'COPYING']) {
    const url = `https://raw.githubusercontent.com/${repo}/${vcs.git.sha1}/${file}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) break;
        const text = await response.text();
        await fs.writeFile(`licenses/supplements/${p.name}-${p.version}.txt`, text);
        records[`${p.name}@${p.version}`] = { url, commit: vcs.git.sha1 };
        found = true;
        await fs.writeFile(
          'licenses/supplements/sources.json',
          JSON.stringify(records, null, 2) + '\n',
        );
        console.log(p.name, file, text.length);
        break;
      } catch (error) {
        if (attempt === 2) console.error(String(error));
      }
    }
    if (found) break;
  }
  if (!found) throw Error(`License not found for ${p.name}@${p.version} at ${vcs.git.sha1}`);
}
