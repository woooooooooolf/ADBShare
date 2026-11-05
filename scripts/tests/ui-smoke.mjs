import { root, prepareWorkspace, runCommand } from './support.mjs';
// Tests the actual Tauri WebView via its temporary loopback CDP endpoint.
import { chromium, expect } from '@playwright/test';
import { fixture, freePort, Reader, pack } from './fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, readFile, copyFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

process.chdir(root);
const lab = await fixture();
const directory = await prepareWorkspace('ui');
const port = await freePort();
const cdp = await freePort();
let offlinePort = await freePort();
while ([lab.port, port, cdp].includes(offlinePort)) offlinePort = await freePort();
const file = path.join(directory, 'config.json');
await writeFile(
  file,
  JSON.stringify({
    version: 1,
    adbPath: 'adb',
    upstreamPort: offlinePort,
    groups: [
      {
        id: randomUUID(),
        name: '示例 · Android 调试组',
        address: '127.0.0.1',
        port,
        sources: ['127.0.0.0/8'],
        members: ['SIM-PIXEL', 'SIM-TABLET', 'SIM-RETURN'],
      },
    ],
  }),
);
const testExe = path.join(directory, 'ADBShare-ui-test.exe');
await copyFile(
  path.resolve(process.env.ADB_SHARE_EXE || 'src-tauri/target/release/adbshare.exe'),
  testExe,
);
await writeFile(path.join(directory, 'firewall-rules.json'), '[]');
const proc = spawn(testExe, [], {
  windowsHide: false,
  env: {
    ...process.env,
    ADB_SHARE_DATA_DIR: directory,
    WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}`,
  },
  stdio: 'ignore',
});
let exited = false;
proc.once('exit', () => (exited = true));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let held;
let pageRef;
async function dismissOutside(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  assert(box);
  await page.mouse.click(Math.max(1, box.x / 2), Math.max(1, box.y / 2));
  await expect(page.locator(`#${id}`)).toBeHidden();
}
async function resizeWindow(page, width, height) {
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    path.resolve('scripts/tests/resize-window-test.ps1'),
    '-AppPid',
    String(proc.pid),
    '-ClientWidth',
    String(Math.round(width * ratio)),
    '-ClientHeight',
    String(Math.round(height * ratio)),
  ]);
  await expect
    .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function assertFits(page) {
  const bounds = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    sidebarBottom: document.querySelector('.side-bottom').getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert(
    bounds.document <= bounds.viewport + 1 && bounds.body <= bounds.viewport + 1,
    JSON.stringify(bounds),
  );
  assert(bounds.sidebarBottom <= bounds.height + 1, JSON.stringify(bounds));
}
async function assertHeaderRow(page) {
  const rows = await page.evaluate(() =>
    ['title', 'delete-group', 'save', 'toggle'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.y + r.height / 2;
    }),
  );
  assert(Math.max(...rows) - Math.min(...rows) < 3, `Header controls wrapped: ${rows}`);
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).length) break;
    } catch {}
    if (exited) throw Error('App exited');
    await delay(100);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
  const page = browser.contexts()[0].pages()[0];
  pageRef = page;
  await page.bringToFront();
  await page.waitForURL((url) => url.hostname === 'tauri.localhost');
  await page.locator('#language-toggle').waitFor({ state: 'visible' });
  await page.evaluate(() =>
    localStorage.setItem(
      'adbshare.preferences',
      JSON.stringify({ language: 'zh', theme: 'light' }),
    ),
  );
  await page.reload();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('#adb-warning')).toBeVisible();
  await expect(page.locator('#adb-warning')).toContainText('请先启用本地 ADB 服务');
  await page.screenshot({ path: path.join(directory, 'adb-offline.png') });
  await resizeWindow(page, 640, 480);
  await page.locator('#language-toggle').click();
  await expect(page.locator('#adb-warning')).toContainText('Local ADB Server is unavailable');
  await assertFits(page);
  const footer = await page.locator('#adb-warning').boundingBox();
  assert(footer && Math.abs(footer.y + footer.height - 480) < 2);
  await page.screenshot({ path: path.join(directory, 'adb-offline-small-en.png') });
  await page.locator('#language-toggle').click();
  await resizeWindow(page, 1240, 840);
  await page.locator('#adb-warning-settings').click();
  await expect(page.locator('#upstream-port')).toHaveValue(String(offlinePort));
  const settingsBox = await page.locator('#settings-dialog').boundingBox();
  await page.mouse.click(settingsBox.x + 5, settingsBox.y + 5);
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.mouse.move(settingsBox.x + 40, settingsBox.y + 35);
  await page.mouse.down();
  await page.mouse.move(settingsBox.x / 2, settingsBox.y / 2);
  await page.mouse.up();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await dismissOutside(page, 'settings-dialog');
  await expect(page.locator('#adb-warning')).toBeVisible();
  await page.locator('#adb-warning-settings').click();
  await page.locator('#upstream-port').fill(String(lab.port));
  await page.locator('#settings-form button[type="submit"]').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#adb-warning')).toBeHidden();
  console.log(
    'PASS startup ADB warning, bottom placement, recovery and settings backdrop dismissal',
  );
  await expect(page.locator('#adb-status')).toHaveText('本机设备列表');
  await expect(page.locator('#device-count')).toHaveText('3');
  await expect(page.locator('.utility-bar button')).toHaveCount(3);
  await expect(page.locator('#group-count')).toHaveText('1');
  await expect(
    page.locator('#refresh, #summary, #draft-label, .group-heading, main .logs'),
  ).toHaveCount(0);
  await page.locator('#group-entry').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#editor-header')).toBeHidden();
  await page.locator('#groups .group-item').first().click();
  await expect(page.locator('#editor-header .editor-actions button')).toHaveText([
    '删除组',
    '保存',
    '开始共享',
  ]);
  await assertHeaderRow(page);
  for (const [width, height] of [
    [1600, 960],
    [1000, 700],
    [760, 600],
    [640, 480],
  ]) {
    await resizeWindow(page, width, height);
    await assertFits(page);
    await assertHeaderRow(page);
    const columns = await page
      .locator('.columns')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, width > 1050 ? 2 : 1);
    if (width === 640)
      await page.screenshot({ path: path.join(directory, 'responsive-small-zh.png') });
    if (width === 1600)
      await page.screenshot({ path: path.join(directory, 'responsive-wide-zh.png') });
  }
  await page.locator('#group-entry').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await assertFits(page);
  const welcomeBox = await page.locator('#welcome').boundingBox();
  assert(welcomeBox.y + welcomeBox.height <= 480);
  await page.locator('#groups .group-item').first().click();
  await page.locator('#about').click();
  await expect(page.locator('#about-dialog')).toBeVisible();
  await assertFits(page);
  await dismissOutside(page, 'about-dialog');
  await page.locator('#language-toggle').click();
  await assertHeaderRow(page);
  await assertFits(page);
  await page.locator('#language-toggle').click();
  await resizeWindow(page, 1240, 840);
  console.log(
    'PASS native window resizing, column reflow, compact header and narrow sidebar navigation',
  );
  await expect(page.locator('#firewall-add')).toHaveText('应用规则');
  await expect(page.locator('#firewall-remove')).toHaveText('移除规则');
  await expect(page.getByText('本机访问不受影响。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('退出时停止共享并清理规则。', { exact: true })).toHaveCount(0);
  await page.locator('#device-entry').click();
  await expect(page.locator('#local-count')).toHaveText('3');
  await expect(page.locator('#local-device-list tbody tr')).toHaveCount(3);
  await expect(page.locator('#local-device-list')).not.toContainText('SIM-RETURN');
  lab.state.deviceError = '<b id="upstream-error-markup">upstream failed</b>';
  await page.locator('#local-refresh').click();
  await expect(page.locator('#local-device-list')).toContainText('<b id="upstream-error-markup">');
  await expect(page.locator('#upstream-error-markup')).toHaveCount(0);
  lab.state.deviceError = '';
  await page.locator('#local-refresh').click();
  await expect(page.locator('#local-count')).toHaveText('3');
  const inventory = [...lab.state.inventory];
  lab.state.inventory = [];
  await page.locator('#local-refresh').click();
  await expect(page.locator('#local-count')).toHaveText('0');
  await expect(page.locator('#adb-warning')).toBeHidden();
  lab.state.inventory = [...inventory];
  lab.state.inventory.pop();
  await page.locator('#local-refresh').click();
  await expect(page.locator('#device-count')).toHaveText('2');
  await expect(page.locator('#local-count')).toHaveText('2');
  lab.state.inventory = inventory;
  await page.locator('#local-refresh').click();
  await expect(page.locator('#local-count')).toHaveText('3');
  await page.screenshot({ path: path.join(directory, 'local-devices-light-zh.png') });
  await dismissOutside(page, 'local-devices-dialog');
  console.log('PASS local-device entry reports actual count and refreshes inventory');
  await page.locator('#about').click();
  await expect(page.locator('#about-summary')).toContainText('wooooooooolf');
  await expect(page.locator('#about-summary')).toContainText('GPL-3.0-only');
  const built = Date.parse(await page.locator('#about-summary time').getAttribute('datetime'));
  assert(Number.isFinite(built) && built <= Date.now() + 10000 && built > Date.UTC(2026, 0, 1));
  await page.locator('[data-tab="project"]').click();
  await expect(page.locator('#license-document')).toContainText('GNU GENERAL PUBLIC LICENSE');
  await page.locator('[data-tab="thirdParty"]').click();
  const catalog = await readFile(path.resolve('THIRD_PARTY_NOTICES.txt'), 'utf8');
  const count = Number(catalog.match(/^Components: (\d+)$/m)[1]);
  await expect(page.locator('#third-party-components tbody tr')).toHaveCount(count);
  await expect(page.locator('#third-party-components th')).toHaveText(['组件名', '版本', '许可证']);
  const api = page
    .locator('#third-party-components tbody tr')
    .filter({ hasText: '@tauri-apps/api' });
  const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  await expect(api.locator('td')).toHaveText([
    '@tauri-apps/api',
    pkg.dependencies['@tauri-apps/api'],
    'Apache-2.0 OR MIT',
  ]);
  await expect(page.locator('#third-party-components')).toContainText('webview2-com');
  await expect(page.locator('#license-document')).toBeHidden();
  await expect(page.locator('#component-picker, #license-component')).toHaveCount(0);
  await expect(page.locator('#third-party-components')).not.toContainText('TERMS AND CONDITIONS');
  await page.screenshot({ path: path.join(directory, 'third-party-light-zh.png') });
  await page.locator('[data-tab="project"]').click();
  await expect(page.locator('#third-party-components')).toBeHidden();
  await expect(page.locator('#license-document')).toContainText('GNU GENERAL PUBLIC LICENSE');
  await dismissOutside(page, 'about-dialog');
  console.log('PASS about metadata, project license and concise third-party component table');
  await page.locator('#group-name').fill('Locale draft');
  await page.locator('[data-serial="emulator-5554"]').check();
  await page.locator('#language-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#settings')).toHaveText('Local ADB settings');
  await expect(page.locator('#adb-status')).toHaveText('Local devices');
  await expect(page.locator('#device-count')).toHaveText('3');
  await expect(page.locator('#group-name')).toHaveValue('Locale draft');
  await expect(page.locator('[data-serial="emulator-5554"]')).toBeChecked();
  await expect(page.locator('#groups .group-item small')).toContainText('4 devices');
  await expect(page.locator('#sources')).toHaveAttribute(
    'placeholder',
    '192.168.1.0/24 or 192.168.1.20',
  );
  await page.locator('#new-bottom').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await dismissOutside(page, 'confirm-dialog');
  await expect(page.locator('#group-name')).toHaveValue('Locale draft');
  await expect(page.locator('#group-count')).toHaveText('1');
  await page.locator('#sources').fill('8.8.8.8');
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#notice')).toContainText('private IPv4');
  await page.locator('#sources').fill('127.0.0.0/8');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    ),
    '#0c0d0f',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(directory, 'dark-en.png') });
  await page.locator('#about').click();
  await page.screenshot({ path: path.join(directory, 'about-dark-en.png') });
  await page.locator('[data-tab="thirdParty"]').click();
  await expect(page.locator('#third-party-components th')).toHaveText([
    'Component',
    'Version',
    'License',
  ]);
  await page.screenshot({ path: path.join(directory, 'third-party-dark-en.png') });
  await page.locator('#close-about').click();
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(directory, 'light-en.png') });
  await page.locator('#language-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#adb-status')).toHaveText('本机设备列表');
  await expect(page.locator('#device-count')).toHaveText('3');
  console.log(
    'PASS locale/theme switches preserve drafts, localize errors and persist preferences',
  );
  await expect(page.getByRole('button', { name: '新建共享组', exact: true })).toHaveCount(1);
  await expect(page.getByText('工作空间', { exact: true })).toHaveCount(0);
  await expect(page.locator('#new-group, #create-first')).toHaveCount(0);
  await expect(page.locator('[data-serial="SIM-RETURN"]')).toBeChecked();
  await expect(page.locator('#devices')).toContainText('暂未连接');
  const name = page.locator('#group-name');
  await name.fill('原型交互测试');
  await page.locator('[data-serial="emulator-5554"]').check();
  await page.locator('#device-entry').click();
  await page.locator('#local-refresh').click();
  await page.locator('#close-devices').click();
  await expect(name).toHaveValue('原型交互测试');
  await expect(page.locator('[data-serial="emulator-5554"]')).toBeChecked();
  console.log('PASS refresh preserves draft and absent device memberships');
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#save')).toBeDisabled();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.groups[0].name, '原型交互测试');
  assert(saved.groups[0].members.includes('SIM-RETURN'));
  console.log('PASS atomic save persists intended group');
  await page.locator('#toggle').click();
  await expect(page.locator('#group-state')).toContainText('共享中');
  await expect(name).toBeDisabled();
  await page.locator('.copy').first().click();
  await expect(page.locator('#notice')).toHaveText('命令已复制');
  console.log('PASS start locks editor and command copy succeeds');
  held = net.connect({ host: '127.0.0.1', port });
  const reader = new Reader(held);
  await once(held, 'connect');
  held.write(pack('host:transport:SIM-PIXEL'));
  assert.equal((await reader.bytes(4)).toString(), 'OKAY');
  held.write(pack('shell:sleep 30'));
  assert.equal((await reader.bytes(4)).toString(), 'OKAY');
  await expect(page.locator('#sessions')).toContainText('SIM-PIXEL');
  await page.screenshot({ path: path.join(directory, 'sharing.png'), fullPage: true });
  await page.locator('#history-entry').click();
  await expect(page.locator('#history-status')).toContainText('1 组共享中');
  await page.locator('[data-history-group]').click();
  await expect(page.locator('#history-overview')).toContainText('SIM-PIXEL');
  await page.locator('[data-history-serial="SIM-PIXEL"]').click();
  await expect(page.locator('#history-records')).toContainText('shell:sleep 30');
  const sample = net.connect({ host: '127.0.0.1', port });
  const sr = new Reader(sample);
  await once(sample, 'connect');
  sample.write(pack('host:transport:SIM-PIXEL'));
  assert.equal((await sr.bytes(4)).toString(), 'OKAY');
  sample.write(pack('shell:echo history-preview'));
  assert.equal((await sr.bytes(4)).toString(), 'OKAY');
  assert.equal((await sr.bytes(16)).toString(), 'history-preview\n');
  sample.destroy();
  await expect(page.locator('#history-records')).toContainText('history-preview');
  await page.locator('#history-copy').click();
  await expect(page.locator('#history-feedback')).toHaveText('记录已复制');
  const exported = path.join(directory, `history-${randomUUID()}.txt`);
  await page.locator('#history-export').click();
  await runCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-File',
      path.resolve('scripts/tests/save-dialog-test.ps1'),
      '-AppPid',
      String(proc.pid),
      '-Destination',
      exported,
    ],
    { timeout: 60000 },
  );
  await expect(page.locator('#history-feedback')).toHaveText('记录已保存');
  const output = await readFile(exported, 'utf8');
  assert(output.includes('history-preview'));
  assert(output.includes('HEX'));
  console.log('PASS native Save As writes the selected device history');
  const revoked = once(held, 'close');
  await page.locator('[data-device-toggle="SIM-PIXEL"]').click();
  await revoked;
  await expect(page.locator('#history-records')).toContainText('禁用设备');
  await expect(page.locator('#history-overview')).toContainText('已禁用');
  assert(JSON.parse(await readFile(file, 'utf8')).groups[0].disabledMembers.includes('SIM-PIXEL'));
  await page.locator('[data-device-toggle="SIM-PIXEL"]').click();
  await expect(page.locator('#history-records')).toContainText('启用设备');
  const before = [...lab.state.inventory];
  lab.state.inventory = before.filter((d) => d.serial !== 'SIM-PIXEL');
  await expect(page.locator('#history-overview')).toContainText('暂未连接');
  await expect(page.locator('#history-records')).toContainText('设备连接状态: 暂未连接');
  lab.state.inventory = before;
  await expect(page.locator('#history-overview')).toContainText('已连接');
  await page.screenshot({ path: path.join(directory, 'history-light-zh.png') });
  await page.locator('#history-reset').click();
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#history-records')).toHaveText('暂无日志');
  await dismissOutside(page, 'history-dialog');
  held = net.connect({ host: '127.0.0.1', port });
  const resumed = new Reader(held);
  await once(held, 'connect');
  held.write(pack('host:transport:SIM-PIXEL'));
  assert.equal((await resumed.bytes(4)).toString(), 'OKAY');
  held.write(pack('shell:sleep 30'));
  assert.equal((await resumed.bytes(4)).toString(), 'OKAY');
  console.log(
    'PASS global/group/device history, payload, copy, scoped reset, persisted enablement and hot revocation',
  );
  const closed = once(held, 'close');
  await page.locator('#toggle').click();
  await closed;
  await expect(name).toBeEnabled();
  console.log('PASS live session visibility and stop revocation');
  await page.locator('[data-serial="SIM-PIXEL"]').uncheck();
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await page.locator('#history-entry').click();
  await page.locator('[data-history-group]').click();
  await expect(page.locator('#history-device')).not.toContainText('SIM-PIXEL');
  await expect(page.locator('#history-records')).not.toContainText('SIM-PIXEL');
  await page.locator('#close-history').click();
  await page.locator('[data-serial="SIM-PIXEL"]').check();
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  console.log('PASS removing a device clears its scoped history');
  await page.locator('#toggle').click();
  await expect(page.locator('#group-state')).toContainText('共享中');
  await page.locator('#firewall-remove').click();
  await expect(name).toBeEnabled();
  await expect(page.locator('#notice')).toHaveText('规则已移除');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).groups.length, 1);
  await page.locator('#toggle').click();
  await expect(page.locator('#group-state')).toContainText('共享中');
  console.log('PASS remove-rules action stops sharing and keeps the group');
  // A damaged cleanup record triggers the same production error/retention path,
  // without modifying the real firewall or presenting a UAC prompt.
  const ledger = path.join(directory, 'firewall-rules.json');
  await writeFile(ledger, 'broken');
  await page.locator('#delete-group').click();
  await expect(page.locator('#confirm-text')).toContainText('将停止');
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#notice')).toContainText('共享组已保留');
  await expect(name).toBeEnabled();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).groups.length, 1);
  console.log('PASS failed deletion stops sharing and retains group for retry');
  await writeFile(ledger, '[]');
  await page.locator('#toggle').click();
  await expect(page.locator('#group-state')).toContainText('共享中');
  await page.locator('#delete-group').click();
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#groups .group-item')).toHaveCount(0);
  await expect(page.locator('#welcome h2')).toHaveText('局域网 ADB 设备共享');
  await expect(page.locator('#welcome button')).toHaveCount(0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).groups.length, 0);
  console.log('PASS running-group deletion and concise welcome page without success banner');
  await page.screenshot({ path: path.join(directory, 'welcome.png'), fullPage: true });
  await expect(page.locator('#group-count')).toHaveText('0');
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await page.locator('#history-entry').click();
  await expect(page.locator('#history-records')).toHaveText('暂无日志');
  await expect(page.locator('#history-status')).toContainText('0 个共享组');
  await page.locator('#close-history').click();
  console.log('PASS group deletion purges its history');
  await page.locator('#new-bottom').click();
  await page.locator('#address').selectOption('127.0.0.1');
  await name.fill('新建流程');
  await page.locator('[data-serial="SIM-PIXEL"]').check();
  await page.locator('#sources').fill('8.8.8.8');
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#notice')).toContainText('私有 IPv4');
  await page.locator('#sources').fill('127.0.0.1');
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#save')).toBeDisabled();
  console.log('PASS empty state, creation and invalid-source feedback');
  await page.locator('#new-bottom').click();
  await page.locator('#address').selectOption('127.0.0.1');
  await name.fill('另一个共享组');
  await page.locator('[data-serial="SIM-PIXEL"]').check();
  await page.locator('#save').click();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#delete-group').click();
  await page.locator('#confirm-yes').click();
  await expect(name).toHaveValue('新建流程');
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
  console.log('PASS deleting one of several groups selects the remaining group');
  await page.locator('#settings').click();
  await expect(page.locator('#upstream-port')).toHaveValue(String(lab.port));
  await page.locator('#close-settings').click();
  await page.locator('#toggle').click();
  await expect(page.locator('#group-state')).toContainText('共享中');
  const finalConfig = JSON.parse(await readFile(file, 'utf8'));
  const finalPort = finalConfig.groups[0].port;
  await writeFile(ledger, 'broken');
  // WM_CLOSE exercises Tauri's native ExitRequested shutdown path; it does not kill
  // the process. Only the process created by this test is targeted.
  await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-Process -Id ${proc.pid}).CloseMainWindow() | Out-Null`,
  ]);
  await expect(page.locator('#shutdown-title')).toHaveText('退出未完成');
  assert(!exited, 'Cleanup failure must retain native window');
  await expect(page.locator('#shutdown-text')).toContainText('规则清理未完成');
  await writeFile(ledger, '[]');
  await page.locator('#shutdown-retry').click();
  for (let i = 0; i < 100 && !exited; i++) await delay(100);
  assert(exited, 'App must exit after successful cleanup retry');
  await assert.rejects(async () => {
    const s = net.connect({ host: '127.0.0.1', port: finalPort });
    await once(s, 'connect');
    s.destroy();
  });
  console.log('PASS native close preserves window on cleanup failure, then retries and exits');
  assert.deepEqual(errors, []);
  console.log('PASS no WebView JavaScript errors');
} catch (error) {
  await pageRef
    ?.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  held?.destroy();
  await browser?.close().catch(() => {});
  if (!exited) proc.kill();
  await lab.close();
}
