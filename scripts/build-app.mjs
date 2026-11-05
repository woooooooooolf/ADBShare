import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkVersion, root } from './version.mjs';
checkVersion();
await import('./notices.mjs');
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'build',
    '--ci',
    '--no-bundle',
    '--',
    '--locked',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ADB_SHARE_BUILD_TIMESTAMP: String(Math.floor(Date.now() / 1000)) },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
