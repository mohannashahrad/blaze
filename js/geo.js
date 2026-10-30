// Pure geometry and track math (no DOM, so it can be unit-tested in Node).
// A track point is [lat, lon, altitude|null, timeMs|null, accuracyM|null].
// A hike's track is a list of segments (one per pause/resume), each a list of points.

const R = 6371008.8;
const rad = d => (d * Math.PI) / 180;

// Ignore altitude wobble smaller than this when counting climb; GPS altitude is noisy.
const CLIMB_THRESHOLD = 6;
// Slower than this between two fixes counts as standing still.
const MOVING_SPEED = 0.3;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

export function trackStats(segments) {
  let distanceM = 0, movingS = 0, gainM = 0, lossM = 0;
  let first = null, last = null;
  for (const seg of segments || []) {
    let ref = null;
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      first ??= p;
      last = p;
      const alt = p[2];
      if (alt != null) {
        if (ref == null) ref = alt;
        else if (alt - ref >= CLIMB_THRESHOLD) { gainM += alt - ref; ref = alt; }
        else if (ref - alt >= CLIMB_THRESHOLD) { lossM += ref - alt; ref = alt; }
      }
      if (i > 0) {
        const q = seg[i - 1];
        const d = haversine(q, p);
        distanceM += d;
        if (p[3] != null && q[3] != null) {
          const dt = (p[3] - q[3]) / 1000;
          if (dt > 0 && dt < 300 && d / dt > MOVING_SPEED) movingS += dt;
        }
      }
    }
  }
  const elapsedS = first?.[3] != null && last?.[3] != null ? (last[3] - first[3]) / 1000 : 0;
  return {
    distanceM: Math.round(distanceM),
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    movingS: Math.round(movingS),
    elapsedS: Math.round(elapsedS),
  };
}

export function firstPoint(segments) {
  for (const seg of segments || []) if (seg.length) return seg[0];
  return null;
}

// Where a hike happened: start of its track, or the spot picked for a manual entry.
export function hikeLocation(hike) {
  const p = firstPoint(hike.segments);
  return p ? [p[0], p[1]] : hike.location ?? null;
}

// A thinned-out set of [lat, lon] along a hike, for "have I been here?" checks.
export function samplePoints(hike, max = 60) {
  const pts = (hike.segments || []).flat();
  if (!pts.length) return hike.location ? [hike.location] : [];
  const step = Math.max(1, Math.ceil(pts.length / max));
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push([pts[i][0], pts[i][1]]);
  return out;
}

// [[distanceFromStartM, altitudeM]], lightly smoothed.
export function elevationProfile(segments, window = 7) {
  const raw = [];
  let d = 0;
  for (const seg of segments || []) {
    for (let i = 0; i < seg.length; i++) {
      if (i > 0) d += haversine(seg[i - 1], seg[i]);
      if (seg[i][2] != null) raw.push([d, seg[i][2]]);
    }
  }
  const half = Math.floor(window / 2);
  return raw.map(([x], i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(raw.length, i + half + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += raw[j][1];
    return [x, sum / (hi - lo)];
  });
}

// OSM "distance" tags look like "12.5", "12.5 km", "7 mi". Bare numbers are km.
export function parseDistance(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(km|miles?|mi|m)?\b/i.exec(String(text ?? ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] || 'km').toLowerCase();
  if (!(n > 0)) return null;
  return Math.round(unit.startsWith('mi') ? n * 1609.344 : unit === 'm' ? n : n * 1000);
}
