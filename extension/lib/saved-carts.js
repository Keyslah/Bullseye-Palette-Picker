/**
 * Named local carts, independent of saved photo palettes and Bullseye's cart.
 * Items retain their chosen variant IDs and quantities when stock changes.
 * Only deleteCart removes a saved cart; this module makes no store requests.
 */
const DATABASE = 'bullseyeSavedCarts';
const STORE = 'carts';
const MAX_NAME_LENGTH = 80;
let databasePromise, connection;

export function normalizeCartName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Give this cart a name.');
  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) throw new Error('Use 80 characters or fewer for the cart name.');
  return name;
}

/** Validate the order fields, merge repeated variants, and copy display fields. */
export function normalizeCartItems(items) {
  if (!Array.isArray(items)) throw new Error('The saved cart must contain a list of jars.');
  const merged = new Map();
  const displayText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  for (const item of items) {
    const variantId = typeof item?.variantId === 'string' && /^[1-9]\d*$/.test(item.variantId)
      ? Number(item.variantId) : item?.variantId;
    if (!Number.isSafeInteger(variantId) || variantId < 1) throw new Error('A saved jar has no valid Bullseye variant ID.');
    if (typeof item.productId !== 'string' || !item.productId.trim() || item.productId.length > 120) {
      throw new Error('A saved jar has no valid Bullseye glass code.');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new Error('Jar quantities must be whole numbers between 1 and 999.');
    }
    const productId = item.productId.trim(), previous = merged.get(variantId);
    if (previous) {
      if (previous.productId !== productId) throw new Error('One jar variant cannot belong to two glass colors.');
      if (previous.quantity + item.quantity > 999) throw new Error('The combined quantity for one jar size cannot exceed 999.');
      previous.quantity += item.quantity;
      continue;
    }
    merged.set(variantId, {
      key: `${productId}:${variantId}`, productId, variantId, quantity: item.quantity,
      name: displayText(item.name, 200), sku: displayText(item.sku, 120),
      title: displayText(item.title, 200), image: displayText(item.image, 2048),
      form: ['sheets','powder','fine','medium','coarse'].includes(item.form) ? item.form : '',
      price: Number.isSafeInteger(item.price) && item.price >= 0 ? item.price : 0,
      available: item.available === true,
    });
  }
  return [...merged.values()];
}

export function copiedCartName(sourceName, existingNames = []) {
  const source = normalizeCartName(sourceName);
  const used = new Set(existingNames.filter(name => typeof name === 'string').map(name => name.trim().toLowerCase()));
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? ' copy' : ` copy ${number}`;
    const name = `${source.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

function savedId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new Error('This saved cart has no valid ID.');
  return id;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function database() {
  if (databasePromise) return databasePromise;
  const opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Saved carts are unavailable in this browser.')); return; }
    let request, failed = false;
    const fail = error => { failed = true; reject(error || new Error('Saved carts could not be opened.')); };
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      try { request.result.createObjectStore(STORE, {keyPath: 'id'}); }
      catch (error) { fail(error); request.transaction?.abort(); }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('Close other Bullseye picker tabs, then try opening saved carts again.'));
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      connection = db;
      const forget = () => {
        if (connection === db) { connection = undefined; databasePromise = undefined; }
      };
      db.onversionchange = () => { db.close(); forget(); };
      db.onclose = forget;
      resolve(db);
    };
  });
  const guarded = opening.catch(error => {
    if (databasePromise === guarded) databasePromise = undefined;
    throw error;
  });
  databasePromise = guarded;
  return guarded;
}

/** Resolve only after the transaction commits, including writes inside reads. */
function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    try { tx = db.transaction(STORE, mode); }
    catch (error) { reject(error); return; }
    const fail = error => {
      failure = error;
      try { tx.abort(); } catch { reject(error); }
    };
    const guarded = callback => event => {
      try { callback(event); } catch (error) { fail(error); }
    };
    tx.oncomplete = () => failure ? reject(failure) : resolve(result);
    tx.onerror = event => { failure ||= event.target?.error || tx.error; };
    tx.onabort = () => reject(failure || tx.error || new Error('This saved cart change was interrupted.'));
    try { action(tx.objectStore(STORE), value => { result = value; }, fail, guarded); }
    catch (error) { fail(error); }
  });
}

function record(id, name, items, previous = null) {
  const now = Date.now();
  return {
    id, name, createdAt: previous?.createdAt ?? now, updatedAt: now, items,
    colorCount: new Set(items.map(item => item.productId)).size,
    jarCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export async function listCarts() {
  const db = await database();
  return transaction(db, 'readonly', (store, done, fail, guarded) => {
    const request = store.getAll();
    request.onsuccess = guarded(() => done(request.result.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.name.localeCompare(b.name))));
  });
}

/** An explicit ID updates that cart; a missing ID cannot create a replacement. */
export async function saveCart(name, items, id = null) {
  const cleanedName = normalizeCartName(name), cleanedItems = normalizeCartItems(items);
  const key = id === null ? newId() : savedId(id);
  const db = await database();
  return transaction(db, 'readwrite', (store, done, fail, guarded) => {
    if (id === null) {
      const saved = record(key, cleanedName, cleanedItems);
      store.add(saved); done(saved); return;
    }
    const request = store.get(key);
    request.onsuccess = guarded(() => {
      if (!request.result) { fail(new Error('This saved cart no longer exists. Save it as a new cart.')); return; }
      const saved = record(key, cleanedName, cleanedItems, request.result);
      store.put(saved); done(saved);
    });
  });
}

export async function loadCart(id) {
  const key = savedId(id), db = await database();
  return transaction(db, 'readonly', (store, done, fail, guarded) => {
    const request = store.get(key);
    request.onsuccess = guarded(() => done(request.result || null));
  });
}

/** Name allocation and the copy commit share one write transaction. */
export async function duplicateCart(id, name) {
  const key = savedId(id), requestedName = name === undefined ? null : normalizeCartName(name);
  const db = await database();
  return transaction(db, 'readwrite', (store, done, fail, guarded) => {
    const request = store.getAll();
    request.onsuccess = guarded(() => {
      const source = request.result.find(cart => cart.id === key);
      if (!source) { fail(new Error('This saved cart no longer exists.')); return; }
      const copyName = requestedName ?? copiedCartName(source.name, request.result.map(cart => cart.name));
      const copy = record(newId(), copyName, normalizeCartItems(source.items));
      store.add(copy); done(copy);
    });
  });
}

export async function deleteCart(id) {
  const key = savedId(id), db = await database();
  return transaction(db, 'readwrite', (store, done, fail, guarded) => {
    const request = store.get(key);
    request.onsuccess = guarded(() => { store.delete(key); done(Boolean(request.result)); });
  });
}
