const DB_NAME = "incident_photos_v1";
const DB_VERSION = 1;
const STORE = "photos";

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function savePhoto(id: string, dataUrl: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dataUrl, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function getPhotos(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const db = await openDB();
  const result: Record<string, string> = {};
  await Promise.all(
    ids.map(id =>
      new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => { if (req.result) result[id] = req.result as string; res(); };
        req.onerror = () => rej(req.error);
      })
    )
  );
  return result;
}

export async function deletePhotos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    ids.forEach(id => tx.objectStore(STORE).delete(id));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function getAllPhotos(): Promise<Record<string, string>> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const result: Record<string, string> = {};
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { result[cursor.key as string] = cursor.value as string; cursor.continue(); }
      else res(result);
    };
    req.onerror = () => rej(req.error);
  });
}

export async function importPhotos(photos: Record<string, string>): Promise<void> {
  if (!Object.keys(photos).length) return;
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    Object.entries(photos).forEach(([id, data]) => store.put(data, id));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
