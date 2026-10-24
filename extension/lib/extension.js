/**
 * Purpose: browser bridge for photos, saved palettes, and the signed-in Bullseye cart.
 * Setup: imported by picker.js in a Manifest V3 extension or a local preview tab.
 * Destructive behavior: explicit send/empty clicks change the native website cart.
 * Constraints: photos stay in this browser; host access is requested per image origin.
 */
import {BULLSEYE_LOGIN_URL, validateCartItems} from './commerce.js';
import {guardPersonalDataWrite, personalDataGeneration} from './personal-data-session.js';

export {validateCartItems} from './commerce.js';

const PROJECT_KEY = 'bullseyeProjectV1';
const PENDING_KEY = 'pendingImage';
const hasExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const message = (type, payload = {}) => chrome.runtime.sendMessage({type, ...payload});
let cartFlight = null;
const cartRequests = new Map();

function bridgeError(result) {
  const error = new Error(result?.error || 'The Bullseye store action did not finish.');
  for (const key of ['code', 'authRequired', 'uncertain', 'addedItems', 'cartUrl', 'account']) {
    if (result?.[key] !== undefined) error[key] = result[key];
  }
  return error;
}

export async function getBullseyeAccount() {
  if (!hasExtension()) return {signedIn: null, status: 'preview', message: 'Install the extension to connect your Bullseye account.', checkedAt: Date.now()};
  const result = await message('BULLSEYE_ACCOUNT');
  if (result?.error) throw bridgeError(result);
  return result && [true, false, null].includes(result.signedIn) ? result : {
    signedIn: null, status: 'unknown', checkedAt: Date.now(), message: 'Bullseye did not confirm your sign-in. Open your account or try again.',
  };
}

export async function signInToBullseye() {
  if (!hasExtension()) {
    window.open(BULLSEYE_LOGIN_URL, '_blank', 'noopener');
    return {opened: true};
  }
  const result = await message('BULLSEYE_SIGN_IN');
  if (result?.error) throw bridgeError(result);
  return result;
}

export async function sendToCart(items) {
  const cleaned = validateCartItems(items);
  if (!hasExtension()) throw new Error('Install the Chrome extension to send colors to your Bullseye cart.');
  const signature = JSON.stringify(cleaned);
  if (cartFlight) {
    if (cartFlight.kind === 'add' && cartFlight.signature === signature) return cartFlight.promise;
    throw new Error('Your Bullseye cart is still being updated.');
  }
  const requestId = cartRequests.get(signature) || crypto.randomUUID();
  cartRequests.set(signature, requestId);
  const promise = (async () => {
    const result = await message('BULLSEYE_SEND_CART', {items: cleaned, requestId});
    if (result?.error) {
      // Safe, definitive rejection can be corrected/retried by a new user click.
      // Uncertain writes retain their ID and are never automatically sent again.
      if (!result.uncertain) cartRequests.delete(signature);
      throw bridgeError(result);
    }
    if (result?.added !== true) throw bridgeError({
      error: 'Bullseye did not confirm the cart addition. Check your cart before sending this selection again.',
      code: 'CART_UNCONFIRMED', uncertain: true, cartUrl: 'https://shop.bullseyeglass.com/cart',
    });
    cartRequests.delete(signature);
    return result;
  })();
  cartFlight = {kind:'add', signature, promise};
  try { return await promise; }
  finally { if (cartFlight?.promise === promise) cartFlight = null; }
}

/** Explicit website-cart empty only. Local carts and saved palettes are retained. */
export async function emptyBullseyeCart() {
  if (!hasExtension()) throw new Error('Install the extension and sign in to Bullseye to empty your website cart.');
  if (cartFlight) {
    if (cartFlight.kind === 'clear') return cartFlight.promise;
    throw new Error('Wait for your current Bullseye cart addition to finish before emptying it.');
  }
  const promise = (async () => {
    const result = await message('BULLSEYE_EMPTY_CART');
    if (result?.error) throw bridgeError(result);
    if (result?.cleared !== true || result.itemCount !== 0) throw bridgeError({
      error:'Bullseye did not confirm an empty cart. Check your website cart before trying again.',
      code:'CART_CLEAR_UNCONFIRMED', uncertain:true, cartUrl:'https://shop.bullseyeglass.com/cart',
    });
    cartRequests.clear();
    return result;
  })();
  cartFlight = {kind:'clear', promise};
  try { return await promise; }
  finally { if (cartFlight?.promise === promise) cartFlight = null; }
}

/** User-clicked copy only. This operation never adds or removes website items. */
export async function readBullseyeCart() {
  if (!hasExtension()) throw new Error('Install the extension and sign in to Bullseye to copy your website cart.');
  const result = await message('BULLSEYE_READ_CART');
  if (result?.error) throw bridgeError(result);
  if (result?.read !== true || !Array.isArray(result.items)) throw new Error('Bullseye did not return a readable cart.');
  return result;
}
export async function openCartPage(mode = 'working') {
  const destination = `picker.html?workspace=1&cart=1&mode=${mode === 'list' ? 'list' : 'working'}`;
  if (hasExtension()) return chrome.tabs.create({url:chrome.runtime.getURL(destination)});
  window.open(new URL(destination, location.href).href,'_blank','noopener');
}
export async function loadState() {
  if (hasExtension()) {
    const result = await message('BULLSEYE_LOAD_WORKSPACE');
    if (result?.error) throw new Error(result.error);
    if (result?.loaded !== true || !Object.hasOwn(result,'workspace')) throw new Error('Your saved workspace could not be read. Reload the extension.');
    return result.workspace;
  }
  return JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
}

export async function saveState(value) {
  if (hasExtension()) {
    // No await before sendMessage: the worker retains the queued write if this
    // picker is destroyed immediately after a pagehide-triggered save.
    const result = await message('BULLSEYE_SAVE_WORKSPACE',{workspace:value,generation:personalDataGeneration()});
    if (result?.error) throw new Error(result.error);
    if (result?.saved !== true) throw new Error('The workspace save was not confirmed. Reload the extension.');
    return;
  }
  return guardPersonalDataWrite(async () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(value));
  });
}

export async function getPendingImage() {
  if (!hasExtension()) return null;
  return (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] ?? null;
}

export function subscribePendingImage(callback) {
  if (!hasExtension()) return () => {};
  const listener = (changes, area) => {
    if (area === 'session' && changes[PENDING_KEY]?.newValue) callback(changes[PENDING_KEY].newValue);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function openWorkspace() {
  if (hasExtension()) {
    const [active] = await chrome.tabs.query({active: true, currentWindow: true});
    if (Number.isInteger(active?.id) && active.url && !active.url.startsWith('chrome-extension:')) {
      await chrome.storage.session.set({sourceTabId: active.id, sourceWindowId: active.windowId});
    }
    return chrome.tabs.create({url: chrome.runtime.getURL('picker.html?workspace=1')});
  }
  window.open(new URL('picker.html?workspace=1', location.href).href, '_blank', 'noopener');
}

export async function cancelPendingImage() {
  if (!hasExtension()) return {cancelled: true};
  const result = await message('CANCEL_PENDING_IMAGE');
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function captureVisibleImage() {
  if (!hasExtension()) throw new Error('Page capture is available when the Chrome extension is installed. You can also drop or paste an image.');
  const result = await message('CAPTURE_VISIBLE');
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function requestImageAccess(sourceUrl) {
  if (!hasExtension()) throw new Error('Host access is available in the installed extension.');
  const url = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use visible-page capture or drop the image for this source.');
  const granted = await chrome.permissions.request({origins: [`${url.origin}/*`]});
  if (!granted) throw new Error('Image access was not granted. Use page capture or drop the image instead.');
  const result = await message('FETCH_SELECTED_IMAGE', {sourceUrl});
  if (result?.error) throw new Error(result.error);
  return result;
}

export function validateOrderLines(lines) {
  if (typeof lines !== 'string' || lines.length > 20000) throw new Error('The shopping list is not valid.');
  const rows = lines.trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length || rows.length > 100) throw new Error('Choose at least one jar before sending your list.');
  for (const row of rows) {
    if (!/^[A-Za-z0-9-]+\s+[1-9]\d{0,3}$/.test(row.trim())) throw new Error('Each order line needs a product SKU and a whole-number jar quantity.');
  }
  return rows.map(row => row.trim().replace(/\s+/, ' ')).join('\n');
}

export async function fetchProductVariants(handle) {
  if (!/^[a-z0-9-]+$/.test(handle)) throw new Error('Invalid product.');
  if (hasExtension()) {
    const result = await message('PRODUCT_VARIANTS', {handle});
    if (result?.error) throw new Error(result.error);
    return result;
  }
  // The bundled catalog remains useful offline; the store confirms stock when adding jars.
  return null;
}
