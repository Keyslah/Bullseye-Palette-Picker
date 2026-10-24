/**
 * Purpose: retain the active local cart and share its item count between picker tabs.
 * Setup: Chrome local storage in the extension; localStorage for isolated previews.
 * Writes: only bullseyeWorkingCartV1 after an explicit local cart edit or addition.
 * Constraints: no website requests, no clearing named carts, and no reset on update.
 */
import {normalizeCartItems} from './saved-carts.js';
import {guardPersonalDataWrite} from './personal-data-session.js';

export const WORKING_CART_KEY = 'bullseyeWorkingCartV1';
const inExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
let writeQueue = Promise.resolve();

function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The working cart could not be read. Reload before changing it.');
  if (value.version !== undefined && value.version !== 1) throw new Error('This working-cart version is not supported. Update the extension before changing it.');
  return {
    version:1, id:typeof value.id === 'string' ? value.id : null,
    instanceId:typeof value.instanceId === 'string' && value.instanceId ? value.instanceId
      : `legacy:${typeof value.id === 'string' ? value.id : 'unnamed'}:${value.createdAt ?? 0}`,
    name:typeof value.name === 'string' ? value.name.slice(0,80) : 'My cart',
    items:normalizeCartItems(value.items), dirty:value.dirty === true,
    createdAt:value.createdAt || Date.now(), updatedAt:value.updatedAt || Date.now(),
  };
}

export async function loadWorkingCart() {
  const value = inExtension() ? (await chrome.storage.local.get(WORKING_CART_KEY))[WORKING_CART_KEY]
    : JSON.parse(localStorage.getItem(WORKING_CART_KEY) || 'null');
  return value == null ? null : normalize(value);
}

function updateWorkingCart(update) {
  const write = async () => {
    const previous = await loadWorkingCart();
    const value = normalize(await update(previous));
    value.updatedAt = Date.now();
    if (inExtension()) await chrome.storage.local.set({[WORKING_CART_KEY]:value});
    else localStorage.setItem(WORKING_CART_KEY,JSON.stringify(value));
    return value;
  };
  const locked = () => guardPersonalDataWrite(() => globalThis.navigator?.locks?.request
    ? navigator.locks.request(WORKING_CART_KEY,write) : write());
  const task = writeQueue.then(locked,locked);
  writeQueue = task.catch(() => {});
  return task;
}

/** A new editor supplies a new instanceId; saving that copy preserves its identity. */
export function saveWorkingCart(value) {
  const snapshot = {...normalize(value),instanceId:typeof value.instanceId === 'string' && value.instanceId ? value.instanceId : crypto.randomUUID()};
  return updateWorkingCart(() => snapshot);
}

/** A second deliberate Add to Cart adds the selected quantities again. */
export function addWorkingCartItems(items, name = 'My cart') {
  const additions = normalizeCartItems(items);
  return updateWorkingCart(previous => ({
    ...(previous || {name,createdAt:Date.now(),instanceId:crypto.randomUUID()}), dirty:true,
    items:normalizeCartItems([...(previous?.items || []),...additions]),
  }));
}

/** Merge only the rows edited here, keeping unrelated additions from another tab. */
export function patchWorkingCart(before, after) {
  const old = normalize(before), next = normalize(after);
  return updateWorkingCart(previous => {
    if (previous && previous.instanceId !== old.instanceId) {
      throw new Error('Another cart was opened in a different tab. Reload before editing this cart.');
    }
    const current = previous || old;
    const items = new Map(current.items.map(item => [item.variantId,item]));
    const oldItems = new Map(old.items.map(item => [item.variantId,item]));
    const nextItems = new Map(next.items.map(item => [item.variantId,item]));
    for (const item of old.items) if (!nextItems.has(item.variantId)) items.delete(item.variantId);
    for (const item of next.items) {
      const prior = oldItems.get(item.variantId);
      if (JSON.stringify(prior) === JSON.stringify(item)) continue;
      if (!prior && items.has(item.variantId)) items.set(item.variantId,{...item,quantity:items.get(item.variantId).quantity+item.quantity});
      else items.set(item.variantId,item);
    }
    return {...current, name:next.name !== old.name ? next.name : current.name,
      id:next.id !== old.id ? next.id : current.id, dirty:next.dirty, items:[...items.values()]};
  });
}

export function subscribeWorkingCart(callback) {
  if (inExtension()) {
    const listener = (changes, area) => {
      if (area === 'local' && changes[WORKING_CART_KEY]) callback(changes[WORKING_CART_KEY].newValue || null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = event => {
    if (event.key === WORKING_CART_KEY) callback(event.newValue ? JSON.parse(event.newValue) : null);
  };
  window.addEventListener('storage',listener);
  return () => window.removeEventListener('storage',listener);
}
