import { root, prepareWorkspace, runCommand } from './support.mjs';
import { fixture, freePort, pack, Reader } from './fixture.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.chdir(root);
const lab = await fixture();
const work = await prepareWorkspace('integration');
const port = await freePort();
const other = await freePort();
const group = (p, m) => ({
  id: randomUUID(),
  name: 'Integration',
  address: '127.0.0.1',
  port: p,
  sources: ['127.0.0.1'],
  members: m,
});
const config = {
  version: 1,
  adbPath: 'adb',
  upstreamPort: lab.port,
  groups: [group(port, ['SIM-PIXEL']), group(other, ['SIM-TABLET'])],
};
const file = path.join(work, 'config.json');
await writeFile(file, JSON.stringify(config));
const exe = path.resolve(
  process.env.ADB_SHARE_EXE ||
    `src-tauri/target/release/adbshare${process.platform === 'win32' ? '.exe' : ''}`,
);
const proc = spawn(exe, ['--headless', file], {
  windowsHide: true,
  detached: process.platform === 'linux',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
proc.stdout.on('data', (b) => (output += b));
proc.stderr.on('data', (b) => (output += b));
let spawnError;
proc.once('error', (e) => (spawnError = e));
const exited = new Promise((resolve) => {
  proc.once('exit', resolve);
  proc.once('error', resolve);
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(p, req) {
  const s = net.connect({ host: '127.0.0.1', port: p });
  const r = new Reader(s);
  await once(s, 'connect');
  s.write(pack(req));
  const status = (await r.bytes(4)).toString();
  const payload = await r.frame();
  s.destroy();
  return { status, payload };
}
async function adb(...args) {
  const { stdout } = await runCommand(process.env.ADB_PATH || 'adb', [
    '-H',
    '127.0.0.1',
    '-P',
    String(port),
    ...args,
  ]);
  return stdout.trim();
}
try {
  for (let i = 0; i < 100 && !output.includes('READY'); i++) {
    if (spawnError) throw spawnError;
    if (proc.exitCode !== null) throw Error(output);
    await wait(100);
  }
  assert.match(output, /READY/);
  let r = await request(port, 'host:devices-l');
  assert.equal(r.status, 'OKAY');
  assert.match(r.payload, /SIM-PIXEL/);
  assert.doesNotMatch(r.payload, /SIM-TABLET/);
  console.log('PASS group A inventory');
  r = await request(other, 'host:devices-l');
  assert.match(r.payload, /SIM-TABLET/);
  assert.doesNotMatch(r.payload, /SIM-PIXEL/);
  console.log('PASS group B isolation');
  for (const req of [
    'host:kill',
    'host:transport:SIM-TABLET',
    'host:transport-id:9002',
    'host-serial:SIM-PIXEL:killforward-all',
  ]) {
    const s = net.connect({ host: '127.0.0.1', port });
    const reader = new Reader(s);
    await once(s, 'connect');
    s.write(pack(req));
    assert.equal((await reader.bytes(4)).toString(), 'FAIL');
    s.destroy();
  }
  console.log('PASS denied commands and selectors');
  assert.match(await adb('devices', '-l'), /SIM-PIXEL/);
  console.log('PASS standard adb devices');
  assert.equal(await adb('-s', 'SIM-PIXEL', 'get-state'), 'device');
  console.log('PASS standard adb get-state');
  assert.equal(await adb('-s', 'SIM-PIXEL', 'shell', 'echo', 'adbshare-cli-ok'), 'adbshare-cli-ok');
  console.log('PASS standard adb shell v2 through modern tport');
  assert.equal(await adb('-t', '9001', 'shell', 'echo', 'transport-id-ok'), 'transport-id-ok');
  console.log('PASS standard adb transport-id');
  const source = path.join(work, 'probe.bin');
  const pulled = path.join(work, 'pulled.bin');
  const bytes = Buffer.from([0, 255, 1, 128, 10, 13, 42]);
  await writeFile(source, bytes);
  await adb('-s', 'SIM-PIXEL', 'push', source, '/data/local/tmp/adbshare-probe.bin');
  await adb('-s', 'SIM-PIXEL', 'pull', '/data/local/tmp/adbshare-probe.bin', pulled);
  assert.deepEqual(await readFile(pulled), bytes);
  console.log('PASS standard adb push/pull binary roundtrip against fake device');
  assert(!lab.state.requests.includes('host:kill'));
  console.log('PASS upstream remains usable; no host mutation forwarded');
} finally {
  // AppImage extraction launches a child executable. Stop the group owned by
  // this test so the wrapper cannot leave a shared listener behind.
  if (process.platform === 'linux' && proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGINT');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  } else proc.kill();
  await exited;
  await lab.close();
}
