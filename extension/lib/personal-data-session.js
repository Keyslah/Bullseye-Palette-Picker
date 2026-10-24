/**
 * Purpose: prevent open picker tabs from overwriting a restored personal backup.
 * Setup: initialize once before page storage reads, then wrap normal workspace/cart
 * writes with guardPersonalDataWrite and a restore with runPersonalDataRestore.
 * Writes: one local generation marker; never deletes personal data or changes IDs.
 * Constraints: shared Web Locks drain old writes before an exclusive restore.
 * Sleeping tabs must match the stored generation before writing. Node/worker-only
 * callers skip page coordination; all user-facing restores run in a picker page.
 */
export const PERSONAL_DATA_GENERATION_KEY = 'bullseyePersonalDataGenerationV1';
const LOCK = 'bullseye-personal-data-write';
const inPage = () => typeof document !== 'undefined';
const inExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
let ready = null, generation = null, ownRestore = null, paused = false, completed = null;
let callbacks = {};

const marker = value => ({
  generation:typeof value?.generation === 'string' ? value.generation : '',
  restoring:value?.restoring === true,
});
async function readMarker() {
  const value = inExtension() ? (await chrome.storage.local.get(PERSONAL_DATA_GENERATION_KEY))[PERSONAL_DATA_GENERATION_KEY]
    : JSON.parse(localStorage.getItem(PERSONAL_DATA_GENERATION_KEY) || 'null');
  return marker(value);
}
async function writeMarker(value) {
  const record = {...value,updatedAt:Date.now()};
  if (inExtension()) await chrome.storage.local.set({[PERSONAL_DATA_GENERATION_KEY]:record});
  else localStorage.setItem(PERSONAL_DATA_GENERATION_KEY,JSON.stringify(record));
}
function locked(mode, action) {
  return globalThis.navigator?.locks?.request ? navigator.locks.request(LOCK,{mode},action) : action();
}
function pause() {
  if (paused) return;
  paused = true; callbacks.onPause?.();
}
function receive(value) {
  if (generation === null) return;
  const current = marker(value);
  if (current.generation === generation && !current.restoring) return;
  pause();
  // The importing page awaits its restore result and reloads in its own handler.
  if (!current.restoring && current.generation !== ownRestore && completed !== current.generation) {
    completed = current.generation; callbacks.onComplete?.();
  }
}
function subscribe() {
  if (inExtension()) {
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area === 'local' && changes[PERSONAL_DATA_GENERATION_KEY]) receive(changes[PERSONAL_DATA_GENERATION_KEY].newValue);
    });
  } else window.addEventListener('storage',event => {
    if (event.key !== PERSONAL_DATA_GENERATION_KEY) return;
    try { receive(event.newValue ? JSON.parse(event.newValue) : null); }
    catch (error) { callbacks.onError?.(error); }
  });
}

/** Wait for any active restore before reading the initial page state. */
export function initPersonalDataSession(handlers = {}) {
  if (!inPage()) return Promise.resolve();
  callbacks = {...callbacks,...handlers};
  if (ready) return ready;
  subscribe();
  ready = locked('shared',async () => {
    const current = await readMarker();
    // Acquiring the lock proves no restore is still running. A remaining flag
    // therefore records an interrupted prior session; keep its new generation.
    if (current.restoring) {
      if (!globalThis.navigator?.locks?.request) throw new Error('A data restore is still in progress. Reload this page when it finishes.');
      await writeMarker({...current,restoring:false});
      callbacks.onError?.(new Error('A previous data restore was interrupted. Check your restored settings and carts before continuing.'));
    }
    generation = current.generation;
  });
  return ready;
}

function requireCurrent(current) {
  if (current.restoring || current.generation !== generation) {
    receive(current);
    throw new Error('Personal data changed in another picker tab. Reload this page before saving changes.');
  }
}

/** Synchronous capture lets pagehide hand a save to the worker before unloading. */
export function personalDataGeneration() {
  if (!inPage()) return '';
  if (generation === null) throw new Error('Personal data is still loading. Wait before saving.');
  return generation;
}

/** Worker-side guard: the originating page's generation travels with its write. */
export async function guardPersonalDataGeneration(expectedGeneration, action) {
  if (typeof expectedGeneration !== 'string' || expectedGeneration.length > 160) throw new Error('The personal-data session is not valid. Reload the picker.');
  return locked('shared',async () => {
    const current = await readMarker();
    if (current.restoring || current.generation !== expectedGeneration) {
      if (inPage()) receive(current);
      throw new Error('Personal data changed in another picker tab. Reload this page before saving changes.');
    }
    return action();
  });
}

/** The stored generation is checked inside the same lock as the actual write. */
export async function guardPersonalDataWrite(action) {
  if (!inPage()) return action();
  await initPersonalDataSession();
  return guardPersonalDataGeneration(generation,action);
}

/** Freeze other pages and finish every in-flight normal write before restoration. */
export async function runPersonalDataRestore(action) {
  if (!inPage()) return action();
  await initPersonalDataSession();
  return locked('exclusive',async () => {
    requireCurrent(await readMarker());
    ownRestore = crypto.randomUUID();
    pause();
    await writeMarker({generation:ownRestore,restoring:true});
    try { return await action(); }
    finally { await writeMarker({generation:ownRestore,restoring:false}); }
  });
}
