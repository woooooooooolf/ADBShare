import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersion, root } from './version.mjs';

export function packagePair(source, directory, name, executable = false) {
  fs.mkdirSync(directory, { recursive: true });
  const legacy = path.join(directory, 'SHA256SUMS');
  const allowed = new Set([name, `${name}.sha256`, 'SHA256SUMS']);
  if (fs.readdirSync(directory).some((file) => !allowed.has(file)))
    throw Error('Output directory contains other files. Choose a fresh output directory.');
  if (fs.existsSync(legacy)) {
    const old = fs.readFileSync(legacy, 'utf8').trim();
    if (!/^[a-fA-F0-9]{64}  .+$/.test(old) || old.slice(66) !== name)
      throw Error('Output directory contains a different legacy manifest.');
  }
  const destination = path.join(directory, name);
  if (path.resolve(source) !== path.resolve(destination)) fs.copyFileSync(source, destination);
  if (executable) fs.chmodSync(destination, 0o755);
  const hash = createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(`${destination}.sha256`, `${hash}  ${name}\n`);
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = checkVersion();
  if (process.arch !== 'x64' || !['win32', 'linux'].includes(process.platform))
    throw Error('Supported package hosts: Windows x64 and Linux x64');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-directory'))
    throw Error('Usage: npm run package -- [--output-directory DIRECTORY]');
  const directory = path.resolve(root, args[1] || `artifacts/${version}`);
  const windows = process.platform === 'win32';
  const source = windows
    ? path.join(root, 'src-tauri/target/release/adbshare.exe')
    : path.join(
        root,
        `src-tauri/target/release/bundle/appimage/ADBShare_${version}_amd64.AppImage`,
      );
  if (!fs.existsSync(source)) throw Error(`Run npm run build:app first: ${source}`);
  if (windows) {
    const actual = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Item -LiteralPath $env:ADB_SHARE_PACKAGE_INPUT).VersionInfo.ProductVersion',
      ],
      {
        env: { ...process.env, ADB_SHARE_PACKAGE_INPUT: source },
        encoding: 'utf8',
      },
    ).trim();
    if (actual !== version)
      throw Error(`EXE version ${actual} does not match ${version}; rebuild first`);
  }
  const name = `ADBShare-${version}-${windows ? 'windows' : 'linux'}-x64.${windows ? 'exe' : 'AppImage'}`;
  console.log(packagePair(source, directory, name, !windows));
}
