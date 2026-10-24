/**
 * Purpose: validate selected jars and use Bullseye's current customer/cart session.
 * Setup: imported by the MV3 worker; runBullseyeStoreAction is also injected as-is.
 * Destructive behavior: explicit add/clear actions change the native website cart.
 * Constraints: never checks out, reads credentials, or automatically retries a POST.
 */

export const BULLSEYE_ORIGIN = 'https://shop.bullseyeglass.com';
export const BULLSEYE_CART_URL = `${BULLSEYE_ORIGIN}/cart`;
export const BULLSEYE_LOGIN_URL = `${BULLSEYE_ORIGIN}/customer_authentication/login?return_to=%2Fcart`;

export function validateCartItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new Error('Choose at least one jar to send to your cart.');
  }
  const merged = new Map();
  for (const item of items) {
    const variantId = typeof item?.variantId === 'string' && /^[1-9]\d*$/.test(item.variantId)
      ? Number(item.variantId) : item?.variantId;
    if (!Number.isSafeInteger(variantId) || variantId < 1) throw new Error('A selected jar has no valid Bullseye variant ID.');
    if (!Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 9999) {
      throw new Error('Jar quantities must be whole numbers between 1 and 9,999.');
    }
    const quantity = (merged.get(variantId) || 0) + item.quantity;
    if (quantity > 9999) throw new Error('The combined quantity for one jar size cannot exceed 9,999.');
    merged.set(variantId, quantity);
  }
  return [...merged].sort(([a], [b]) => a - b).map(([variantId, quantity]) => ({variantId, quantity}));
}

/**
 * Self-contained because chrome.scripting serializes this function without imports.
 * The read-only account action can also run in the extension worker. Cart writes
 * must run in a native Bullseye tab, so browser cookie blocking cannot create a
 * separate extension-origin cart.
 */
export async function runBullseyeStoreAction(request) {
  const origin = 'https://shop.bullseyeglass.com';
  const defaultCartUrl = `${origin}/cart`;
  const checkedAt = Date.now();
  const unknown = (message = 'Open Bullseye or send your selection to check your sign-in.') => ({
    signedIn: null, status: 'unknown', message, checkedAt,
  });
  const fail = (error, code, extra = {}) => ({error, code, cartUrl: defaultCartUrl, ...extra});
  const plainText = (value) => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 360);
  const jsonFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000), ...options,
      headers: {Accept: 'application/json', ...options.headers},
    });
    const data = await response.json().catch(() => null);
    return {response, data};
  };
  const cartTotals = (cart) => {
    if (!cart || !Array.isArray(cart.items)) throw new Error('The store did not return a readable cart.');
    const totals = new Map();
    for (const item of cart.items) {
      const id = Number(item.variant_id ?? item.id);
      if (!Number.isSafeInteger(id) || !Number.isInteger(item.quantity) || item.quantity < 0) {
        throw new Error('The store did not return a readable cart.');
      }
      totals.set(id, (totals.get(id) || 0) + item.quantity);
    }
    return totals;
  };

  // Fresh server-rendered customer UI is authoritative; an old open tab can be
  // signed out in another tab. Horizon renders these nodes only for `customer`.
  // CSS, scripts, comments, generic account links, and footer text are ignored.
  const inspectAccount = (html) => {
    const markup = String(html).replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    let signedIn = false;
    let signedOut = false;
    for (const match of markup.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)) {
      const classes = match[0].match(/\sclass\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]?.split(/\s+/) || [];
      if (classes.includes('account-actions__email') || classes.includes('account-button__avatar')) {
        const content = markup.slice(match.index + match[0].length).split(/<\//, 1)[0];
        if (plainText(content).replace(/&(?:nbsp|#160);/g, '').trim()) signedIn = true;
      }
      if (classes.includes('account-actions__sign-ins')) signedOut = true;
    }
    if (/<(?:button|a)\b[^>]*\sclass\s*=\s*(["'])[^"']*\baccount-button\b[^"']*\1[^>]*>\s*<shop-user-avatar\b/i.test(markup)) signedIn = true;
    if (signedIn && signedOut) return unknown('Bullseye returned conflicting account information. Open your account and try again.');
    if (signedIn) return {signedIn: true, status: 'signed_in', message: 'Signed in to Bullseye', checkedAt};
    if (signedOut) return {signedIn: false, status: 'signed_out', message: 'Sign in to Bullseye before sending your colors.', checkedAt};
    return unknown('Bullseye did not return a recognized account status. Open your account and try again.');
  };

  if (!['account', 'add', 'read-cart', 'clear-cart'].includes(request?.kind)) return fail('Invalid store action.', 'INVALID_ACTION');
  if (['add','read-cart','clear-cart'].includes(request.kind) && (typeof location === 'undefined' || location.origin !== origin)) {
    return fail('Open Bullseye before changing your cart.', 'STORE_TAB_REQUIRED', {mutationStarted: false});
  }
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.origin !== origin) {
    return fail('The store tab has navigated away from Bullseye.', 'STORE_TAB_REQUIRED', {mutationStarted: false});
  }

  let html;
  try {
    const url = new URL('/cart', origin);
    url.searchParams.set('_bullseye_palette_check', String(checkedAt));
    const response = await fetch(url.href, {
      credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: {Accept: 'text/html'}, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok || (response.url && new URL(response.url).origin !== origin)) throw new Error('Store account check failed.');
    html = await response.text();
  } catch {
    const account = unknown('Could not check your Bullseye sign-in. Check your connection and open your account.');
    return request.kind === 'account' ? account : fail(account.message, 'ACCOUNT_UNKNOWN', {account, authRequired: true, mutationStarted: false});
  }
  const account = inspectAccount(html);
  if (request.kind === 'account') return account;
  if (account.signedIn !== true) {
    return fail(account.message, account.signedIn === false ? 'SIGN_IN_REQUIRED' : 'ACCOUNT_UNKNOWN', {
      account, authRequired: true, mutationStarted: false,
    });
  }

  // Use the store's locale root, but never allow a page value to change origin.
  const rootCandidate = html.match(/Shopify\.routes\.root\s*=\s*(["'])([^"']+)\1/)?.[2] || '/';
  const root = /^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(rootCandidate) && rootCandidate.length < 80 ? rootCandidate : '/';
  const cartUrl = new URL(`${root}cart`, origin).href;
  const cartApi = new URL(`${root}cart.js`, origin).href;
  // Explicit read/copy: return only product information, never cart tokens,
  // customer identity, credentials, addresses, notes or checkout information.
  if (request.kind === 'read-cart') {
    try {
      const {response, data} = await jsonFetch(cartApi);
      if (!response.ok) throw new Error('The website cart is unavailable.');
      cartTotals(data);
      const items = data.items.map(item => {
        const variantId = Number(item.variant_id ?? item.id);
        if (variantId < 1 || item.quantity < 1 || item.quantity > 999) {
          throw new Error('A website cart quantity is outside the supported 1 to 999 range.');
        }
        if (item.selling_plan_allocation || (item.properties && Object.keys(item.properties).length)) {
          throw new Error('This cart has custom or subscription items that cannot be copied faithfully. Your local cart was not replaced.');
        }
        return {variantId, quantity:item.quantity,
          name:plainText(item.product_title || item.title), sku:plainText(item.sku),
          title:plainText(item.variant_title || item.title),
          price:Number.isSafeInteger(item.final_price) && item.final_price >= 0 ? item.final_price
            : Number.isSafeInteger(item.price) && item.price >= 0 ? item.price : 0};
      });
      return {read:true, items, account, mutationStarted:false,
        itemCount:items.reduce((sum,item)=>sum+item.quantity,0), currency:plainText(data.currency || 'USD')};
    } catch (error) {
      return fail(plainText(error.message || 'The website cart could not be read.'), 'CART_READ_FAILED', {account, mutationStarted:false});
    }
  }
  // Emptying is a separate, explicit operation. An empty add request never clears
  // anything. Verify the website cart after one POST, including a lost response.
  if (request.kind === 'clear-cart') {
    let response;
    let data;
    try {
      ({response, data} = await jsonFetch(new URL(`${root}cart/clear.js`, origin).href, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:'{}',
      }));
    } catch { /* Read back before deciding whether the single POST succeeded. */ }
    let after;
    try {
      const result = await jsonFetch(cartApi);
      if (result.response.ok) after = cartTotals(result.data);
    } catch { /* Never retry a clear whose outcome could not be confirmed. */ }
    if (after && [...after.values()].every(quantity => quantity === 0)) {
      return {cleared:true, itemCount:0, cartUrl, account, mutationStarted:true};
    }
    const storeMessage = plainText(data?.description || data?.message || data?.errors);
    if (after && response && !response.ok && response.status >= 400 && response.status < 500) {
      return fail(storeMessage || 'Bullseye could not empty your cart. Try again when the store is available.', 'CART_CLEAR_REJECTED', {
        account, cartUrl, mutationStarted:true, uncertain:false,
      });
    }
    return fail('Bullseye did not confirm an empty cart. Check your website cart before trying again.', 'CART_CLEAR_UNCONFIRMED', {
      account, cartUrl, mutationStarted:true, uncertain:true,
    });
  }
  const items = request.items;
  if (!Array.isArray(items) || !items.length || items.some(item => !Number.isSafeInteger(item.variantId)
    || item.variantId < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999)) {
    return fail('Choose valid jars and whole-number quantities.', 'INVALID_ITEMS', {account, mutationStarted: false});
  }

  let before;
  try {
    const {response, data} = await jsonFetch(cartApi);
    if (!response.ok) throw new Error('The cart is unavailable.');
    before = cartTotals(data);
  } catch {
    return fail('Could not read your Bullseye cart. Nothing was sent. Try again when the store is available.', 'CART_UNAVAILABLE', {
      account, cartUrl, mutationStarted: false,
    });
  }

  let response;
  let data;
  try {
    ({response, data} = await jsonFetch(new URL(`${root}cart/add.js`, origin).href, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({items: items.map(item => ({id: item.variantId, quantity: item.quantity}))}),
    }));
  } catch { /* A lost response may still mean the store accepted the POST. Never retry it. */ }

  let after;
  try {
    const result = await jsonFetch(cartApi);
    if (result.response.ok) after = cartTotals(result.data);
  } catch { /* Report an uncertain outcome rather than adding the same jars twice. */ }
  const addedItems = items.map(item => ({
    variantId: item.variantId, requested: item.quantity,
    added: after ? Math.max(0, (after.get(item.variantId) || 0) - (before.get(item.variantId) || 0)) : null,
  }));
  const complete = !!after && addedItems.every(item => item.added >= item.requested);
  if (complete) {
    return {added: true, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), cartUrl, account, mutationStarted: true};
  }

  const storeMessage = plainText(data?.description || data?.message || data?.errors);
  if (after && addedItems.some(item => item.added > 0)) {
    return fail(`${storeMessage ? storeMessage + ' ' : ''}Only part of your selection was added. Check your Bullseye cart before sending more.`, 'CART_PARTIAL', {
      account, cartUrl, mutationStarted: true, uncertain: true, addedItems,
    });
  }
  if (after && response && !response.ok && response.status >= 400 && response.status < 500) {
    return fail(storeMessage || 'Bullseye could not add these jars. Check stock, jar sizes, and quantities.', 'CART_REJECTED', {
      account, cartUrl, mutationStarted: true, uncertain: false, addedItems,
    });
  }
  return fail('Bullseye did not confirm the added quantities. Check your cart before sending this selection again.', 'CART_UNCONFIRMED', {
    account, cartUrl, mutationStarted: true, uncertain: true, addedItems,
  });
}
