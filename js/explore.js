// Explore: nearby trails, peaks, waterfalls… from OpenStreetMap, ranked by your own hike history,
// or search for a specific hike or place by name.

import { $, h, fill, on, emit, toast, settings, imperial, fmtDist, distToM, distUnit } from './util.js';
import { db } from './db.js';
import { findNearby, searchPlaces } from './osm.js';
import { KINDS, buildProfile, scorePlace } from './recommend.js';
import { makeMap, pinIcon, hereStyle, US_CENTER } from './map.js';
import { openPlaceDetail } from './place.js';
import { toggleSaved } from './wishlist.js';

const RADII = { imperial: [5, 10, 20, 35], metric: [10, 15, 30, 50] };
const MAX_LIST = 60;

let map, markerGroup;
let raw = null;          // nearby places as fetched
let origin = null, searchedRadius = null;
let search = null;       // { query, places, origin } while showing search results
let results = [];        // what's listed now, scored
let filter = 'all';
let savedIds = new Set();

export async function init() {
  map = makeMap($('#explore-map'));
  map.setView(US_CENTER, 4);
  markerGroup = L.featureGroup().addTo(map);

  $('#btn-near-me').onclick = searchNearMe;
  $('#btn-search-area').onclick = () => {
    const c = map.getCenter();
    searchNearby(c.lat, c.lng);
  };
  $('#search-form').onsubmit = e => {
    e.preventDefault();
    searchByName($('#search-input').value.trim());
  };
  // The ✕ inside a search field clears it.
  $('#search-input').addEventListener('search', () => { if (!$('#search-input').value) clearSearch(); });
  $('#radius').onchange = e => settings.set('radius', +e.target.value);
  drawRadiusOptions();

  on('hikes-changed', rescore);
  on('saved-changed', rescore);
  on('units', () => { drawRadiusOptions(); renderList(); });
  // "Find hikes near here" from a place's detail sheet.
  on('explore-here', ({ lat, lon }) => {
    emit('show-tab', 'explore');
    map.setView([lat, lon], 11);
    searchNearby(lat, lon);
  });

  // Show the last nearby search right away (also works offline).
  const last = await db.get('kv', 'lastExplore');
  if (last) {
    raw = last.places;
    origin = last.origin;
    searchedRadius = last.radiusM;
    map.setView(origin, 11);
  }
  await rescore();
}

export function onShow() {
  setTimeout(() => map.invalidateSize(), 0);
}

function drawRadiusOptions() {
  const options = RADII[imperial() ? 'imperial' : 'metric'];
  const savedM = settings.get('radius');
  const values = options.map(n => Math.round(distToM(n)));
  // Closest option to the saved radius (it may have been saved in the other unit system).
  const current = savedM == null
    ? values[1]
    : values.reduce((best, v) => (Math.abs(v - savedM) < Math.abs(best - savedM) ? v : best));
  $('#radius').replaceChildren(...options.map((n, i) =>
    h('option', { value: values[i], selected: values[i] === current }, `${n} ${distUnit()}`)));
}

// Only offer filters for kinds that are actually in the results.
function drawFilters() {
  const present = new Set(results.map(p => p.kind));
  if (filter !== 'all' && !present.has(filter)) filter = 'all';
  const kinds = Object.entries(KINDS).filter(([k]) => present.has(k));
  fill($('#kind-filters'), kinds.length > 1 && [['all', 'All'], ...kinds.map(([k, v]) => [k, `${v.emoji} ${v.label}s`])].map(([k, label]) =>
    h('button', {
      class: `chip${filter === k ? ' on' : ''}`,
      onclick: () => { filter = k; drawFilters(); renderList(); },
    }, label)));
}

// ---------- Searching ----------

function searchNearMe() {
  if (!navigator.geolocation) return toast('No location access on this device.');
  setBusy(true, 'Finding you…');
  navigator.geolocation.getCurrentPosition(
    pos => searchNearby(pos.coords.latitude, pos.coords.longitude),
    () => {
      setBusy(false);
      toast('Couldn\'t get your location. Pan the map and tap "Search this area" instead.', 5000);
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 });
}

async function searchNearby(lat, lon) {
  const radiusM = +$('#radius').value;
  setBusy(true, 'Searching… (can take a minute)');
  try {
    raw = await findNearby(lat, lon, radiusM);
    origin = [lat, lon];
    searchedRadius = radiusM;
    clearSearch(false);
    await db.put('kv', { origin, radiusM, places: raw, at: Date.now() }, 'lastExplore');
    await rescore();
    fitResults();
    if (!raw.length) toast('Nothing found here. Try a bigger radius.');
  } catch (err) {
    console.warn(err);
    toast(navigator.onLine === false ? 'You\'re offline. Showing your last search.' : err.message, 6000);
  } finally {
    setBusy(false);
  }
}

async function searchByName(query) {
  if (query.length < 2) return;
  $('#search-input').blur(); // hide the phone keyboard
  setBusy(true, 'Searching…');
  try {
    // Prefer matches in the area on screen, unless zoomed out to a continent.
    const b = map.getBounds();
    const viewbox = map.getZoom() >= 6 ? [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()] : null;
    const [places, here] = await Promise.all([searchPlaces(query, viewbox), whereAmI()]);
    search = { query, places, origin: here };
    filter = 'all';
    await rescore();
    fitResults();
    if (!places.length) toast(`No trails or places found for "${query}". Try another spelling or a nearby landmark.`, 5000);
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    setBusy(false);
  }
}

function clearSearch(redraw = true) {
  search = null;
  $('#search-input').value = '';
  if (redraw) rescore().then(fitResults);
}

// Your rough position, for "x mi away" on search results. Never blocks for long.
function whereAmI() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve([p.coords.latitude, p.coords.longitude]),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 10 * 60_000 });
  });
}

function setBusy(busy, label) {
  const btn = $('#btn-near-me');
  btn.disabled = busy;
  $('#btn-search-area').disabled = busy;
  $('#search-input').disabled = busy;
  btn.textContent = busy ? label : '📍 Near me';
}

// ---------- Ranking & rendering ----------

async function rescore() {
  const [hikes, saved] = await Promise.all([db.all('hikes'), db.all('saved')]);
  const profile = buildProfile(hikes);
  savedIds = new Set(saved.map(s => s.id));

  if (search) {
    // Keep the search service's relevance order: the best name match comes first.
    results = search.places.map(p => scorePlace(p, profile, search.origin, null, savedIds));
    fill($('#explore-note'),
      h('span', {}, `${results.length} result${results.length === 1 ? '' : 's'} for “${search.query}”`),
      h('button', { class: 'btn small ghost', onclick: () => clearSearch() }, '✕ Clear'));
  } else {
    results = (raw ?? [])
      .map(p => scorePlace(p, profile, origin, searchedRadius, savedIds))
      .sort((a, b) => b.score - a.score);
    fill($('#explore-note'), raw && (profile.count
      ? `Ranked for you using your ${profile.count} logged hike${profile.count === 1 ? '' : 's'}.`
      : 'Tip: log and rate a few hikes, and these suggestions will start matching what you like.'));
  }
  drawFilters();
  renderList();
}

function visible() {
  return (filter === 'all' ? results : results.filter(p => p.kind === filter)).slice(0, MAX_LIST);
}

function renderList() {
  const list = $('#explore-list');
  if (!raw && !search) {
    list.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, '🧭'),
      h('p', {}, h('strong', {}, 'Where to next?')),
      h('p', { class: 'muted' }, 'Search for a trail by name above, or tap "Near me" to find trails, peaks, waterfalls and campgrounds around you.')));
    renderMarkers([]);
    return;
  }
  const items = visible();
  renderMarkers(items);
  if (!items.length) {
    list.replaceChildren(h('p', { class: 'muted' }, search ? 'Nothing matched.' : 'Nothing of this kind nearby.'));
    return;
  }
  list.replaceChildren(...items.map(placeCard));
}

function placeCard(p) {
  const kind = KINDS[p.kind];
  const info = [
    kind.label,
    p.area,
    p.awayM != null ? `${fmtDist(p.awayM)} away` : null,
    p.lengthM ? `${fmtDist(p.lengthM)} long` : null,
  ].filter(Boolean).join(' · ');
  const star = h('button', {
    class: 'star-btn',
    'aria-label': savedIds.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist',
    onclick: async () => {
      const saved = await toggleSaved(p);
      toast(saved ? 'Added to your wishlist' : 'Removed from wishlist');
    },
  }, savedIds.has(p.id) ? '★' : '☆');
  return h('div', { class: 'card place-card' },
    h('button', { class: 'card-main', onclick: () => openPlaceDetail(p) },
      h('span', { class: 'kind-emoji' }, kind.emoji),
      h('div', {},
        h('strong', {}, p.name),
        h('div', { class: 'muted small' }, info),
        p.reasons.length ? h('div', { class: 'reasons-inline' }, p.reasons.slice(0, 2).join(' · ')) : null)),
    search ? null : h('span', { class: 'score' }, `${p.score}%`),
    star);
}

function renderMarkers(items) {
  markerGroup.clearLayers();
  const you = search ? search.origin : origin;
  if (you) L.circleMarker(you, { ...hereStyle, radius: 6 }).addTo(markerGroup);
  for (const p of items) {
    L.marker([p.lat, p.lon], { icon: pinIcon(KINDS[p.kind].emoji, p.visited ? 'visited' : ''), title: p.name })
      .on('click', () => openPlaceDetail(p))
      .addTo(markerGroup);
  }
}

function fitResults() {
  const items = visible();
  if (search && items.length) {
    // Frame the results, not your own position, which may be far away.
    const b = L.latLngBounds(items.map(p => [p.lat, p.lon]));
    map.fitBounds(b, { padding: [40, 40], maxZoom: 12 });
    return;
  }
  const b = markerGroup.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 13 });
}
