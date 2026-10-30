// Entry point: wires up the menu and starts each view.

import { $, h, on, settings, toast, pushOverlay } from './util.js';
import * as track from './track.js';
import * as hikes from './hikes.js';
import * as explore from './explore.js';
import * as pack from './pack.js';
import * as saved from './saved.js';
import * as me from './me.js';

const VIEWS = { track, hikes, explore, pack, saved, me };
const TITLES = { track: 'Track', hikes: 'My hikes', explore: 'Explore', pack: 'Packing list', saved: 'Wishlist', me: 'Me' };

let current = null;
let recording = 'idle';

function show(name) {
  if (!VIEWS[name]) name = 'track';
  current = name;
  for (const key of Object.keys(VIEWS)) {
    $(`#view-${key}`).hidden = key !== name;
    const item = $(`.drawer [data-tab="${key}"]`);
    item.classList.toggle('active', key === name);
    if (key === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  $('#title').textContent = TITLES[name];
  drawRecording();
  try {
    VIEWS[name].onShow?.();
  } catch (err) {
    console.error(err);
  }
  settings.set('tab', name);
}

// ---------- Slide-out menu ----------

let menuOpen = false;

function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#menu-btn').setAttribute('aria-expanded', 'true');
  pushOverlay(menuClosed);
  setTimeout(() => $('.drawer .active')?.focus(), 50);
}

// Closing goes through history so Android's back button and the menu stay in sync.
function closeMenu() {
  if (menuOpen) history.back();
}

function menuClosed() {
  menuOpen = false;
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
}

// While recording, a header badge links back to Track from any other page.
function drawRecording() {
  const active = recording !== 'idle';
  const pill = $('#rec-pill');
  pill.hidden = !active || current === 'track';
  pill.textContent = recording === 'paused' ? '❚❚ Paused' : '● REC';
  pill.classList.toggle('paused', recording === 'paused');
  $('.drawer .rec-dot').hidden = !active;
  $('.drawer .rec-dot').textContent = recording === 'paused' ? '❚❚ Paused' : '● REC';
}

async function main() {
  if (!window.L) {
    toast('Map library failed to load. Connect to the internet once so the app can cache it.', 8000);
    return;
  }
  // One page failing to start must not take the other pages down with it.
  for (const [name, view] of Object.entries(VIEWS)) {
    try {
      await view.init();
    } catch (err) {
      console.error(`${name} failed to start`, err);
      $(`#view-${name}`).replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'empty-icon' }, '⚠️'),
        h('p', {}, h('strong', {}, 'This page couldn\'t load')),
        h('p', { class: 'muted small' }, err.message)));
    }
  }
  $('#menu-btn').onclick = openMenu;
  $('#scrim').onclick = closeMenu;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  document.querySelectorAll('.drawer [data-tab]').forEach(btn =>
    btn.addEventListener('click', () => {
      closeMenu();
      show(btn.dataset.tab);
    }));
  $('#rec-pill').onclick = () => show('track');
  on('show-tab', show);
  on('recording', status => { recording = status; drawRecording(); });
  recording = track.status();
  // Always reopen on Track if a hike is in progress.
  show(track.isActive() ? 'track' : settings.get('tab') || 'track');

  if ('serviceWorker' in navigator) {
    // When an updated version takes over, reload once so every file is from the same version.
    // Never in the middle of a recording; the update simply applies next time.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      if (track.isActive()) return toast('Blaze updated. Changes apply after this hike.');
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker failed', err));
  }
}

main().catch(err => {
  console.error(err);
  toast(`Something went wrong: ${err.message}`, 8000);
});
