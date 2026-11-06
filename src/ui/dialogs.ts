import { $, dialog } from './dom';

export function confirmAction(title: string, text: string): Promise<boolean> {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  dialog('confirm-dialog').showModal();
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      dialog('confirm-dialog').close();
      resolve(v);
    };
    $('confirm-yes').onclick = () => finish(true);
    $('confirm-no').onclick = () => finish(false);
    dialog('confirm-dialog').oncancel = () => finish(false);
  });
}

export function initializeDialogs() {
  for (const [modal, button] of [
    ['settings-dialog', 'settings'],
    ['local-devices-dialog', 'device-entry'],
    ['about-dialog', 'about'],
    ['help-dialog', 'help'],
    ['history-dialog', 'history-entry'],
  ]) {
    dialog(modal).addEventListener('close', () => $(button).setAttribute('aria-expanded', 'false'));
    dialog(modal).addEventListener('toggle', () =>
      $(button).setAttribute('aria-expanded', String(dialog(modal).open)),
    );
  }
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((modal) => {
    let pressedOutside = false;
    const outside = (e: MouseEvent) => {
      const r = modal.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    modal.addEventListener('pointerdown', (e) => {
      pressedOutside = e.button === 0 && e.target === modal && outside(e);
    });
    modal.addEventListener('pointercancel', () => {
      pressedOutside = false;
    });
    modal.addEventListener('close', () => {
      pressedOutside = false;
    });
    modal.addEventListener('click', (e) => {
      const dismiss = pressedOutside && e.target === modal && outside(e);
      pressedOutside = false;
      if (
        dismiss &&
        modal.open &&
        modal.dispatchEvent(new Event('cancel', { cancelable: true })) &&
        modal.open
      )
        modal.close();
    });
  });
}
