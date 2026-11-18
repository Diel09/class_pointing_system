const DB_NAME = "classpulse_device_db";
const STORE_NAME = "tokens";
const TOKEN_KEY = "device_mirror_token";

function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads the persisted device mirror token from browser IndexedDB.
 */
export async function getIndexedDbDeviceToken(): Promise<string | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }
  try {
    const db = await openDeviceDb();
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(TOKEN_KEY);
      req.onsuccess = () => {
        resolve(typeof req.result === "string" ? req.result : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Stores the signed device mirror token in browser IndexedDB for anti-proxy persistence.
 */
export async function setIndexedDbDeviceToken(token: string): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }
  try {
    const db = await openDeviceDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(token, TOKEN_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Graceful no-op in restricted browser contexts (e.g. private mode).
  }
}
