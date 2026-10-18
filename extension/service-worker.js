/**
 * Purpose: receive image context-menu clicks and hand photos to the palette picker.
 * Setup: Manifest V3 service worker; uses the user's current Chrome window/session.
 * Destructive behavior: none; Quick Add opens and prefills a list without submitting it.
 * Constraints: full-color image bytes stay local; only Bullseye product reads are automatic.
 */
import {validateOrderLines} from './lib/extension.js';

const IMAGE_MENU = 'bullseye-palette-from-image';
const CAPTURE_MENU = 'bullseye-palette-from-page';
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const QUICK_ADD_URL = 'https://shop.bullseyeglass.com/pages/quick-add-to-cart';
let currentImageRequest = 0;

async function configure() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id: IMAGE_MENU, title: 'Create Bullseye palette', contexts: ['image']});
  chrome.contextMenus.create({id: CAPTURE_MENU, title: 'Create Bullseye palette from visible page', contexts: ['page']});
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
}
chrome.runtime.onInstalled.addListener(() => { void configure(); });
chrome.runtime.onStartup.addListener(() => { void configure(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || ![IMAGE_MENU, CAPTURE_MENU].includes(info.menuItemId)) return;
  const requestId = ++currentImageRequest;
  // Call open during the user gesture, before any asynchronous image work.
  const opened = chrome.sidePanel.open({windowId: tab.windowId});
  void (async () => {
    try {
      await opened;
      await chrome.storage.session.set({sourceTabId: tab.id, sourceWindowId: tab.windowId});
      if (info.menuItemId === CAPTURE_MENU) {
        const result = await captureVisible(tab.windowId);
        await publish({...result, sourceUrl: tab.url || '', captured: true}, requestId);
      } else {
        await publish({loading: true, sourceUrl: info.srcUrl}, requestId);
        await fetchSelectedImage(info.srcUrl, requestId);
      }
    } catch (error) {
      await publish({error: readableError(error), sourceUrl: info.srcUrl || ''}, requestId).catch(() => {});
    }
  })();
});

function readableError(error) {
  return error instanceof Error ? error.message : 'Could not open that image. Try dropping it into the picker.';
}
function publish(pendingImage, requestId = currentImageRequest) {
  if (requestId !== currentImageRequest) return Promise.resolve();
  // A data URL may contain megabytes. Only the reduced decoded image is stored.
  const sourceUrl = /^https?:\/\//.test(pendingImage.sourceUrl || '')
    ? pendingImage.sourceUrl.slice(0, 16000) : '';
  return chrome.storage.session.set({pendingImage: {...pendingImage, sourceUrl, updatedAt: Date.now()}});
}

async function imageBlobToDataUrl(blob) {
  const bitmap = await createImageBitmap(blob);
  if (!bitmap.width || !bitmap.height) throw new Error('This image could not be decoded.');
  // Keep the ephemeral image below Chrome session-storage limits and analysis responsive.
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext('2d', {colorSpace: 'srgb'});
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const reduced = await canvas.convertToBlob({type: 'image/png'});
  const bytes = new Uint8Array(await reduced.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:image/png;base64,${btoa(binary)}`;
}

async function fetchSelectedImage(sourceUrl, requestId = ++currentImageRequest) {
  let url;
  try { url = new URL(sourceUrl); } catch { throw new Error('No usable image URL was supplied. Drop an image or capture the page.'); }
  if (!['http:', 'https:', 'data:'].includes(url.protocol)) {
    const result = {sourceUrl, error: 'This image is generated inside the page. Use Capture page or drop a saved image.'};
    await publish(result, requestId);
    return requestId === currentImageRequest ? result : {stale: true};
  }
  try {
    const response = await fetch(sourceUrl, {credentials: 'omit', signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`The image server returned ${response.status}.`);
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error('This image is large. Use Capture page or a smaller image.');
    const blob = await response.blob();
    if (blob.size > MAX_DOWNLOAD) throw new Error('This image is large. Use Capture page or a smaller image.');
    if (blob.type && !blob.type.startsWith('image/')) throw new Error('That address did not return an image.');
    const result = {dataUrl: await imageBlobToDataUrl(blob), sourceUrl};
    await publish(result, requestId);
    // Runtime replies must obey the same ordering as storage publications.
    if (requestId !== currentImageRequest) return {stale: true};
    return {...result, sourceUrl: /^https?:\/\//.test(sourceUrl) ? sourceUrl : ''};
  } catch (error) {
    let needsPermission = false;
    if (['https:', 'http:'].includes(url.protocol)) {
      needsPermission = !(await chrome.permissions.contains({origins: [`${url.origin}/*`]}));
    }
    const result = {
      sourceUrl,
      needsPermission,
      error: needsPermission
        ? 'Allow access to this image host, or use Capture page / drop an image.'
        : `${readableError(error)} You can also capture the visible page or drop an image.`,
    };
    await publish(result, requestId);
    return requestId === currentImageRequest ? result : {stale: true};
  }
}

async function captureVisible(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: 'png'});
  const blob = await (await fetch(dataUrl)).blob();
  return {dataUrl: await imageBlobToDataUrl(blob)};
}

async function captureSource() {
  ++currentImageRequest;
  const [active] = await chrome.tabs.query({active: true, currentWindow: true});
  const ownPage = active?.url?.startsWith(chrome.runtime.getURL(''));
  const saved = await chrome.storage.session.get(['sourceTabId', 'sourceWindowId']);
  if (ownPage && saved.sourceTabId) {
    const source = await chrome.tabs.update(saved.sourceTabId, {active: true});
    return captureVisible(source.windowId);
  }
  if (!active?.windowId) throw new Error('Open the source page and use the extension icon or the right-click menu first.');
  try { return await captureVisible(active.windowId); }
  catch { throw new Error('On the source page, click the extension icon or right-click and choose Create Bullseye palette from visible page.'); }
}

async function cancelPendingImage() {
  ++currentImageRequest;
  await chrome.storage.session.remove('pendingImage');
  return {cancelled: true};
}

async function tabReady(tabId) {
  await new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
    const listener = (id, change) => { if (id === tabId && change.status === 'complete') { done(); resolve(); } };
    const timer = setTimeout(() => { done(); reject(new Error('The store is still loading. Use Copy list and paste it into Quick Add.')); }, 15000);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') { done(); resolve(); } }).catch(error => { done(); reject(error); });
  });
}

async function openQuickAdd(lines) {
  const validated = validateOrderLines(lines);
  const tab = await chrome.tabs.create({url: QUICK_ADD_URL});
  try {
    await tabReady(tab.id);
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      args: [validated],
      func: async (orderLines) => {
        // The native app loads asynchronously. Only fill a visible multiline order input.
        // Never click Submit/Add to Cart: the user reviews the resolved products on the store.
        for (let attempt = 0; attempt < 24; attempt++) {
          const fields = [...document.querySelectorAll('textarea')].filter(el => el.getClientRects().length && !el.disabled && !el.readOnly);
          const field = fields.find(el => /sku|multi|order|product/i.test(`${el.id} ${el.name} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`)) || (fields.length === 1 ? fields[0] : null);
          if (field) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(field, orderLines);
            field.dispatchEvent(new Event('input', {bubbles: true}));
            field.dispatchEvent(new Event('change', {bubbles: true}));
            field.focus();
            return {prefilled: true};
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        return {prefilled: false};
      },
    });
    return {opened: true, prefilled: !!results[0]?.result?.prefilled, manualPaste: !results[0]?.result?.prefilled};
  } catch { return {opened: true, prefilled: false, manualPaste: true}; }
}

async function productVariants(handle) {
  if (!/^[a-z0-9-]+$/.test(handle || '')) throw new Error('Invalid Bullseye product.');
  const response = await fetch(`https://shop.bullseyeglass.com/products/${handle}.js`, {signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('Could not refresh this product. The store will confirm stock in Quick Add.');
  const product = await response.json();
  return {variants: product.variants.map(v => ({id: v.id, sku: v.sku, title: v.title, available: v.available, price: v.price}))};
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  const actions = {
    FETCH_SELECTED_IMAGE: () => fetchSelectedImage(request.sourceUrl),
    CAPTURE_VISIBLE: captureSource,
    CANCEL_PENDING_IMAGE: cancelPendingImage,
    OPEN_QUICK_ADD: () => openQuickAdd(request.lines),
    PRODUCT_VARIANTS: () => productVariants(request.handle),
  };
  const action = actions[request.type];
  if (!action) return false;
  Promise.resolve().then(action).then(sendResponse).catch(error => sendResponse({error: readableError(error)}));
  return true;
});
