// Tests for js/osm.js (hedged Overpass requests, area cache, trail-line cache) with a fake fetch
// and a fake IndexedDB, plus one live search at the end. Not part of the app.
// Setup once: cd dev && npm i fake-indexeddb@6   Run: node dev/test-osm.mjs
import 'fake-indexeddb/auto';
const osm = await import(new URL('../js/osm.js', import.meta.url));
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const realFetch = globalThis.fetch;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fake fetch: behaviour per host. 'hang' = never answers until aborted.
let plan, calls;
globalThis.fetch = (url, opts) => {
  const host = new URL(url).hostname; calls.push(host);
  const b = plan[host];
  return new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    if (b.fail) setTimeout(() => resolve(new Response('', { status: b.fail })), b.after ?? 0);
    else if (!b.hang) setTimeout(() => resolve(new Response(JSON.stringify({ elements: b.elements ?? [], from: host }))), b.after);
  });
};
const H = ['overpass-api.de', 'overpass.private.coffee', 'overpass.kumi.systems'];
let t;

// 1. First server hangs: second starts at 4s and wins; third never needed.
plan = { [H[0]]: { hang: true }, [H[1]]: { after: 200 }, [H[2]]: { after: 200 } }; calls = []; t = Date.now();
let r = await osm.overpass('q');
assert(r.from === H[1] && Date.now() - t < 4500 && calls.length === 2, `hang → hedged to #2 in ${Date.now() - t}ms, calls=${calls}`);

// 2. First fails fast (429): next starts immediately.
plan = { [H[0]]: { fail: 429 }, [H[1]]: { after: 100 }, [H[2]]: { after: 100 } }; calls = []; t = Date.now();
r = await osm.overpass('q');
assert(r.from === H[1] && Date.now() - t < 500, `429 → failover immediately in ${Date.now() - t}ms`);

// 3. All fail: rejects with a friendly message.
plan = { [H[0]]: { fail: 429 }, [H[1]]: { fail: 500 }, [H[2]]: { fail: 504 } }; calls = [];
try { await osm.overpass('q'); assert(false, 'all fail rejects'); } catch (e) { assert(calls.length === 3 && /failed \(504\)/.test(e.message), `all fail → rejects: "${e.message}"`); }

// 4. Fast first server: no extra requests.
plan = { [H[0]]: { after: 50 }, [H[1]]: { after: 50 }, [H[2]]: { after: 50 } }; calls = [];
await osm.overpass('q'); await sleep(4200);
assert(calls.length === 1, `fast server → only 1 request (calls=${calls.length})`);

// 5. findNearby: points first (partial), then trails; then area cache hit; then a non-covered area misses.
const peak = { type: 'node', id: 1, lat: 46.001, lon: 7.001, tags: { natural: 'peak', name: 'Peak A' } };
const route = { type: 'relation', id: 2, center: { lat: 46.002, lon: 7.0 }, tags: { route: 'hiking', name: 'Trail B' } };
globalThis.fetch = (url, opts) => {
  const q = opts.body.get('data'); const isTrails = q.includes('relation[');
  return sleep(isTrails ? 600 : 100).then(() => new Response(JSON.stringify({ elements: isTrails ? [route] : [peak] })));
};
let partial = null; t = Date.now();
r = await osm.findNearby(46, 7, 10_000, p => { partial = { p, at: Date.now() - t }; });
assert(partial?.p.length === 1 && partial.p[0].kind === 'peak' && partial.at < 300, `partial points first at ${partial?.at}ms`);
assert(r.places.length === 2 && !r.cached && !r.missing, `full result: ${r.places.map(p => p.kind)}`);
t = Date.now(); r = await osm.findNearby(46.001, 7.001, 10_000);
assert(r.cached && r.places.length === 2 && Date.now() - t < 50, `nearby re-search (≈140 m away) → cache hit in ${Date.now() - t}ms`);
r = await osm.findNearby(46.2, 7, 10_000);
assert(!r.cached, 'search 22 km away → cache miss');
r = await osm.findNearby(46, 7, 3_000);
assert(!r.cached, '3 km search inside a 10 km cached one → miss (cached area >2× bigger)');

// 6. Trails fail, points ok → returns points with missing='trails', not cached.
const peak10 = { ...peak, lat: 10.001, lon: 10.001 };
globalThis.fetch = (url, opts) => opts.body.get('data').includes('relation[') ? Promise.resolve(new Response('', { status: 504 })) : Promise.resolve(new Response(JSON.stringify({ elements: [peak10] })));
r = await osm.findNearby(10, 10, 10_000);
assert(r.missing === 'trails' && r.places.length === 1, 'trails fail → points kept, missing=trails');
r = await osm.findNearby(10, 10, 10_000);
assert(!r.cached, 'partial result not cached');

// 7. routeGeometry caches.
let n = 0;
globalThis.fetch = () => { n++; return Promise.resolve(new Response(JSON.stringify({ elements: [{ type: 'way', geometry: [{ lat: 46.123456789, lon: 7.1 }, { lat: 46.13, lon: 7.11 }] }] }))); };
const g1 = await osm.routeGeometry('relation', 99); await sleep(50);
const g2 = await osm.routeGeometry('relation', 99);
assert(n === 1 && g2.lines[0][0][0] === 46.12346 && g1.lengthM > 0, `route cached (fetches=${n}, len=${Math.round(g2.lengthM)} m)`);

// 8. Real network: one live nearby search (Yosemite Valley, 5 km).
globalThis.fetch = realFetch;
t = Date.now(); let pAt;
try {
  r = await osm.findNearby(37.7456, -119.5936, 5000, () => { pAt = Date.now() - t; });
  console.log(`live: ${r.places.length} places (${r.places.filter(p => p.kind === 'route').length} trails), partial at ${pAt ?? '-'}ms, total ${Date.now() - t}ms, missing=${r.missing}`);
} catch (e) { console.log('live search failed:', e.message, `${Date.now() - t}ms`); }
process.exit();
