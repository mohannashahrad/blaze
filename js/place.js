// Detail sheet for a public place (trail, peak, waterfall…): map, forecast, why it was suggested.

import { h, fill, emit, openSheet, fmtDist, fmtElev, toast } from './util.js';
import { makeMap, pinIcon, ROUTE_STYLE } from './map.js';
import { getForecast, forecastCards } from './weather.js';
import { routeGeometry } from './osm.js';
import { KINDS } from './recommend.js';
import { isSaved, toggleSaved } from './wishlist.js';

export const directionsUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
const osmUrl = p => `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`;
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

export function openPlaceDetail(place) {
  const kind = KINDS[place.kind];
  const sheet = openSheet(place.name);
  const mapEl = h('div', { class: 'map map-detail' });
  const weatherEl = h('div', {}, h('p', { class: 'muted small' }, 'Loading forecast…'));
  const lengthEl = h('dd', {}, place.lengthM ? fmtDist(place.lengthM) : '–');

  const saveBtn = h('button', { class: 'btn' });
  const drawSave = saved => {
    saveBtn.textContent = saved ? '★ On wishlist' : '☆ Add to wishlist';
    saveBtn.classList.toggle('primary', !saved);
  };
  saveBtn.onclick = async () => {
    const saved = await toggleSaved(place);
    drawSave(saved);
    toast(saved ? 'Added to your wishlist' : 'Removed from wishlist');
  };
  isSaved(place.id).then(drawSave);

  const t = place.tags || {};
  const facts = [
    place.area && ['Where', place.area],
    place.awayM != null && ['Distance away', `${fmtDist(place.awayM)} (straight line)`],
    place.kind === 'route' && ['Trail length', lengthEl],
    place.eleM != null && ['Elevation', fmtElev(place.eleM)],
    t.from && t.to && ['Runs', `${t.from} → ${t.to}`],
    place.roundtrip && ['Shape', 'Loop'],
    t.operator && ['Managed by', t.operator],
    t.fee && ['Fee', t.fee],
    t.opening_hours && ['Hours', t.opening_hours],
    t.description && ['About', t.description],
    safeUrl(t.website) && ['Website', h('a', { href: t.website, target: '_blank', rel: 'noopener' }, t.website.replace(/^https?:\/\/(www\.)?/, ''))],
  ].filter(Boolean);

  fill(sheet.body,
    mapEl,
    h('div', { class: 'place-head' },
      h('span', { class: 'kind-badge' }, `${kind.emoji} ${kind.label}`),
      place.score != null ? h('span', { class: 'score' }, `${place.score}% match`) : null),
    place.reasons?.length ? h('ul', { class: 'reasons' }, place.reasons.map(r => h('li', {}, r))) : null,
    h('dl', { class: 'facts' }, facts.flatMap(([k, v]) => [h('dt', {}, k), v instanceof Node && v.tagName === 'DD' ? v : h('dd', {}, v)])),
    h('h3', {}, 'Forecast'),
    weatherEl,
    h('div', { class: 'actions' },
      saveBtn,
      h('a', { class: 'btn', href: directionsUrl(place), target: '_blank', rel: 'noopener' }, '🚗 Directions'),
      h('button', {
        class: 'btn',
        onclick: () => {
          sheet.close();
          emit('explore-here', { lat: place.lat, lon: place.lon });
        },
      }, '🧭 Find hikes near here'),
      h('a', { class: 'btn ghost', href: osmUrl(place), target: '_blank', rel: 'noopener' }, 'OpenStreetMap ↗')));

  const map = makeMap(mapEl);
  map.setView([place.lat, place.lon], 13);
  L.marker([place.lat, place.lon], { icon: pinIcon(kind.emoji) }).addTo(map);
  sheet.onClose(() => map.remove());
  setTimeout(() => map.invalidateSize(), 320);

  getForecast(place.lat, place.lon)
    .then(days => weatherEl.replaceChildren(forecastCards(days)))
    .catch(() => weatherEl.replaceChildren(h('p', { class: 'muted small' }, 'Forecast unavailable (offline?).')));

  if (place.osmType === 'relation' || (place.osmType === 'way' && place.kind === 'route')) {
    routeGeometry(place.osmType, place.osmId).then(({ lines, lengthM }) => {
      if (!lines.length) return;
      const layer = L.featureGroup(lines.map(l => L.polyline(l, ROUTE_STYLE))).addTo(map);
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
      if (!place.lengthM && lengthM) lengthEl.textContent = `≈ ${fmtDist(lengthM)} (from map data)`;
    }).catch(() => {});
  }
}
