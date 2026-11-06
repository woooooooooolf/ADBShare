// Test tooling only; Android Platform Tools are never bundled with ADBShare.
// Version and archives verified against Google's stable SDK repository metadata:
// https://dl.google.com/android/repository/repository2-3.xml
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../version.mjs';

const version = '37.0.1';
const archives = {
  win32: {
    file: 'platform-tools_r37.0.1-win.zip',
    sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99',
  },
  linux: {
    file: 'platform-tools_r37.0.1-linux.zip',
    sha256: 'd230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1',
  },
};
const spec = archives[process.platform];
if (!spec || process.arch !== 'x64')
  throw Error('Platform Tools tests require Windows / Linux x64');
const directory = path.join(
  process.env.RUNNER_TEMP || path.join(root, 'work', 'tools'),
  `adbshare-platform-tools-${version}`,
);
await fs.mkdir(directory, { recursive: true });
const archive = path.join(directory, spec.file);
let bytes = await fs.readFile(archive).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (!bytes) {
  const response = await fetch(`https://dl.google.com/android/repository/${spec.file}`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`Platform Tools download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256)
  throw Error('Platform Tools archive SHA-256 mismatch');
await fs.writeFile(archive, bytes);
if (process.platform === 'win32') {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:ADB_TOOL_ARCHIVE -DestinationPath $env:ADB_TOOL_DIRECTORY -Force',
    ],
    { env: { ...process.env, ADB_TOOL_ARCHIVE: archive, ADB_TOOL_DIRECTORY: directory } },
  );
} else {
  execFileSync('unzip', ['-oq', archive, '-d', directory]);
}
const bin = path.join(directory, 'platform-tools');
const adb = path.join(bin, process.platform === 'win32' ? 'adb.exe' : 'adb');
const actual = execFileSync(adb, ['version'], { encoding: 'utf8' });
if (!actual.includes(`Version ${version}-`)) throw Error(`Unexpected adb version: ${actual}`);
if (process.env.GITHUB_PATH) await fs.appendFile(process.env.GITHUB_PATH, `${bin}\n`);
if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `ADB_PATH=${adb}\n`);
process.stdout.write(actual);
