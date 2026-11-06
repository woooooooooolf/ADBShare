import { language, t } from '../i18n';
import { helpContent } from '../help-content';
import { $, dialog, esc } from './dom';

export function createHelp(canOpen: () => boolean) {
  type Tab = 'guide' | 'commands' | 'differences';
  let activeTab: Tab = 'guide';
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-help-tab]'));
  function select(tab: Tab) {
    activeTab = tab;
    for (const button of tabs) {
      const selected = button.dataset.helpTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      $(`help-${button.dataset.helpTab}`).hidden = !selected;
    }
    $('help-content').scrollTop = 0;
  }
  function render() {
    const c = helpContent[language];
    const list = (items: readonly string[], ordered = false) => {
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag}>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</${tag}>`;
    };
    $('help-guide').innerHTML =
      `<h3>${esc(c.startTitle)}</h3>${list(c.steps, true)}<h3>${esc(c.examplesTitle)}</h3><pre>adb -H 192.168.1.10 -P 15037 devices -l\nadb -H 192.168.1.10 -P 15037 -s SERIAL shell\nadb -H 192.168.1.10 -P 15037 -s SERIAL push example.txt /data/local/tmp/\nadb -H 192.168.1.10 -P 15037 -s SERIAL wait-for-device</pre><p>${esc(c.exampleHint)}</p><h3>${esc(c.dailyTitle)}</h3>${list(c.daily)}`;
    $('help-commands').innerHTML =
      `<p>${esc(c.supportHint)}</p><table><thead><tr><th scope="col">${esc(c.commandTitle)}</th><th scope="col">${esc(c.behaviorTitle)}</th></tr></thead><tbody>${c.commands.map(([commands, behavior]) => `<tr><td><code>${esc(commands)}</code></td><td>${esc(behavior)}</td></tr>`).join('')}</tbody></table><p>${esc(c.validationHint)}</p>`;
    $('help-differences').innerHTML =
      `<h3>${esc(c.selectionTitle)}</h3>${list(c.selection)}<h3>${esc(c.boundaryTitle)}</h3>${list(c.boundaries)}<h3>${esc(c.troubleTitle)}</h3>${list(c.troubleshooting)}`;
    $('help-tabs').setAttribute('aria-label', t('help'));
    select(activeTab);
  }
  function open() {
    if (!canOpen()) return;
    if (!dialog('help-dialog').open) {
      render();
      dialog('help-dialog').showModal();
    }
    $('close-help').focus();
  }
  $('help').onclick = open;
  $('close-help').onclick = () => dialog('help-dialog').close();
  for (const button of tabs) {
    button.onclick = () => select(button.dataset.helpTab as Tab);
    button.onkeydown = (event) => {
      let index = tabs.indexOf(button);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      select(tabs[index].dataset.helpTab as Tab);
      tabs[index].focus();
    };
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F1') return;
    event.preventDefault();
    if (!event.repeat) open();
  });
  render();
  return { render };
}
