/**
 * Purpose: browser bridge for photo handoff, saved palettes, and Bullseye Quick Add.
 * Setup: imported by picker.js in a Manifest V3 extension or a local preview tab.
 * Destructive behavior: none; cart handoff fills a reviewable order list only.
 * Constraints: photos stay in this browser; host access is requested per image origin.
 */

const PROJECT_KEY = 'bullseyeProjectV1';
const PENDING_KEY = 'pendingImage';
const hasExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const message = (type, payload = {}) => chrome.runtime.sendMessage({type, ...payload});

export async function loadState() {
  try {
    if (hasExtension()) return (await chrome.storage.local.get(PROJECT_KEY))[PROJECT_KEY] ?? null;
    return JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
  } catch { return null; }
}

export async function saveState(value) {
  if (hasExtension()) return chrome.storage.local.set({[PROJECT_KEY]: value});
  localStorage.setItem(PROJECT_KEY, JSON.stringify(value));
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

export async function openQuickAdd(lines) {
  const cleaned = validateOrderLines(lines);
  if (hasExtension()) {
    const result = await message('OPEN_QUICK_ADD', {lines: cleaned});
    if (result?.error) throw new Error(result.error);
    return result;
  }
  // Open synchronously to remain inside the user's gesture in preview mode.
  const opened = window.open('https://shop.bullseyeglass.com/pages/quick-add-to-cart', '_blank', 'noopener');
  try { await navigator.clipboard.writeText(cleaned); } catch { /* The picker also provides a copy action. */ }
  return {opened: !!opened, manualPaste: true};
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
  // The bundled catalog remains useful offline; the store confirms stock during Quick Add.
  return null;
}
