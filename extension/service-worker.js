/**
 * Purpose: receive image context-menu clicks and hand photos to the palette picker.
 * Setup: Manifest V3 service worker; uses the user's current Chrome window/session.
 * Destructive behavior: explicit send/empty requests change the native website cart.
 * Constraints: photos stay local; never checks out or reads credentials.
 */
import {BULLSEYE_ORIGIN, BULLSEYE_CART_URL, BULLSEYE_LOGIN_URL, validateCartItems, runBullseyeStoreAction} from './lib/commerce.js';
import {findLinkedImage} from './lib/page-image.js';
import {guardPersonalDataGeneration} from './lib/personal-data-session.js';

const IMAGE_MENU = 'bullseye-palette-from-image';
const CAPTURE_MENU = 'bullseye-palette-from-page';
const MAX_DOWNLOAD = 20 * 1024 * 1024;
let currentImageRequest = 0;
const CART_JOURNAL_KEY = 'bullseyeCartRequestsV1';
let cartFlight = null;
let storeRequestTabId = null;
const WORKSPACE_KEY = 'bullseyeProjectV1';
let workspaceSaves = Promise.resolve();

function saveWorkspace(workspace, generation) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new Error('The palette workspace is not valid.');
  const snapshot = structuredClone(workspace);
  const save = workspaceSaves.then(() => guardPersonalDataGeneration(generation,async () => {
    await chrome.storage.local.set({[WORKSPACE_KEY]:snapshot});
    return {saved:true};
  }));
  workspaceSaves = save.catch(() => {});
  return save;
}

async function loadWorkspace() {
  // A freshly reloaded picker must wait for its old page's final queued save.
  await workspaceSaves;
  return {loaded:true,workspace:(await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY] ?? null};
}

async function configure() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id: IMAGE_MENU, title: 'Create Bullseye palette', contexts: ['image', 'link']});
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
        let sourceUrl = info.srcUrl || '';
        await publish({loading: true, sourceUrl}, requestId);
        if (!sourceUrl && info.linkUrl) {
          // Pinterest's hover overlay is a link, even when its photo is visible.
          // The context-menu gesture grants activeTab for this one DOM lookup.
          let results;
          try {
            results = await chrome.scripting.executeScript({
              target: {tabId: tab.id, frameIds: [Number.isInteger(info.frameId) ? info.frameId : 0]},
              world: 'ISOLATED', func: findLinkedImage, args: [info.linkUrl],
            });
          } catch {
            throw new Error('Chrome could not read that linked photo. Open the photo directly or use Capture page.');
          }
          const resolved = results?.[0]?.result;
          sourceUrl = typeof resolved === 'string' ? resolved : '';
        }
        if (requestId !== currentImageRequest) return;
        if (!sourceUrl) throw new Error('No photo was found in that link. Open the photo directly or use Capture page.');
        await fetchSelectedImage(sourceUrl, requestId);
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

function tabLoaded(tab) {
  return tab.status === 'complete' && !tab.pendingUrl;
}

async function tabReady(tabId) {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
    const check = () => chrome.tabs.get(tabId).then(tab => {
      if (tabLoaded(tab)) { done(); resolve(tab); }
    }).catch(error => { done(); reject(error); });
    const listener = (id, change) => { if (id === tabId && change.status === 'complete') void check(); };
    const timer = setTimeout(() => { done(); reject(new Error('Bullseye is still loading. Check your connection and try again.')); }, 15000);
    chrome.tabs.onUpdated.addListener(listener);
    void check();
  });
}

async function storeTab(create = false) {
  const tabs = (await chrome.tabs.query({url: `${BULLSEYE_ORIGIN}/*`})).filter(tab => {
    try { return new URL(tab.url).origin === BULLSEYE_ORIGIN; } catch { return false; }
  });
  // Keep using the established store document for immediate Send/Empty actions.
  // A newly opened result tab can still have a pending navigation even when its
  // previous document is reported as complete.
  tabs.sort((a, b) => Number(tabLoaded(b)) - Number(tabLoaded(a))
    || Number(b.id === storeRequestTabId) - Number(a.id === storeRequestTabId)
    || Number(b.url?.includes('/cart')) - Number(a.url?.includes('/cart'))
    || Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  let tab = tabs[0] || (create ? await chrome.tabs.create({url: BULLSEYE_CART_URL, active: false}) : null);
  if (tab && !tabLoaded(tab)) tab = await tabReady(tab.id);
  if (tab) storeRequestTabId = tab.id;
  return tab;
}

async function inStore(tab, action) {
  const results = await chrome.scripting.executeScript({
    target: {tabId: tab.id}, world: 'ISOLATED',
    func: runBullseyeStoreAction, args: [action],
  });
  const result = results.find(entry => entry.frameId === 0)?.result || results[0]?.result;
  if (!result) throw new Error('Bullseye did not return a result.');
  return result;
}

async function bullseyeAccount() {
  try {
    const tab = await storeTab();
    // Prefer the actual store session to an extension-origin request. Fetch fresh
    // customer HTML even when an existing tab still shows an older login state.
    return tab ? await inStore(tab, {kind: 'account'}) : await runBullseyeStoreAction({kind: 'account'});
  } catch {
    return {signedIn: null, status: 'unknown', checkedAt: Date.now(), message: 'Could not check your Bullseye sign-in. Open your account or send your selection to check again.'};
  }
}

async function signInToBullseye() {
  await chrome.tabs.create({url: BULLSEYE_LOGIN_URL, active: true});
  return {opened: true};
}

async function showNativeCart(url = BULLSEYE_CART_URL) {
  // The only destination accepted here is this store's cart, including its locale.
  let destination = BULLSEYE_CART_URL;
  try {
    const parsed = new URL(url);
    if (parsed.origin === BULLSEYE_ORIGIN && /^\/(?:[a-zA-Z0-9_-]+\/)*cart$/.test(parsed.pathname)) destination = parsed.href;
  } catch { /* Keep the verified default cart URL. */ }
  try {
    // The store tab used for the request may be the user's source product page.
    // Always open the result separately so its URL, history and page state survive.
    await chrome.tabs.create({url: destination, active: true});
    return true;
  } catch { return false; }
}

async function sendCart(items, requestId) {
  const cleaned = validateCartItems(items);
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new Error('The cart request is not valid.');
  const signature = JSON.stringify(cleaned);
  if (cartFlight) {
    if (cartFlight.kind === 'add' && cartFlight.signature === signature) return cartFlight.promise;
    return {error: 'Your Bullseye cart is still being updated.', code: 'CART_BUSY'};
  }
  const promise = sendCartOnce(cleaned, requestId, signature);
  cartFlight = {kind:'add', signature, promise};
  try { return await promise; }
  finally { if (cartFlight?.promise === promise) cartFlight = null; }
}

async function sendCartOnce(items, requestId, signature) {
  const saved = await chrome.storage.local.get(CART_JOURNAL_KEY);
  const journal = Array.isArray(saved[CART_JOURNAL_KEY]) ? saved[CART_JOURNAL_KEY].slice(-19) : [];
  const prior = journal.find(entry => entry.requestId === requestId);
  if (prior?.status === 'complete') {
    await showNativeCart(prior.result.cartUrl);
    return {...prior.result, duplicate: true};
  }
  const unresolved = journal.find(entry => entry.signature === signature && ['pending', 'uncertain'].includes(entry.status));
  if (unresolved) {
    await showNativeCart();
    return {
      error: 'A previous attempt to send this selection was not confirmed. Check your Bullseye cart before changing your selection and sending again.',
      code: 'CART_UNCONFIRMED', uncertain: true, cartUrl: BULLSEYE_CART_URL,
    };
  }
  const tab = await storeTab(true);
  const record = {requestId, signature, status: 'pending', updatedAt: Date.now()};
  journal.push(record);
  // Write the journal before a POST is possible. A restarted worker must not
  // blindly resend a request whose page response was lost.
  await chrome.storage.local.set({[CART_JOURNAL_KEY]: journal});
  let result;
  try {
    result = await inStore(tab, {kind: 'add', items});
    if (result.added !== true && typeof result.error !== 'string') throw new Error('Missing cart confirmation.');
  } catch {
    result = {
      error: 'The store tab closed or stopped responding. Check your Bullseye cart before sending this selection again.',
      code: 'CART_UNCONFIRMED', uncertain: true, cartUrl: BULLSEYE_CART_URL,
    };
  }
  record.updatedAt = Date.now();
  if (result.added === true) {
    record.status = 'complete';
    record.result = result;
    await chrome.storage.local.set({[CART_JOURNAL_KEY]: journal});
    return {...result, opened: await showNativeCart(result.cartUrl)};
  }
  if (result.uncertain) record.status = 'uncertain';
  else journal.splice(journal.indexOf(record), 1);
  await chrome.storage.local.set({[CART_JOURNAL_KEY]: journal});
  if (result.uncertain) await showNativeCart(result.cartUrl);
  return result;
}

async function emptyCart() {
  if (cartFlight) {
    if (cartFlight.kind === 'clear') return cartFlight.promise;
    return {error:'Wait for your current Bullseye cart addition to finish before emptying it.', code:'CART_BUSY'};
  }
  const promise = emptyCartOnce();
  cartFlight = {kind:'clear', promise};
  try { return await promise; }
  finally { if (cartFlight?.promise === promise) cartFlight = null; }
}

async function emptyCartOnce() {
  const tab = await storeTab(true);
  let result;
  try {
    result = await inStore(tab, {kind:'clear-cart'});
    if ((result.cleared === true && result.itemCount !== 0)
      || (result.cleared !== true && typeof result.error !== 'string')) throw new Error('Missing empty-cart confirmation.');
  } catch {
    result = {error:'The store tab stopped responding. Check your Bullseye cart before emptying it again.',
      code:'CART_CLEAR_UNCONFIRMED', uncertain:true, cartUrl:BULLSEYE_CART_URL};
  }
  if (result.cleared === true) {
    // Emptying resolves outstanding additions, while completed operation IDs
    // remain protected against an old message being replayed after the clear.
    const saved = await chrome.storage.local.get(CART_JOURNAL_KEY);
    const journal = Array.isArray(saved[CART_JOURNAL_KEY]) ? saved[CART_JOURNAL_KEY] : [];
    await chrome.storage.local.set({[CART_JOURNAL_KEY]:journal.filter(entry => !['pending','uncertain'].includes(entry.status))});
    return {...result, opened:await showNativeCart(result.cartUrl)};
  }
  if (result.uncertain) await showNativeCart(result.cartUrl);
  return result;
}

async function productVariants(handle) {
  if (!/^[a-z0-9-]+$/.test(handle || '')) throw new Error('Invalid Bullseye product.');
  const response = await fetch(`https://shop.bullseyeglass.com/products/${handle}.js`, {signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('Could not refresh this product. The store will confirm stock when adding jars.');
  const product = await response.json();
  return {variants: product.variants.map(v => ({id: v.id, sku: v.sku, title: v.title, available: v.available, price: v.price}))};
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (request.type === 'BULLSEYE_SAVE_WORKSPACE' || request.type === 'BULLSEYE_LOAD_WORKSPACE') {
    // Queue these synchronously in receive order, before the sending page exits.
    try {
      const action = request.type === 'BULLSEYE_SAVE_WORKSPACE' ? saveWorkspace(request.workspace,request.generation) : loadWorkspace();
      Promise.resolve(action).then(sendResponse).catch(error => sendResponse({error:readableError(error)}));
    } catch (error) { sendResponse({error:readableError(error)}); }
    return true;
  }
  const actions = {
    FETCH_SELECTED_IMAGE: () => fetchSelectedImage(request.sourceUrl),
    CAPTURE_VISIBLE: captureSource,
    CANCEL_PENDING_IMAGE: cancelPendingImage,
    BULLSEYE_ACCOUNT: bullseyeAccount,
    BULLSEYE_READ_CART: async () => inStore(await storeTab(true), {kind:'read-cart'}),
    BULLSEYE_SIGN_IN: signInToBullseye,
    BULLSEYE_SEND_CART: () => sendCart(request.items, request.requestId),
    BULLSEYE_EMPTY_CART: emptyCart,
    PRODUCT_VARIANTS: () => productVariants(request.handle),
  };
  const action = actions[request.type];
  if (!action) return false;
  Promise.resolve().then(action).then(sendResponse).catch(error => sendResponse({error: readableError(error)}));
  return true;
});
