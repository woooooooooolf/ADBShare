// Tests the actual Tauri WebView via its temporary loopback CDP endpoint.
import { chromium, expect } from '@playwright/test';
import { fixture, freePort, Reader, pack } from './fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const lab=await fixture();const directory=path.resolve('work/ui-smoke');await mkdir(directory,{recursive:true});
const port=await freePort();const cdp=await freePort();const file=path.join(directory,'config.json');
await writeFile(file,JSON.stringify({version:1,adbPath:'adb',upstreamPort:lab.port,groups:[{id:randomUUID(),name:'示例 · Android 调试组',address:'127.0.0.1',port,sources:['127.0.0.0/8'],members:['SIM-PIXEL','SIM-TABLET','SIM-RETURN']}]}));
const testExe=path.join(directory,'ADBShare-ui-test.exe');
await copyFile(path.resolve(process.env.ADB_SHARE_EXE||'src-tauri/target/release/adbshare.exe'),testExe);
await writeFile(path.join(directory,'firewall-rules.json'),'[]');
const proc=spawn(testExe,[],{windowsHide:false,env:{...process.env,ADB_SHARE_DATA_DIR:directory,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${cdp}`},stdio:'ignore'});
let exited=false;proc.once('exit',()=>exited=true);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;let held;let pageRef;let previousPreferences;
async function restorePreferences() {
  if(pageRef && !pageRef.isClosed() && previousPreferences!==undefined)await pageRef.evaluate(value=>{
    if(value===null)localStorage.removeItem('adbshare.preferences');else localStorage.setItem('adbshare.preferences',value);
  },previousPreferences);
}
try{
  for(let i=0;i<100;i++){try{if((await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).length)break;}catch{}if(exited)throw Error('App exited');await delay(100);}
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
  const page=browser.contexts()[0].pages()[0];pageRef=page;await page.bringToFront();
  await page.waitForURL(url=>url.hostname==='tauri.localhost');await page.locator('#language-toggle').waitFor({state:'visible'});
  previousPreferences=await page.evaluate(()=>localStorage.getItem('adbshare.preferences'));
  await page.evaluate(()=>localStorage.setItem('adbshare.preferences',JSON.stringify({language:'zh',theme:'light'})));await page.reload();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#adb-status')).toHaveText('本机设备列表 3');
  await expect(page.locator('.utility-bar button')).toHaveCount(3);
  await expect(page.getByText('本机访问不受影响。',{exact:true})).toHaveCount(0);
  await expect(page.getByText('退出时停止共享并清理规则。',{exact:true})).toHaveCount(0);
  await page.locator('#device-entry').click();await expect(page.locator('#local-count')).toHaveText('3');await expect(page.locator('#local-device-list tbody tr')).toHaveCount(3);await expect(page.locator('#local-device-list')).not.toContainText('SIM-RETURN');
  const inventory=[...lab.state.inventory];lab.state.inventory.pop();await page.locator('#local-refresh').click();await expect(page.locator('#adb-status')).toHaveText('本机设备列表 2');await expect(page.locator('#local-count')).toHaveText('2');
  lab.state.inventory=inventory;await page.locator('#local-refresh').click();await expect(page.locator('#local-count')).toHaveText('3');await page.screenshot({path:path.join(directory,'local-devices-light-zh.png')});await page.locator('#close-devices').click();console.log('PASS local-device entry reports actual count and refreshes inventory');
  await page.locator('#about').click();await expect(page.locator('#about-summary')).toContainText('wooooooooolf');await expect(page.locator('#about-summary')).toContainText('GPL-3.0-only');
  const built=Date.parse(await page.locator('#about-summary time').getAttribute('datetime'));assert(Number.isFinite(built)&&built<=Date.now()+10000&&built>Date.UTC(2026,0,1));
  await page.locator('[data-tab="project"]').click();await expect(page.locator('#license-document')).toContainText('GNU GENERAL PUBLIC LICENSE');
  await page.locator('[data-tab="thirdParty"]').click();await expect(page.locator('#license-document')).toContainText('@tauri-apps/api');
  const webviewOption=await page.locator('#license-component option').filter({hasText:/^webview2-com /}).getAttribute('value');
  await page.locator('#license-component').selectOption(webviewOption);await expect(page.locator('#license-document')).toContainText('webview2-com');
  await page.locator('#close-about').click();console.log('PASS about metadata and embedded project/third-party licenses');
  await page.locator('#group-name').fill('Locale draft');await page.locator('[data-serial="emulator-5554"]').check();
  await page.locator('#language-toggle').click();await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.locator('#settings')).toHaveText('Local ADB settings');await expect(page.locator('#adb-status')).toHaveText('Local devices 3');
  await expect(page.locator('#group-name')).toHaveValue('Locale draft');await expect(page.locator('[data-serial="emulator-5554"]')).toBeChecked();await expect(page.locator('#sources')).toHaveAttribute('placeholder','192.168.1.0/24 or 192.168.1.20');
  await page.locator('#sources').fill('8.8.8.8');await page.locator('#save').click();await expect(page.locator('#notice')).toContainText('private IPv4');await page.locator('#sources').fill('127.0.0.0/8');
  await page.locator('#theme-toggle').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()),'#0c0d0f');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(directory,'dark-en.png')});await page.locator('#about').click();await page.screenshot({path:path.join(directory,'about-dark-en.png')});await page.locator('#close-about').click();
  await page.locator('#theme-toggle').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(directory,'light-en.png')});
  await page.locator('#language-toggle').click();await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('#adb-status')).toHaveText('本机设备列表 3');
  console.log('PASS locale/theme switches preserve drafts, localize errors and persist preferences');
  await expect(page.getByRole('button',{name:'新建共享组',exact:true})).toHaveCount(1);
  await expect(page.getByText('工作空间',{exact:true})).toHaveCount(0);
  await expect(page.locator('#new-group, #create-first')).toHaveCount(0);
  await expect(page.locator('[data-serial="SIM-RETURN"]')).toBeChecked();
  await expect(page.locator('#devices')).toContainText('暂未连接');
  const name=page.locator('#group-name');await name.fill('原型交互测试');
  await page.locator('[data-serial="emulator-5554"]').check();
  await page.locator('#refresh').click();
  await expect(name).toHaveValue('原型交互测试');await expect(page.locator('[data-serial="emulator-5554"]')).toBeChecked();
  console.log('PASS refresh preserves draft and absent device memberships');
  await page.locator('#save').click();await expect(page.locator('#draft-label')).toHaveText('已保存');
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.groups[0].name,'原型交互测试');assert(saved.groups[0].members.includes('SIM-RETURN'));console.log('PASS atomic save persists intended group');
  await page.locator('#toggle').click();await expect(page.locator('#group-state')).toContainText('共享中');await expect(name).toBeDisabled();
  await page.locator('.copy').first().click();await expect(page.locator('#notice')).toHaveText('命令已复制');console.log('PASS start locks editor and command copy succeeds');
  held=net.connect({host:'127.0.0.1',port});const reader=new Reader(held);await once(held,'connect');held.write(pack('host:transport:SIM-PIXEL'));assert.equal((await reader.bytes(4)).toString(),'OKAY');held.write(pack('shell:sleep 30'));assert.equal((await reader.bytes(4)).toString(),'OKAY');
  await expect(page.locator('#sessions')).toContainText('SIM-PIXEL');await page.screenshot({path:path.join(directory,'sharing.png'),fullPage:true});
  const closed=once(held,'close');await page.locator('#toggle').click();await closed;await expect(name).toBeEnabled();console.log('PASS live session visibility and stop revocation');
  await page.locator('#toggle').click();await expect(page.locator('#group-state')).toContainText('共享中');
  // A damaged cleanup record triggers the same production error/retention path,
  // without modifying the real firewall or presenting a UAC prompt.
  const ledger=path.join(directory,'firewall-rules.json');await writeFile(ledger,'broken');
  await page.locator('#delete-group').click();await expect(page.locator('#confirm-text')).toContainText('将停止');await page.locator('#confirm-yes').click();
  await expect(page.locator('#notice')).toContainText('共享组已保留');await expect(name).toBeEnabled();
  assert.equal(JSON.parse(await readFile(file,'utf8')).groups.length,1);console.log('PASS failed deletion stops sharing and retains group for retry');
  await writeFile(ledger,'[]');await page.locator('#toggle').click();await expect(page.locator('#group-state')).toContainText('共享中');
  await page.locator('#delete-group').click();await page.locator('#confirm-yes').click();await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#notice')).toBeHidden();await expect(page.locator('#groups .group-item')).toHaveCount(0);
  await expect(page.locator('#welcome h2')).toHaveText('局域网 ADB 设备共享');await expect(page.locator('#welcome button')).toHaveCount(0);
  assert.equal(JSON.parse(await readFile(file,'utf8')).groups.length,0);console.log('PASS running-group deletion and concise welcome page without success banner');
  await page.screenshot({path:path.join(directory,'welcome.png'),fullPage:true});
  await page.locator('#new-bottom').click();await page.locator('#address').selectOption('127.0.0.1');await name.fill('新建流程');await page.locator('[data-serial="SIM-PIXEL"]').check();await page.locator('#sources').fill('8.8.8.8');await page.locator('#save').click();await expect(page.locator('#notice')).toContainText('私有 IPv4');
  await page.locator('#sources').fill('127.0.0.1');await page.locator('#save').click();await expect(page.locator('#draft-label')).toHaveText('已保存');console.log('PASS empty state, creation and invalid-source feedback');
  await page.locator('#new-bottom').click();await page.locator('#address').selectOption('127.0.0.1');await name.fill('另一个共享组');await page.locator('[data-serial="SIM-PIXEL"]').check();await page.locator('#save').click();await expect(page.locator('#draft-label')).toHaveText('已保存');
  await page.locator('#delete-group').click();await page.locator('#confirm-yes').click();await expect(name).toHaveValue('新建流程');await expect(page.locator('#welcome')).toBeHidden();await expect(page.locator('#notice')).toBeHidden();console.log('PASS deleting one of several groups selects the remaining group');
  await page.locator('#settings').click();await expect(page.locator('#upstream-port')).toHaveValue(String(lab.port));await page.locator('#close-settings').click();
  await page.locator('#toggle').click();await expect(page.locator('#group-state')).toContainText('共享中');
  const finalConfig=JSON.parse(await readFile(file,'utf8'));const finalPort=finalConfig.groups[0].port;
  await writeFile(ledger,'broken');
  await restorePreferences();
  // WM_CLOSE exercises Tauri's native ExitRequested shutdown path; it does not kill
  // the process. Only the process created by this test is targeted.
  await new Promise((resolve,reject)=>{const closer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${proc.pid}).CloseMainWindow() | Out-Null`],{windowsHide:true});closer.on('error',reject);closer.on('exit',code=>code===0?resolve():reject(Error('WM_CLOSE failed')));});
  await expect(page.locator('#shutdown-title')).toHaveText('退出未完成');assert(!exited,'Cleanup failure must retain native window');
  await expect(page.locator('#shutdown-text')).toContainText('规则清理未完成');
  await writeFile(ledger,'[]');await page.locator('#shutdown-retry').click();
  for(let i=0;i<100&&!exited;i++)await delay(100);assert(exited,'App must exit after successful cleanup retry');
  await assert.rejects(async()=>{const s=net.connect({host:'127.0.0.1',port:finalPort});await once(s,'connect');s.destroy();});console.log('PASS native close preserves window on cleanup failure, then retries and exits');
  assert.deepEqual(errors,[]);console.log('PASS no WebView JavaScript errors');
}finally{await restorePreferences().catch(()=>{});held?.destroy();await browser?.close().catch(()=>{});if(!exited)proc.kill();await lab.close();}
