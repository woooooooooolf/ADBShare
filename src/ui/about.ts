import { invoke } from '@tauri-apps/api/core';
import { language, t, errorText } from '../i18n';
import { glyph } from '../icons';
import type { AppInfo, ThirdPartyComponent, RunAction } from '../types';
import { $, dialog, esc } from './dom';

export function createAbout(run: RunAction) {
  let info: AppInfo | null = null;
  let aboutTab: 'overview' | 'project' | 'thirdParty' = 'overview';
  let components: ThirdPartyComponent[] = [];
  let aboutRequest = 0;
  function renderAbout() {
    if (!info) return;
    const date = new Date(info.buildTimestamp * 1000);
    $('about-summary').innerHTML =
      `<div class="about-brand">${glyph}<strong>${esc(info.name)}</strong></div><dl><dt>${t('version')}</dt><dd>${esc(info.version)}</dd><dt>${t('buildTime')}</dt><dd><time datetime="${date.toISOString()}">${date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { timeZoneName: 'short' })}</time></dd><dt>${t('author')}</dt><dd>${esc(info.author)}</dd><dt>${t('projectLicense')}</dt><dd>GPLv3 <span class="quiet">(${esc(info.license)})</span></dd><dt>${t('source')}</dt><dd>${t('sourceRepository')}</dd></dl><p class="legal">${t('legal', { author: info.author })}</p><p class="quiet">${t('compliance')}</p>`;
  }
  function renderComponents() {
    $('third-party-components').innerHTML =
      `<table><thead><tr><th scope="col">${t('component')}</th><th scope="col">${t('version')}</th><th scope="col">${t('componentLicense')}</th></tr></thead><tbody>${components.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.version)}</td><td>${esc(c.license)}</td></tr>`).join('')}</tbody></table>`;
  }
  async function showAboutTab(tab: typeof aboutTab) {
    const request = ++aboutRequest;
    aboutTab = tab;
    $('about-summary').hidden = tab !== 'overview';
    $('license-document').hidden = tab !== 'project';
    $('third-party-components').hidden = tab !== 'thirdParty';
    document
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'overview') return;
    const target = $(tab === 'thirdParty' ? 'third-party-components' : 'license-document');
    target.textContent = '…';
    try {
      if (tab === 'thirdParty') {
        const list = components.length
          ? components
          : await invoke<ThirdPartyComponent[]>('third_party_components');
        if (request !== aboutRequest) return;
        components = list;
        renderComponents();
      } else {
        const text = await invoke<string>('license_document');
        if (request === aboutRequest) target.textContent = text;
      }
    } catch (e) {
      if (request === aboutRequest) target.textContent = errorText(e);
    }
  }
  $('about').onclick = () =>
    void run(async () => {
      info = info || (await invoke<AppInfo>('app_info'));
      renderAbout();
      await showAboutTab('overview');
      dialog('about-dialog').showModal();
    });
  $('close-about').onclick = () => dialog('about-dialog').close();
  document
    .querySelectorAll<HTMLButtonElement>('[data-tab]')
    .forEach((b) => (b.onclick = () => void showAboutTab(b.dataset.tab as typeof aboutTab)));

  return {
    render: () => {
      renderAbout();
      if (components.length) renderComponents();
    },
  };
}
