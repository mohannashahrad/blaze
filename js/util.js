// Small DOM, formatting, settings and navigation helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);

// Build DOM without innerHTML so names coming from OpenStreetMap or GPX files can't inject markup.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Like el.replaceChildren(), but skips null/false (the DOM would print them as "null").
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

// App-wide events: 'hikes-changed', 'saved-changed', 'units'.
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));

export const uid = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const settings = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(`tb.${key}`)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(`tb.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

// 'dark' (earthy trail theme, default) or 'light' (high-contrast "Sunlight" theme).
export const theme = () => (settings.get('theme') === 'light' ? 'light' : 'dark');
export function setTheme(value) {
  settings.set('theme', value);
  if (value === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  $('meta[name="theme-color"]').setAttribute('content', value === 'light' ? '#3a6b3f' : '#2d4b31');
}

let toastTimer;
export function toast(message, ms = 3000) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const slug = s => (s || 'hike').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hike';

// ---------- Units & formatting ----------

const MI = 1609.344;
const FT = 0.3048;

export const imperial = () =>
  (settings.get('units') ?? (navigator.language === 'en-US' ? 'imperial' : 'metric')) === 'imperial';
export const distUnit = () => (imperial() ? 'mi' : 'km');
export const elevUnit = () => (imperial() ? 'ft' : 'm');
export const distValue = m => m / (imperial() ? MI : 1000);
export const elevValue = m => m / (imperial() ? FT : 1);
export const distToM = v => v * (imperial() ? MI : 1000);
export const elevToM = v => v * (imperial() ? FT : 1);

export function fmtDist(m, digits = 1) {
  const v = distValue(m || 0);
  return `${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(digits)} ${distUnit()}`;
}
export const fmtElev = m => `${Math.round(elevValue(m || 0)).toLocaleString()} ${elevUnit()}`;

export function fmtDuration(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function fmtClock(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtPace(seconds, meters) {
  if (!meters || meters < 50 || !seconds) return '–';
  const per = Math.round(seconds / distValue(meters));
  if (per > 5999) return '–';
  return `${Math.floor(per / 60)}:${String(per % 60).padStart(2, '0')}`;
}

export const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDay = ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

// <input type="datetime-local"> speaks local wall-clock time without a zone.
export const toLocalInput = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const fromLocalInput = str => (str ? new Date(str).getTime() : null);

// ---------- Overlays (menu, sheets) that close with Android's back button ----------

// Each open overlay owns one history entry; going back closes the topmost one.
const overlays = [];

export function pushOverlay(onClose) {
  history.pushState({ overlay: true }, '');
  overlays.push(onClose);
}

window.addEventListener('popstate', () => overlays.pop()?.());

export function openSheet(title, ...content) {
  const heading = h('h2', {}, title);
  const body = h('div', { class: 'sheet-body' }, content);
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'sheet-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => sheet.close() }, '←'),
      heading),
    body);
  $('#sheets').append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));

  let closing = false;
  const cleanups = [];
  const sheet = {
    el,
    body,
    setTitle: text => { heading.textContent = text; },
    onClose: fn => cleanups.push(fn),
    close: () => { if (!closing) { closing = true; history.back(); } },
  };
  pushOverlay(() => {
    cleanups.forEach(fn => fn());
    el.classList.remove('open');
    setTimeout(() => el.remove(), 300);
  });
  return sheet;
}

export function segmented(options, value, onChange, { allowNone = false } = {}) {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  const draw = () => el.replaceChildren(...options.map(([key, label]) =>
    h('button', {
      type: 'button',
      class: key === value ? 'on' : '',
      role: 'radio',
      'aria-checked': String(key === value),
      onclick: () => { value = allowNone && value === key ? null : key; draw(); onChange(value); },
    }, label)));
  draw();
  return el;
}
