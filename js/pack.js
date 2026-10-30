// Pack: a checklist of hiking and camping essentials, with tips from the local forecast.

import { $, h, fill, toast, uid, segmented, imperial, fmtTime } from './util.js';
import { db } from './db.js';
import { getForecast } from './weather.js';
import { CATEGORIES, ITEMS } from './pack-data.js';

// Kept in IndexedDB so custom items survive like the rest of your data.
let state = { list: 'day', checked: { day: [], camp: [] }, custom: [] };
const tipsEl = h('div');
let tipsFor = null;

export async function init() {
  const saved = await db.get('kv', 'pack');
  if (saved) state = { ...state, ...saved, checked: { ...state.checked, ...saved.checked } };
  render();
}

export function onShow() {
  if (tipsFor !== state.list) loadTips();
}

const save = () => db.put('kv', state, 'pack').catch(err => console.error('Could not save packing list', err));
const itemsFor = list => [...ITEMS, ...state.custom].filter(i => i.lists.includes(list));

function render() {
  const items = itemsFor(state.list);
  const checked = new Set(state.checked[state.list]);
  const done = items.filter(i => checked.has(i.id)).length;
  const allDone = items.length > 0 && done === items.length;

  fill($('#pack-content'),
    h('div', { class: 'pack-switch' },
      segmented([['day', '🥾 Day hike'], ['camp', '⛺ Camping']], state.list, value => {
        state.list = value;
        save();
        render();
        loadTips();
      })),
    h('div', { class: 'card pack-progress' },
      h('div', { class: 'progress-top' },
        h('strong', {}, allDone ? 'All packed. Have a great trip! 🎉' : `${done} of ${items.length} packed`),
        h('button', { class: 'btn small ghost', disabled: !done, onclick: reset }, '↺ Reset')),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': items.length, 'aria-valuenow': done },
        h('i', { style: `width:${items.length ? (done / items.length) * 100 : 0}%` }))),
    tipsEl,
    CATEGORIES.map(cat => {
      const inCat = items.filter(i => i.cat === cat.id);
      if (!inCat.length) return null;
      const packed = inCat.filter(i => checked.has(i.id)).length;
      return h('section', { class: 'pack-cat' },
        h('div', { class: 'pack-cat-head' },
          h('h3', {}, cat.title),
          h('span', { class: 'muted small' }, `${packed}/${inCat.length}`)),
        cat.note ? h('p', { class: 'muted small cat-note' }, cat.note) : null,
        h('div', { class: 'pack-list' }, inCat.map(item => itemRow(item, cat.tone, checked.has(item.id)))));
    }),
    addForm());
}

function itemRow(item, tone, on) {
  return h('div', { class: `pack-row${on ? ' on' : ''}` },
    h('button', {
      class: 'pack-item',
      role: 'checkbox',
      'aria-checked': String(on),
      onclick: () => toggle(item.id),
    },
      h('span', { class: `pack-icon tone-${tone}`, 'aria-hidden': 'true' }, item.emoji),
      h('span', { class: 'pack-text' },
        h('strong', {}, item.name),
        item.note ? h('span', { class: 'pack-note' }, item.note) : null),
      h('span', { class: 'pack-check', 'aria-hidden': 'true' }, on ? '✓' : '')),
    item.custom
      ? h('button', { class: 'pack-del', 'aria-label': `Remove ${item.name}`, onclick: () => removeCustom(item) }, '×')
      : null);
}

function toggle(id) {
  const list = state.checked[state.list];
  state.checked[state.list] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  save();
  render();
}

function reset() {
  if (!confirm('Uncheck everything on this list?')) return;
  state.checked[state.list] = [];
  save();
  render();
}

function addForm() {
  const emoji = h('input', { type: 'text', class: 'emoji-input', placeholder: '📦', maxlength: 8, 'aria-label': 'Icon (emoji)' });
  const name = h('input', { type: 'text', placeholder: 'Add your own item…', maxlength: 60, enterkeyhint: 'done', 'aria-label': 'Item name' });
  return h('form', {
    class: 'pack-add',
    onsubmit: e => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) return name.focus();
      state.custom.push({
        id: `custom-${uid()}`,
        cat: 'custom',
        emoji: emoji.value.trim() || '📦',
        name: text,
        lists: [state.list],
        custom: true,
      });
      save();
      render();
      toast(`Added "${text}" to your ${state.list === 'day' ? 'day hike' : 'camping'} list`);
    },
  }, emoji, name, h('button', { type: 'submit', class: 'btn primary' }, 'Add'));
}

function removeCustom(item) {
  state.custom = state.custom.filter(i => i.id !== item.id);
  for (const key of Object.keys(state.checked)) state.checked[key] = state.checked[key].filter(id => id !== item.id);
  save();
  render();
}

// ---------- Forecast-based reminders ----------

function loadTips() {
  tipsFor = state.list;
  navigator.geolocation?.getCurrentPosition(async pos => {
    try {
      const days = await getForecast(pos.coords.latitude, pos.coords.longitude);
      fill(tipsEl, tipsCard(state.list === 'day' ? days.slice(0, 1) : days));
    } catch {
      fill(tipsEl); // offline: just skip the tips
    }
  }, () => fill(tipsEl), { enableHighAccuracy: false, timeout: 15_000, maximumAge: 30 * 60_000 });
}

function tipsCard(days) {
  const toC = t => (imperial() ? ((t - 32) * 5) / 9 : t);
  const deg = imperial() ? '°F' : '°C';
  const rain = Math.max(...days.map(d => d.rain ?? 0));
  const lo = Math.min(...days.map(d => d.lo));
  const hi = Math.max(...days.map(d => d.hi));
  const wind = Math.max(...days.map(d => d.wind));
  const windKmh = imperial() ? wind * 1.609 : wind;
  const codes = days.map(d => d.code);

  const tips = [];
  if (codes.some(c => c >= 95)) tips.push(['⛈️', 'Thunderstorms forecast. Plan to be off exposed ridges and summits by early afternoon.']);
  if (rain >= 40) tips.push(['🌧️', `${rain}% chance of rain. Pack your rain jacket and a pack cover or liner.`]);
  if (codes.some(c => c >= 71 && c <= 86)) tips.push(['❄️', 'Snow possible. Consider microspikes and waterproof boots.']);
  if (toC(lo) <= 5) tips.push(['🥶', `Low of ${lo}${deg}. Bring warm layers, a hat and gloves${state.list === 'camp' ? ', and check your sleeping bag rating' : ''}.`]);
  if (toC(hi) >= 27) tips.push(['🥵', `High of ${hi}${deg}. Carry extra water and electrolytes, and start early.`]);
  if (windKmh >= 40) tips.push(['💨', `Gusty winds (${wind} ${imperial() ? 'mph' : 'km/h'}). A windproof layer will help on exposed sections.`]);
  tips.push(['🌅', `Sunset at ${fmtTime(days[0].sunset)}. Pack a headlamp in case you're out later than planned.`]);

  return h('div', { class: 'card pack-tips' },
    h('h3', {}, state.list === 'day' ? 'Today\'s forecast near you' : 'Next 3 days near you'),
    h('ul', {}, tips.map(([icon, text]) => h('li', {}, h('span', { 'aria-hidden': 'true' }, icon), h('span', {}, text)))));
}
