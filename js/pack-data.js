// Packing checklist content. lists: which trip types an item belongs to.
// Camping includes the day-hike basics, so most items list both.

export const CATEGORIES = [
  { id: 'essentials', title: 'The Ten Essentials', note: 'The classic safety list. Bring these on every hike, even short ones.', tone: 'amber' },
  { id: 'wear', title: 'Wear & carry', tone: 'bark' },
  { id: 'food', title: 'Food & water', tone: 'moss' },
  { id: 'safety', title: 'Safety & extras', tone: 'rust' },
  { id: 'shelter', title: 'Shelter & sleep', tone: 'forest' },
  { id: 'kitchen', title: 'Camp kitchen', tone: 'amber' },
  { id: 'camp', title: 'Camp clothing & hygiene', tone: 'sky' },
  { id: 'custom', title: 'Your own items', tone: 'bark' },
];

const BOTH = ['day', 'camp'];
const CAMP = ['camp'];
const DAY = ['day'];

export const ITEMS = [
  // The Ten Essentials
  { id: 'nav', cat: 'essentials', emoji: '🧭', name: 'Navigation', note: 'Map, compass, or offline maps on your phone', lists: BOTH },
  { id: 'headlamp', cat: 'essentials', emoji: '🔦', name: 'Headlamp', note: 'Plus spare batteries, even on day hikes', lists: BOTH },
  { id: 'sun', cat: 'essentials', emoji: '🕶️', name: 'Sun protection', note: 'Sunscreen, sunglasses, hat, lip balm', lists: BOTH },
  { id: 'firstaid', cat: 'essentials', emoji: '🩹', name: 'First-aid kit', note: 'Include blister care and any personal meds', lists: BOTH },
  { id: 'knife', cat: 'essentials', emoji: '🔪', name: 'Knife or multitool', note: 'And a little duct tape for repairs', lists: BOTH },
  { id: 'fire', cat: 'essentials', emoji: '🔥', name: 'Fire starter', note: 'Lighter, waterproof matches, fire starter', lists: BOTH },
  { id: 'shelter', cat: 'essentials', emoji: '🆘', name: 'Emergency shelter', note: 'Space blanket or emergency bivy', lists: BOTH },
  { id: 'xfood', cat: 'essentials', emoji: '🍫', name: 'Extra food', note: 'More than you plan to eat', lists: BOTH },
  { id: 'xwater', cat: 'essentials', emoji: '💧', name: 'Extra water', note: 'Plus a filter or purification tablets', lists: BOTH },
  { id: 'xclothes', cat: 'essentials', emoji: '🧥', name: 'Extra layer', note: 'An insulating layer beyond what you expect to need', lists: BOTH },

  // Wear & carry
  { id: 'boots', cat: 'wear', emoji: '🥾', name: 'Hiking boots or trail shoes', note: 'Broken in before the trip', lists: BOTH },
  { id: 'socks', cat: 'wear', emoji: '🧦', name: 'Wool or synthetic socks', note: 'Skip cotton: it stays wet and causes blisters', lists: BOTH },
  { id: 'daypack', cat: 'wear', emoji: '🎒', name: 'Daypack', note: '15–30 L is plenty', lists: DAY },
  { id: 'backpack', cat: 'wear', emoji: '🎒', name: 'Backpacking pack', note: '40–65 L, adjusted to fit', lists: CAMP },
  { id: 'rain', cat: 'wear', emoji: '🌧️', name: 'Rain jacket', note: 'Doubles as a wind layer', lists: BOTH },
  { id: 'poles', cat: 'wear', emoji: '🚶', name: 'Trekking poles', note: 'Easier on the knees going downhill', lists: BOTH },

  // Food & water
  { id: 'bottles', cat: 'food', emoji: '🥤', name: 'Water bottles or bladder', note: 'About 0.5 L per hour of hiking', lists: BOTH },
  { id: 'snacks', cat: 'food', emoji: '🥜', name: 'Trail snacks', note: 'Mix salty and sweet', lists: BOTH },
  { id: 'lunch', cat: 'food', emoji: '🥪', name: 'Lunch', lists: DAY },
  { id: 'electrolytes', cat: 'food', emoji: '🧂', name: 'Electrolytes', note: 'For hot days and big climbs', lists: BOTH },

  // Safety & extras
  { id: 'phone', cat: 'safety', emoji: '📱', name: 'Phone, fully charged', note: 'Download offline maps before you lose signal', lists: BOTH },
  { id: 'battery', cat: 'safety', emoji: '🔋', name: 'Power bank and cable', lists: BOTH },
  { id: 'whistle', cat: 'safety', emoji: '📣', name: 'Whistle', note: 'Three blasts means "help"', lists: BOTH },
  { id: 'bugs', cat: 'safety', emoji: '🦟', name: 'Bug spray', lists: BOTH },
  { id: 'bearspray', cat: 'safety', emoji: '🐻', name: 'Bear spray', note: 'In bear country; keep it on your hip, not in the pack', lists: BOTH },
  { id: 'plan', cat: 'safety', emoji: '📝', name: 'Tell someone your plan', note: 'Where you\'re going and when you\'ll be back', lists: BOTH },
  { id: 'id', cat: 'safety', emoji: '🪪', name: 'ID, cash, park pass', lists: BOTH },
  { id: 'trash', cat: 'safety', emoji: '🗑️', name: 'Trash bag', note: 'Pack it in, pack it out', lists: BOTH },

  // Shelter & sleep
  { id: 'tent', cat: 'shelter', emoji: '⛺', name: 'Tent', note: 'Body, poles, stakes, rainfly, footprint', lists: CAMP },
  { id: 'bag', cat: 'shelter', emoji: '🛌', name: 'Sleeping bag', note: 'Rated below the forecast low', lists: CAMP },
  { id: 'pad', cat: 'shelter', emoji: '🛏️', name: 'Sleeping pad', note: 'Insulation from the cold ground matters as much as the bag', lists: CAMP },
  { id: 'pillow', cat: 'shelter', emoji: '💤', name: 'Pillow', note: 'Or a stuff sack filled with clothes', lists: CAMP },
  { id: 'cord', cat: 'shelter', emoji: '🪢', name: 'Rope or cord', note: 'Hanging food, drying lines, repairs', lists: CAMP },

  // Camp kitchen
  { id: 'stove', cat: 'kitchen', emoji: '🍳', name: 'Stove and fuel', note: 'Test it at home first', lists: CAMP },
  { id: 'pot', cat: 'kitchen', emoji: '🍲', name: 'Pot and utensils', note: 'A spork covers most of it', lists: CAMP },
  { id: 'mug', cat: 'kitchen', emoji: '☕', name: 'Mug', lists: CAMP },
  { id: 'meals', cat: 'kitchen', emoji: '🍝', name: 'Meals', note: 'One per meal, plus a spare', lists: CAMP },
  { id: 'filter', cat: 'kitchen', emoji: '🚰', name: 'Water filter or purifier', lists: CAMP },
  { id: 'canister', cat: 'kitchen', emoji: '🥫', name: 'Bear canister or food bag', note: 'Required in many parks', lists: CAMP },

  // Camp clothing & hygiene
  { id: 'warmhat', cat: 'camp', emoji: '🧤', name: 'Warm hat and gloves', note: 'Nights get cold, even in summer', lists: CAMP },
  { id: 'campclothes', cat: 'camp', emoji: '👕', name: 'Dry camp clothes', note: 'A set kept just for sleeping', lists: CAMP },
  { id: 'spares', cat: 'camp', emoji: '🧦', name: 'Spare socks and underwear', lists: CAMP },
  { id: 'campshoes', cat: 'camp', emoji: '🩴', name: 'Camp shoes', lists: CAMP },
  { id: 'tp', cat: 'camp', emoji: '🧻', name: 'Toilet paper and trowel', note: 'Dig catholes 15–20 cm deep, 60 m from water', lists: CAMP },
  { id: 'toiletries', cat: 'camp', emoji: '🪥', name: 'Toothbrush and toiletries', lists: CAMP },
  { id: 'sanitizer', cat: 'camp', emoji: '🧼', name: 'Hand sanitizer', lists: BOTH },
];
