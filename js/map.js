// Leaflet helpers. Leaflet itself is loaded as a global (L) from index.html.

import { settings } from './util.js';

const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Your own track: bold rust. Public trails: dashed brown, like a paper trail map.
export const TRACK_STYLE = { color: '#e0702e', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' };
export const ROUTE_STYLE = { color: '#6b3f1d', weight: 4, opacity: 0.9, dashArray: '9 7' };
export const US_CENTER = [39.8, -98.6];

export function makeMap(el, options = {}) {
  const map = L.map(el, { zoomControl: false, ...options });
  // crossOrigin lets the service worker cache tiles for offline use on the trail.
  const base = {
    Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc',
      maxZoom: 17,
      crossOrigin: true,
      attribution: `${ATTR_OSM}, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a>`,
    }),
    Streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: ATTR_OSM,
    }),
  };
  base[settings.get('mapStyle') === 'streets' ? 'Streets' : 'Topo'].addTo(map);
  L.control.layers(base, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', e => settings.set('mapStyle', e.name === 'Streets' ? 'streets' : 'topo'));
  return map;
}

export function trackLayer(segments) {
  const group = L.featureGroup(
    segments.filter(s => s.length).map(s => L.polyline(s.map(p => [p[0], p[1]]), TRACK_STYLE)));
  const first = segments.find(s => s.length);
  const last = [...segments].reverse().find(s => s.length);
  if (first) {
    L.circleMarker([first[0][0], first[0][1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#4c7a4f', fillOpacity: 1 }).addTo(group);
    const end = last.at(-1);
    L.circleMarker([end[0], end[1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#cf5b45', fillOpacity: 1 }).addTo(group);
  }
  return group;
}

export function pinIcon(emoji, extraClass = '') {
  return L.divIcon({
    className: `pin ${extraClass}`,
    html: emoji,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export const hereStyle = { radius: 8, color: '#fff', weight: 3, fillColor: '#2b7bd6', fillOpacity: 1 };
export const accuracyStyle = { color: '#2b7bd6', weight: 1, fillOpacity: 0.12, interactive: false };
