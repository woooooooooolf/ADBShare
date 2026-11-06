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
const network = await freePort();
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
  groups: [
    group(port, ['SIM-PIXEL']),
    group(other, ['SIM-TABLET']),
    group(network, ['emulator-5554']),
  ],
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
  return adbAt(port, ...args);
}
async function adbAt(sharedPort, ...args) {
  const { stdout } = await runCommand(process.env.ADB_PATH || 'adb', [
    '-H',
    '127.0.0.1',
    '-P',
    String(sharedPort),
    ...args,
  ]);
  return stdout.trim();
}
async function trackerSnapshot(format) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.ADB_PATH || 'adb',
      ['-H', '127.0.0.1', '-P', String(port), 'track-devices', `--proto-${format}`],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = Buffer.alloc(0);
    let errors = '';
    let payload;
    const timer = setTimeout(() => child.kill(), 10000);
    child.stderr.on('data', (data) => {
      errors += data;
    });
    child.stdout.on('data', (data) => {
      output = Buffer.concat([output, data]);
      if (output.length < 4) return;
      const length = Number.parseInt(output.subarray(0, 4).toString(), 16);
      if (output.length >= 4 + length && !payload) {
        payload = output.subarray(4, 4 + length);
        child.kill();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (payload) resolve(payload);
      else reject(Error(`adb tracker returned no complete frame: ${errors}`));
    });
  });
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
  for (const selector of [[], ['-s', 'SIM-PIXEL'], ['-t', '9001'], ['-d']]) {
    assert.equal(await adb(...selector, 'get-state'), 'device');
    assert.equal(await adb(...selector, 'get-serialno'), 'SIM-PIXEL');
    assert.equal(await adb(...selector, 'shell', 'echo', 'selection-ok'), 'selection-ok');
    assert.equal(await adb(...selector, 'wait-for-device'), '');
    assert.equal(await adb(...selector, 'wait-for-device-recovery'), '');
    assert.equal(await adb(...selector, 'wait-for-any-any'), '');
  }
  assert.equal(await adbAt(network, '-e', 'get-serialno'), 'emulator-5554');
  assert.equal(await adbAt(network, '-e', 'shell', 'echo', 'local-ok'), 'local-ok');
  assert.equal(await adbAt(network, '-e', 'wait-for-device'), '');
  const pixel = lab.state.inventory.find((d) => d.serial === 'SIM-PIXEL');
  pixel.state = 'bootloader';
  assert.equal(await adb('-s', 'SIM-PIXEL', 'wait-for-bootloader'), '');
  pixel.state = 'device';
  assert.match(await adb('reconnect'), /reconnecting SIM-PIXEL/);
  assert.match(await adb('mdns', 'check'), /synthetic mdns available/);
  assert.match(await adb('server-status'), /synthetic/);
  for (const format of ['binary', 'text']) {
    const payload = await trackerSnapshot(format);
    assert(payload.includes(Buffer.from('SIM-PIXEL')));
    assert(!payload.includes(Buffer.from('SIM-TABLET')));
    assert(!payload.includes(Buffer.from('emulator-5554')));
  }
  console.log(
    'PASS standard selectors, waits, scoped reconnect, diagnostics and protobuf isolation',
  );
  for (const selector of [[], ['-s', 'SIM-PIXEL'], ['-t', '9001'], ['-d']]) {
    for (const direction of ['forward', 'reverse']) {
      for (const args of [
        ['tcp:8000', 'tcp:9000'],
        ['--no-rebind', 'tcp:0', 'tcp:9000'],
        ['--list'],
        ['--remove', 'tcp:8000'],
        ['--remove-all'],
      ]) {
        await assert.rejects(
          adb(...selector, direction, ...args),
          /ADBShare does not support port mapping \(adb forward\/reverse:/,
          ['adb', ...selector, direction, ...args].join(' '),
        );
      }
    }
  }
  console.log('PASS standard adb forward/reverse explicitly unsupported for all operations');
  for (const args of [
    ['connect', '127.0.0.1:5555'],
    ['disconnect'],
    ['pair', '127.0.0.1:5555', '123456'],
    ['mdns', 'services'],
    ['kill-server'],
    ['reconnect', 'offline'],
    ['attach', 'SIM-PIXEL'],
    ['detach', 'SIM-PIXEL'],
  ]) {
    await assert.rejects(
      adb(...args),
      /denied.*ADBShare|unsupported by ADBShare/,
      ['adb', ...args].join(' '),
    );
  }
  assert.equal(await adb('start-server'), '');
  console.log('PASS unsupported host commands; start-server only checks the existing gateway');
  const source = path.join(work, 'probe.bin');
  const pulled = path.join(work, 'pulled.bin');
  const bytes = Buffer.from([0, 255, 1, 128, 10, 13, 42]);
  await writeFile(source, bytes);
  await adb('-s', 'SIM-PIXEL', 'push', source, '/data/local/tmp/adbshare-probe.bin');
  await adb('-s', 'SIM-PIXEL', 'pull', '/data/local/tmp/adbshare-probe.bin', pulled);
  assert.deepEqual(await readFile(pulled), bytes);
  console.log('PASS standard adb push/pull binary roundtrip against fake device');
  assert(!lab.state.requests.includes('host:kill'));
  assert(!lab.state.requests.some((r) => /forward|^reverse:/.test(r)));
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
