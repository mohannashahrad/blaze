// Public trail data from OpenStreetMap via the Overpass API.

import { haversine, parseDistance, pathLength } from './geo.js';

// Public Overpass instances listed on the OSM wiki, tried in order.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Public Overpass servers are sometimes busy or hang; give each one a bounded try, then move on.
const TIMEOUT_MS = 60_000;

export async function overpass(query) {
  let lastError;
  for (const url of ENDPOINTS) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: abort.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'OpenStreetMap is busy right now. Try again in a minute.' : `OpenStreetMap search failed (${res.status})`);
      return await res.json();
    } catch (err) {
      lastError = err.name === 'AbortError' ? new Error('OpenStreetMap took too long to answer. Try again or use a smaller radius.')
        : err instanceof TypeError ? new Error('Couldn\'t reach OpenStreetMap. Check your connection and try again.')
        : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// A bounding box is much cheaper for Overpass than around:, especially for trail relations;
// the corners outside the radius are trimmed on the phone afterwards.
// Each kind gets its own limit so a region full of named lakes can't crowd out trails.
function nearbyQuery(lat, lon, radiusM) {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(v => v.toFixed(5)).join(',');
  return `[out:json][timeout:60][bbox:${bbox}];
relation["route"~"^(hiking|foot)$"]["name"]; out tags center 150;
node["natural"="peak"]["name"]; out body 120;
node["waterway"="waterfall"]["name"]; out body 80;
node["tourism"="viewpoint"]["name"]; out body 80;
node["highway"="trailhead"]["name"]; out body 60;
way["natural"="water"]["water"="lake"]["name"]; out tags center 50;
nwr["tourism"="camp_site"]["name"]; out tags center 40;`;
}

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

export async function findNearby(lat, lon, radiusM) {
  const data = await overpass(nearbyQuery(lat, lon, radiusM));
  const seen = new Set();
  const places = [];
  for (const el of data.elements) {
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
export async function routeGeometry(osmType, id) {
  const select = osmType === 'relation' ? `relation(${id});way(r);` : `way(${id});`;
  const data = await overpass(`[out:json][timeout:30];${select}out geom;`);
  const lines = data.elements
    .filter(e => e.type === 'way' && e.geometry?.length)
    .map(w => w.geometry.map(g => [g.lat, g.lon]));
  return { lines, lengthM: lines.reduce((sum, l) => sum + pathLength(l), 0) };
}

export async function placeName(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const j = await res.json();
  const a = j.address || {};
  return j.name || a.leisure || a.natural || a.park || a.hamlet || a.village || a.town || a.city || a.county || null;
}
