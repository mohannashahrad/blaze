// Me: lifetime stats, records, settings, and backup/restore.

import { $, h, fill, on, emit, toast, settings, imperial, segmented, download, fmtDist, fmtElev, fmtDuration, fmtDate, distValue, stars, theme, setTheme } from './util.js';
import { db } from './db.js';
import { openHikeDetail } from './hikes.js';

const EVEREST_M = 8849;

export async function init() {
  on('hikes-changed', render);
  on('units', render);
  await render();
}

export function onShow() {
  render();
}

async function render() {
  const hikes = await db.all('hikes');
  const year = new Date().getFullYear();
  const thisYear = hikes.filter(x => new Date(x.startedAt).getFullYear() === year);

  fill($('#me-content'),
    h('div', { class: 'card' }, h('h3', {}, `${year} so far`), totals(thisYear)),
    h('div', { class: 'card' }, h('h3', {}, 'All time'), totals(hikes),
      hikes.length ? h('p', { class: 'fun' }, funFact(hikes)) : null),
    h('div', { class: 'card' }, h('h3', {}, `Distance per month (${imperial() ? 'mi' : 'km'})`), monthBars(hikes)),
    records(hikes),
    topTags(hikes),
    settingsCard(),
    await dataCard(),
    h('p', { class: 'muted small' },
      'Trail data © OpenStreetMap contributors. Maps by OpenStreetMap & OpenTopoMap. Weather by Open-Meteo. ',
      'Everything you log stays on this phone.'));
}

function totals(list) {
  const sum = key => list.reduce((s, x) => s + (x[key] || 0), 0);
  const tile = (v, label) => h('div', { class: 'tile' }, h('div', { class: 'v' }, v), h('label', {}, label));
  return h('div', { class: 'tiles' },
    tile(list.length, list.length === 1 ? 'hike' : 'hikes'),
    tile(fmtDist(sum('distanceM')), 'distance'),
    tile(fmtElev(sum('gainM')), 'climbed'),
    tile(fmtDuration(sum('durationS')), 'on the trail'));
}

function funFact(hikes) {
  const gain = hikes.reduce((s, x) => s + (x.gainM || 0), 0);
  const everests = gain / EVEREST_M;
  if (everests >= 0.1) return `🏔️ You've climbed ${everests.toFixed(1)}× the height of Everest.`;
  const days = new Set(hikes.map(x => new Date(x.startedAt).toDateString())).size;
  return `🥾 ${days} day${days === 1 ? '' : 's'} on the trail. Keep it up!`;
}

function monthBars(hikes) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString(undefined, { month: 'narrow' }), dist: 0 });
  }
  for (const hike of hikes) {
    const d = new Date(hike.startedAt);
    const bucket = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
    if (bucket) bucket.dist += hike.distanceM || 0;
  }
  const max = Math.max(...months.map(x => x.dist), 1);
  return h('div', { class: 'bars', role: 'img', 'aria-label': 'Distance hiked per month over the last year' },
    months.map(x => {
      const v = distValue(x.dist);
      return h('div', { class: `bar${x.dist ? '' : ' zero'}`, title: `${x.label}: ${v.toFixed(1)}` },
        h('b', {}, x.dist ? (v >= 10 ? Math.round(v) : v.toFixed(1)) : ''),
        h('i', { style: `height:${Math.max(2, (x.dist / max) * 78)}%` }),
        h('span', {}, x.label));
    }));
}

function records(hikes) {
  if (!hikes.length) return null;
  const best = (key) => hikes.reduce((a, b) => ((b[key] || 0) > (a[key] || 0) ? b : a));
  const rated = hikes.filter(x => x.rating);
  const fav = rated.length ? rated.reduce((a, b) => (b.rating > a.rating || (b.rating === a.rating && b.startedAt > a.startedAt) ? b : a)) : null;
  const row = (label, hike, value) => h('button', { class: 'record', onclick: () => openHikeDetail(hike.id) },
    h('span', {}, h('div', { class: 'muted small' }, label), hike.name),
    h('span', {}, value));
  const longest = best('distanceM');
  const steepest = best('gainM');
  return h('div', { class: 'card' }, h('h3', {}, 'Personal records'),
    row('Longest hike', longest, fmtDist(longest.distanceM)),
    row('Biggest climb', steepest, fmtElev(steepest.gainM)),
    fav ? row('Favorite', fav, stars(fav.rating)) : null,
    row('Most recent', hikes.reduce((a, b) => (b.startedAt > a.startedAt ? b : a)), fmtDate(Math.max(...hikes.map(x => x.startedAt)))));
}

function topTags(hikes) {
  const counts = {};
  for (const x of hikes) for (const t of x.tags || []) counts[t] = (counts[t] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return null;
  return h('div', { class: 'card' }, h('h3', {}, 'What you hike for'),
    h('div', { class: 'chips' }, top.map(([t, n]) => h('span', { class: 'chip' }, `${t} · ${n}`))));
}

function settingsCard() {
  return h('div', { class: 'card' }, h('h3', {}, 'Settings'),
    h('div', { class: 'setting' },
      h('span', {}, 'Units'),
      segmented([['imperial', 'mi / ft'], ['metric', 'km / m']], imperial() ? 'imperial' : 'metric', v => {
        settings.set('units', v);
        emit('units');
      })),
    h('div', { class: 'setting' },
      h('span', {}, 'Display', h('span', { class: 'sub' }, 'Sunlight is easier to read in bright sun')),
      segmented([['dark', '🌲 Trail'], ['light', '☀️ Sunlight']], theme(), setTheme)));
}

async function dataCard() {
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const protectBtn = persisted ? null : h('button', {
    class: 'btn small ghost',
    onclick: async () => {
      const ok = await navigator.storage?.persist?.().catch(() => false);
      toast(ok ? 'Storage protected ✓' : 'Your browser declined. Installing the app to your home screen usually helps.', 5000);
      render();
    },
  }, 'Protect storage');

  const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importBackup });
  return h('div', { class: 'card' }, h('h3', {}, 'Your data'),
    h('p', { class: 'small muted' },
      persisted
        ? '✓ Storage is protected, so Android won\'t clear it to free space.'
        : 'Your hikes live only on this phone. Export a backup now and then (e.g. to Google Drive).'),
    h('div', { class: 'data-actions' },
      h('button', { class: 'btn small primary', onclick: exportBackup }, '⤓ Export backup'),
      h('label', { class: 'btn small' }, '⤒ Restore backup', importInput),
      protectBtn));
}

const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function exportBackup() {
  const [hikes, saved, photos] = await Promise.all([db.all('hikes'), db.all('saved'), db.all('photos')]);
  const photoData = await Promise.all(photos.map(async ({ blob, ...p }) => ({ ...p, dataUrl: await blobToDataURL(blob) })));
  const backup = { app: 'blaze', version: 1, exportedAt: new Date().toISOString(), hikes, saved, photos: photoData };
  download(`blaze-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup), 'application/json');
  toast(`Exported ${hikes.length} hikes and ${saved.length} saved places`);
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Backups from before the rename to Blaze say 'trail-buddy'.
    if (!['blaze', 'trail-buddy'].includes(data.app) || !Array.isArray(data.hikes)) throw new Error('Not a Blaze backup');
    const saved = data.saved || [];
    const photos = data.photos || [];
    if (!confirm(`Restore ${data.hikes.length} hikes, ${saved.length} saved places and ${photos.length} photos? Matching items on this phone will be replaced; everything else is kept.`)) return;
    for (const hike of data.hikes) await db.put('hikes', hike);
    for (const place of saved) await db.put('saved', place);
    for (const { dataUrl, ...p } of photos) {
      const blob = await (await fetch(dataUrl)).blob();
      await db.put('photos', { ...p, blob });
    }
    emit('hikes-changed');
    emit('saved-changed');
    toast('Backup restored ✓');
  } catch (err) {
    toast(`Couldn't restore: ${err.message}`, 5000);
  }
}
