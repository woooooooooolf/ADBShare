// Actual Linux WebKitGTK WebView, driven through the official tauri-driver.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { root, prepareWorkspace } from './support.mjs';
import { fixture, freePort } from './fixture.mjs';

if (process.platform !== 'linux' || process.getuid() === 0)
  throw Error(
    'Run Linux UI tests as a regular Linux desktop user (or under dbus-run-session / Xvfb).',
  );
process.chdir(root);
const fontFallback = process.argv.includes('--font-fallback');
const directory = await prepareWorkspace(fontFallback ? 'linux-fonts' : 'linux-ui');
let fontEnvironment = {};
let fontDirectory;
if (fontFallback) {
  fontDirectory = await mkdtemp(path.join(os.tmpdir(), 'adbshare-fonts-'));
  const fonts = path.join(fontDirectory, 'fonts');
  await mkdir(fonts);
  await writeFile(
    path.join(fonts, 'Latin.ttf'),
    await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
  );
  const xml = (value) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const config = path.join(fontDirectory, 'fonts.conf');
  const cache = path.join(fontDirectory, 'cache');
  await mkdir(cache);
  await writeFile(
    config,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${xml(fonts)}</dir><cachedir>${xml(cache)}</cachedir></fontconfig>`,
  );
  fontEnvironment = { FONTCONFIG_FILE: config, FONTCONFIG_PATH: fontDirectory };
}
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
      ...fontEnvironment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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
  // The language control itself must remain readable without any text font.
  assert(
    await execute(
      'return !!document.querySelector("#language-toggle svg path") && !document.querySelector("#language-toggle text") && !document.getElementById("language-toggle").textContent.trim()',
    ),
  );
  assert.equal(await ipc('chinese_font_support', { text: 'English 123' }), true);
  await assert.rejects(ipc('chinese_font_support', { text: '' }));
  if (fontFallback) {
    assert.equal(await ipc('chinese_font_support', { text: '共享设备' }), false);
    await eventually(
      'return document.documentElement.lang === "en" && !document.getElementById("app").hidden',
    );
    assert(
      await execute(
        'return document.getElementById("notice").textContent.includes("Chinese interface fonts are missing")',
      ),
    );
    assert(
      await execute(
        'return JSON.parse(localStorage.getItem("adbshare.preferences")).language === "en" && document.getElementById("language-toggle").getAttribute("aria-pressed") === "true"',
      ),
    );
    await click('language-toggle');
    await eventually(
      'return !document.getElementById("language-toggle").disabled && !document.body.classList.contains("busy")',
    );
    assert.equal(await execute('return document.documentElement.lang'), 'en');
    await execute(
      'localStorage.setItem("adbshare.preferences", JSON.stringify({language:"zh",theme:"dark"}))',
    );
    await request('POST', `/session/${session}/refresh`, {});
    await eventually(
      'return !document.getElementById("app").hidden && document.documentElement.lang === "en"',
    );
    assert(
      await execute(
        'return JSON.parse(localStorage.getItem("adbshare.preferences")).language === "en" && document.documentElement.dataset.theme === "dark"',
      ),
    );
    await click('new-bottom');
    await eventually('return !document.getElementById("workspace").hidden');
    const name = '粘贴的中文组名𠮷';
    await execute(
      'const input=document.getElementById("group-name"); input.value=arguments[0];input.dispatchEvent(new Event("input"));document.querySelector("[data-serial=SIM-PIXEL]").click()',
      [name],
    );
    await click('language-toggle');
    await eventually('return !document.body.classList.contains("busy")');
    assert.equal(await execute('return document.getElementById("group-name").value'), name);
    await click('save');
    await eventually(
      'return !document.body.classList.contains("busy") && document.getElementById("save").disabled',
    );
    assert.equal(
      JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')).groups[0].name,
      name,
    );
    // Fault only this command's HTTP response inside the test renderer. Tauri's
    // bridge is immutable; no production override or system setting is involved.
    await execute(
      'window.__originalFontFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes("/chinese_font_support")?Promise.resolve(new Response(JSON.stringify("Synthetic detector failure"),{headers:{"Tauri-Response":"error","Content-Type":"application/json"}})):window.__originalFontFetch(url,...args)',
    );
    await click('language-toggle');
    await eventually(
      'return !document.body.classList.contains("busy") && document.getElementById("notice").textContent.includes("Could not verify Chinese font support")',
    );
    assert.equal(await execute('return document.documentElement.lang'), 'en');
    assert(
      await execute(
        'return JSON.parse(localStorage.getItem("adbshare.preferences")).language === "en"',
      ),
    );
    await execute(
      'window.fetch=(url,...args)=>String(url).includes("/chinese_font_support")?new Promise(resolve=>{window.__lateFontReply=()=>resolve(new Response("true",{headers:{"Tauri-Response":"ok","Content-Type":"application/json"}}))}):window.__originalFontFetch(url,...args)',
    );
    await click('language-toggle');
    await eventually(
      'return !document.body.classList.contains("busy") && !document.getElementById("language-toggle").disabled',
    );
    await execute(
      'window.__lateFontReply();window.fetch=window.__originalFontFetch;delete window.__lateFontReply;delete window.__originalFontFetch',
    );
    await delay();
    assert(
      await execute(
        'return document.documentElement.lang === "en" && JSON.parse(localStorage.getItem("adbshare.preferences")).language === "en"',
      ),
    );
    await writeFile(
      path.join(directory, 'fallback.png'),
      Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
    );
    console.log(
      'PASS Linux missing Chinese fonts: startup and reload persist English, Chinese selection is rejected, SVG control is independent, Unicode input is preserved, detector errors and timeouts fall back, and late replies cannot restore Chinese',
    );
  } else {
    assert.equal(await ipc('chinese_font_support', { text: '共享设备' }), true);
    await click('language-toggle');
    await eventually('return document.documentElement.lang === "en"');
    await request('POST', `/session/${session}/refresh`, {});
    await eventually(
      'return !document.getElementById("app").hidden && document.documentElement.lang === "en"',
    );
    await click('language-toggle');
    await eventually('return document.documentElement.lang === "zh-CN"');
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
      await execute(
        'return document.getElementById("devices").textContent.includes("USB 权限不足")',
      ),
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
  }
} finally {
  if (session) {
    await ipc('request_exit').catch(() => {});
    await request('DELETE', `/session/${session}`).catch(() => {});
  }
  // The native driver and extracted AppImage belong to this isolated group.
  if (driver.pid) {
    try {
      process.kill(-driver.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await lab.close();
  if (diagnostic) await writeFile(path.join(directory, 'driver.log'), diagnostic);
  if (fontDirectory) await rm(fontDirectory, { recursive: true, force: true });
}
