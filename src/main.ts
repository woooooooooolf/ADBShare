import { invoke } from '@tauri-apps/api/core';
import './style.css';

type Group = { id: string; name: string; address: string; port: number; sources: string[]; members: string[] };
type Config = { version: number; adbPath: string; upstreamPort: number; groups: Group[] };
type Device = { serial: string; state: string; model: string; transportId: string; kind: string };
type Session = { id: number; peer: string; serial: string; since: number };
type Runtime = { id: string; status: string; sessions: Session[] };
type Interface = { name: string; address: string; cidr: string };
type Snapshot = { config: Config; runtime: Runtime[]; interfaces: Interface[]; configPath: string; logs: string[]; configError: string | null };
let data: Snapshot;
let devices: Device[] = [];
let draft: Group | null = null;
let dirty = false;
let busy = false;
let adbError = '';
let connected = false;
let refreshing = false;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const glyph = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="2" width="10" height="17" rx="3" stroke="currentColor" stroke-width="2.3"/><path d="M16 19v5m0 0H5v5m11-5h11v5" stroke="currentColor" stroke-width="2.3"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>`;
const runtime = () => data.runtime.find(r => r.id === draft?.id);
const locked = () => Boolean(runtime());

document.querySelector('#app')!.innerHTML = `
  <aside><div class="brand"><span class="brand-icon">${glyph}</span><div>ADBShare<small>局域网设备共享</small></div></div>
    <div class="nav-label">工作空间 <span class="version">PROTOTYPE 0.1</span></div>
    <div class="side-title"><span>共享组</span><button id="new-group" class="icon-btn" title="新建共享组" aria-label="新建共享组">＋</button></div>
    <nav id="groups"></nav><button id="new-bottom" class="new-group">＋ 新建共享组</button>
    <div class="side-bottom"><div class="local-status"><span id="adb-dot" class="dot"></span><span id="adb-status">正在检查本机 ADB</span></div><button id="settings" class="text-btn">本机 ADB 设置 ↗</button><p>共享期间，本机仍可使用设备。<br>关闭窗口将停止全部共享。</p></div>
  </aside>
  <main><header><div><span class="eyebrow">DEVICE SHARING</span><h1 id="title">让设备在局域网中可达</h1></div><div class="header-actions"><span id="summary" class="quiet"></span><button id="refresh" class="secondary">↻ 刷新设备</button></div></header>
  <div id="notice" role="status" hidden></div>
  <section id="welcome" class="welcome"><div class="hero-icon">${glyph}</div><span class="eyebrow">从一个共享组开始</span><h2>连接在这里，调试在任何一台电脑。</h2><p>把本机的 ADB 设备分组，通过指定网卡共享给局域网中的电脑。</p><button id="create-first" class="primary">＋ 创建第一个共享组</button><div class="intro-steps"><div><b>01</b><strong>选择设备</strong><span>保留本地连接与访问</span></div><div><b>02</b><strong>设置访问范围</strong><span>选择网卡与允许的主机</span></div><div><b>03</b><strong>复制连接命令</strong><span>远端直接使用标准 adb</span></div></div></section>
  <section id="workspace" hidden>
    <div class="group-heading"><div><span id="group-state" class="badge">尚未保存</span><span id="draft-label" class="quiet"></span></div><button id="delete-group" class="danger-text">删除共享组</button></div>
    <div class="apply-bar"><span id="apply-hint" class="quiet">配置只在保存后生效</span><div><button id="save" class="secondary">保存配置</button><button id="toggle" class="primary">保存并开始共享</button></div></div>
    <div class="columns"><div class="configuration"><section class="card"><div class="section-head"><span class="step">01</span><div><h2>选择共享设备</h2><p>允许多台主机连接，由使用者协调设备操作。</p></div><span id="member-count" class="count"></span></div><div id="devices"></div></section>
      <section class="card"><div class="section-head"><span class="step">02</span><div><h2>设置共享入口</h2><p>选择局域网网卡，限定可以接入的主机。</p></div></div>
        <div class="form"><label>共享组名称<input id="group-name" maxlength="60" placeholder="例如：Android 调试组"></label><div class="form-row"><label>监听网卡<select id="address"></select></label><label class="port">端口<input id="port" type="number" min="1" max="65535"></label></div>
        <label>允许的来源 IP / 网段<textarea id="sources" rows="2" placeholder="192.168.1.0/24 或 192.168.1.20"></textarea></label><p class="field-help">多个地址用逗号或换行分隔。本机回环访问始终允许。</p></div>
        <div class="firewall-bar"><span>Windows 防火墙 · 专用 / 域网络</span><button id="firewall-add" class="text-btn">配置放行…</button><button id="firewall-remove" class="text-btn">移除规则…</button></div>
      </section>
    </div><div class="details"><section class="card connect-card"><div class="section-head"><span class="step">03</span><div><h2>在远端使用</h2><p>远端电脑需要安装 ADB 工具。</p></div></div><div id="connection"></div></section><section class="card"><div class="section-head compact"><h2>当前连接</h2><span id="session-count" class="count">0</span></div><div id="sessions"></div></section><div class="scope-note"><strong>调试设备，保持原有方式。</strong><p>本地和远端可以同时使用 shell、logcat、文件传输等命令；操作冲突由使用者协调。</p></div></div></div>
  </section>
  <details class="logs"><summary>运行日志 <span id="log-count"></span></summary><pre id="logs"></pre><p id="config-path" class="quiet"></p></details>
  </main>
  <dialog id="settings-dialog"><form id="settings-form"><span class="eyebrow">LOCAL ADB</span><h2>本机 ADB 设置</h2><p class="quiet">连接本机已有 ADB Server，设备无需改为无线调试。</p><label>adb 可执行文件<input id="adb-path" placeholder="adb 或完整路径"></label><label>本机 Server 端口<input id="upstream-port" type="number" min="1" max="65535"></label><p class="field-help">运行中修改上游端口前，请先停止所有共享组。</p><div class="dialog-actions"><button type="button" id="start-adb" class="secondary">启动本机 ADB</button><button type="button" id="close-settings" class="secondary">取消</button><button type="submit" class="primary">保存</button></div></form></dialog>
  <dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-text"></p><div class="dialog-actions"><button id="confirm-no" class="secondary">取消</button><button id="confirm-yes" class="primary">确认</button></div></dialog>`;

function notify(text: string, error = false) { const n = $('notice'); n.hidden = false; n.className = error ? 'error' : 'success'; n.textContent = text; }
function confirmAction(title: string, text: string): Promise<boolean> {
  $('confirm-title').textContent = title; $('confirm-text').textContent = text;
  const dialog = $<HTMLDialogElement>('confirm-dialog'); dialog.showModal();
  return new Promise(resolve => {
    const finish = (v: boolean) => { dialog.close(); resolve(v); };
    $('confirm-yes').onclick = () => finish(true); $('confirm-no').onclick = () => finish(false);
    dialog.oncancel = () => finish(false);
  });
}
async function action(fn: () => Promise<void>) {
  if (busy) return; busy = true; document.body.classList.add('busy'); renderState();
  try { await fn(); } catch (e) { notify(String(e), true); }
  finally { busy = false; document.body.classList.remove('busy'); renderState(); }
}
async function sync() { data = await invoke<Snapshot>('snapshot'); renderSide(); renderState(); }
function markDirty() { dirty = true; renderSide(); renderState(); }
function renderSide() {
  const groups = [...data.config.groups]; if (draft && !groups.some(g => g.id === draft!.id)) groups.push(draft);
  $('groups').innerHTML = groups.map(g => {
    const r = data.runtime.find(r => r.id === g.id);
    return `<button class="group-item ${draft?.id === g.id ? 'selected' : ''}" data-group="${esc(g.id)}"><span class="group-icon">▦</span><span><strong>${esc(g.id === draft?.id ? draft.name : g.name)}</strong><small>${g.members.length} 台设备 · ${r ? r.status === 'running' ? '共享中' : '监听异常' : '未启动'}</small></span><i class="dot ${r?.status === 'running' ? 'online' : ''}"></i></button>`;
  }).join('');
  $('groups').querySelectorAll<HTMLButtonElement>('[data-group]').forEach(b => b.onclick = () => void selectGroup(b.dataset.group!));
  $('summary').textContent = `${data.runtime.filter(r => r.status === 'running').length} 个共享组运行中`;
  $('config-path').textContent = `配置文件：${data.configPath}`;
  $('log-count').textContent = String(data.logs.length);
  $('logs').textContent = data.logs.map(l => { const p = l.indexOf(' '); return `${new Date(Number(l.slice(0,p))*1000).toLocaleTimeString()} ${l.slice(p+1)}`; }).join('\n') || '尚无运行日志';
}
function renderEditor() {
  $('welcome').hidden = !!draft; $('workspace').hidden = !draft;
  if (!draft) return;
  $('title').textContent = '管理共享组';
  $<HTMLInputElement>('group-name').value = draft.name;
  $<HTMLInputElement>('port').value = String(draft.port);
  $<HTMLTextAreaElement>('sources').value = draft.sources.join('\n');
  const interfaces = [...data.interfaces];
  if (!interfaces.some(i => i.address === draft!.address)) interfaces.push({ address: draft.address, name: '已保存的地址 · 当前不可用', cidr: '' });
  $('address').innerHTML = interfaces.map(i => `<option value="${esc(i.address)}">${esc(i.address)} · ${esc(i.name)}</option>`).join('');
  $<HTMLSelectElement>('address').value = draft.address;
  renderDevices(); renderState(); renderSide();
}
function renderDevices() {
  if (!draft) return;
  const list = [...devices];
  draft.members.filter(s => !list.some(d => d.serial === s)).forEach(serial => list.push({ serial, state: 'absent', model: '已分配设备', transportId: '', kind: '' }));
  $('devices').innerHTML = list.length ? list.map(d => `<label class="device-row"><input type="checkbox" data-serial="${esc(d.serial)}" ${draft!.members.includes(d.serial) ? 'checked' : ''} ${locked() ? 'disabled' : ''}><span class="device-icon">${glyph}</span><span class="device-name"><strong>${esc(d.model || d.serial)}</strong><code>${esc(d.serial)}</code></span><span class="device-state ${d.state === 'device' ? 'ready' : ''}">${esc(({device: '已连接', offline: '离线', unauthorized: '待授权', absent: '暂未连接'} as Record<string,string>)[d.state] || d.state)}</span></label>`).join('') : `<div class="empty"><span>⌁</span><strong>${connected ? '暂未发现设备' : '本机 ADB 未连接'}</strong><p>${connected ? '连接 Android 设备，并在设备上允许 USB 调试。' : esc(adbError || '请检查本机 ADB 设置。')}</p><button id="empty-settings" class="text-btn">打开本机 ADB 设置 ↗</button></div>`;
  $('devices').querySelectorAll<HTMLInputElement>('[data-serial]').forEach(input => input.onchange = () => {
    if (!draft) return;
    const s = input.dataset.serial!; draft.members = input.checked ? [...new Set([...draft.members, s])] : draft.members.filter(m => m !== s); markDirty();
  });
  if ($('empty-settings')) $('empty-settings').onclick = openSettings;
}
function commands(): string[] {
  if (!draft) return [];
  const base = `adb -H ${draft.address} -P ${draft.port}`;
  const serial = draft.members[0]; const arg = serial ? `"${serial.replace(/["`$\\]/g, '')}"` : 'SERIAL';
  return [`${base} devices -l`, `${base} -s ${arg} shell`];
}
function renderState() {
  if (!data || !draft) return;
  const r = runtime(); const running = r?.status === 'running'; const disabled = locked();
  $('group-state').textContent = r ? running ? '● 共享中' : '监听异常' : data.config.groups.some(g => g.id === draft!.id) ? '已停止' : '新共享组';
  $('group-state').className = `badge ${running ? 'active' : ''}`;
  $('draft-label').textContent = dirty ? '有未保存的修改' : '配置已保存';
  $('member-count').textContent = `${draft.members.length} 已选`;
  for (const id of ['group-name', 'port', 'address', 'sources']) ($<HTMLInputElement>(id)).disabled = disabled || busy;
  $('devices').querySelectorAll<HTMLInputElement>('input').forEach(e => e.disabled = disabled || busy);
  $<HTMLButtonElement>('save').disabled = disabled || busy || !dirty;
  $<HTMLButtonElement>('toggle').disabled = busy;
  $('toggle').textContent = r ? '停止共享' : dirty ? '保存并开始共享' : '开始共享';
  $('toggle').className = r ? 'stop-button' : 'primary';
  $<HTMLButtonElement>('delete-group').disabled = disabled || busy;
  for (const id of ['firewall-add','firewall-remove']) $<HTMLButtonElement>(id).disabled = busy || dirty || draft.address.startsWith('127.');
  $('apply-hint').textContent = disabled ? '先停止共享，即可修改本组配置' : dirty ? '修改尚未应用到共享入口' : '配置已保存，可开始共享';
  const cmd = commands();
  $('connection').innerHTML = `<div class="endpoint"><span>${draft.address.startsWith('127.') ? '仅供本机测试' : '共享入口'}</span><strong>${esc(draft.address)}<em>:${draft.port}</em></strong><small>${running ? '监听已就绪 · 远端连通还取决于路由与防火墙' : '启动共享后，这个入口才会接受连接'}</small></div>${dirty ? '<p class="draft-warning">以下命令为草稿预览，保存后使用。</p>' : ''}${cmd.map((c,i) => `<div class="command"><span>${i === 0 ? '查看组内设备' : '打开设备 shell'}</span><code>${esc(c)}</code><button class="text-btn copy" data-command="${i}">复制</button></div>`).join('')}<p class="connection-note">在获准的远端主机执行。不需要在 Android 设备上开启网络 ADB。</p>`;
  $('connection').querySelectorAll<HTMLButtonElement>('.copy').forEach(b => b.onclick = () => void action(async () => { await navigator.clipboard.writeText(cmd[Number(b.dataset.command)]); notify('命令已复制'); }));
  const sessions = r?.sessions || [];
  $('session-count').textContent = String(sessions.length);
  $('sessions').innerHTML = sessions.length ? sessions.map(s => `<div class="session"><i class="dot online"></i><div><code>${esc(s.peer)}</code><small>${esc(s.serial)} · ${new Date(s.since*1000).toLocaleTimeString()}</small></div></div>`).join('') : `<div class="small-empty">${running ? '等待远端主机接入' : '开始共享后显示活动连接'}</div>`;
}
async function mayDiscard() { return !dirty || await confirmAction('放弃尚未保存的修改？', '当前共享组的编辑内容还没有保存。'); }
async function selectGroup(id: string) {
  if (busy || draft?.id === id || !await mayDiscard()) return;
  const g = data.config.groups.find(g => g.id === id); if (!g) return;
  draft = structuredClone(g); dirty = false; renderEditor();
}
async function newGroup() {
  if (busy || !await mayDiscard()) return;
  const iface = data.interfaces.find(i => !i.address.startsWith('127.') && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) || data.interfaces.find(i => i.address === '127.0.0.1')!;
  let port = 15037; while (data.config.groups.some(g => g.port === port)) port++;
  draft = { id: crypto.randomUUID(), name: '新的共享组', address: iface.address, port, sources: [iface.cidr], members: [] };
  dirty = true; renderEditor(); $('group-name').focus();
}
async function save() {
  if (!draft) return;
  const config = structuredClone(data.config); const i = config.groups.findIndex(g => g.id === draft!.id);
  if (i < 0) config.groups.push(structuredClone(draft)); else config.groups[i] = structuredClone(draft);
  await invoke('save_config', { config }); dirty = false; await sync(); renderEditor();
}
async function refreshDevices() {
  if (refreshing) return; refreshing = true;
  try { devices = await invoke<Device[]>('discover'); connected = true; adbError = ''; }
  catch (e) { connected = false; adbError = String(e); devices = []; }
  finally { refreshing = false; }
  $('adb-dot').className = `dot ${connected ? 'online' : 'warning'}`;
  $('adb-status').textContent = connected ? `本机 ADB · ${devices.length} 台设备` : '本机 ADB 未连接';
  renderDevices();
}
function openSettings() {
  $<HTMLInputElement>('adb-path').value = data.config.adbPath;
  $<HTMLInputElement>('upstream-port').value = String(data.config.upstreamPort);
  $<HTMLDialogElement>('settings-dialog').showModal();
}
$('new-group').onclick = $('new-bottom').onclick = $('create-first').onclick = () => void newGroup();
$('settings').onclick = openSettings;
$('close-settings').onclick = () => $<HTMLDialogElement>('settings-dialog').close();
$('refresh').onclick = () => void action(async () => {await refreshDevices(); await sync(); if (!connected) notify(adbError, true);});
$('group-name').oninput = () => {if (draft) {draft.name = $<HTMLInputElement>('group-name').value; markDirty();}};
$('port').oninput = () => {if (draft) {draft.port = Number($<HTMLInputElement>('port').value); markDirty();}};
$('sources').oninput = () => {if (draft) {draft.sources = $<HTMLTextAreaElement>('sources').value.split(/[,;\s]+/).filter(Boolean); markDirty();}};
$('address').onchange = () => {if (draft) {draft.address = $<HTMLSelectElement>('address').value; draft.sources = [data.interfaces.find(i => i.address === draft!.address)?.cidr || '']; dirty = true; renderEditor();}};
$('save').onclick = () => void action(async () => {await save(); notify('共享组配置已保存');});
$('toggle').onclick = () => void action(async () => {
  if (!draft) return;
  if (runtime()) {await invoke('stop_group', {id: draft.id}); notify('共享已停止，组内连接已关闭');}
  else {if (dirty) await save(); await invoke('start_group', {id: draft.id}); notify('监听已就绪，可以在获准主机上运行连接命令');}
  await sync(); renderEditor();
});
$('delete-group').onclick = async () => {
  if (!draft || !await confirmAction('删除这个共享组？', '设备本身不受影响。若配置过防火墙规则，请先点击“移除规则”。')) return;
  void action(async () => { const config = structuredClone(data.config); config.groups = config.groups.filter(g => g.id !== draft!.id); await invoke('save_config', {config}); draft = null; dirty = false; await sync(); renderEditor(); notify('共享组已删除'); });
};
for (const remove of [false,true]) $(remove ? 'firewall-remove' : 'firewall-add').onclick = () => void action(async () => {
  await invoke('firewall', { id: draft!.id, remove }); notify(remove ? '防火墙规则已移除' : '防火墙规则已配置，仅适用于专用 / 域网络');
});
$('settings-form').onsubmit = e => { e.preventDefault(); void action(async () => {
  const config = structuredClone(data.config); config.adbPath = $<HTMLInputElement>('adb-path').value.trim(); config.upstreamPort = Number($<HTMLInputElement>('upstream-port').value);
  await invoke('save_config', {config}); $<HTMLDialogElement>('settings-dialog').close(); await sync(); await refreshDevices(); notify('本机 ADB 设置已保存');
}); };
$('start-adb').onclick = () => void action(async () => {
  const config = structuredClone(data.config); config.adbPath = $<HTMLInputElement>('adb-path').value.trim(); config.upstreamPort = Number($<HTMLInputElement>('upstream-port').value);
  await invoke('save_config', {config}); await invoke('start_adb'); await sync(); await refreshDevices();
  $<HTMLDialogElement>('settings-dialog').close(); notify('本机 ADB 已启动');
});
async function boot() {
  try { await sync(); if (data.configError) notify(`配置加载失败，请检查 ${data.configPath} 后重启：${data.configError}`,true); if (data.config.groups[0]) {draft = structuredClone(data.config.groups[0]); renderEditor();} await refreshDevices(); }
  catch (e) {notify(`应用初始化失败：${e}`,true);}
  setInterval(() => { if (!busy) void sync().catch(e => notify(String(e),true)); },2000);
  setInterval(() => { if (!busy) void refreshDevices(); },4000);
}
void boot();
