// Small rendering helpers shared by the panels. Panels build HTML strings;
// every interactive element carries data-act / data-id attributes that the
// HUD handles through one delegated click listener.

export const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const coins = (n) => `${n}🪙`;

export function meter(label, value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const cls = v < 25 ? 'low' : v < 50 ? 'mid' : '';
  return `<div class="meter-label"><span>${esc(label)}</span><span>${v}%</span></div><div class="meter"><i class="${cls}" style="width:${v}%"></i></div>`;
}

export function portrait(c, big = false) {
  return `<span class="portrait${big ? ' big' : ''}" style="background:${esc(c.color)}">${esc(c.firstName[0])}</span>`;
}

export const badge = (status, label = null) => `<span class="badge ${esc(status)}">${esc(label ?? status.replace('_', ' '))}</span>`;
export const moodIcon = (m) => (m >= 75 ? '😊' : m >= 55 ? '🙂' : m >= 35 ? '😐' : m >= 20 ? '😟' : '😢');
export const link = (act, id, text) => `<button class="chip" data-act="${act}" data-id="${esc(id)}">${esc(text)}</button>`;
export const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
