# Handoff: Explore speed-ups ("quick wins")

Status as of 2026-10-31: **steps 1, 2 and 4 done; waiting for the user's go-ahead to commit (step 3) and deploy (step 5).**
Browser check (headless Chrome, Overpass answered from sample data): partial results at 1.6 s, repeat search 0.3 s
with no Overpass request, cached trail line drawn without a request, offline reload works with the last 9 places.
Live Overpass from this Mac still fails, even in real Chrome (502s and hangs), so check on the phone after deploying.
Delete this file once the work is shipped.

## Goal

Make Explore feel faster without adding a backend. These are the four quick wins:

1. **Hedged Overpass requests.** Don't wait on servers one at a time with a 60 s timeout each.
2. **Cache nearby results by area**, so searching the same area again is instant and works offline.
3. **Shorter timeouts and partial results.** Show peaks, lakes and the like while trails are still loading.
4. **Serve Leaflet and the Bitter font with the app**, instead of loading them from unpkg and Google Fonts.

The bigger plan (backend with PostGIS, Supabase accounts and sync, Capacitor native app) comes **after** this
work and hasn't been started.

## What changed (uncommitted on `main`)

| File | Change |
| --- | --- |
| `js/osm.js` | `overpass()` now hedges: it asks server 1, then adds the next server whenever none has answered for 4 s (`HEDGE_MS`), or immediately when one fails. The first good answer wins and the others are aborted. Each server gets 30 s on the client (`TIMEOUT_MS`), and queries declare `[timeout:25]` to the server. Worst case is now about 38 s instead of 180 s. |
| `js/osm.js` | The nearby search is split into **two parallel queries**: `trailsQuery` (route relations, the slow part) and `pointsQuery` (peaks, waterfalls, viewpoints, trailheads, lakes, campsites). `findNearby(lat, lon, radiusM, onPartial)` now returns `{ places, cached, missing }`. `onPartial` receives the points if they arrive before the trails. `missing` is `'trails'` or `'places'` when only one half came back. |
| `js/osm.js` | **Area cache**: `kv['nearbyCache']` holds the last 12 *complete* searches for 7 days. A cached search is reused when its circle covers the new one (with 5 % slack for GPS jitter) and its radius is at most 2× the new radius, because the per-kind result limits would otherwise drop places. Partial results are never cached. |
| `js/osm.js` | **Trail-line cache**: `routeGeometry()` stores lines in `kv['route:<type>/<id>']` for the last 50 trails opened, with the list of keys in `kv['routeCacheKeys']`. Coordinates are rounded to 5 decimals. |
| `js/explore.js` | `searchNearby()` shows partial results with the button label "Finding trails…", then the full list. When one half fails, it shows a toast saying which. The old label "can take a minute" is gone. |
| `vendor/leaflet/` | Leaflet 1.9.4 `leaflet.js` and `leaflet.css` (checked against the original SRI hashes) plus `images/`. |
| `vendor/fonts/` | Bitter variable font, Latin and Latin-ext woff2 subsets (OFL licence). One file covers weights 600–700. |
| `index.html` | Loads Leaflet and the font locally and preloads `bitter-latin.woff2`. No more unpkg or Google Fonts tags. |
| `css/styles.css` | Two `@font-face` rules at the top for the local Bitter files. |
| `sw.js` | `VERSION` bumped to `blaze-v8`. Vendored files added to `SHELL`. The unpkg/Google Fonts `library()` handler is removed. |
| `js/place.js` | The trail line is fitted only after the map is sized (320 ms) and only if the sheet is still open. A cached line arrived before the resize and caused a Leaflet `_leaflet_pos` error. |
| `js/db.js` | Comment only: lists what `kv` now holds. The backup in `me.js` does not export `kv`, so the caches don't bloat backups. |
| `dev/test-osm.mjs` | Node tests for all of the above, using a fake `fetch` and `fake-indexeddb`. Not part of the app. |

## How to continue

1. **Run the mocked tests** (12 checks, all passing at handoff):
   ```bash
   cd dev && npm i --no-save fake-indexeddb@6 && cd ..
   node dev/test-osm.mjs
   ```
   The last line ("live …") is a real Overpass search. **It fails from Node/curl on this Mac**:
   `overpass-api.de` returns 406 and `overpass.kumi.systems` returns 429 ("include a meaningful User-Agent").
   `overpass.private.coffee` timed out. So the live check has to be done in a browser (step 2).
2. **Test in a real browser**: run `python3 -m http.server 8000`, open <http://localhost:8000>, and use DevTools.
   - Network tab: there should be no requests to unpkg.com or fonts.googleapis.com. Leaflet, the layer switcher icon and the heading font should load from `vendor/`.
   - Explore → *Near me* (set a location under DevTools → Sensors): peaks and lakes should appear first with "Finding trails…", then the trails.
   - Search the same spot again: the results should be instant. In Network, there should be no Overpass request.
   - Open a trail, close it, and open it again: the second time the line should draw instantly.
   - Application → Service workers: `blaze-v8` should install. Go offline and reload: the app, the map controls and the font should still work.
   - If the hedging fires too often (two Overpass requests on most searches), raise `HEDGE_MS`.
3. **Review the diff** (`git diff`), then commit on a branch and open a PR. The user hasn't asked for a commit yet, so ask first.
   `dev/.gitignore` already keeps `dev/node_modules/` out of git.
4. **Update `README.md`**: the "Overpass … can take up to a minute" note, the "Tech" list (Leaflet now served from
   `vendor/`), and the file tree (`vendor/`, `dev/`).
5. **Deploy**: pushing to `main` updates GitHub Pages at <https://mohannashahrad.github.io/blaze/>. The `VERSION` bump
   makes installed phones pick up the update on their own.

## Known limits and open questions

- The free Overpass servers themselves are still the limit. These changes cut waiting time but can't fix a busy server.
  The real fix is the planned backend with its own trail database.
- The area cache trims trails by their *center* within √2 × radius, which approximates the bounding-box search.
- When partial results arrive, the map fits twice, once for the points and once more with the trails. If that jump bothers you, skip the first `fitResults()`.
