// "Share → Blaze" from Google Maps (or any app). Android hands what was shared to Blaze through the
// share_target in manifest.webmanifest, as ?share_title=…&share_text=…&share_url=… on the start URL,
// and this sheet turns it into a wishlist place.
//
// Google Maps shares a name, often an address, and a short maps.app.goo.gl link. A web page can't follow
// that link (Google doesn't allow it), so Blaze searches OpenStreetMap by name and you pick the match,
// or drop a pin yourself. Full Maps links that carry coordinates are used directly.

import { h, fill, toast, emit, openSheet, fmtDist } from './util.js';
import { searchPlaces } from './osm.js';
import { KINDS } from './recommend.js';
import { haversine } from './geo.js';
import { makeMap, pinIcon, US_CENTER } from './map.js';
import { isSaved, toggleSaved } from './wishlist.js';

const PARAMS = ['share_title', 'share_text', 'share_url'];

// What was shared, if Blaze was opened from the share menu; also tidies the address bar.
export function takeShare() {
  const q = new URLSearchParams(location.search);
  if (!PARAMS.some(k => q.has(k))) return null;
  history.replaceState(history.state, '', location.pathname);
  return parseShare({ title: q.get('share_title'), text: q.get('share_text'), url: q.get('share_url') });
}

// ---------- Reading the shared text (pure) ----------

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const lat = '(-?\\d{1,2}(?:\\.\\d+)?)', lon = '(-?\\d{1,3}(?:\\.\\d+)?)';
// Most specific first: !3d!4d is the place itself, @ is only where the map was centered.
const COORDS = [
  new RegExp(`!3d${lat}!4d${lon}`),
  new RegExp(`[?&](?:q|query|ll|destination|daddr)=(?:loc:)?${lat},\\s*${lon}(?:[&#]|$)`),
  new RegExp(`/@${lat},${lon}`),
];
const BARE_COORDS = new RegExp(`^${lat},\\s*${lon}$`);
// Not names: what Maps calls a pin with no place behind it.
const GENERIC = /^(dropped pin|shared location|my location|pinned location|location)$/i;

function coordsIn(s) {
  for (const re of [...COORDS, BARE_COORDS]) {
    const m = s.match(re);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return [+m[1], +m[2]];
  }
  return null;
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// → { name, address, coords: [lat, lon] | null, url }
export function parseShare({ title, text, url }) {
  const all = [title, text, url].filter(Boolean).join('\n');
  const urls = [...new Set([url, ...(all.match(URL_RE) ?? [])].filter(Boolean))];
  const lines = [...new Set([title, ...(text ?? '').split('\n')]
    .map(s => (s ?? '').replace(URL_RE, '').trim().replace(/^["“]|["”]$/g, '').trim())
    .filter(Boolean))];

  let coords = null;
  for (const u of urls) if ((coords = coordsIn(decode(u)))) break;
  coords ??= lines.map(coordsIn).find(Boolean) ?? null;

  const named = lines.filter(s => !GENERIC.test(s) && !BARE_COORDS.test(s));
  return {
    name: named[0] ?? '',
    // Later lines are usually the address: "Yosemite Valley, CA 95389".
    address: named.slice(1).join(', '),
    coords,
    url: urls.find(u => /google\.|goo\.gl/.test(u)) ?? urls[0] ?? null,
  };
}

// A best guess at what kind of place a bare name is, for the wishlist icon.
export function guessKind(name) {
  const n = name.toLowerCase();
  if (/trailhead/.test(n)) return 'trailhead';
  if (/fall(s)?\b|cascade/.test(n)) return 'waterfall';
  if (/trail|path|loop|hike|track|traverse|ridge/.test(n)) return 'route';
  if (/\b(mount|mt\.?|peak|summit|dome|butte|pico|pic|monte|berg)\b/.test(n)) return 'peak';
  if (/lake|lago|lac\b|pond|tarn|reservoir/.test(n)) return 'lake';
  if (/viewpoint|overlook|lookout|vista|view point/.test(n)) return 'viewpoint';
  if (/camp/.test(n)) return 'camp';
  if (/park|forest|reserve|wilderness|preserve/.test(n)) return 'park';
  return 'place';
}

// ---------- The sheet ----------

const NEAR_M = 25_000; // with coordinates, matches farther than this are some other place of the same name

export function openShareSheet(shared) {
  const sheet = openSheet('Add to wishlist');
  const fromMaps = /google\.|goo\.gl/.test(shared.url ?? '');
  const queryInput = h('input', { type: 'text', value: shared.name, placeholder: 'Name of the trail or place', enterkeyhint: 'search', 'aria-label': 'Search for the place' });
  const results = h('div', { class: 'list' });
  const pinBox = h('div', {});

  let pinMap = null;
  sheet.onClose(() => pinMap?.remove());

  async function save(place) {
    if (await isSaved(place.id)) {
      toast(`“${place.name}” is already on your wishlist`);
    } else {
      await toggleSaved({ ...place, sourceUrl: shared.url });
      toast(`Added “${place.name}” to your wishlist`);
    }
    sheet.close();
    emit('show-tab', 'saved');
  }

  const custom = (name, [la, lo]) => ({
    id: `custom/${la.toFixed(5)},${lo.toFixed(5)}`,
    osmType: null,
    osmId: null,
    kind: guessKind(name),
    name,
    lat: la,
    lon: lo,
    lengthM: null,
    eleM: null,
    tags: {},
  });

  const resultCard = p => h('div', { class: 'card place-card' },
    h('button', { class: 'card-main', onclick: () => save(p) },
      h('span', { class: 'kind-emoji' }, KINDS[p.kind].emoji),
      h('div', {},
        h('strong', {}, p.name),
        h('div', { class: 'muted small' }, [KINDS[p.kind].label, p.area,
          shared.coords && `${fmtDist(haversine(shared.coords, [p.lat, p.lon]))} from the shared spot`].filter(Boolean).join(' · ')))),
    h('span', { class: 'btn small primary', 'aria-hidden': 'true' }, '+ Add'));

  async function search(query) {
    query = query.trim();
    if (query.length < 2) return fill(results, h('p', { class: 'muted small' }, 'Type the name of the place to search for it.'));
    fill(results, h('p', { class: 'muted small' }, 'Searching OpenStreetMap…'));
    const c = shared.coords;
    const viewbox = c && [c[1] - 0.3, c[0] + 0.3, c[1] + 0.3, c[0] - 0.3];
    try {
      // The address narrows down common names ("Lost Lake"); fall back to the name alone.
      const area = shared.address.split(',').map(s => s.trim()).filter(s => s && !/\d{3,}/.test(s)).slice(0, 2).join(', ');
      let found = area && query === shared.name ? await searchPlaces(`${query}, ${area}`, viewbox) : [];
      if (!found.length) found = await searchPlaces(query, viewbox);
      if (c) found = found.filter(p => haversine(c, [p.lat, p.lon]) <= NEAR_M)
        .sort((a, b) => haversine(c, [a.lat, a.lon]) - haversine(c, [b.lat, b.lon]));
      fill(results, found.length
        ? [h('p', { class: 'muted small' }, 'Tap the right one. You\'ll get its forecast, directions and, for trails, the trail line.'), found.slice(0, 8).map(resultCard)]
        : h('p', { class: 'muted small' }, `Nothing on OpenStreetMap matched “${query}”. Try a shorter name, or drop a pin below.`));
    } catch (err) {
      fill(results, h('p', { class: 'muted small' }, `${err.message} You can still drop a pin below.`));
    }
  }

  function showPinPicker() {
    const nameInput = h('input', { type: 'text', value: shared.name, placeholder: 'Name', 'aria-label': 'Name for this place' });
    const mapEl = h('div', { class: 'map map-small' });
    let loc = shared.coords;
    const saveBtn = h('button', { class: 'btn primary', disabled: !loc, onclick: () => {
      const name = nameInput.value.trim() || 'Shared place';
      save(custom(name, loc));
    } }, '★ Save this spot');
    fill(pinBox,
      h('div', { class: 'form' },
        h('div', { class: 'field' }, h('span', {}, 'Name'), nameInput),
        h('div', { class: 'field' }, h('span', {}, 'Where (tap the map)'), mapEl),
        h('div', { class: 'form-actions' }, saveBtn)));

    pinMap = makeMap(mapEl);
    let marker = null;
    const setLoc = ll => {
      loc = [+ll[0].toFixed(6), +ll[1].toFixed(6)];
      if (marker) marker.setLatLng(loc);
      else marker = L.marker(loc, { icon: pinIcon('📍') }).addTo(pinMap);
      saveBtn.disabled = false;
    };
    pinMap.on('click', e => setLoc([e.latlng.lat, e.latlng.lng]));
    if (loc) {
      setLoc(loc);
      pinMap.setView(loc, 13);
    } else {
      pinMap.setView(US_CENTER, 4);
      navigator.geolocation?.getCurrentPosition(
        p => { if (!loc) pinMap?.setView([p.coords.latitude, p.coords.longitude], 11); },
        () => {}, { timeout: 10_000, maximumAge: 300_000 });
    }
    setTimeout(() => pinMap?.invalidateSize(), 50);
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  fill(sheet.body,
    h('p', { class: 'muted small' }, fromMaps ? 'Shared from Google Maps' : 'Shared with Blaze'),
    h('p', { class: 'share-name' }, shared.name || (shared.coords ? 'A spot on the map' : 'A shared place')),
    shared.address ? h('p', { class: 'muted' }, shared.address) : null,
    // A link with coordinates pins the exact spot: offer that first.
    shared.coords ? h('div', { class: 'card place-card' },
      h('button', { class: 'card-main', onclick: () => save(custom(shared.name || 'Shared place', shared.coords)) },
        h('span', { class: 'kind-emoji' }, KINDS[guessKind(shared.name)].emoji),
        h('div', {}, h('strong', {}, 'Save the exact spot'), h('div', { class: 'muted small' }, `${shared.coords[0].toFixed(5)}, ${shared.coords[1].toFixed(5)}`))),
      h('span', { class: 'btn small primary', 'aria-hidden': 'true' }, '+ Add')) : null,
    h('h3', { class: 'share-label' }, shared.coords ? 'Or pick it on OpenStreetMap' : 'Find it on OpenStreetMap'),
    h('form', { class: 'share-search', onsubmit: e => { e.preventDefault(); queryInput.blur(); search(queryInput.value); } },
      queryInput,
      h('button', { type: 'submit', class: 'btn' }, 'Search')),
    results,
    h('div', { class: 'share-pin' },
      h('button', { class: 'btn ghost', onclick: e => { e.currentTarget.remove(); showPinPicker(); } }, '📍 Not listed? Drop a pin instead')),
    pinBox);

  search(shared.name);
}
