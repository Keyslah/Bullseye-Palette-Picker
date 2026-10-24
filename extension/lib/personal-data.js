/**
 * Purpose: back up and restore personal settings, photo palettes and local carts.
 * Setup: call from Settings after pending workspace/cart saves have finished.
 * Writes: an explicit restore merges named records by ID and restores the backed-up
 * current workspace/settings/cart; existing records absent from the backup remain.
 * Constraints: local JSON only, no account/session/request-journal data or network
 * calls. Keep the extension identity/storage names stable; reload after restoration.
 */
import {normalizeSettings, SETTINGS_KEY} from './settings.js';
import {PRESETS_KEY} from './settings-presets.js';
import {normalizeCartItems, normalizeCartName} from './saved-carts.js';

export const PERSONAL_DATA_FORMAT = 'bullseye-palette-picker-personal-data';
export const PERSONAL_DATA_VERSION = 1;
const PROJECT_KEY = 'bullseyeProjectV1';
const WORKING_CART_KEY = 'bullseyeWorkingCartV1';
const LOCAL_KEYS = [PROJECT_KEY, SETTINGS_KEY, PRESETS_KEY, WORKING_CART_KEY];
const PALETTES_DATABASE = 'bullseyeSavedPalettes';
const CARTS_DATABASE = 'bullseyeSavedCarts';
const PALETTE_STORES = ['metadata', 'workspaces'];
const inExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
const clone = value => structuredClone(value);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function records(value, label) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error(`${label} must be a list of at most 10,000 records.`);
  return value;
}
function text(value, label, limit = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label} is not valid.`);
  return value;
}
function unique(values, label, identify = value => value.id) {
  const seen = new Set();
  for (const value of values) {
    const id = identify(value);
    if (seen.has(id)) throw new Error(`${label} contains a repeated ID.`);
    seen.add(id);
  }
  return values;
}
function timestamp(value, label) {
  if (value === undefined) return;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return;
  throw new Error(`${label} is not valid.`);
}
function image(value, label) {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    throw new Error(`${label} must be an embedded image.`);
  }
}
function workspace(value) {
  const result = clone(object(value, 'Palette workspace'));
  image(result.sourceDataUrl, 'Source photo');
  image(result.thumbnailDataUrl, 'Photo thumbnail');
  if (result.targets !== undefined) {
    if (!Array.isArray(result.targets) || result.targets.length > 20) throw new Error('A palette must contain at most 20 colors.');
    for (const target of result.targets) {
      if (!Array.isArray(target?.rgb) || target.rgb.length !== 3 || target.rgb.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
        throw new Error('A palette contains an invalid color.');
      }
    }
  }
  if (result.cart !== undefined) result.cart = normalizeCartItems(result.cart);
  if (result.glassTypes !== undefined) normalizeSettings({glassTypes:result.glassTypes});
  return result;
}
function preset(value) {
  const result = clone(object(value, 'Saved settings'));
  text(result.id, 'Saved settings ID');
  text(result.name, 'Saved settings name', 80);
  timestamp(result.updatedAt, 'Saved settings date');
  result.settings = normalizeSettings(result.settings);
  return result;
}
function cart(value, working = false) {
  const result = clone(object(value, working ? 'Working cart' : 'Saved cart'));
  if (!working || result.id !== null && result.id !== undefined) text(result.id, 'Cart ID');
  if (working) {
    if (typeof result.name !== 'string' || result.name.length > 80) throw new Error('Working cart name is not valid.');
  } else result.name = normalizeCartName(result.name);
  timestamp(result.createdAt, 'Cart creation date');
  timestamp(result.updatedAt, 'Cart update date');
  result.items = normalizeCartItems(result.items);
  if (!working) {
    result.colorCount = new Set(result.items.map(item => item.productId)).size;
    result.jarCount = result.items.reduce((sum, item) => sum + item.quantity, 0);
  }
  return result;
}

/** Validate the complete file before opening storage or changing any record. */
export function normalizePersonalDataBackup(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('This backup is not valid JSON.'); }
  }
  object(value, 'Backup');
  if (value.format !== PERSONAL_DATA_FORMAT) throw new Error('Choose a Bullseye Palette Picker personal-data backup.');
  if (value.version !== PERSONAL_DATA_VERSION) throw new Error('This backup version is not supported. Update the extension before restoring it.');
  const source = object(value.local, 'Backup settings'), local = {};
  if (Object.hasOwn(source, PROJECT_KEY)) local[PROJECT_KEY] = source[PROJECT_KEY] === null ? null : workspace(source[PROJECT_KEY]);
  if (Object.hasOwn(source, SETTINGS_KEY)) local[SETTINGS_KEY] = source[SETTINGS_KEY] === null ? null : normalizeSettings(source[SETTINGS_KEY]);
  if (Object.hasOwn(source, PRESETS_KEY)) local[PRESETS_KEY] = unique(records(source[PRESETS_KEY], 'Named settings').map(preset), 'Named settings');
  if (Object.hasOwn(source, WORKING_CART_KEY)) local[WORKING_CART_KEY] = source[WORKING_CART_KEY] === null ? null : cart(source[WORKING_CART_KEY], true);
  const palettes = unique(records(value.palettes, 'Saved palettes').map(entry => {
    object(entry, 'Saved palette');
    const metadata = clone(object(entry.metadata, 'Palette metadata'));
    text(metadata.id, 'Palette ID');
    text(metadata.name, 'Palette name', 80);
    timestamp(metadata.updatedAt, 'Palette update date');
    image(metadata.thumbnailDataUrl, 'Palette thumbnail');
    return {metadata, workspace:workspace(entry.workspace)};
  }), 'Saved palettes', entry => entry.metadata.id);
  const carts = unique(records(value.carts, 'Saved carts').map(value => cart(value)), 'Saved carts');
  return {
    format:PERSONAL_DATA_FORMAT, version:PERSONAL_DATA_VERSION,
    exportedAt:typeof value.exportedAt === 'string' ? value.exportedAt : '',
    extensionVersion:typeof value.extensionVersion === 'string' ? value.extensionVersion : '',
    local, palettes, carts,
  };
}

async function readLocal() {
  if (inExtension()) return chrome.storage.local.get(LOCAL_KEYS);
  const result = {};
  for (const key of LOCAL_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = JSON.parse(value);
  }
  return result;
}
async function writeLocal(values) {
  if (!Object.keys(values).length) return;
  if (inExtension()) return chrome.storage.local.set(values);
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
}
function openDatabase(name, stores) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Personal-data storage is unavailable in this browser.')); return; }
    let request, failed = false;
    const fail = error => { failed = true; reject(error || new Error('Personal-data storage could not be opened.')); };
    try { request = indexedDB.open(name, 1); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      try {
        for (const store of stores) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, {keyPath:'id'});
      } catch (error) { fail(error); request.transaction?.abort(); }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('Close other Bullseye picker tabs and try again.'));
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      resolve(request.result);
    };
  });
}
function readRecords(db, stores) {
  return new Promise((resolve, reject) => {
    let transaction;
    try { transaction = db.transaction(stores, 'readonly'); }
    catch (error) { reject(error); return; }
    const result = {};
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => {};
    transaction.onabort = () => reject(transaction.error || new Error('Personal data could not be read.'));
    try {
      for (const store of stores) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => { result[store] = request.result; };
      }
    } catch (error) { transaction.abort(); reject(error); }
  });
}
function mergeRecords(db, values) {
  return new Promise((resolve, reject) => {
    let transaction;
    try { transaction = db.transaction(Object.keys(values), 'readwrite'); }
    catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {};
    transaction.onabort = () => reject(transaction.error || new Error('Personal-data restoration was interrupted.'));
    try {
      for (const [store, records] of Object.entries(values)) {
        for (const record of records) transaction.objectStore(store).put(record);
      }
    } catch (error) { transaction.abort(); reject(error); }
  });
}
async function withDatabases(action) {
  const databases = [];
  try {
    databases.push(await openDatabase(PALETTES_DATABASE, PALETTE_STORES));
    databases.push(await openDatabase(CARTS_DATABASE, ['carts']));
    return await action(...databases);
  } finally { for (const database of databases) database.close(); }
}

/** Returns a JSON-serializable snapshot, including full saved photos. */
export async function createPersonalDataBackup() {
  return withDatabases(async (palettesDB, cartsDB) => {
    const results = await Promise.allSettled([
      readLocal(), readRecords(palettesDB, PALETTE_STORES), readRecords(cartsDB, ['carts']),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [local, palettes, carts] = results.map(result => result.value);
    const workspaces = new Map(palettes.workspaces.map(record => [record.id, record.workspace]));
    return normalizePersonalDataBackup({
      format:PERSONAL_DATA_FORMAT, version:PERSONAL_DATA_VERSION, exportedAt:new Date().toISOString(),
      extensionVersion:inExtension() ? chrome.runtime.getManifest?.().version || '' : '',
      local,
      palettes:palettes.metadata.map(metadata => {
        if (!workspaces.has(metadata.id)) throw new Error(`The saved photo palette “${metadata.name}” could not be read. Your data was not changed.`);
        return {metadata, workspace:workspaces.get(metadata.id)};
      }),
      carts:carts.carts,
    });
  });
}

/** Merge named records and restore backed-up current choices. Reload after success. */
export async function restorePersonalDataBackup(value) {
  const backup = normalizePersonalDataBackup(value);
  const current = await readLocal();
  const local = clone(backup.local);
  if (Object.hasOwn(local, PRESETS_KEY)) {
    const existing = current[PRESETS_KEY] === undefined ? [] : records(current[PRESETS_KEY], 'Existing named settings').map(preset);
    local[PRESETS_KEY] = [...new Map([...existing, ...local[PRESETS_KEY]].map(record => [record.id, record])).values()];
  }
  await withDatabases(async (palettesDB, cartsDB) => {
    try {
      if (backup.palettes.length) await mergeRecords(palettesDB, {
        metadata:backup.palettes.map(entry => entry.metadata),
        workspaces:backup.palettes.map(entry => ({id:entry.metadata.id, workspace:entry.workspace})),
      });
      if (backup.carts.length) await mergeRecords(cartsDB, {carts:backup.carts});
      await writeLocal(local);
    } catch (error) {
      throw new Error(`Restore did not finish: ${error.message || error}. Some named items may already have been restored. Reload the picker before trying again.`, {cause:error});
    }
  });
  return {palettes:backup.palettes.length, carts:backup.carts.length, settingsPresets:backup.local[PRESETS_KEY]?.length || 0, requiresReload:true};
}
