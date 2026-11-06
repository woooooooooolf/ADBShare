import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  language,
  theme,
  preferences,
  t,
  translate,
  errorText,
  stateLabel,
  chineseInterfaceText,
  type Language,
} from './i18n';
import { icons } from './icons';
import { hasNonLocalSources } from './source-warning';
import {
  adapterId,
  commandHost,
  displayAddress,
  endpointAddresses,
  endpointAvailable,
  groupMode,
  isLoopback,
  type NetworkMode,
} from './network';
import type { Group, Device, Snapshot } from './types';
import { $, dialog, esc } from './ui/dom';
import { appMarkup } from './ui/template';
import { confirmAction, initializeDialogs } from './ui/dialogs';
import { createAbout } from './ui/about';
import { createHelp } from './ui/help';
import { createActivity } from './ui/activity';
import './style.css';

let data: Snapshot;
let devices: Device[] = [];
let draft: Group | null = null;
let dirty = false;
let protocolMode: NetworkMode = 'ipv4';
let busy = false;
let adbError = '';
let connected = false;
let adbChecked = false;
let refreshing = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const runtime = () => data?.runtime.find((r) => r.id === draft?.id);
const locked = () => Boolean(runtime());
preferences();

document.querySelector('#app')!.innerHTML = appMarkup;

const activity = createActivity({
  snapshot: () => data,
  isBusy: () => busy,
  run: action,
  confirm: confirmAction,
  onDeviceChanged: async (id) => {
    await sync();
    if (draft?.id === id)
      draft.disabledMembers = [
        ...(data.config.groups.find((g) => g.id === id)?.disabledMembers || []),
      ];
  },
});
const about = createAbout(action);
const help = createHelp(() => !dialog('shutdown-dialog').open);
initializeDialogs();

function clearNotice() {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  $('notice').textContent = '';
}
function notify(text: string, error = false) {
  clearNotice();
  const n = $('notice');
  n.hidden = false;
  n.className = error ? 'error' : 'success';
  n.textContent = text;
  activity.feedback(text);
  if (!error) noticeTimer = setTimeout(clearNotice, 3000);
}
async function action(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  renderState();
  try {
    await fn();
  } catch (e) {
    console.error(e);
    notify(errorText(e), true);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    renderState();
  }
}
async function sync() {
  data = await invoke<Snapshot>('snapshot');
  $('firewall-controls').hidden = !data.automaticFirewall;
  $('external-firewall-hint').hidden = data.automaticFirewall;
  $('linux-adb-hint').hidden = data.automaticFirewall;
  renderAddressOptions();
  renderSide();
  renderState();
  if (activity.isOpen()) await activity.refresh();
}
function markDirty() {
  dirty = true;
  clearNotice();
  renderSide();
  renderState();
}
function renderSide() {
  if (!data) return;
  const groups = data.config.groups.map((g) => (g.id === draft?.id ? draft : g));
  if (draft && !groups.some((g) => g.id === draft!.id)) groups.push(draft);
  $('groups').innerHTML = groups
    .map((g) => {
      const r = data.runtime.find((r) => r.id === g.id);
      const label = g.name;
      return `<button class="group-item ${draft?.id === g.id ? 'selected' : ''}" data-group="${esc(g.id)}" title="${esc(label)}" aria-label="${esc(label)}"><span class="group-icon">▦</span><span><strong>${esc(g.name)}</strong><small>${t('deviceCount', { n: g.members.length })} · ${r ? t(r.status === 'running' ? 'running' : 'failed') : t('stopped')}</small></span><i class="dot ${r?.status === 'running' ? 'online' : ''}"></i></button>`;
    })
    .join('');
  $('groups')
    .querySelectorAll<HTMLButtonElement>('[data-group]')
    .forEach((b) => (b.onclick = () => void selectGroup(b.dataset.group!)));
  $('group-count').textContent = String(groups.length);
  $('group-entry').setAttribute('aria-label', `${t('groups')} ${groups.length}`);
  $('group-entry').classList.toggle('selected', !draft);
  $('config-path').textContent = `${t('configPath')}: ${data.configPath}`;
  $('editor-header').hidden = !draft;
}
function renderAddressOptions() {
  if (!draft || !data) return;
  const id = adapterId(draft, data.interfaces);
  const adapters = new Map(data.interfaces.map((i) => [i.id, i.name]));
  if (!adapters.has(id)) adapters.set(id, t('unavailableAddress'));
  $('adapter').innerHTML = [...adapters]
    .map(
      ([value, name]) =>
        `<option value="${esc(value)}">${esc(value === 'loopback' ? t('localOnly') : name)}</option>`,
    )
    .join('');
  $<HTMLSelectElement>('adapter').value = id;
  $<HTMLSelectElement>('network-mode').value = protocolMode;
  const rows = data.interfaces.filter((i) => i.id === id);
  const options = (family: 'ipv4' | 'ipv6', selected: string) => {
    const candidates = rows.filter((i) => i.family === family);
    const choices = candidates.map(
      (i) =>
        `<option value="${esc(i.address)}" ${i.available ? '' : 'disabled'}>${esc(i.address)}${i.available ? '' : ` · ${t(i.reason as Parameters<typeof t>[0])}`}</option>`,
    );
    if (!candidates.some((i) => i.address === selected))
      choices.unshift(
        `<option value="${esc(selected)}">${esc(selected || t('noUsableAddress'))}${selected ? ` · ${t('unavailableAddress')}` : ''}</option>`,
      );
    return choices.join('');
  };
  $('address-label').textContent = protocolMode === 'ipv6' ? 'IPv6' : 'IPv4';
  $('address').innerHTML = options(protocolMode === 'ipv6' ? 'ipv6' : 'ipv4', draft.address);
  $<HTMLSelectElement>('address').value = draft.address;
  $('ipv6-address-field').hidden = protocolMode !== 'dual';
  $('ipv6-address').innerHTML = options('ipv6', draft.ipv6Address || '');
  $<HTMLSelectElement>('ipv6-address').value = draft.ipv6Address || '';
  const status = ['ipv4', 'ipv6']
    .map(
      (family) =>
        `${family === 'ipv4' ? 'IPv4' : 'IPv6'}: ${t(rows.some((i) => i.family === family && i.available) ? 'networkReady' : 'noUsableAddress')}`,
    )
    .join(' · ');
  $('network-status').textContent = data.networkError ? errorText(data.networkError) : status;
  $('network-status').classList.toggle(
    'source-warning',
    !endpointAvailable(draft, data.interfaces, protocolMode),
  );
  $('link-local-hint').hidden = !endpointAddresses(draft).some((a) => /^fe[89ab]/i.test(a));
}
function selectNetwork(id: string, mode: NetworkMode) {
  if (!draft) return;
  const rows = data.interfaces.filter((i) => i.id === id && i.available);
  const choose = (family: 'ipv4' | 'ipv6') =>
    rows.find((i) => i.family === family && endpointAddresses(draft!).includes(i.address)) ??
    rows.find((i) => i.family === family && !/^fe[89ab]/i.test(i.address)) ??
    rows.find((i) => i.family === family);
  protocolMode = mode;
  draft.interfaceName = id;
  const primary = choose(mode === 'ipv6' ? 'ipv6' : 'ipv4');
  const secondary = mode === 'dual' ? choose('ipv6') : undefined;
  draft.address = primary?.address || '';
  draft.ipv6Address = secondary?.address;
  draft.sources = [primary?.cidr, secondary?.cidr].filter((s): s is string => !!s);
  dirty = true;
  clearNotice();
  renderEditor();
}
function renderEditor() {
  $('welcome').hidden = !!draft;
  $('workspace').hidden = !draft;
  if (draft) {
    $<HTMLInputElement>('group-name').value = draft.name;
    $<HTMLInputElement>('port').value = String(draft.port);
    $<HTMLTextAreaElement>('sources').value = draft.sources.join('\n');
    renderAddressOptions();
    renderDevices();
  }
  renderSide();
  renderState();
}
function renderDevices() {
  if (!draft) return;
  const list = [...devices];
  draft.members
    .filter((s) => !list.some((d) => d.serial === s))
    .forEach((serial) =>
      list.push({ serial, state: 'absent', model: '', transportId: '', kind: '' }),
    );
  $('devices').innerHTML = list.length
    ? list
        .map(
          (d) =>
            `<label class="device-row"><input type="checkbox" data-serial="${esc(d.serial)}" ${draft!.members.includes(d.serial) ? 'checked' : ''} ${locked() ? 'disabled' : ''}><span class="device-icon">${icons.devices}</span><span class="device-name"><strong>${esc(d.model || (d.state === 'absent' ? t('assigned') : d.serial))}</strong><code>${esc(d.serial)}</code></span><span class="device-state ${d.state === 'device' ? 'ready' : ''}">${esc(stateLabel(d.state))}</span></label>`,
        )
        .join('')
    : `<div class="empty"><strong>${t(connected ? 'noDevices' : 'adbOffline')}</strong><p>${connected ? t('connectDevice') : esc(errorText(adbError || t('noUpstream')))}</p><button id="empty-settings" class="text-btn">${t('openSettings')}</button></div>`;
  $('devices')
    .querySelectorAll<HTMLInputElement>('[data-serial]')
    .forEach(
      (input) =>
        (input.onchange = () => {
          if (!draft) return;
          const s = input.dataset.serial!;
          draft.members = input.checked
            ? [...new Set([...draft.members, s])]
            : draft.members.filter((m) => m !== s);
          draft.disabledMembers = (draft.disabledMembers || []).filter((m) =>
            draft!.members.includes(m),
          );
          markDirty();
        }),
    );
  if ($('empty-settings')) $('empty-settings').onclick = openSettings;
}
function renderLocalDevices() {
  $('adb-status').textContent = t('localDevices');
  $('device-count').textContent = String(devices.length);
  $('device-entry').setAttribute('aria-label', `${t('localDevices')} ${devices.length}`);
  $('device-entry').title = connected ? t('localDevices') : t('adbOffline');
  $('device-entry').classList.toggle('adb-offline', !connected);
  $('local-count').textContent = String(devices.length);
  $('local-device-list').innerHTML = devices.length
    ? `<table><thead><tr><th>${t('model')}</th><th>${t('serial')}</th><th>${t('state')}</th><th>${t('transport')}</th></tr></thead><tbody>${devices.map((d) => `<tr><td>${esc(d.model || '—')}</td><td><code>${esc(d.serial)}</code></td><td><span class="device-state ${d.state === 'device' ? 'ready' : ''}">${esc(stateLabel(d.state))}</span></td><td>${t(d.kind === 'usb' ? 'usb' : 'localTransport')}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty"><strong>${t(connected ? 'noDevices' : 'adbOffline')}</strong><p>${connected ? t('connectDevice') : esc(errorText(adbError || t('noUpstream')))}</p></div>`;
}
function commands() {
  if (!draft) return [];
  const serial = draft.members[0];
  const arg = serial ? `"${serial.replace(/["`$\\]/g, '')}"` : 'SERIAL';
  return endpointAddresses(draft)
    .filter(Boolean)
    .flatMap((address) => {
      const base = `adb -H ${commandHost(address)} -P ${draft!.port}`;
      return [`${base} devices -l`, `${base} -s ${arg} shell`];
    });
}
function renderState() {
  if (activity.isOpen()) activity.render();
  $('source-warning').hidden = !draft || !hasNonLocalSources(draft.sources);
  if (!data || !draft) return;
  const r = runtime();
  const running = r?.status === 'running';
  const disabled = locked();
  $('group-state').hidden = !r;
  $('group-state').textContent = r ? t(running ? 'running' : 'failed') : '';
  $('group-state').className = `badge ${running ? 'active' : ''}`;
  $('member-count').textContent = t('selectedCount', { n: draft.members.length });
  for (const id of [
    'group-name',
    'port',
    'adapter',
    'network-mode',
    'address',
    'ipv6-address',
    'sources',
  ])
    $<HTMLInputElement>(id).disabled = disabled || busy;
  $('devices')
    .querySelectorAll<HTMLInputElement>('input')
    .forEach((e) => (e.disabled = disabled || busy));
  const networkAvailable =
    !data.networkError && endpointAvailable(draft, data.interfaces, protocolMode);
  $<HTMLButtonElement>('save').disabled = disabled || busy || !dirty || !networkAvailable;
  $<HTMLButtonElement>('toggle').disabled = busy || (!r && !networkAvailable);
  $('toggle').textContent = t(r ? 'stop' : dirty ? 'saveStart' : 'start');
  $('toggle').className = r ? 'stop-button' : 'primary';
  $<HTMLButtonElement>('delete-group').disabled = busy;
  $<HTMLButtonElement>('firewall-add').disabled =
    busy || (locked() && dirty) || !networkAvailable || isLoopback(draft.address);
  $<HTMLButtonElement>('firewall-remove').disabled =
    busy || !data.config.groups.some((g) => g.id === draft!.id);
  $('group-state').title = disabled ? t('editStopped') : '';
  const cmd = commands();
  $('connection').innerHTML = `${endpointAddresses(draft)
    .filter(Boolean)
    .map(
      (address) =>
        `<div class="endpoint"><span>${t(isLoopback(address) ? 'localOnly' : 'endpoint')}</span><strong>${esc(displayAddress(address))}<em>:${draft!.port}</em></strong><small>${t(running ? 'listening' : 'notListening')}</small></div>`,
    )
    .join(
      '',
    )}${dirty ? `<p class="draft-warning">${t('commandPreview')}</p>` : ''}${cmd.map((c, i) => `<div class="command"><span>${t(i % 2 === 0 ? 'listCommand' : 'shellCommand')}</span><code>${esc(c)}</code><button class="text-btn copy" data-command="${i}">${t('copy')}</button></div>`).join('')}`;
  $('connection')
    .querySelectorAll<HTMLButtonElement>('.copy')
    .forEach(
      (b) =>
        (b.onclick = () =>
          void action(async () => {
            await writeText(cmd[Number(b.dataset.command)]);
            notify(t('copied'));
          })),
    );
  const sessions = r?.sessions || [];
  $('session-count').textContent = String(sessions.length);
  $('sessions').innerHTML = sessions.length
    ? sessions
        .map(
          (s) =>
            `<div class="session"><i class="dot online"></i><div><code>${esc(s.peer)}</code><small>${esc(s.serial === '协商中' ? (language === 'zh' ? '协商中' : 'Negotiating') : s.serial)} · ${new Date(s.since * 1000).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US')}</small></div></div>`,
        )
        .join('')
    : `<div class="small-empty">${t(running ? 'noConnections' : 'startForConnections')}</div>`;
}
function applyLanguage() {
  translate();
  renderSide();
  renderState();
  renderDevices();
  renderAddressOptions();
  renderLocalDevices();
  about.render();
  help.render();
  activity.render();
  $('language-toggle').title = t('switchLanguage');
  $('language-toggle').setAttribute('aria-label', t('switchLanguage'));
  $('language-toggle').setAttribute('aria-pressed', String(language === 'en'));
  $('theme-toggle').innerHTML = theme === 'dark' ? icons.sun : icons.moon;
  $('theme-toggle').title = t(theme === 'dark' ? 'lightMode' : 'darkMode');
  $('theme-toggle').setAttribute('aria-label', t(theme === 'dark' ? 'lightMode' : 'darkMode'));
  $('theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  for (const [id, key] of [
    ['group-entry', 'groups'],
    ['new-bottom', 'newGroup'],
    ['settings', 'settings'],
    ['history-entry', 'logs'],
  ] as const) {
    $(id).title = t(key);
    if (id !== 'group-entry') $(id).setAttribute('aria-label', t(key));
  }
  $('groups').setAttribute('aria-label', t('groups'));
  $('about').title = t('about');
  $('about').setAttribute('aria-label', t('about'));
  $('help').title = `${t('help')} (F1)`;
  $('help').setAttribute('aria-label', `${t('help')} (F1)`);
  $('help-tabs').setAttribute('aria-label', t('help'));
  document.querySelectorAll<HTMLElement>('.close-button').forEach((b) => {
    b.title = t('close');
    b.setAttribute('aria-label', t('close'));
  });
}
async function mayDiscard() {
  return !dirty || (await confirmAction(t('discardTitle'), t('discardText')));
}
async function selectGroup(id: string) {
  if (busy || draft?.id === id || !(await mayDiscard())) return;
  const g = data.config.groups.find((g) => g.id === id);
  if (!g) return;
  draft = structuredClone(g);
  protocolMode = groupMode(draft);
  dirty = false;
  clearNotice();
  renderEditor();
}
async function newGroup() {
  if (busy || !data || !(await mayDiscard())) return;
  const usable = data.interfaces.filter((i) => i.available);
  const iface =
    usable.find(
      (i) => i.family === 'ipv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address),
    ) ??
    usable.find((i) => i.id !== 'loopback') ??
    usable[0];
  if (!iface) {
    notify(t('noUsableAddress'), true);
    return;
  }
  protocolMode = iface.family;
  let port = 15037;
  while (data.config.groups.some((g) => g.port === port)) port++;
  draft = {
    id: crypto.randomUUID(),
    name: t('newName'),
    address: iface.address,
    interfaceName: iface.id,
    port,
    sources: [iface.cidr],
    members: [],
  };
  dirty = true;
  clearNotice();
  renderEditor();
  $('group-name').focus();
}
async function save() {
  if (!draft) return;
  const config = structuredClone(data.config);
  const i = config.groups.findIndex((g) => g.id === draft!.id);
  if (i < 0) config.groups.push(structuredClone(draft));
  else config.groups[i] = structuredClone(draft);
  await invoke('save_config', { config });
  dirty = false;
  await sync();
  renderEditor();
}
function renderAdbWarning() {
  const visible = adbChecked && !connected;
  $('adb-warning').hidden = !visible;
  document.body.classList.toggle('has-adb-warning', visible);
}
async function refreshDevices() {
  if (refreshing || !data) return;
  refreshing = true;
  const port = data.config.upstreamPort;
  try {
    const list = await invoke<Device[]>('discover');
    if (data.config.upstreamPort === port) {
      devices = list;
      connected = true;
      adbError = '';
    }
  } catch (e) {
    if (data.config.upstreamPort === port) {
      connected = false;
      adbError = String(e);
      devices = [];
    }
  } finally {
    refreshing = false;
  }
  if (data.config.upstreamPort !== port) {
    await refreshDevices();
    return;
  }
  adbChecked = true;
  renderDevices();
  renderLocalDevices();
  renderAdbWarning();
}
function openSettings() {
  if (!data) return;
  dialog('local-devices-dialog').close();
  $<HTMLInputElement>('adb-path').value = data.config.adbPath;
  $<HTMLInputElement>('upstream-port').value = String(data.config.upstreamPort);
  dialog('settings-dialog').showModal();
}
$('new-bottom').onclick = () => void newGroup();
$('settings').onclick = openSettings;
$('adb-warning-settings').onclick = openSettings;
$('group-entry').onclick = () =>
  void action(async () => {
    if (!(await mayDiscard())) return;
    draft = null;
    dirty = false;
    renderEditor();
  });
$('close-settings').onclick = () => dialog('settings-dialog').close();
$('device-entry').onclick = () => {
  renderLocalDevices();
  dialog('local-devices-dialog').showModal();
};
$('close-devices').onclick = () => dialog('local-devices-dialog').close();
async function selectLanguage(next: Language) {
  const button = $<HTMLButtonElement>('language-toggle');
  button.disabled = true;
  let warning: 'chineseFontMissing' | 'chineseFontCheckFailed' | undefined;
  try {
    if (next === 'zh') {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const supported = await Promise.race([
          invoke<boolean>('chinese_font_support', { text: chineseInterfaceText() }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(Error('Font check timed out')), 5000);
          }),
        ]);
        if (!supported) warning = 'chineseFontMissing';
      } catch (error) {
        console.warn('Chinese font check failed', error);
        warning = 'chineseFontCheckFailed';
      } finally {
        clearTimeout(timeout);
      }
    }
    preferences({ language: warning ? 'en' : next });
    clearNotice();
    applyLanguage();
    if (warning) notify(t(warning), true);
  } finally {
    button.disabled = false;
  }
}
$('language-toggle').onclick = () =>
  void action(() => selectLanguage(language === 'zh' ? 'en' : 'zh'));
$('theme-toggle').onclick = () => {
  preferences({ theme: theme === 'light' ? 'dark' : 'light' });
  applyLanguage();
};
for (const id of ['local-refresh'])
  $(id).onclick = () =>
    void action(async () => {
      await refreshDevices();
      await sync();
      if (!connected) notify(errorText(adbError), true);
    });
$('group-name').oninput = () => {
  if (draft) {
    draft.name = $<HTMLInputElement>('group-name').value;
    markDirty();
  }
};
$('port').oninput = () => {
  if (draft) {
    draft.port = Number($<HTMLInputElement>('port').value);
    markDirty();
  }
};
$('sources').oninput = () => {
  if (draft) {
    draft.sources = $<HTMLTextAreaElement>('sources')
      .value.split(/[,;\s]+/)
      .filter(Boolean);
    markDirty();
  }
};
$('adapter').onchange = () => selectNetwork($<HTMLSelectElement>('adapter').value, protocolMode);
$('network-mode').onchange = () => {
  if (draft)
    selectNetwork(
      adapterId(draft, data.interfaces),
      $<HTMLSelectElement>('network-mode').value as NetworkMode,
    );
};
for (const field of ['address', 'ipv6-address'])
  $(field).onchange = () => {
    if (!draft) return;
    const address = $<HTMLSelectElement>(field).value;
    // Keep legacy callers selecting an address able to identify its adapter.
    const row = data.interfaces.find(
      (i) =>
        i.address === address &&
        (i.id === adapterId(draft!, data.interfaces) || !draft!.interfaceName),
    );
    if (field === 'address') draft.address = address;
    else draft.ipv6Address = address || undefined;
    if (row) draft.interfaceName = row.id;
    draft.sources = endpointAddresses(draft)
      .map(
        (a) =>
          data.interfaces.find(
            (i) => i.address === a && i.id === adapterId(draft!, data.interfaces),
          )?.cidr,
      )
      .filter((s): s is string => !!s);
    markDirty();
    renderEditor();
  };
$('save').onclick = () =>
  void action(async () => {
    await save();
    notify(t('groupSaved'));
  });
$('toggle').onclick = () =>
  void action(async () => {
    if (!draft) return;
    if (runtime()) {
      await invoke('stop_group', { id: draft.id });
      notify(t('sharingStopped'));
    } else {
      if (dirty) await save();
      await invoke('start_group', { id: draft.id });
      notify(t('sharingStarted'));
    }
    await sync();
    renderEditor();
  });
$('delete-group').onclick = async () => {
  if (
    !draft ||
    !(await confirmAction(
      t('deleteTitle'),
      t(data.automaticFirewall ? 'deleteText' : 'deleteTextManual'),
    ))
  )
    return;
  void action(async () => {
    clearNotice();
    try {
      if (data.config.groups.some((g) => g.id === draft!.id))
        await invoke('delete_group', { id: draft!.id });
    } catch (e) {
      await sync();
      renderEditor();
      throw e;
    }
    draft = null;
    dirty = false;
    await sync();
    if (data.config.groups[0]) {
      draft = structuredClone(data.config.groups[0]);
      protocolMode = groupMode(draft);
    }
    renderEditor();
  });
};
for (const remove of [false, true])
  $(remove ? 'firewall-remove' : 'firewall-add').onclick = () =>
    void action(async () => {
      if (!draft) return;
      if (!remove && dirty) await save();
      try {
        await invoke('firewall', { id: draft.id, remove });
        notify(t(remove ? 'ruleRemoved' : 'ruleAdded'));
      } finally {
        await sync();
        renderEditor();
      }
    });
async function saveSettings() {
  const config = structuredClone(data.config);
  config.adbPath = $<HTMLInputElement>('adb-path').value.trim();
  config.upstreamPort = Number($<HTMLInputElement>('upstream-port').value);
  await invoke('save_config', { config });
  await sync();
}
$('settings-form').onsubmit = (e) => {
  e.preventDefault();
  void action(async () => {
    await saveSettings();
    dialog('settings-dialog').close();
    await refreshDevices();
    notify(t('settingsSaved'));
  });
};
$('start-adb').onclick = () =>
  void action(async () => {
    await saveSettings();
    await invoke('start_adb');
    await refreshDevices();
    dialog('settings-dialog').close();
    notify(t('adbStarted'));
  });
new ResizeObserver(() =>
  document.documentElement.style.setProperty(
    '--adb-warning-height',
    `${$('adb-warning').getBoundingClientRect().height}px`,
  ),
).observe($('adb-warning'));
dialog('shutdown-dialog').oncancel = (e) => e.preventDefault();
$('shutdown-back').onclick = () => dialog('shutdown-dialog').close();
$('shutdown-retry').onclick = () =>
  void invoke('request_exit').catch((e) => notify(errorText(e), true));
async function boot() {
  try {
    await selectLanguage(language);
  } catch (error) {
    applyLanguage();
    notify(errorText(error), true);
  } finally {
    $('app').hidden = false;
  }
  try {
    await listen<{ error: string | null }>('shutdown-state', async ({ payload }) => {
      for (const id of [
        'settings-dialog',
        'confirm-dialog',
        'local-devices-dialog',
        'about-dialog',
        'help-dialog',
        'history-dialog',
      ])
        dialog(id).close();
      $('shutdown-title').textContent = t(payload.error ? 'exitFailed' : 'exiting');
      $('shutdown-text').textContent = payload.error
        ? `${t('exitError')} ${errorText(payload.error)}`
        : t(data?.automaticFirewall ? 'exitPending' : 'exitPendingManual');
      $('shutdown-actions').hidden = !payload.error;
      if (!dialog('shutdown-dialog').open) dialog('shutdown-dialog').showModal();
      if (payload.error) {
        await sync();
        renderEditor();
      }
    });
    await sync();
    if (data.configError)
      notify(`${t('configFailed')}: ${errorText(data.configError)} (${data.configPath})`, true);
    if (data.config.groups[0]) {
      draft = structuredClone(data.config.groups[0]);
      protocolMode = groupMode(draft);
    }
    renderEditor();
    await refreshDevices();
  } catch (e) {
    notify(`${t('initializingFailed')}: ${errorText(e)}`, true);
  }
  setInterval(() => {
    if (!busy) void sync().catch((e) => notify(errorText(e), true));
  }, 2000);
  setInterval(() => {
    if (!busy) void refreshDevices();
  }, 4000);
}
void boot();
