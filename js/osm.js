// Public trail data from OpenStreetMap via the Overpass API.

import { haversine, parseDistance, pathLength } from './geo.js';
import { db } from './db.js';

// Public Overpass instances listed on the OSM wiki. They're often busy or hang, so rather than
// waiting on one at a time, start with the first and bring in the next whenever the ones asked so far
// haven't answered within HEDGE_MS (or right away if one fails). The first good answer wins and the
// rest are cancelled, so a slow server costs a few seconds instead of a full timeout.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const HEDGE_MS = 4000;
const TIMEOUT_MS = 30_000;
// Sent to the server too: Overpass admits queries with a smaller declared timeout sooner when it's busy.
const SERVER_TIMEOUT_S = 25;

async function ask(url, query, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal });
  } catch (err) {
    throw err.name === 'AbortError' ? new Error('OpenStreetMap took too long to answer. Try again or use a smaller radius.')
      : new Error('Couldn\'t reach OpenStreetMap. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'OpenStreetMap is busy right now. Try again in a minute.' : `OpenStreetMap search failed (${res.status})`);
  return res.json();
}

export function overpass(query) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    const timers = [];
    let settled = false, failed = 0;
    const settle = () => {
      settled = true;
      timers.forEach(clearTimeout);
      controllers.forEach(c => c.abort());
    };
    const start = i => {
      if (settled || i >= ENDPOINTS.length || controllers[i]) return;
      const abort = controllers[i] = new AbortController();
      timers.push(setTimeout(() => abort.abort(), TIMEOUT_MS), setTimeout(() => start(i + 1), HEDGE_MS));
      ask(ENDPOINTS[i], query, abort.signal).then(
        json => { if (!settled) { settle(); resolve(json); } },
        err => {
          if (settled) return;
          if (++failed === ENDPOINTS.length) { settle(); reject(err); } else start(i + 1);
        });
    };
    start(0);
  });
}

// ---------- Nearby (Overpass) ----------

// A bounding box is much cheaper for Overpass than around:, especially for trail relations;
// the corners outside the radius are trimmed on the phone afterwards.
function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(5)).join(',');
}

// Trail relations are the slow part of a nearby search, so they're a query of their own:
// peaks, lakes and the rest usually come back in a few seconds and can be shown while trails load.
// Each kind gets its own limit so a region full of named lakes can't crowd out the others.
const trailsQuery = bbox => `[out:json][timeout:${SERVER_TIMEOUT_S}][bbox:${bbox}];
relation["route"~"^(hiking|foot)$"]["name"]; out tags center 150;`;

const pointsQuery = bbox => `[out:json][timeout:${SERVER_TIMEOUT_S}][bbox:${bbox}];
node["natural"="peak"]["name"]; out body 120;
node["waterway"="waterfall"]["name"]; out body 80;
node["tourism"="viewpoint"]["name"]; out body 80;
node["highway"="trailhead"]["name"]; out body 60;
way["natural"="water"]["water"="lake"]["name"]; out tags center 50;
nwr["tourism"="camp_site"]["name"]; out tags center 40;`;

const KEEP_TAGS = ['description', 'website', 'operator', 'network', 'ele', 'distance', 'from', 'to', 'roundtrip', 'access', 'fee', 'wikipedia', 'opening_hours'];

function toPlace(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !t.name) return null;

  let kind;
  if (t.route) kind = 'route';
  else if (t.natural === 'peak') kind = 'peak';
  else if (t.waterway === 'waterfall') kind = 'waterfall';
  else if (t.tourism === 'viewpoint') kind = 'viewpoint';
  else if (t.highway === 'trailhead') kind = 'trailhead';
  else if (t.natural === 'water') kind = 'lake';
  else if (t.tourism === 'camp_site') kind = 'camp';
  else return null;

  const ele = parseFloat(t.ele);
  return {
    id: `${el.type}/${el.id}`,
    osmType: el.type,
    osmId: el.id,
    kind,
    name: t.name,
    lat,
    lon,
    lengthM: kind === 'route' ? parseDistance(t.distance) : null,
    eleM: Number.isFinite(ele) && kind !== 'lake' ? ele : null,
    roundtrip: t.roundtrip === 'yes',
    tags: Object.fromEntries(KEEP_TAGS.filter(k => t[k]).map(k => [k, t[k]])),
  };
}

function toPlaces(elements, lat, lon, radiusM) {
  const seen = new Set();
  const places = [];
  for (const el of elements) {
    const place = toPlace(el);
    // Trails are kept if any part might be in range; their center can sit outside it.
    if (!place || (place.kind !== 'route' && haversine([lat, lon], [place.lat, place.lon]) > radiusM)) continue;
    // Long trails are often split into many relations with the same name; keep one.
    const key = place.kind === 'route' ? `route:${place.name.toLowerCase()}` : place.id;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  return places;
}

// Recent complete nearby searches, so searching the same area again is instant (and works offline).
// Trail data changes slowly, so a week-old answer is still a good one.
const AREA_CACHE_KEY = 'nearbyCache';
const AREA_CACHE_SIZE = 12;
const AREA_CACHE_MS = 7 * 24 * 3600_000;

// A cached search can answer a new one if its circle covers the new circle (give or take a small
// sliver at the edge, so GPS jitter between two "Near me" taps still hits). It must not be much
// bigger either: each kind is capped at a fixed count, so a huge area may have dropped places
// that a smaller search would find.
async function fromAreaCache(lat, lon, radiusM) {
  const entries = (await db.get('kv', AREA_CACHE_KEY)) ?? [];
  const hit = entries.find(e => Date.now() - e.at < AREA_CACHE_MS
    && e.radiusM >= radiusM && e.radiusM <= 2 * radiusM
    && haversine(e.origin, [lat, lon]) + radiusM <= e.radiusM + 0.05 * radiusM);
  if (!hit) return null;
  // Same trimming as a fresh search; trails by center, out to the corners of the search box.
  return hit.places.filter(p => haversine([lat, lon], [p.lat, p.lon]) <= (p.kind === 'route' ? radiusM * Math.SQRT2 : radiusM));
}

async function toAreaCache(lat, lon, radiusM, places) {
  const entries = (await db.get('kv', AREA_CACHE_KEY)) ?? [];
  entries.unshift({ origin: [lat, lon], radiusM, places, at: Date.now() });
  await db.put('kv', entries.slice(0, AREA_CACHE_SIZE), AREA_CACHE_KEY);
}

// Nearby trails, peaks, waterfalls… Resolves to { places, cached, missing }, where missing names
// the half of the search that failed ('trails' or 'places') if only one half came back.
// onPartial(places) is called with peaks, lakes etc. if they arrive before the trails do.
export async function findNearby(lat, lon, radiusM, onPartial) {
  const cached = await fromAreaCache(lat, lon, radiusM).catch(() => null);
  if (cached) return { places: cached, cached: true, missing: null };

  const bbox = bboxAround(lat, lon, radiusM);
  let trailsDone = false;
  const trails = overpass(trailsQuery(bbox)).then(d => toPlaces(d.elements, lat, lon, radiusM)).finally(() => { trailsDone = true; });
  const points = overpass(pointsQuery(bbox)).then(d => toPlaces(d.elements, lat, lon, radiusM));
  points.then(p => { if (!trailsDone) onPartial?.(p); }, () => {});

  const [t, p] = await Promise.allSettled([trails, points]);
  if (t.status === 'rejected' && p.status === 'rejected') throw t.reason;
  const places = [...(t.value ?? []), ...(p.value ?? [])];
  const missing = t.status === 'rejected' ? 'trails' : p.status === 'rejected' ? 'places' : null;
  if (!missing) await toAreaCache(lat, lon, radiusM, places).catch(() => {});
  return { places, cached: false, missing };
}

// ---------- Search by name (Nominatim) ----------

// What a search hit is, from its OSM category/type. null = not hiking-related (streets, shops…).
function searchKind(category, type) {
  if (category === 'route') return /^(hiking|foot)$/.test(type) ? 'route' : null;
  if (category === 'highway') return type === 'trailhead' ? 'trailhead' : /^(path|footway|track|bridleway)$/.test(type) ? 'route' : null;
  if (category === 'natural') {
    if (/^(peak|volcano|hill)$/.test(type)) return 'peak';
    if (type === 'water') return 'lake';
    return 'place'; // glaciers, ridges, valleys, cliffs…
  }
  if (category === 'water' || type === 'lake' || type === 'reservoir') return 'lake';
  if (category === 'waterway') return type === 'waterfall' ? 'waterfall' : null;
  if (category === 'tourism') return { viewpoint: 'viewpoint', camp_site: 'camp', attraction: 'place', picnic_site: 'place' }[type] ?? null;
  if (category === 'leisure') return /^(park|nature_reserve)$/.test(type) ? 'park' : null;
  if (category === 'boundary') return /^(national_park|protected_area)$/.test(type) ? 'park' : type === 'administrative' ? 'place' : null;
  if (category === 'place') return 'place'; // towns, villages, localities: "find hikes near here"
  return null;
}

function fromSearchHit(r) {
  const kind = searchKind(r.category, r.type);
  const name = r.name || r.display_name?.split(',')[0];
  if (!kind || !name) return null;
  const t = r.extratags || {};
  const ele = parseFloat(t.ele);
  return {
    id: `${r.osm_type}/${r.osm_id}`,
    osmType: r.osm_type,
    osmId: r.osm_id,
    kind,
    name,
    // "Washington County, Utah" — names repeat worldwide, so show where it is.
    area: r.display_name.split(',').slice(1).map(s => s.trim()).filter(s => !/^\d/.test(s)).slice(-3, -1).join(', '),
    lat: +r.lat,
    lon: +r.lon,
    lengthM: kind === 'route' ? parseDistance(t.distance) : null,
    eleM: Number.isFinite(ele) && kind !== 'lake' ? ele : null,
    roundtrip: t.roundtrip === 'yes',
    tags: Object.fromEntries(KEEP_TAGS.filter(k => t[k]).map(k => [k, t[k]])),
  };
}

// viewbox = [west, north, east, south] to prefer results in the area you're looking at.
export async function searchPlaces(query, viewbox) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '25', extratags: '1' });
  if (viewbox) params.set('viewbox', viewbox.map(v => v.toFixed(4)).join(','));
  let res;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Couldn\'t reach the search service. Check your connection.');
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'Search is busy. Try again in a moment.' : `Search failed (${res.status})`);
  const seen = new Set();
  return (await res.json())
    .map(fromSearchHit)
    .filter(p => p && !seen.has(p.id) && seen.add(p.id));
}

// The actual line of a trail (a route relation or a single path), plus its length from the geometry.
// Kept on the phone for the last ROUTE_CACHE_SIZE trails opened, so reopening one is instant
// and its line still shows on the trail without signal.
const ROUTE_CACHE_SIZE = 50;

export async function routeGeometry(osmType, id) {
  const key = `route:${osmType}/${id}`;
  const cached = await db.get('kv', key).catch(() => null);
  if (cached) return cached;

  const select = osmType === 'relation' ? `relation(${id});way(r);` : `way(${id});`;
  const data = await overpass(`[out:json][timeout:${SERVER_TIMEOUT_S}];${select}out geom;`);
  const lines = data.elements
    .filter(e => e.type === 'way' && e.geometry?.length)
    // 5 decimals is about a meter: plenty for drawing, and about half the storage.
    .map(w => w.geometry.map(g => [+g.lat.toFixed(5), +g.lon.toFixed(5)]));
  const route = { lines, lengthM: lines.reduce((sum, l) => sum + pathLength(l), 0) };
  if (lines.length) cacheRoute(key, route).catch(() => {});
  return route;
}

async function cacheRoute(key, route) {
  const keys = ((await db.get('kv', 'routeCacheKeys')) ?? []).filter(k => k !== key);
  keys.unshift(key);
  await db.put('kv', route, key);
  for (const old of keys.splice(ROUTE_CACHE_SIZE)) await db.del('kv', old);
  await db.put('kv', keys, 'routeCacheKeys');
}

export async function placeName(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const j = await res.json();
  const a = j.address || {};
  return j.name || a.leisure || a.natural || a.park || a.hamlet || a.village || a.town || a.city || a.county || null;
}
