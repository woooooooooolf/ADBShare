import { spawnSync } from 'node:child_process';
import './notices.mjs';
const result=spawnSync(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','build','--no-bundle'],{
  stdio:'inherit',env:{...process.env,ADB_SHARE_BUILD_TIMESTAMP:String(Math.floor(Date.now()/1000))}
});
if(result.error)throw result.error;
process.exit(result.status ?? 1);
