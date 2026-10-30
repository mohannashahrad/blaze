// Tiny promise wrapper around IndexedDB. All of your data lives here, on the phone.
//   hikes   – logged hikes (GPS tracks, GPX imports, manual entries)
//   saved   – wishlist places
//   photos  – resized photo blobs, indexed by hikeId
//   kv      – misc: the in-progress recording, last Explore results

// Kept from the app's earlier name, Trail Buddy, so existing hikes stay where they are.
const DB_NAME = 'trail-buddy';
const VERSION = 1;
let opening;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('hikes', { keyPath: 'id' });
      d.createObjectStore('saved', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('hikeId', 'hikeId');
      d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(storeName, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  all: store => run(store, 'readonly', s => s.getAll()),
  get: (store, key) => run(store, 'readonly', s => s.get(key)),
  put: (store, value, key) => run(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
  byIndex: (store, index, value) => run(store, 'readonly', s => s.index(index).getAll(value)),
};
