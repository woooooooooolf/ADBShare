import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { language, t, stateLabel, logText, eventText } from '../i18n';
import type { Snapshot, HistoryRecord, HistoryView, RunAction, ConfirmAction } from '../types';
import { $, dialog, esc } from './dom';

type ActivityContext = {
  snapshot: () => Snapshot;
  isBusy: () => boolean;
  run: RunAction;
  confirm: ConfirmAction;
  onDeviceChanged: (id: string) => Promise<void>;
};

export function createActivity(context: ActivityContext) {
  let history: HistoryView | null = null;
  let historyGroup = '';
  let historySerial = '';
  let historyRequest = 0;
  function groupStatus(id: string) {
    const data = context.snapshot();
    const r = data.runtime.find((r) => r.id === id);
    return t(r ? (r.status === 'running' ? 'running' : 'failed') : 'stopped');
  }
  function historyScope() {
    return { groupId: historyGroup || null, serial: historySerial || null };
  }
  async function refreshHistory() {
    const data = context.snapshot();
    if (historyGroup && !data.config.groups.some((g) => g.id === historyGroup)) {
      historyGroup = '';
      historySerial = '';
    }
    if (
      historySerial &&
      !data.config.groups.find((g) => g.id === historyGroup)?.members.includes(historySerial)
    )
      historySerial = '';
    const request = ++historyRequest;
    const view = await invoke<HistoryView>('history_view', historyScope());
    if (request !== historyRequest || !dialog('history-dialog').open) return;
    history = view;
    renderHistory();
  }
  function recordText(r: HistoryRecord) {
    const data = context.snapshot();
    const group =
      data.config.groups.find((g) => g.id === r.groupId)?.name || r.groupId || t('allGroups');
    const prefix = `[${new Date(r.time).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}] ${group}${r.serial ? ` / ${r.serial}` : ''}${r.session !== null ? ` #${r.session}` : ''} · ${eventText(r.kind)}`;
    if (r.bytes)
      return `${prefix} · ${r.bytes} B${r.bytes > (history?.payloadLimit || 512) ? ` · ${t('historyPreview')}` : ''}\nHEX  ${r.hex}\nTEXT ${r.text}`;
    return `${prefix}${r.message ? `: ${r.kind === 'device-state' ? stateLabel(r.message) : logText(r.message)}` : ''}`;
  }
  function historyText() {
    const data = context.snapshot();
    if (!history) return '';
    return [
      `ADBShare · ${data.config.groups.find((g) => g.id === historyGroup)?.name || t('allGroups')}${historySerial ? ` / ${historySerial}` : ''}`,
      t('historyLimits', { n: history.perScopeLimit, bytes: history.payloadLimit }),
      t('historyDropped', { n: history.dropped }),
      '',
      ...history.records.map(recordText),
    ].join('\n');
  }
  function renderHistory() {
    const data = context.snapshot();
    const busy = context.isBusy();
    if (!history || !data) return;
    const group = data.config.groups.find((g) => g.id === historyGroup);
    $('history-group').innerHTML =
      `<option value="">${t('allGroups')}</option>${data.config.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}`;
    $<HTMLSelectElement>('history-group').value = historyGroup;
    $<HTMLSelectElement>('history-group').disabled = busy;
    $('history-device').innerHTML =
      `<option value="">${t('allDevices')}</option>${(group?.members || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
    $<HTMLSelectElement>('history-device').value = historySerial;
    $<HTMLSelectElement>('history-device').disabled = !group || busy;
    const active = data.runtime.filter((r) => r.status === 'running');
    $('history-status').textContent = group
      ? `${group.name} · ${groupStatus(group.id)}`
      : `${t('groupTotal', { n: data.config.groups.length })} · ${t('runningCount', { n: active.length })} · ${t('connectionTotal', { n: active.reduce((n, r) => n + r.sessions.length, 0) })}`;
    const overview = group
      ? group.members
          .filter((s) => !historySerial || s === historySerial)
          .map((serial) => {
            const disabled = group.disabledMembers?.includes(serial);
            const state = history!.states[serial] || 'absent';
            const sharing = data.runtime.some((r) => r.id === group.id && r.status === 'running');
            const count =
              data.runtime
                .find((r) => r.id === group.id)
                ?.sessions.filter((s) => s.serial === serial).length || 0;
            return `<div class="history-row"><button class="history-drill" data-history-serial="${esc(serial)}"><strong>${esc(serial)}</strong><small>${esc(stateLabel(state))} · ${t(disabled ? 'disabled' : 'enabled')}${!sharing ? ` · ${t('historyGroupStopped')}` : ''} · ${t('connectionTotal', { n: count })}</small></button><button class="secondary" data-device-toggle="${esc(serial)}" ${busy ? 'disabled' : ''}>${t(disabled ? 'enableDevice' : 'disableDevice')}</button></div>`;
          })
          .join('') || `<p class="quiet">${t('deviceEmpty')}</p>`
      : data.config.groups
          .map(
            (g) =>
              `<button class="history-row history-drill" data-history-group="${esc(g.id)}"><strong>${esc(g.name)}</strong><small>${groupStatus(g.id)} · ${t('deviceCount', { n: g.members.length })}</small><span>${t('historyDetails')} →</span></button>`,
          )
          .join('') || `<p class="quiet">${t('groupEmpty')}</p>`;
    if ($('history-overview').innerHTML !== overview) $('history-overview').innerHTML = overview;
    $('history-overview')
      .querySelectorAll<HTMLButtonElement>('[data-history-group]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            historyGroup = b.dataset.historyGroup!;
            historySerial = '';
            void context.run(refreshHistory);
          }),
      );
    $('history-overview')
      .querySelectorAll<HTMLButtonElement>('[data-history-serial]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            historySerial = b.dataset.historySerial!;
            void context.run(refreshHistory);
          }),
      );
    $('history-overview')
      .querySelectorAll<HTMLButtonElement>('[data-device-toggle]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            void context.run(async () => {
              const id = historyGroup;
              const serial = b.dataset.deviceToggle!;
              await invoke('set_device_enabled', {
                id,
                serial,
                enabled: !!group?.disabledMembers?.includes(serial),
              });
              await context.onDeviceChanged(id);
            })),
      );
    $('history-overview')
      .querySelectorAll<HTMLButtonElement>('.history-drill')
      .forEach((b) => (b.disabled = busy));
    $('history-count').textContent =
      `${t('historyCount', { n: history.records.length })} · ${t('historyDropped', { n: history.dropped })}`;
    $('history-limits').textContent = t('historyLimits', {
      n: history.perScopeLimit,
      bytes: history.payloadLimit,
    });
    const pre = $('history-records');
    const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 12;
    const scroll = pre.scrollTop;
    pre.textContent =
      (history.records.length > 512 ? `${t('historyRecent')}\n\n` : '') +
      (history.records.slice(-512).map(recordText).join('\n\n') || t('noLogs'));
    pre.scrollTop = atEnd ? pre.scrollHeight : scroll;
    for (const id of ['history-copy', 'history-export', 'history-reset'])
      $<HTMLButtonElement>(id).disabled = busy || (!history.records.length && !history.dropped);
  }
  $('history-entry').onclick = () =>
    void context.run(async () => {
      historyGroup = '';
      historySerial = '';
      dialog('history-dialog').showModal();
      await refreshHistory();
    });
  $('close-history').onclick = () => {
    historyRequest++;
    dialog('history-dialog').close();
  };
  $('history-group').onchange = () => {
    historyGroup = $<HTMLSelectElement>('history-group').value;
    historySerial = '';
    void context.run(refreshHistory);
  };
  $('history-device').onchange = () => {
    historySerial = $<HTMLSelectElement>('history-device').value;
    void context.run(refreshHistory);
  };
  $('history-copy').onclick = () =>
    void context.run(async () => {
      await writeText(historyText());
      $('history-feedback').textContent = t('historyCopied');
    });
  $('history-export').onclick = () =>
    void context.run(async () => {
      if (await invoke<boolean>('export_history', { content: historyText() }))
        $('history-feedback').textContent = t('historyExported');
    });
  $('history-reset').onclick = async () => {
    if (!(await context.confirm(t('resetHistory'), t('resetHistoryText')))) return;
    void context.run(async () => {
      await invoke('reset_history', historyScope());
      await refreshHistory();
      $('history-feedback').textContent = t('historyReset');
    });
  };

  return {
    render: renderHistory,
    refresh: refreshHistory,
    isOpen: () => dialog('history-dialog').open,
    feedback: (text: string) => {
      if (dialog('history-dialog').open) $('history-feedback').textContent = text;
    },
  };
}
