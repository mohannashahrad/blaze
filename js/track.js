// Live GPS recording.

import { $, on, emit, toast, uid, fmtClock, fmtPace, fmtElev, distValue, distUnit, elevValue, elevUnit } from './util.js';
import { db } from './db.js';
import { haversine, trackStats } from './geo.js';
import { makeMap, TRACK_STYLE, hereStyle, accuracyStyle, US_CENTER } from './map.js';
import { getForecast, weatherLine } from './weather.js';
import { openHikeEditor } from './hikes.js';

const MAX_ACCURACY = 35;   // m — fixes fuzzier than this are skipped
const MIN_STEP = 4;        // m — smaller moves are GPS jitter while standing still
const SAVE_EVERY = 5_000;  // ms — how often the in-progress track is written to storage

let map, trackGroup, lines = [];
let hereDot = null, accuracyRing = null;
let follow = true, needsFit = false;

// rec: { startedAt, segments: [[point]], elapsedMs, segStartedAt, status: 'recording' | 'paused' }
let rec = null;
let stats = null;
let watchId = null, wakeLock = null, ticker = null;
let lastSave = 0, saveTimer = null, hiddenAt = null;
let lastFix = null, gpsNote = null, sunset = null, weatherLoaded = false;

export const isActive = () => !!rec;
export const status = () => rec?.status ?? 'idle';

export async function init() {
  map = makeMap($('#track-map'));
  map.setView(US_CENTER, 4);
  trackGroup = L.featureGroup().addTo(map);
  map.on('dragstart', () => { follow = false; });

  $('#btn-recenter').onclick = () => {
    follow = true;
    if (lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 15));
    else locateOnce();
  };
  $('#btn-start').onclick = start;
  $('#btn-pause').onclick = pause;
  $('#btn-resume').onclick = resume;
  $('#btn-finish').onclick = finish;
  $('#btn-discard').onclick = discard;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => persist(true));
  on('units', render);

  // Pick up a hike that was in progress when the app was closed or crashed.
  const saved = await db.get('kv', 'active');
  if (saved) {
    rec = saved;
    stats = trackStats(rec.segments);
    drawTrack();
    needsFit = true;
    toast('Picked up your unfinished hike. Resume or finish it.');
  }
  render();
}

export function onShow() {
  setTimeout(() => {
    map.invalidateSize();
    if (needsFit && trackGroup.getLayers().length) {
      const b = trackGroup.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
      needsFit = false;
    }
  }, 0);
  if (!lastFix) locateOnce();
}

// ---------- Recording lifecycle ----------

function start() {
  if (!('geolocation' in navigator)) return toast('This device has no GPS access.');
  rec = { startedAt: Date.now(), segments: [[]], elapsedMs: 0, segStartedAt: Date.now(), status: 'recording' };
  stats = trackStats([]);
  follow = true;
  drawTrack();
  beginWatch();
  persist(true);
  render();
}

function pause() {
  rec.elapsedMs = elapsedMs();
  rec.segStartedAt = null;
  rec.status = 'paused';
  endWatch();
  persist(true);
  render();
}

function resume() {
  rec.segments.push([]);
  lines.push(L.polyline([], TRACK_STYLE).addTo(trackGroup));
  rec.segStartedAt = Date.now();
  rec.status = 'recording';
  follow = true;
  beginWatch();
  persist(true);
  render();
}

async function finish() {
  if (rec.status === 'recording') pause();
  const segments = rec.segments.filter(s => s.length);
  const points = segments.reduce((n, s) => n + s.length, 0);
  if (points < 2) {
    if (confirm('No GPS track was recorded yet. Discard this hike?')) await clearRecording();
    return;
  }
  const s = trackStats(segments);
  openHikeEditor({
    id: uid(),
    source: 'gps',
    startedAt: rec.startedAt,
    segments,
    distanceM: s.distanceM,
    gainM: s.gainM,
    lossM: s.lossM,
    movingS: s.movingS,
    durationS: Math.round(elapsedMs() / 1000),
    name: '',
    rating: 0,
    difficulty: null,
    tags: [],
    notes: '',
  }, { isNew: true, onSaved: clearRecording });
}

async function discard() {
  if (confirm('Discard this hike? The recorded track will be lost.')) await clearRecording();
}

async function clearRecording() {
  endWatch();
  clearTimeout(saveTimer);
  saveTimer = null;
  rec = null;
  stats = null;
  trackGroup.clearLayers();
  lines = [];
  await db.del('kv', 'active');
  render();
}

function elapsedMs() {
  if (!rec) return 0;
  return rec.elapsedMs + (rec.status === 'recording' && rec.segStartedAt ? Date.now() - rec.segStartedAt : 0);
}

// Saved as a paused snapshot, so a crash restores cleanly into "Paused".
// Throttled saves leave a trailing one queued, so the last points get written even if you stop moving.
function persist(force = false) {
  if (!rec) return;
  const wait = SAVE_EVERY - (Date.now() - lastSave);
  if (!force && wait > 0) {
    saveTimer ??= setTimeout(() => { saveTimer = null; persist(true); }, wait);
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  lastSave = Date.now();
  db.put('kv', { ...rec, elapsedMs: elapsedMs(), segStartedAt: null, status: 'paused' }, 'active')
    .catch(err => console.error('Could not save track', err));
}

// ---------- GPS ----------

function beginWatch() {
  endWatch();
  watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30_000,
  });
  keepAwake();
  ticker = setInterval(render, 1000);
}

function endWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(ticker);
  ticker = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  gpsNote = null;
}

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
}

function onVisibility() {
  if (rec?.status !== 'recording') return;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    persist(true);
  } else {
    keepAwake();
    if (hiddenAt && Date.now() - hiddenAt > 60_000) {
      toast('Welcome back! GPS may have paused while the app was in the background, so that stretch is drawn as a straight line.', 6000);
    }
    hiddenAt = null;
  }
}

function onPosition(pos) {
  const { latitude, longitude, altitude, accuracy } = pos.coords;
  showHere(latitude, longitude, accuracy);
  if (rec?.status !== 'recording') return;

  if (accuracy > MAX_ACCURACY) {
    gpsNote = `Waiting for a better GPS signal (±${fmtElev(accuracy)})…`;
    return render();
  }
  gpsNote = null;

  const point = [
    +latitude.toFixed(6),
    +longitude.toFixed(6),
    altitude == null ? null : Math.round(altitude * 10) / 10,
    pos.timestamp,
    Math.round(accuracy),
  ];
  const seg = rec.segments.at(-1);
  const prev = seg.at(-1);
  if (prev && haversine(prev, point) < Math.max(MIN_STEP, accuracy / 3)) return;

  seg.push(point);
  lines.at(-1).addLatLng([point[0], point[1]]);
  stats = trackStats(rec.segments);
  persist();
  render();
}

function onGeoError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    gpsNote = 'Location permission is off. Allow it in your browser settings to track.';
    toast(gpsNote, 5000);
    render();
  }
  // Timeouts and temporary signal loss: keep waiting; watchPosition retries on its own.
}

function locateOnce() {
  navigator.geolocation?.getCurrentPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    showHere(latitude, longitude, accuracy);
    if (!rec || !trackGroup.getLayers().length) map.setView([latitude, longitude], 15);
    loadWeather(latitude, longitude);
    render();
  }, () => {}, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
}

function showHere(lat, lon, accuracy) {
  lastFix = { lat, lon, accuracy };
  const ll = [lat, lon];
  if (!hereDot) {
    accuracyRing = L.circle(ll, { radius: accuracy, ...accuracyStyle }).addTo(map);
    hereDot = L.circleMarker(ll, hereStyle).addTo(map);
  } else {
    hereDot.setLatLng(ll);
    accuracyRing.setLatLng(ll).setRadius(accuracy);
  }
  if (follow && rec?.status === 'recording') map.panTo(ll);
  if (!weatherLoaded) loadWeather(lat, lon);
}

async function loadWeather(lat, lon) {
  weatherLoaded = true;
  try {
    const [today] = await getForecast(lat, lon);
    sunset = today.sunset;
    $('#track-weather').replaceChildren(weatherLine(today));
  } catch {
    weatherLoaded = false; // offline; try again on the next fix
  }
}

// ---------- Drawing ----------

function drawTrack() {
  trackGroup.clearLayers();
  lines = (rec?.segments ?? []).map(s => L.polyline(s.map(p => [p[0], p[1]]), TRACK_STYLE).addTo(trackGroup));
}

function statusText(status) {
  if (gpsNote) return gpsNote;
  if (status === 'recording') {
    const mins = sunset ? (sunset - Date.now()) / 60000 : Infinity;
    if (mins < 0 && mins > -240) return '🌙 Past sunset. Headlamp time.';
    if (mins < 60) return `🌅 Sunset in ${Math.round(mins)} min. Plan your way back.`;
    return `● Recording${lastFix ? ` · GPS ±${fmtElev(lastFix.accuracy)}` : ''}`;
  }
  if (status === 'paused') return '❚❚ Paused';
  return lastFix ? `GPS ready · ±${fmtElev(lastFix.accuracy)}` : 'Ready when you are';
}

let lastStatus = 'idle';

function render() {
  const status = rec?.status ?? 'idle';
  if (status !== lastStatus) {
    lastStatus = status;
    emit('recording', status);
  }
  $('#btn-start').hidden = status !== 'idle';
  $('#btn-pause').hidden = status !== 'recording';
  $('#btn-resume').hidden = status !== 'paused';
  $('#btn-finish').hidden = status === 'idle';
  $('#btn-discard').hidden = status !== 'paused';
  $('#track-panel').dataset.status = status;

  const s = stats ?? { distanceM: 0, gainM: 0 };
  const secs = elapsedMs() / 1000;
  $('#t-dist').textContent = distValue(s.distanceM).toFixed(2);
  $('#t-dist-u').textContent = distUnit();
  $('#t-time').textContent = fmtClock(secs);
  $('#t-gain').textContent = Math.round(elevValue(s.gainM)).toLocaleString();
  $('#t-gain-u').textContent = elevUnit();
  $('#t-pace').textContent = fmtPace(secs, s.distanceM);
  $('#t-pace-u').textContent = `/${distUnit()}`;
  $('#track-status').textContent = statusText(status);
}
