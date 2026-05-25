/**
 * WikiFlow - Local Storage & Settings Manager (IndexedDB)
 * 
 * Provides persistence for FileSystemHandles and UI settings.
 */

const DB_NAME = 'WikiFlowDB';
const DB_VERSION = 1;
const STORE_NAME = 'settings';

/**
 * Opens the IndexedDB database connection.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Gets a persisted value by key.
 * @param {string} key 
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get setting from DB:', err);
    // Fallback to localStorage for simple settings if IDB fails
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Persists a value under a key.
 * @param {string} key 
 * @param {any} value 
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to set setting in DB:', err);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
}

/**
 * Removes a persisted value by key.
 * @param {string} key 
 * @returns {Promise<void>}
 */
export async function deleteSetting(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete setting in DB:', err);
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}
