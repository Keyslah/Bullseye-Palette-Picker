/**
 * Purpose: save named palette workspaces, including their source image, locally.
 * Setup: browser IndexedDB; imported by picker.js. No account or server required.
 * Destructive behavior: deletePalette removes only the palette explicitly chosen.
 * Constraints: metadata and full workspaces use separate stores so listing names
 * does not load every image. IndexedDB avoids the extension settings quota.
 */
const DATABASE = 'bullseyeSavedPalettes';
let databasePromise;

function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('metadata', {keyPath: 'id'});
      request.result.createObjectStore('workspaces', {keyPath: 'id'});
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = undefined; reject(request.error || new Error('Saved palettes could not be opened.')); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('Close other picker tabs and try opening saved palettes again.')); };
  });
  return databasePromise;
}

function finish(transaction, value) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(value());
    transaction.onerror = () => reject(transaction.error || new Error('This palette could not be saved.'));
    transaction.onabort = () => reject(transaction.error || new Error('This palette change was interrupted.'));
  });
}

export async function listPalettes() {
  const db = await database();
  const transaction = db.transaction('metadata', 'readonly');
  const request = transaction.objectStore('metadata').getAll();
  return finish(transaction, () => request.result.sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function savePalette(name, workspace, id = null) {
  const cleaned = String(name || '').trim().slice(0, 80);
  if (!cleaned) throw new Error('Give this palette a name.');
  if (!Array.isArray(workspace?.targets) || !workspace.targets.length) throw new Error('Add a palette color before saving.');
  const key = id || globalThis.crypto?.randomUUID?.() || `palette-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = {id: key, name: cleaned, updatedAt: Date.now(), colorCount: workspace.targets.length, glassCount: new Set((workspace.cart || []).map(item => item.productId)).size};
  const db = await database();
  const transaction = db.transaction(['metadata', 'workspaces'], 'readwrite');
  transaction.objectStore('metadata').put(metadata);
  transaction.objectStore('workspaces').put({id: key, workspace: structuredClone(workspace)});
  return finish(transaction, () => metadata);
}

export async function loadPalette(id) {
  const db = await database();
  const transaction = db.transaction(['metadata', 'workspaces'], 'readonly');
  const metadata = transaction.objectStore('metadata').get(id);
  const workspace = transaction.objectStore('workspaces').get(id);
  return finish(transaction, () => metadata.result && workspace.result ? {...metadata.result, workspace: workspace.result.workspace} : null);
}

export async function deletePalette(id) {
  const db = await database();
  const transaction = db.transaction(['metadata', 'workspaces'], 'readwrite');
  transaction.objectStore('metadata').delete(id);
  transaction.objectStore('workspaces').delete(id);
  return finish(transaction, () => true);
}
