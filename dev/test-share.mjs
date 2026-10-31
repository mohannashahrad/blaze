// Tests for reading what other apps share to Blaze (js/share.js parseShare / guessKind). Not part of the app.
// Run: node dev/test-share.mjs
// share.js imports DOM-using modules, so give them just enough of a browser to load.
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.L = {}; globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null, documentElement: { dataset: {} } };
const { parseShare, guessKind } = await import(new URL('../js/share.js', import.meta.url));

let failed = 0;
const eq = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', label, ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};
const pick = (r, ...keys) => Object.fromEntries(keys.map(k => [k, r[k]]));

// Google Maps on Android, a named place: name, address and a short link in the text.
eq(pick(parseShare({ title: null, text: 'Mist Trail\nYosemite Valley, CA 95389\nhttps://maps.app.goo.gl/AbC123xyz', url: null }), 'name', 'address', 'coords', 'url'),
  { name: 'Mist Trail', address: 'Yosemite Valley, CA 95389', coords: null, url: 'https://maps.app.goo.gl/AbC123xyz' }, 'Maps place: name + address + short link');
// Same with the name also in the title (some versions do both).
eq(pick(parseShare({ title: 'Mist Trail', text: 'Mist Trail\nhttps://maps.app.goo.gl/AbC', url: '' }), 'name', 'address'),
  { name: 'Mist Trail', address: '' }, 'title duplicates the first line');
// Link only, in the url field.
eq(pick(parseShare({ title: '', text: '', url: 'https://maps.app.goo.gl/AbC' }), 'name', 'coords', 'url'),
  { name: '', coords: null, url: 'https://maps.app.goo.gl/AbC' }, 'short link only');
// Dropped pin: coordinates in a q= link.
eq(pick(parseShare({ text: 'Dropped pin\nhttps://maps.google.com/?q=37.745612,-119.593601' }), 'name', 'coords'),
  { name: '', coords: [37.745612, -119.593601] }, 'dropped pin with ?q=lat,lon');
// Full place link: !3d!4d (the place) wins over @ (the map center).
eq(parseShare({ text: 'Half Dome https://www.google.com/maps/place/Half+Dome/@37.74,-119.6,13z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d37.7459!4d-119.5332' }).coords,
  [37.7459, -119.5332], 'full place link prefers !3d!4d over @');
eq(parseShare({ text: 'https://www.google.com/maps/@46.5,7.9,12z' }).coords, [46.5, 7.9], 'map link with only @center');
// URL-encoded comma, and coordinates typed as text.
eq(parseShare({ text: 'https://www.google.com/maps/search/?api=1&query=46.0207%2C7.7491' }).coords, [46.0207, 7.7491], 'encoded comma in query=');
eq(parseShare({ text: '37.7456, -119.5936' }).coords, [37.7456, -119.5936], 'bare coordinates');
// Nonsense numbers are not coordinates; quotes are stripped.
eq(parseShare({ text: '“Lost Lake”\nhttps://example.com/?q=123.4,567.8' }).coords, null, 'out-of-range numbers ignored');
eq(parseShare({ text: '“Lost Lake”\nhttps://example.com/x' }).name, 'Lost Lake', 'quotes stripped from name');

eq(['Mist Trail', 'Yosemite Falls', 'Half Dome', 'Mt. Tamalpais', 'Lake Agnes', 'Glacier Point Overlook', 'Upper Pines Campground', 'Muir Woods National Monument', 'Mosaic Canyon Trailhead', 'Bridalveil Fall']
  .map(guessKind), ['route', 'waterfall', 'peak', 'peak', 'lake', 'viewpoint', 'camp', 'place', 'trailhead', 'waterfall'], 'guessKind');

process.exitCode = failed ? 1 : 0;
