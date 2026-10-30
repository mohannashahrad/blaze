// Ranks public places (from OpenStreetMap) against what your own hike log says you enjoy.
// Pure functions, no DOM.

import { haversine, samplePoints } from './geo.js';

export const KINDS = {
  route: { label: 'Trail', emoji: '🥾', tag: null },
  peak: { label: 'Peak', emoji: '⛰️', tag: 'summit' },
  waterfall: { label: 'Waterfall', emoji: '💧', tag: 'waterfall' },
  viewpoint: { label: 'Viewpoint', emoji: '🔭', tag: 'views' },
  lake: { label: 'Lake', emoji: '🏞️', tag: 'lake' },
  trailhead: { label: 'Trailhead', emoji: '🅿️', tag: null },
  camp: { label: 'Campground', emoji: '⛺', tag: 'camping' },
  park: { label: 'Park', emoji: '🌲', tag: 'forest' },
  place: { label: 'Place', emoji: '📍', tag: null },
};

// Baseline appeal before personal taste: actual trails beat a parking lot.
const KIND_PRIOR = { route: 10, peak: 6, waterfall: 6, viewpoint: 4, park: 4, lake: 2, camp: 2, trailhead: 0, place: 0 };

const TAG_PHRASE = { summit: 'summit hikes', waterfall: 'waterfalls', views: 'big views', lake: 'lake hikes', camping: 'camping trips', forest: 'forest hikes' };

// Within this many metres of somewhere you've logged counts as "been there".
const VISITED_RADIUS = 600;

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function buildProfile(hikes) {
  const rated = hikes.filter(h => h.rating > 0);
  const avgRating = rated.length ? mean(rated.map(h => h.rating)) : 3;

  const byTag = {};
  for (const hike of hikes) {
    for (const tag of hike.tags || []) {
      byTag[tag] ??= { n: 0, ratings: [] };
      byTag[tag].n++;
      if (hike.rating) byTag[tag].ratings.push(hike.rating);
    }
  }
  // Affinity in [-1, 1]: how often you pick it, nudged by how you rate it vs. your average.
  const affinity = {};
  for (const [tag, s] of Object.entries(byTag)) {
    const freq = s.n / hikes.length;
    const ratingDelta = s.ratings.length ? (mean(s.ratings) - avgRating) / 2 : 0;
    affinity[tag] = clamp(freq * 0.6 + ratingDelta, -1, 1);
  }

  const distances = hikes.map(h => h.distanceM).filter(d => d > 0).sort((a, b) => a - b);
  const preferredM = distances.length ? distances[Math.floor(distances.length / 2)] : 8000;

  return {
    count: hikes.length,
    affinity,
    preferredM,
    hasDistances: distances.length > 0,
    likesLoops: (affinity.loop ?? 0) > 0.2,
    visited: hikes.flatMap(h => samplePoints(h, 60)),
  };
}

export function scorePlace(place, profile, origin, radiusM, savedIds = new Set()) {
  const here = [place.lat, place.lon];
  const reasons = [];
  let score = 50 + (KIND_PRIOR[place.kind] ?? 0);

  const tag = KINDS[place.kind]?.tag;
  const aff = tag ? profile.affinity[tag] ?? 0 : 0;
  if (aff) {
    score += aff * 25;
    if (aff > 0.25) reasons.push(`You love ${TAG_PHRASE[tag]}`);
  }

  if (place.lengthM) {
    const r = Math.log(place.lengthM / profile.preferredM);
    const fit = Math.exp(-(r * r) / 0.35); // 1 when it matches your usual distance
    score += (fit - 0.4) * 25;
    if (profile.hasDistances) {
      if (fit > 0.6) reasons.push('About your usual distance');
      else if (r > 0.7) reasons.push('Longer than you usually go');
      else if (r < -0.7) reasons.push('Shorter than your usual');
    }
  }

  if (place.kind === 'route' && place.roundtrip && profile.likesLoops) {
    score += 6;
    reasons.push('A loop — you like those');
  }

  const awayM = origin ? haversine(origin, here) : null;
  if (radiusM && awayM != null) score -= (awayM / radiusM) * 18;

  const visited = profile.visited.some(v => haversine(v, here) < VISITED_RADIUS);
  if (visited) {
    score -= 25;
    reasons.push("You've hiked here");
  } else if (profile.count) {
    score += 5;
    reasons.push('Somewhere new');
  }

  if (savedIds.has(place.id)) reasons.push('On your wishlist');

  return { ...place, score: Math.round(clamp(score, 1, 99)), awayM, visited, reasons };
}
