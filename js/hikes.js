// The hike log: list, detail view, and the add/edit form.

import {
  $, h, fill, on, emit, toast, uid, openSheet, segmented, download, slug, stars,
  fmtDist, fmtElev, fmtDuration, fmtPace, fmtDate, fmtDay, fmtTime,
  distValue, distUnit, elevValue, elevUnit, distToM, elevToM, toLocalInput, fromLocalInput,
} from './util.js';
import { db } from './db.js';
import { trackStats, firstPoint, elevationProfile } from './geo.js';
import { hikeToGPX, parseGPX } from './gpx.js';
import { makeMap, trackLayer, pinIcon, US_CENTER } from './map.js';
import { placeName } from './osm.js';

const PRESET_TAGS = ['summit', 'waterfall', 'lake', 'views', 'forest', 'river', 'loop', 'out-and-back', 'camping', 'dog-friendly', 'wildflowers', 'scramble', 'quiet'];
const DIFFICULTY = [['easy', 'Easy'], ['moderate', 'Moderate'], ['hard', 'Hard']];

export async function init() {
  $('#btn-add-hike').onclick = () => newManualHike();
  $('#gpx-input').onchange = importGPX;
  on('hikes-changed', render);
  on('units', render);
  await render();
}

async function render() {
  const hikes = (await db.all('hikes')).sort((a, b) => b.startedAt - a.startedAt);
  const total = hikes.reduce((sum, x) => sum + (x.distanceM || 0), 0);
  $('#hikes-summary').textContent = hikes.length
    ? `${hikes.length} hike${hikes.length === 1 ? '' : 's'} · ${fmtDist(total)}`
    : '';

  const list = $('#hike-list');
  if (!hikes.length) {
    list.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, '🥾'),
      h('p', {}, h('strong', {}, 'No hikes yet')),
      h('p', { class: 'muted' }, 'Open the menu ☰ → Track and tap Start, import a GPX file, or log a past hike.')));
    return;
  }
  list.replaceChildren(...hikes.map(hikeCard));
}

function hikeCard(hike) {
  const source = { gps: ' · GPS', gpx: ' · GPX' }[hike.source] ?? '';
  return h('button', { class: `card${hike.difficulty ? ` diff-${hike.difficulty}` : ''}`, onclick: () => openHikeDetail(hike.id) },
    h('div', { class: 'card-top' },
      h('strong', {}, hike.name),
      hike.rating ? h('span', { class: 'stars small' }, stars(hike.rating)) : null),
    h('div', { class: 'muted small' }, fmtDate(hike.startedAt), source),
    h('div', { class: 'stat-row' },
      h('span', {}, fmtDist(hike.distanceM)),
      h('span', {}, `↗ ${fmtElev(hike.gainM)}`),
      h('span', {}, fmtDuration(hike.durationS))),
    hike.tags?.length ? h('div', { class: 'chips small' }, hike.tags.map(t => h('span', { class: 'chip' }, t))) : null);
}

export function newManualHike(prefill = {}, options = {}) {
  openHikeEditor({
    id: uid(),
    source: 'manual',
    startedAt: Date.now(),
    name: '',
    rating: 0,
    difficulty: null,
    tags: [],
    notes: '',
    distanceM: 0,
    gainM: 0,
    durationS: 0,
    segments: [],
    location: null,
    ...prefill,
  }, { isNew: true, ...options });
}

async function importGPX(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { name, segments } = parseGPX(await file.text());
    const s = trackStats(segments);
    const t0 = firstPoint(segments)[3];
    openHikeEditor({
      id: uid(),
      source: 'gpx',
      startedAt: t0 ?? file.lastModified,
      name: name || file.name.replace(/\.gpx$/i, ''),
      segments,
      distanceM: s.distanceM,
      gainM: s.gainM,
      lossM: s.lossM,
      movingS: s.movingS,
      durationS: s.elapsedS,
      rating: 0,
      difficulty: null,
      tags: [],
      notes: '',
    }, { isNew: true });
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Detail ----------

export async function openHikeDetail(id) {
  const initial = await db.get('hikes', id);
  if (!initial) return;
  const sheet = openSheet(initial.name);
  let map = null;
  let urls = [];
  const cleanup = () => { map?.remove(); map = null; urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
  sheet.onClose(cleanup);

  async function draw(hike) {
    cleanup();
    sheet.setTitle(hike.name);
    const photos = await db.byIndex('photos', 'hikeId', hike.id);
    urls = photos.map(p => URL.createObjectURL(p.blob));
    const hasTrack = hike.segments?.some(s => s.length > 1);
    const mapEl = hasTrack || hike.location ? h('div', { class: 'map map-detail' }) : null;

    fill(sheet.body,
      mapEl,
      h('div', { class: 'meta-line' },
        h('span', {}, `${fmtDay(hike.startedAt)} · ${fmtTime(hike.startedAt)}`),
        hike.rating ? h('span', { class: 'stars' }, stars(hike.rating)) : null,
        hike.difficulty ? h('span', { class: 'chip' }, hike.difficulty) : null),
      h('div', { class: 'stat-grid' },
        stat(distValue(hike.distanceM || 0).toFixed(1), distUnit(), 'Distance'),
        stat(Math.round(elevValue(hike.gainM || 0)).toLocaleString(), elevUnit(), 'Climb'),
        stat(fmtDuration(hike.durationS), '', 'Time'),
        stat(fmtPace(hike.movingS || hike.durationS, hike.distanceM), `/${distUnit()}`, 'Pace')),
      hasTrack ? elevationChart(hike.segments) : null,
      hike.movingS && hike.durationS - hike.movingS > 120
        ? h('p', { class: 'muted small' }, `Moving ${fmtDuration(hike.movingS)}, stopped ${fmtDuration(hike.durationS - hike.movingS)}`)
        : null,
      hike.tags?.length ? h('div', { class: 'chips' }, hike.tags.map(t => h('span', { class: 'chip' }, t))) : null,
      hike.notes ? h('p', { class: 'notes' }, hike.notes) : null,
      photos.length
        ? h('div', { class: 'photo-grid' }, urls.map(u =>
          h('img', { src: u, alt: '', loading: 'lazy', onclick: () => openSheet(hike.name, h('img', { src: u, alt: '', class: 'photo-full' })) })))
        : null,
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn primary',
          onclick: () => openHikeEditor(hike, { onSaved: saved => draw(saved) }),
        }, '✎ Edit'),
        hasTrack ? h('button', {
          class: 'btn',
          onclick: () => download(`${slug(hike.name)}.gpx`, hikeToGPX(hike), 'application/gpx+xml'),
        }, '⤓ Export GPX') : null,
        h('button', { class: 'btn ghost', onclick: () => deleteHike(hike, sheet) }, '🗑 Delete')));

    if (mapEl) {
      map = makeMap(mapEl);
      if (hasTrack) {
        const layer = trackLayer(hike.segments).addTo(map);
        map.fitBounds(layer.getBounds(), { padding: [24, 24] });
      } else {
        L.marker(hike.location, { icon: pinIcon('🥾') }).addTo(map);
        map.setView(hike.location, 13);
      }
      setTimeout(() => map?.invalidateSize(), 320);
    }
  }

  draw(initial);
}

function stat(value, unit, label) {
  return h('div', {},
    h('span', { class: 'v' }, value),
    unit ? h('span', { class: 'u' }, unit) : null,
    h('label', {}, label));
}

function elevationChart(segments) {
  const pts = elevationProfile(segments);
  if (pts.length < 5) return null;
  const W = 300, H = 90;
  const maxX = pts.at(-1)[0] || 1;
  const alts = pts.map(p => p[1]);
  const lo = Math.min(...alts), hi = Math.max(...alts);
  const span = Math.max(hi - lo, 10);
  const xy = pts.map(([x, a]) => [(x / maxX) * W, H - 4 - ((a - lo) / span) * (H - 8)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const wrap = h('div', { class: 'elev' });
  // Numbers only, so building this SVG from a string is safe.
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Elevation profile">
    <path class="area" d="${line}L${W},${H}L0,${H}Z"/><path class="line" d="${line}"/></svg>`;
  wrap.append(h('div', { class: 'labels' },
    h('span', {}, `Low ${fmtElev(lo)}`),
    h('span', {}, 'Elevation (GPS)'),
    h('span', {}, `High ${fmtElev(hi)}`)));
  return wrap;
}

async function deleteHike(hike, sheet) {
  if (!confirm(`Delete "${hike.name}"? This can't be undone.`)) return;
  for (const p of await db.byIndex('photos', 'hikeId', hike.id)) await db.del('photos', p.id);
  await db.del('hikes', hike.id);
  emit('hikes-changed');
  sheet.close();
  toast('Hike deleted');
}

// ---------- Add / edit form ----------

export async function openHikeEditor(hike, { isNew = false, onSaved } = {}) {
  const draft = structuredClone(hike);
  draft.tags ??= [];
  const manual = draft.source === 'manual';

  const existing = isNew ? [] : (await db.byIndex('photos', 'hikeId', draft.id))
    .map(p => ({ ...p, url: URL.createObjectURL(p.blob) }));
  const removed = new Set();
  const added = []; // { file, url }

  const fallbackName = `Hike on ${fmtDate(draft.startedAt)}`;
  const nameInput = h('input', { type: 'text', value: draft.name || '', placeholder: fallbackName, maxlength: 80, autocomplete: 'off' });
  const dateInput = h('input', { type: 'datetime-local', value: toLocalInput(draft.startedAt) });

  const ratingEl = h('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'Rating' });
  const drawRating = () => ratingEl.replaceChildren(...[1, 2, 3, 4, 5].map(n =>
    h('button', {
      type: 'button',
      class: n <= draft.rating ? 'on' : '',
      'aria-label': `${n} star${n > 1 ? 's' : ''}`,
      onclick: () => { draft.rating = draft.rating === n ? 0 : n; drawRating(); },
    }, '★')));
  drawRating();

  const knownTags = (await db.all('hikes')).flatMap(x => x.tags || []);
  const allTags = [...new Set([...PRESET_TAGS, ...knownTags, ...draft.tags])];
  const tagBox = h('div', { class: 'chips' });
  const newTag = h('input', { type: 'text', class: 'chip-input', placeholder: '+ new tag', enterkeyhint: 'done' });
  const addTag = () => {
    const t = newTag.value.trim().toLowerCase();
    newTag.value = '';
    if (!t) return;
    if (!allTags.includes(t)) allTags.push(t);
    if (!draft.tags.includes(t)) draft.tags.push(t);
    drawTags();
  };
  newTag.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  newTag.addEventListener('blur', addTag);
  const drawTags = () => tagBox.replaceChildren(
    ...allTags.map(t => h('button', {
      type: 'button',
      class: `chip${draft.tags.includes(t) ? ' on' : ''}`,
      onclick: () => {
        draft.tags = draft.tags.includes(t) ? draft.tags.filter(x => x !== t) : [...draft.tags, t];
        drawTags();
      },
    }, t)),
    newTag);
  drawTags();

  const notes = h('textarea', { rows: 4, placeholder: 'How was it? Trail conditions, parking, what you saw…' }, draft.notes || '');

  // Distance/climb/time are measured for GPS & GPX hikes, typed in for manual ones.
  let manualFields = null, distInput, gainInput, hrsInput, minsInput, locMapEl;
  if (manual) {
    const num = (value, step) => h('input', { type: 'number', inputmode: 'decimal', min: 0, step, value });
    distInput = num(draft.distanceM ? +distValue(draft.distanceM).toFixed(2) : '', 'any');
    gainInput = num(draft.gainM ? Math.round(elevValue(draft.gainM)) : '', 1);
    hrsInput = num(draft.durationS ? Math.floor(draft.durationS / 3600) : '', 1);
    minsInput = num(draft.durationS ? Math.floor((draft.durationS % 3600) / 60) : '', 1);
    locMapEl = h('div', { class: 'map map-small' });
    manualFields = [
      h('div', { class: 'field-row' },
        field('Distance', h('div', { class: 'input-unit' }, distInput, h('span', {}, distUnit()))),
        field('Climb', h('div', { class: 'input-unit' }, gainInput, h('span', {}, elevUnit()))),
        field('Time', h('div', { class: 'input-unit' }, hrsInput, h('span', {}, 'h'), minsInput, h('span', {}, 'm')))),
      field('Where (tap the map)', locMapEl),
    ];
  }

  const photoInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  photoInput.addEventListener('change', () => {
    for (const file of photoInput.files) added.push({ file, url: URL.createObjectURL(file) });
    photoInput.value = '';
    drawPhotos();
  });
  const photoGrid = h('div', { class: 'photo-grid' });
  const thumb = (url, onRemove) => h('div', { class: 'thumb' },
    h('img', { src: url, alt: '' }),
    h('button', { type: 'button', class: 'thumb-x', 'aria-label': 'Remove photo', onclick: onRemove }, '×'));
  const drawPhotos = () => photoGrid.replaceChildren(
    ...existing.filter(p => !removed.has(p.id)).map(p => thumb(p.url, () => { removed.add(p.id); drawPhotos(); })),
    ...added.map(a => thumb(a.url, () => { added.splice(added.indexOf(a), 1); URL.revokeObjectURL(a.url); drawPhotos(); })),
    h('label', { class: 'photo-add' }, '+ Photo', photoInput));
  drawPhotos();

  const saveBtn = h('button', { type: 'submit', class: 'btn primary big' }, isNew ? 'Save hike' : 'Save changes');

  const form = h('form', { class: 'form', onsubmit: save },
    field('Name', nameInput),
    field('When', dateInput),
    manualFields,
    field('Rating', ratingEl),
    field('Difficulty', segmented(DIFFICULTY, draft.difficulty, v => { draft.difficulty = v; }, { allowNone: true })),
    field('Tags', tagBox),
    field('Notes', notes),
    field('Photos', photoGrid),
    h('div', { class: 'form-actions' }, saveBtn));

  const sheet = openSheet(isNew ? 'Save hike' : 'Edit hike', form);
  let locMap = null;
  sheet.onClose(() => {
    locMap?.remove();
    existing.forEach(p => URL.revokeObjectURL(p.url));
    added.forEach(a => URL.revokeObjectURL(a.url));
  });

  if (manual) {
    locMap = makeMap(locMapEl);
    let marker = null;
    const setLoc = ll => {
      draft.location = [+ll[0].toFixed(6), +ll[1].toFixed(6)];
      if (marker) marker.setLatLng(draft.location);
      else marker = L.marker(draft.location, { icon: pinIcon('🥾') }).addTo(locMap);
    };
    locMap.on('click', e => setLoc([e.latlng.lat, e.latlng.lng]));
    if (draft.location) {
      setLoc(draft.location);
      locMap.setView(draft.location, 13);
    } else {
      locMap.setView(US_CENTER, 4);
      navigator.geolocation?.getCurrentPosition(
        p => { if (!draft.location) locMap?.setView([p.coords.latitude, p.coords.longitude], 12); },
        () => {}, { timeout: 10_000, maximumAge: 300_000 });
    }
    setTimeout(() => locMap?.invalidateSize(), 320);
  }

  // Suggest a name from the map for fresh GPS/GPX hikes.
  const start = firstPoint(draft.segments);
  if (isNew && start && !nameInput.value) {
    placeName(start[0], start[1])
      .then(place => { if (place && !nameInput.value) nameInput.value = place; })
      .catch(() => {});
  }

  async function save(e) {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      draft.name = nameInput.value.trim() || fallbackName;
      draft.startedAt = fromLocalInput(dateInput.value) ?? draft.startedAt;
      draft.notes = notes.value.trim();
      if (manual) {
        draft.distanceM = Math.round(distToM(parseFloat(distInput.value) || 0));
        draft.gainM = Math.round(elevToM(parseFloat(gainInput.value) || 0));
        draft.durationS = (parseInt(hrsInput.value, 10) || 0) * 3600 + (parseInt(minsInput.value, 10) || 0) * 60;
      }
      draft.createdAt ??= Date.now();
      draft.updatedAt = Date.now();

      for (const id of removed) await db.del('photos', id);
      for (const a of added) {
        await db.put('photos', { id: uid(), hikeId: draft.id, blob: await shrinkImage(a.file), addedAt: Date.now() });
      }
      await db.put('hikes', draft);
      navigator.storage?.persist?.().catch(() => {});

      emit('hikes-changed');
      toast(isNew ? 'Hike saved 🎉' : 'Saved');
      sheet.close();
      onSaved?.(draft);
    } catch (err) {
      console.error(err);
      toast(`Couldn't save: ${err.message}`);
      saveBtn.disabled = false;
    }
  }
}

// A <div>, not a <label>: a label would forward taps on its empty space to the
// first button inside it (a star, a tag chip, or the map's layer switcher).
function field(label, control) {
  return h('div', { class: 'field' }, h('span', {}, label), control);
}

// Phone photos are huge; keep a 1600px JPEG so storage doesn't balloon.
async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await new Promise(resolve => canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}
