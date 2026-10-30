// Wishlist view.

import { $, h, on, toast, fmtDist, fmtDate } from './util.js';
import { KINDS } from './recommend.js';
import { listSaved, removeSaved } from './wishlist.js';
import { openPlaceDetail, directionsUrl } from './place.js';
import { newManualHike } from './hikes.js';

export async function init() {
  on('saved-changed', render);
  on('units', render);
  await render();
}

async function render() {
  const items = await listSaved();
  const list = $('#saved-list');
  if (!items.length) {
    list.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, '⭐'),
      h('p', {}, h('strong', {}, 'Your wishlist is empty')),
      h('p', { class: 'muted' }, 'Find places in Explore and tap ☆ to save them for later.')));
    return;
  }
  list.replaceChildren(...items.map(card));
}

function card(p) {
  const kind = KINDS[p.kind];
  const info = [kind.label, p.lengthM ? fmtDist(p.lengthM) : null, `saved ${fmtDate(p.addedAt)}`].filter(Boolean).join(' · ');
  return h('div', { class: 'card saved-card' },
    h('div', { class: 'place-card' },
      h('button', { class: 'card-main', onclick: () => openPlaceDetail(p) },
        h('span', { class: 'kind-emoji' }, kind.emoji),
        h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted small' }, info)))),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn small primary', onclick: () => logIt(p) }, '✓ I hiked it'),
      h('a', { class: 'btn small', href: directionsUrl(p), target: '_blank', rel: 'noopener' }, '🚗 Directions'),
      h('button', { class: 'btn small ghost', onclick: () => removeSaved(p.id) }, 'Remove')));
}

// Turn a wishlist place into a logged hike, then take it off the list.
function logIt(p) {
  const tag = KINDS[p.kind].tag;
  newManualHike(
    { name: p.name, location: [p.lat, p.lon], distanceM: p.lengthM || 0, tags: tag ? [tag] : [] },
    {
      onSaved: async () => {
        await removeSaved(p.id);
        toast('Nice! Moved from your wishlist to your hikes.');
      },
    });
}
