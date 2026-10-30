import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { language, theme, preferences, t, translate, errorText, logText } from './i18n';
import { icons } from './icons';
import './style.css';

type Group = { id: string; name: string; address: string; port: number; sources: string[]; members: string[] };
type Config = { version: number; adbPath: string; upstreamPort: number; groups: Group[] };
type Device = { serial: string; state: string; model: string; transportId: string; kind: string };
type Session = { id: number; peer: string; serial: string; since: number };
type Runtime = { id: string; status: string; sessions: Session[] };
type Interface = { name: string; address: string; cidr: string };
type Snapshot = { config: Config; runtime: Runtime[]; interfaces: Interface[]; configPath: string; logs: string[]; configError: string | null };
type AppInfo = { name: string; version: string; buildTimestamp: number; author: string; license: string };
let data: Snapshot;
let devices: Device[] = [];
let draft: Group | null = null;
let dirty = false;
let busy = false;
let adbError = '';
let connected = false;
let refreshing = false;
let info: AppInfo | null = null;
let aboutTab: 'overview' | 'project' | 'thirdParty' = 'overview';
let components: string[] = [];
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = (id: string) => $<HTMLDialogElement>(id);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const runtime = () => data?.runtime.find(r => r.id === draft?.id);
const locked = () => Boolean(runtime());
const glyph = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="2" width="10" height="17" rx="3" stroke="currentColor" stroke-width="2"/><path d="M16 19v5m0 0H5v5m11-5h11v5" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>`;
preferences();

document.querySelector('#app')!.innerHTML = `
<aside>
  <div class="brand"><span class="brand-icon">${glyph}</span><div>ADBShare<small data-i18n="tagline"></small></div></div>
  <div class="side-title" data-i18n="groups"></div><nav id="groups"></nav>
  <button id="new-bottom" class="new-group"><span aria-hidden="true">＋</span> <span data-i18n="newGroup"></span></button>
  <div class="side-bottom">
    <button id="device-entry" class="flat-nav" aria-haspopup="dialog" aria-expanded="false">${icons.devices}<span id="adb-status"></span><i id="adb-dot" class="dot"></i></button>
    <button id="settings" class="flat-nav" aria-haspopup="dialog" aria-expanded="false">${icons.settings}<span data-i18n="settings"></span></button>
    <div class="utility-bar">
      <button id="language-toggle" class="square-button">${icons.language}</button>
      <button id="theme-toggle" class="square-button"></button>
      <button id="about" class="square-button" aria-haspopup="dialog" aria-expanded="false">${icons.info}</button>
    </div>
  </div>
</aside>
<main>
  <header><h1 id="title"></h1><div class="header-actions"><span id="summary" class="quiet"></span><button id="refresh" class="secondary" data-i18n="refresh"></button></div></header>
  <div id="notice" role="status" hidden></div>
  <section id="welcome" class="welcome"><div class="welcome-icon">${glyph}</div><h2 data-i18n="welcomeTitle"></h2><p class="welcome-description" data-i18n="welcomeDescription"></p><div class="welcome-steps"><span><b>01</b><span data-i18n="selectDevices"></span></span><span><b>02</b><span data-i18n="endpoint"></span></span><span><b>03</b><span data-i18n="remoteUse"></span></span></div></section>
  <section id="workspace" hidden>
    <div class="group-heading"><div><span id="group-state" class="badge"></span><span id="draft-label" class="quiet"></span></div><button id="delete-group" class="danger-text" data-i18n="deleteGroup"></button></div>
    <div class="apply-bar"><span id="apply-hint" class="quiet"></span><div><button id="save" class="secondary" data-i18n="save"></button><button id="toggle" class="primary"></button></div></div>
    <div class="columns"><div class="configuration">
      <section class="card"><div class="section-head"><span class="step">01</span><div><h2 data-i18n="selectDevices"></h2><p data-i18n="deviceHint"></p></div><span id="member-count" class="count"></span></div><div id="devices"></div></section>
      <section class="card"><div class="section-head"><span class="step">02</span><div><h2 data-i18n="endpoint"></h2><p data-i18n="endpointHint"></p></div></div>
        <div class="form"><label><span data-i18n="name"></span><input id="group-name" maxlength="60" data-placeholder="namePlaceholder"></label><div class="form-row"><label><span data-i18n="adapter"></span><select id="address"></select></label><label class="port"><span data-i18n="port"></span><input id="port" type="number" min="1" max="65535"></label></div>
        <label><span data-i18n="sources"></span><textarea id="sources" rows="2" data-placeholder="sourcesPlaceholder"></textarea></label><p class="field-help" data-i18n="sourceHint"></p></div>
        <div class="firewall-bar"><span data-i18n="firewall"></span><button id="firewall-add" class="text-btn" data-i18n="firewallAdd"></button><button id="firewall-remove" class="text-btn" data-i18n="firewallRemove"></button></div>
      </section>
    </div><div class="details">
      <section class="card connect-card"><div class="section-head"><span class="step">03</span><div><h2 data-i18n="remoteUse"></h2><p data-i18n="remoteHint"></p></div></div><div id="connection"></div></section>
      <section class="card"><div class="section-head compact"><h2 data-i18n="connections"></h2><span id="session-count" class="count">0</span></div><div id="sessions"></div></section>
    </div></div>
  </section>
  <details class="logs"><summary><span data-i18n="logs"></span> <span id="log-count"></span></summary><pre id="logs"></pre><p id="config-path" class="quiet"></p></details>
</main>
<dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><h2 data-i18n="settings"></h2><button type="button" id="close-settings" class="square-button close-button">${icons.close}</button></div><p class="quiet" data-i18n="settingsHint"></p><label><span data-i18n="adbPath"></span><input id="adb-path" data-placeholder="adbPathPlaceholder"></label><label><span data-i18n="upstreamPort"></span><input id="upstream-port" type="number" min="1" max="65535"></label><p class="field-help" data-i18n="settingsPortHint"></p><div class="dialog-actions"><button type="button" id="start-adb" class="secondary" data-i18n="startAdb"></button><button type="submit" class="primary" data-i18n="save"></button></div></form></dialog>
<dialog id="local-devices-dialog" class="wide-dialog"><div class="dialog-heading"><h2><span data-i18n="localDevices"></span> <span id="local-count" class="count"></span></h2><div class="header-actions"><button id="local-refresh" class="secondary" data-i18n="refresh"></button><button id="close-devices" class="square-button close-button">${icons.close}</button></div></div><div id="local-device-list"></div></dialog>
<dialog id="about-dialog" class="wide-dialog"><div class="dialog-heading"><h2 data-i18n="about"></h2><button id="close-about" class="square-button close-button">${icons.close}</button></div><div class="about-tabs"><button data-tab="overview" data-i18n="overview"></button><button data-tab="project" data-i18n="projectLicense"></button><button data-tab="thirdParty" data-i18n="thirdParty"></button></div><div id="about-summary"></div><label id="component-picker" hidden><span data-i18n="component"></span><select id="license-component"></select></label><pre id="license-document" hidden tabindex="0" lang="en"></pre></dialog>
<dialog id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-text"></p><div class="dialog-actions"><button id="confirm-no" class="secondary" data-i18n="cancel"></button><button id="confirm-yes" class="primary" data-i18n="confirm"></button></div></dialog>
<dialog id="shutdown-dialog"><h2 id="shutdown-title"></h2><p id="shutdown-text"></p><div id="shutdown-actions" class="dialog-actions" hidden><button id="shutdown-back" class="secondary" data-i18n="back"></button><button id="shutdown-retry" class="primary" data-i18n="retryExit"></button></div></dialog>`;

function clearNotice() { clearTimeout(noticeTimer); $('notice').hidden = true; $('notice').textContent = ''; }
function notify(text: string, error = false) { clearNotice(); const n = $('notice'); n.hidden = false; n.className = error ? 'error' : 'success'; n.textContent = text; if (!error) noticeTimer = setTimeout(clearNotice, 3000); }
async function action(fn: () => Promise<void>) {
  if (busy) return; busy = true; document.body.classList.add('busy'); renderState();
  try { await fn(); } catch (e) { console.error(e); notify(errorText(e), true); }
  finally { busy = false; document.body.classList.remove('busy'); renderState(); }
}
function confirmAction(title: string, text: string): Promise<boolean> {
  $('confirm-title').textContent = title; $('confirm-text').textContent = text; dialog('confirm-dialog').showModal();
  return new Promise(resolve => {
    const finish = (v: boolean) => { dialog('confirm-dialog').close(); resolve(v); };
    $('confirm-yes').onclick = () => finish(true); $('confirm-no').onclick = () => finish(false); dialog('confirm-dialog').oncancel = () => finish(false);
  });
}
async function sync() { data = await invoke<Snapshot>('snapshot'); renderSide(); renderState(); }
function markDirty() { dirty = true; clearNotice(); renderSide(); renderState(); }
function stateLabel(state: string) { return ({device:t('online'),offline:t('offline'),unauthorized:t('unauthorized'),absent:t('absent')} as Record<string,string>)[state] || state; }
function renderSide() {
  if (!data) return;
  const groups = [...data.config.groups]; if (draft && !groups.some(g => g.id === draft!.id)) groups.push(draft);
  $('groups').innerHTML = groups.map(g => {
    const r = data.runtime.find(r => r.id === g.id);
    return `<button class="group-item ${draft?.id === g.id ? 'selected' : ''}" data-group="${esc(g.id)}"><span class="group-icon">▦</span><span><strong>${esc(g.id === draft?.id ? draft.name : g.name)}</strong><small>${t('deviceCount',{n:g.members.length})} · ${r ? t(r.status==='running'?'running':'failed') : t('stopped')}</small></span><i class="dot ${r?.status==='running'?'online':''}"></i></button>`;
  }).join('');
  $('groups').querySelectorAll<HTMLButtonElement>('[data-group]').forEach(b => b.onclick = () => void selectGroup(b.dataset.group!));
  $('summary').textContent = t('runningCount',{n:data.runtime.filter(r=>r.status==='running').length});
  $('config-path').textContent = `${t('configPath')}: ${data.configPath}`;
  $('log-count').textContent = String(data.logs.length);
  $('logs').textContent = data.logs.map(l=>{const p=l.indexOf(' '); return `${new Date(Number(l.slice(0,p))*1000).toLocaleTimeString(language==='zh'?'zh-CN':'en-US')} ${logText(l.slice(p+1))}`;}).join('\n') || t('noLogs');
  $('title').textContent = t(draft?'groupConfig':'groups');
}
function renderAddressOptions() {
  if (!draft) return;
  const interfaces = [...data.interfaces];
  if (!interfaces.some(i=>i.address===draft!.address)) interfaces.push({address:draft.address,name:t('unavailableAddress'),cidr:''});
  $('address').innerHTML = interfaces.map(i=>`<option value="${esc(i.address)}">${esc(i.address)} · ${esc(i.address==='127.0.0.1'?t('localOnly'):i.name)}</option>`).join('');
  $<HTMLSelectElement>('address').value = draft.address;
}
function renderEditor() {
  $('welcome').hidden = !!draft; $('workspace').hidden = !draft;
  if (draft) {
    $<HTMLInputElement>('group-name').value = draft.name;
    $<HTMLInputElement>('port').value = String(draft.port);
    $<HTMLTextAreaElement>('sources').value = draft.sources.join('\n');
    renderAddressOptions(); renderDevices();
  }
  renderSide(); renderState();
}
function renderDevices() {
  if (!draft) return;
  const list = [...devices];
  draft.members.filter(s=>!list.some(d=>d.serial===s)).forEach(serial=>list.push({serial,state:'absent',model:'',transportId:'',kind:''}));
  $('devices').innerHTML = list.length ? list.map(d=>`<label class="device-row"><input type="checkbox" data-serial="${esc(d.serial)}" ${draft!.members.includes(d.serial)?'checked':''} ${locked()?'disabled':''}><span class="device-icon">${icons.devices}</span><span class="device-name"><strong>${esc(d.model || (d.state==='absent'?t('assigned'):d.serial))}</strong><code>${esc(d.serial)}</code></span><span class="device-state ${d.state==='device'?'ready':''}">${esc(stateLabel(d.state))}</span></label>`).join('') : `<div class="empty"><strong>${t(connected?'noDevices':'adbOffline')}</strong><p>${connected?t('connectDevice'):errorText(adbError || t('noUpstream'))}</p><button id="empty-settings" class="text-btn">${t('openSettings')}</button></div>`;
  $('devices').querySelectorAll<HTMLInputElement>('[data-serial]').forEach(input=>input.onchange=()=>{
    if (!draft) return; const s=input.dataset.serial!;
    draft.members=input.checked?[...new Set([...draft.members,s])]:draft.members.filter(m=>m!==s); markDirty();
  });
  if ($('empty-settings')) $('empty-settings').onclick=openSettings;
}
function renderLocalDevices() {
  $('adb-status').textContent = `${t('localDevices')} ${devices.length}`;
  $('device-entry').title = connected?t('localDevices'):t('adbOffline');
  $('adb-dot').className = `dot ${connected?'online':'warning'}`;
  $('local-count').textContent = String(devices.length);
  $('local-device-list').innerHTML = devices.length ? `<table><thead><tr><th>${t('model')}</th><th>${t('serial')}</th><th>${t('state')}</th><th>${t('transport')}</th></tr></thead><tbody>${devices.map(d=>`<tr><td>${esc(d.model || '—')}</td><td><code>${esc(d.serial)}</code></td><td><span class="device-state ${d.state==='device'?'ready':''}">${esc(stateLabel(d.state))}</span></td><td>${t(d.kind==='usb'?'usb':'localTransport')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>${t(connected?'noDevices':'adbOffline')}</strong><p>${connected?t('connectDevice'):errorText(adbError || t('noUpstream'))}</p></div>`;
}
function commands() {
  if (!draft) return [];
  const base=`adb -H ${draft.address} -P ${draft.port}`;
  const serial=draft.members[0]; const arg=serial?`"${serial.replace(/["`$\\]/g,'')}"`:'SERIAL';
  return [`${base} devices -l`,`${base} -s ${arg} shell`];
}
function renderState() {
  if (!data || !draft) return;
  const r=runtime(); const running=r?.status==='running'; const disabled=locked();
  $('group-state').textContent = r?t(running?'running':'failed'):t(data.config.groups.some(g=>g.id===draft!.id)?'stopped':'newState');
  $('group-state').className = `badge ${running?'active':''}`;
  $('draft-label').textContent=t(dirty?'unsaved':'saved'); $('member-count').textContent=t('selectedCount',{n:draft.members.length});
  for (const id of ['group-name','port','address','sources']) $<HTMLInputElement>(id).disabled=disabled || busy;
  $('devices').querySelectorAll<HTMLInputElement>('input').forEach(e=>e.disabled=disabled || busy);
  $<HTMLButtonElement>('save').disabled=disabled || busy || !dirty;
  $<HTMLButtonElement>('toggle').disabled=busy; $('toggle').textContent=t(r?'stop':dirty?'saveStart':'start'); $('toggle').className=r?'stop-button':'primary';
  $<HTMLButtonElement>('delete-group').disabled=busy;
  $<HTMLButtonElement>('firewall-add').disabled=busy || dirty || draft.address.startsWith('127.');
  $<HTMLButtonElement>('firewall-remove').disabled=busy || !data.config.groups.some(g=>g.id===draft!.id);
  $('apply-hint').textContent=t(disabled?'editStopped':dirty?'changesPending':'readyToStart');
  const cmd=commands();
  $('connection').innerHTML=`<div class="endpoint"><span>${t(draft.address.startsWith('127.')?'localOnly':'endpoint')}</span><strong>${esc(draft.address)}<em>:${draft.port}</em></strong><small>${t(running?'listening':'notListening')}</small></div>${dirty?`<p class="draft-warning">${t('commandPreview')}</p>`:''}${cmd.map((c,i)=>`<div class="command"><span>${t(i===0?'listCommand':'shellCommand')}</span><code>${esc(c)}</code><button class="text-btn copy" data-command="${i}">${t('copy')}</button></div>`).join('')}`;
  $('connection').querySelectorAll<HTMLButtonElement>('.copy').forEach(b=>b.onclick=()=>void action(async()=>{await navigator.clipboard.writeText(cmd[Number(b.dataset.command)]);notify(t('copied'));}));
  const sessions=r?.sessions || []; $('session-count').textContent=String(sessions.length);
  $('sessions').innerHTML=sessions.length?sessions.map(s=>`<div class="session"><i class="dot online"></i><div><code>${esc(s.peer)}</code><small>${esc(s.serial==='协商中'?(language==='zh'?'协商中':'Negotiating'):s.serial)} · ${new Date(s.since*1000).toLocaleTimeString(language==='zh'?'zh-CN':'en-US')}</small></div></div>`).join(''):`<div class="small-empty">${t(running?'noConnections':'startForConnections')}</div>`;
}
function applyLanguage() {
  translate(); renderSide(); renderState(); renderDevices(); renderAddressOptions(); renderLocalDevices(); renderAbout();
  $('language-toggle').title=t('switchLanguage'); $('language-toggle').setAttribute('aria-label',t('switchLanguage')); $('language-toggle').setAttribute('aria-pressed',String(language==='en'));
  $('theme-toggle').innerHTML=theme==='dark'?icons.sun:icons.moon;
  $('theme-toggle').title=t(theme==='dark'?'lightMode':'darkMode'); $('theme-toggle').setAttribute('aria-label',t(theme==='dark'?'lightMode':'darkMode')); $('theme-toggle').setAttribute('aria-pressed',String(theme==='dark'));
  $('about').title=t('about'); $('about').setAttribute('aria-label',t('about'));
  document.querySelectorAll<HTMLElement>('.close-button').forEach(b=>{b.title=t('close');b.setAttribute('aria-label',t('close'));});
}
function renderAbout() {
  if (!info) return;
  const date=new Date(info.buildTimestamp*1000);
  $('about-summary').innerHTML=`<div class="about-brand">${glyph}<strong>${esc(info.name)}</strong></div><dl><dt>${t('version')}</dt><dd>${esc(info.version)}</dd><dt>${t('buildTime')}</dt><dd><time datetime="${date.toISOString()}">${date.toLocaleString(language==='zh'?'zh-CN':'en-US',{timeZoneName:'short'})}</time></dd><dt>${t('author')}</dt><dd>${esc(info.author)}</dd><dt>${t('projectLicense')}</dt><dd>GPLv3 <span class="quiet">(${esc(info.license)})</span></dd><dt>${t('source')}</dt><dd>${t('sourcePending')}</dd></dl><p class="legal">${t('legal',{author:info.author})}</p><p class="quiet">${t('compliance')}</p>`;
}
async function showAboutTab(tab: typeof aboutTab) {
  aboutTab=tab; $('about-summary').hidden=tab!=='overview'; $('license-document').hidden=tab==='overview';
  $('component-picker').hidden=tab!=='thirdParty';
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  if (tab==='thirdParty' && !components.length) {
    components=await invoke<string[]>('third_party_components');
    $('license-component').innerHTML=components.map((name,i)=>`<option value="${i}">${esc(name)}</option>`).join('');
  }
  if (tab!=='overview') await loadLicense();
}
async function loadLicense() {
  const tab=aboutTab; const component=Number($<HTMLSelectElement>('license-component').value || 0);
  $('license-document').textContent='…';
  try { const text=await invoke<string>('license_document',{kind:tab,component});if(aboutTab===tab && component===Number($<HTMLSelectElement>('license-component').value || 0))$('license-document').textContent=text; }
  catch(e){$('license-document').textContent=errorText(e);}
}
async function mayDiscard() {return !dirty || await confirmAction(t('discardTitle'),t('discardText'));}
async function selectGroup(id: string) {
  if (busy || draft?.id===id || !await mayDiscard()) return;
  const g=data.config.groups.find(g=>g.id===id); if (!g) return;
  draft=structuredClone(g); dirty=false; clearNotice(); renderEditor();
}
async function newGroup() {
  if (busy || !data || !await mayDiscard()) return;
  const iface=data.interfaces.find(i=>!i.address.startsWith('127.') && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) || data.interfaces.find(i=>i.address==='127.0.0.1')!;
  let port=15037; while (data.config.groups.some(g=>g.port===port)) port++;
  draft={id:crypto.randomUUID(),name:t('newName'),address:iface.address,port,sources:[iface.cidr],members:[]};dirty=true;clearNotice();renderEditor();$('group-name').focus();
}
async function save() {
  if (!draft) return;
  const config=structuredClone(data.config);const i=config.groups.findIndex(g=>g.id===draft!.id);
  if (i<0) config.groups.push(structuredClone(draft));else config.groups[i]=structuredClone(draft);
  await invoke('save_config',{config});dirty=false;await sync();renderEditor();
}
async function refreshDevices() {
  if (refreshing) return;refreshing=true;
  try {devices=await invoke<Device[]>('discover');connected=true;adbError='';} catch(e){connected=false;adbError=String(e);devices=[];} finally {refreshing=false;}
  renderDevices();renderLocalDevices();
}
function openSettings() {
  if (!data) return;
  dialog('local-devices-dialog').close();
  $<HTMLInputElement>('adb-path').value=data.config.adbPath;$<HTMLInputElement>('upstream-port').value=String(data.config.upstreamPort);dialog('settings-dialog').showModal();
}
$('new-bottom').onclick=()=>void newGroup();$('settings').onclick=openSettings;
$('close-settings').onclick=()=>dialog('settings-dialog').close();
$('device-entry').onclick=()=>{renderLocalDevices();dialog('local-devices-dialog').showModal();};
$('close-devices').onclick=()=>dialog('local-devices-dialog').close();
for (const [modal,button] of [['settings-dialog','settings'],['local-devices-dialog','device-entry'],['about-dialog','about']]) {
  dialog(modal).addEventListener('close',()=>$(button).setAttribute('aria-expanded','false'));
  dialog(modal).addEventListener('toggle',()=>$(button).setAttribute('aria-expanded',String(dialog(modal).open)));
}
$('language-toggle').onclick=()=>{preferences({language:language==='zh'?'en':'zh'});clearNotice();applyLanguage();};
$('theme-toggle').onclick=()=>{preferences({theme:theme==='light'?'dark':'light'});applyLanguage();};
$('about').onclick=()=>void action(async()=>{info=info || await invoke<AppInfo>('app_info');renderAbout();await showAboutTab('overview');dialog('about-dialog').showModal();});
$('close-about').onclick=()=>dialog('about-dialog').close();
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.onclick=()=>void showAboutTab(b.dataset.tab as typeof aboutTab));
$('license-component').onchange=()=>void loadLicense();
for (const id of ['refresh','local-refresh']) $(id).onclick=()=>void action(async()=>{await refreshDevices();await sync();if (!connected) notify(errorText(adbError),true);});
$('group-name').oninput=()=>{if(draft){draft.name=$<HTMLInputElement>('group-name').value;markDirty();}};
$('port').oninput=()=>{if(draft){draft.port=Number($<HTMLInputElement>('port').value);markDirty();}};
$('sources').oninput=()=>{if(draft){draft.sources=$<HTMLTextAreaElement>('sources').value.split(/[,;\s]+/).filter(Boolean);markDirty();}};
$('address').onchange=()=>{if(draft){draft.address=$<HTMLSelectElement>('address').value;draft.sources=[data.interfaces.find(i=>i.address===draft!.address)?.cidr || ''];dirty=true;renderEditor();}};
$('save').onclick=()=>void action(async()=>{await save();notify(t('groupSaved'));});
$('toggle').onclick=()=>void action(async()=>{
  if(!draft)return;
  if(runtime()){await invoke('stop_group',{id:draft.id});notify(t('sharingStopped'));}
  else{if(dirty)await save();await invoke('start_group',{id:draft.id});notify(t('sharingStarted'));}
  await sync();renderEditor();
});
$('delete-group').onclick=async()=>{
  if(!draft || !await confirmAction(t('deleteTitle'),t('deleteText')))return;
  void action(async()=>{clearNotice();try{if(data.config.groups.some(g=>g.id===draft!.id))await invoke('delete_group',{id:draft!.id});}catch(e){await sync();renderEditor();throw e;}
    draft=null;dirty=false;await sync();if(data.config.groups[0])draft=structuredClone(data.config.groups[0]);renderEditor();});
};
for(const remove of [false,true])$(remove?'firewall-remove':'firewall-add').onclick=()=>void action(async()=>{await invoke('firewall',{id:draft!.id,remove});notify(t(remove?'ruleRemoved':'ruleAdded'));});
async function saveSettings() {
  const config=structuredClone(data.config);config.adbPath=$<HTMLInputElement>('adb-path').value.trim();config.upstreamPort=Number($<HTMLInputElement>('upstream-port').value);
  await invoke('save_config',{config});await sync();
}
$('settings-form').onsubmit=e=>{e.preventDefault();void action(async()=>{await saveSettings();dialog('settings-dialog').close();await refreshDevices();notify(t('settingsSaved'));});};
$('start-adb').onclick=()=>void action(async()=>{await saveSettings();await invoke('start_adb');await refreshDevices();dialog('settings-dialog').close();notify(t('adbStarted'));});
dialog('shutdown-dialog').oncancel=e=>e.preventDefault();
$('shutdown-back').onclick=()=>dialog('shutdown-dialog').close();
$('shutdown-retry').onclick=()=>void invoke('request_exit').catch(e=>notify(errorText(e),true));
applyLanguage();
async function boot() {
  try {
    await listen<{error:string|null}>('shutdown-state',async({payload})=>{
      for(const id of ['settings-dialog','confirm-dialog','local-devices-dialog','about-dialog'])dialog(id).close();
      $('shutdown-title').textContent=t(payload.error?'exitFailed':'exiting');
      $('shutdown-text').textContent=payload.error?`${t('exitError')} ${errorText(payload.error)}`:t('exitPending');
      $('shutdown-actions').hidden=!payload.error;if(!dialog('shutdown-dialog').open)dialog('shutdown-dialog').showModal();if(payload.error){await sync();renderEditor();}
    });
    await sync();if(data.configError)notify(`${t('configFailed')}: ${errorText(data.configError)} (${data.configPath})`,true);
    if(data.config.groups[0])draft=structuredClone(data.config.groups[0]);renderEditor();await refreshDevices();
  } catch(e){notify(`${t('initializingFailed')}: ${errorText(e)}`,true);}
  setInterval(()=>{if(!busy)void sync().catch(e=>notify(errorText(e),true));},2000);
  setInterval(()=>{if(!busy)void refreshDevices();},4000);
}
void boot();
