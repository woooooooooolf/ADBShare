const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons = {
  groups: svg(
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  ),
  logs: svg('<path d="M5 3h14v18H5Z M8 7h8 M8 11h8 M8 15h5"/>'),
  language: svg(
    '<path d="M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-10 11M14 21l4-10 4 10M16 17h4"/>',
  ),
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  ),
  moon: svg('<path d="M20.5 14A8.8 8.8 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  devices: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  settings: svg(
    '<path d="m10 3-.5 2-2 1L5 5 3 8l1.5 1.5v3L3 14l2 3 2.5-1 2 1 .5 2h4l.5-2 2-1 2.5 1 2-3-1.5-1.5v-3L21 8l-2-3-2.5 1-2-1L14 3Z"/><circle cx="12" cy="11" r="3"/>',
  ),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
};

export const glyph = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="2" width="10" height="17" rx="3" stroke="currentColor" stroke-width="2"/><path d="M16 19v5m0 0H5v5m11-5h11v5" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>`;
