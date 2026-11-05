// Actual Linux WebKitGTK WebView, driven through the official tauri-driver.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, prepareWorkspace } from './support.mjs';
import { fixture, freePort } from './fixture.mjs';

if (process.platform !== 'linux' || process.getuid() === 0)
  throw Error(
    'Run Linux UI tests as a regular Linux desktop user (or under dbus-run-session / Xvfb).',
  );
process.chdir(root);
const directory = await prepareWorkspace('linux-ui');
const lab = await fixture();
lab.state.inventory.push({
  serial: 'SIM-NO-PERMISSION',
  model: '',
  state: 'no permissions',
  id: 9004,
});
await writeFile(
  path.join(directory, 'config.json'),
  JSON.stringify({
    version: 1,
    adbPath: 'adb',
    upstreamPort: lab.port,
    groups: [],
  }),
);
const port = await freePort();
const nativePort = await freePort();
const executable = path.resolve(process.env.ADB_SHARE_EXE || 'src-tauri/target/release/adbshare');
const driver = spawn(
  process.env.TAURI_DRIVER || 'tauri-driver',
  ['--port', String(port), '--native-port', String(nativePort)],
  {
    env: {
      ...process.env,
      ADB_SHARE_DATA_DIR: directory,
      XDG_DATA_HOME: path.join(directory, 'data'),
      XDG_CACHE_HOME: path.join(directory, 'cache'),
      LANGUAGE: 'zh_CN',
      LANG: 'C.UTF-8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let diagnostic = '';
driver.stdout.on('data', (b) => {
  diagnostic += b;
});
driver.stderr.on('data', (b) => {
  diagnostic += b;
});
driver.on('error', (e) => {
  diagnostic += e.message;
});
let session;
const delay = () => new Promise((resolve) => setTimeout(resolve, 150));
async function request(method, resource, body) {
  const response = await fetch(`http://127.0.0.1:${port}${resource}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result));
  return result.value;
}
const execute = (script, args = []) =>
  request('POST', `/session/${session}/execute/sync`, { script, args });
async function eventually(script) {
  for (let n = 0; n < 120; n++) {
    if (await execute(script)) return;
    await delay();
  }
  throw Error(`Timed out: ${script}\n${diagnostic}`);
}
const click = (id) => execute('document.getElementById(arguments[0]).click()', [id]);
const ipc = (command, args = {}) =>
  request('POST', `/session/${session}/execute/async`, {
    script:
      'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));',
    args: [command, args],
  }).then((result) => {
    if (result.error) throw Error(result.error);
    return result.value;
  });
try {
  for (let n = 0; n < 120; n++) {
    try {
      await request('GET', '/status');
      break;
    } catch {
      await delay();
    }
  }
  const created = await request('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: executable } } },
  });
  session = created.sessionId;
  await eventually('return document.getElementById("device-count")?.textContent === "4"');
  assert.equal((await ipc('snapshot')).automaticFirewall, false);
  await click('new-bottom');
  await eventually('return !!document.querySelector("[data-serial=SIM-PIXEL]")');
  await execute(
    'document.querySelector("[data-serial=SIM-PIXEL]").click();document.getElementById("address").value="127.0.0.1";document.getElementById("address").dispatchEvent(new Event("change"));',
  );
  const sharePort = await freePort();
  await execute(
    'const p=document.getElementById("port");p.value=arguments[0];p.dispatchEvent(new Event("input"));',
    [sharePort],
  );
  assert(
    await execute(
      'return document.getElementById("firewall-controls").hidden && !document.getElementById("external-firewall-hint").hidden',
    ),
  );
  assert(
    await execute('return document.getElementById("devices").textContent.includes("USB 权限不足")'),
  );
  await click('toggle');
  await eventually('return document.getElementById("group-state").textContent === "共享中"');
  await execute('document.querySelector(".copy").click()');
  await eventually('return document.getElementById("notice").textContent === "命令已复制"');
  await click('toggle');
  await eventually('return document.getElementById("toggle").textContent === "开始共享"');
  await click('history-entry');
  await eventually(
    'return document.getElementById("history-records").textContent.includes("启用组共享")',
  );
  await click('history-copy');
  await eventually(
    'return document.getElementById("history-feedback").textContent === "记录已复制"',
  );
  await click('close-history');
  await click('delete-group');
  await eventually('return document.getElementById("confirm-dialog").open');
  assert(
    !(await execute('return document.getElementById("confirm-dialog").textContent')).includes(
      '防火墙',
    ),
  );
  await click('confirm-yes');
  await eventually('return !document.getElementById("welcome").hidden');
  assert.equal(
    JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')).groups.length,
    0,
  );
  await assert.rejects(readFile(path.join(directory, 'firewall-rules.json')));
  await writeFile(
    path.join(directory, 'linux.png'),
    Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
  );
  console.log(
    'PASS Linux native UI: discovery, USB permissions, external firewall, sharing, clipboard, history and deletion',
  );
} finally {
  if (session) {
    await ipc('request_exit').catch(() => {});
    await request('DELETE', `/session/${session}`).catch(() => {});
  }
  driver.kill();
  await lab.close();
  if (diagnostic) await writeFile(path.join(directory, 'driver.log'), diagnostic);
}
