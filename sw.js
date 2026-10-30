// Service worker: makes the app open offline, and keeps map tiles you've seen
// so the map still works on the trail without signal.

const VERSION = 'blaze-v7'; // bump when shipping changes so the shell is re-cached
const TILE_CACHE = 'blaze-tiles';
const MAX_TILES = 4000;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/db.js',
  './js/explore.js',
  './js/geo.js',
  './js/gpx.js',
  './js/hikes.js',
  './js/map.js',
  './js/me.js',
  './js/osm.js',
  './js/pack.js',
  './js/pack-data.js',
  './js/place.js',
  './js/recommend.js',
  './js/saved.js',
  './js/track.js',
  './js/util.js',
  './js/weather.js',
  './js/wishlist.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

const TILE_HOST = /(^|\.)tile\.(openstreetmap|opentopomap)\.org$/;

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache so the new version never precaches stale files.
  event.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOST.test(url.hostname)) event.respondWith(tile(req));
  else if (url.origin === self.location.origin) event.respondWith(appFile(req));
  else if (/^(unpkg\.com|fonts\.(googleapis|gstatic)\.com)$/.test(url.hostname)) event.respondWith(library(req));
  // Everything else (Overpass, weather, geocoding) goes straight to the network.
});

// The app's own files: network first, so every file comes from the same (latest) version
// whenever you're online. With no or very weak signal, fall back to the cached copy.
const NETWORK_WAIT_MS = 4000;

async function appFile(req) {
  const cache = await caches.open(VERSION);
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_WAIT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* offline */ }
  const cached = await cache.match(req, { ignoreSearch: true });
  return cached || network;
}

// Libraries and fonts have versioned URLs that never change, so the cache is always right.
async function library(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

let tilePuts = 0;

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Opaque responses are padded to megabytes of quota each in Chrome; only keep CORS ones.
    if (res.ok && res.type !== 'opaque') {
      await cache.put(req, res.clone());
      if (++tilePuts % 100 === 0) trimTiles(cache);
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(key);
}
