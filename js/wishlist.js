// Wishlist storage: places you want to hike someday.

import { db } from './db.js';
import { emit } from './util.js';

export const listSaved = async () => (await db.all('saved')).sort((a, b) => b.addedAt - a.addedAt);

export const isSaved = async id => !!(await db.get('saved', id));

export async function removeSaved(id) {
  await db.del('saved', id);
  emit('saved-changed');
}

// Returns true if the place is now saved.
export async function toggleSaved(place) {
  if (await isSaved(place.id)) {
    await removeSaved(place.id);
    return false;
  }
  // Scores and reasons depend on where you searched from, so don't freeze them.
  const { score, reasons, awayM, visited, ...rest } = place;
  await db.put('saved', { ...rest, addedAt: Date.now() });
  emit('saved-changed');
  return true;
}
