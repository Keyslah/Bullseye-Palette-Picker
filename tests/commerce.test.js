/**
 * Purpose: verify the real native-store function against account/cart response fixtures.
 * Setup: run node --test; fetch and the store origin are replaced for each test.
 * Destructive behavior: none; all cart reads/writes are local JavaScript fixtures.
 * Constraints: customer markers track the current Bullseye Horizon theme, not all shops.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BULLSEYE_ORIGIN, runBullseyeStoreAction, validateCartItems} from '../extension/lib/commerce.js';

const signedInHeader = '<header><button class="account-button"><span class="account-button__avatar">A</span></button></header><footer><a href="/account">Sign In</a></footer>';
const signedOutHeader = '<header><button class="account-button"><span class="account-button__icon"><svg></svg></span></button><div class="account-actions__sign-ins"><a href="/customer_authentication/login">Sign in</a></div></header>';
const chosen = [{variantId: 12345678901234, quantity: 2}, {variantId: 12345678901235, quantity: 1}];

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function store(t, options = {}) {
  const fixture = {
    html: options.html ?? signedInHeader,
    calls: [], posts: [], clearPosts:[],
    cart: options.cart ?? [{id: 9000, quantity: 4}, {id: chosen[0].variantId, quantity: 3}],
    cartReads: 0,
  };
  replaceGlobal(t, 'location', {origin: BULLSEYE_ORIGIN, protocol: 'https:'});
  replaceGlobal(t, 'fetch', async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, BULLSEYE_ORIGIN);
    assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    fixture.calls.push({url: parsed.href, method: init.method || 'GET'});
    if (parsed.pathname.endsWith('/cart/clear.js')) {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'application/json');
      const body = JSON.parse(init.body);
      fixture.clearPosts.push(body);
      if (options.clearPost) return options.clearPost(body,fixture);
      fixture.cart = [];
      return Response.json({items:[],item_count:0});
    }
    if (parsed.pathname.endsWith('/cart/add.js')) {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'application/json');
      const body = JSON.parse(init.body);
      fixture.posts.push(body);
      if (options.post) return options.post(body, fixture);
      for (const item of body.items) {
        const existing = fixture.cart.find(line => line.id === item.id);
        if (existing) existing.quantity += item.quantity;
        else fixture.cart.push({...item});
      }
      return Response.json({items: fixture.cart.filter(line => body.items.some(item => item.id === line.id))});
    }
    if (parsed.pathname.endsWith('/cart.js')) {
      fixture.cartReads += 1;
      if (options.cartRead) return options.cartRead(fixture);
      return Response.json({items: fixture.cart});
    }
    assert.equal(parsed.pathname, '/cart');
    return new Response(fixture.html, {headers: {'Content-Type': 'text/html'}});
  });
  return fixture;
}

test('cart validation merges real variant IDs and rejects unsafe quantities or IDs', () => {
  assert.deepEqual(validateCartItems([{variantId: '12', quantity: 2}, {variantId: 12, quantity: 1}, {variantId: 2, quantity: 3}]), [
    {variantId: 2, quantity: 3}, {variantId: 12, quantity: 3},
  ]);
  for (const items of [[], null, [{variantId: 12, quantity: 0}], [{variantId: 12, quantity: 1.5}], [{variantId: 12, quantity: '1'}], [{variantId: 'https://evil.example', quantity: 1}], [{variantId: Number.MAX_SAFE_INTEGER + 1, quantity: 1}], [{variantId: 12, quantity: 9999}, {variantId: 12, quantity: 1}]]) {
    assert.throws(() => validateCartItems(items));
  }
});

test('a real customer avatar is signed in even with a permanent footer Sign In link', async (t) => {
  const fixture = store(t);
  const account = await runBullseyeStoreAction({kind: 'account'});
  assert.equal(account.signedIn, true);
  assert.equal(account.status, 'signed_in');
  assert.equal(fixture.posts.length, 0);
  assert.deepEqual(Object.keys(account).sort(), ['checkedAt', 'message', 'signedIn', 'status']);
});

test('customer avatar image and customer-only email markers are supported without returning identity', async (t) => {
  const fixture = store(t, {html: '<button class="account-button"><shop-user-avatar></shop-user-avatar></button>'});
  assert.equal((await runBullseyeStoreAction({kind: 'account'})).signedIn, true);
  fixture.html = '<header class="account-actions__header"><span class="account-actions__email">fixture@example.invalid</span></header>';
  const account = await runBullseyeStoreAction({kind: 'account'});
  assert.equal(account.signedIn, true);
  assert.equal(JSON.stringify(account).includes('@'), false);
});

test('signed-out header or blank avatar does not count as an authenticated customer', async (t) => {
  const fixture = store(t, {html: signedOutHeader});
  assert.equal((await runBullseyeStoreAction({kind: 'account'})).signedIn, false);
  fixture.html = '<span class="account-button__avatar"> </span>' + signedOutHeader;
  assert.equal((await runBullseyeStoreAction({kind: 'account'})).signedIn, false);
});

test('scripts, CSS, footer links, and missing or conflicting customer markers stay unknown', async (t) => {
  const fixture = store(t);
  for (const html of [
    '<footer><a href="/account">Sign in</a></footer>',
    '<style>.account-button__avatar {color:red}</style><script>const example = \'<span class="account-button__avatar">A</span>\';</script>',
    '<!-- <span class="account-button__avatar">A</span> --><span data-class="account-button__avatar">A</span>',
    signedInHeader + signedOutHeader,
  ]) {
    fixture.html = html;
    assert.equal((await runBullseyeStoreAction({kind: 'account'})).signedIn, null);
  }
});

test('account fetch failure is unknown, never a claim that the customer is signed out', async (t) => {
  replaceGlobal(t, 'fetch', async () => { throw new Error('Offline'); });
  const account = await runBullseyeStoreAction({kind: 'account'});
  assert.equal(account.signedIn, null);
  assert.equal(account.status, 'unknown');
});

test('one native POST adds all selected variants, preserves existing jars, and verifies quantities', async (t) => {
  const fixture = store(t);
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.added, true);
  assert.equal(result.itemCount, 3);
  assert.equal(result.cartUrl, `${BULLSEYE_ORIGIN}/cart`);
  assert.deepEqual(fixture.posts, [{items: chosen.map(item => ({id: item.variantId, quantity: item.quantity}))}]);
  assert.deepEqual(fixture.cart, [{id: 9000, quantity: 4}, {id: chosen[0].variantId, quantity: 5}, {id: chosen[1].variantId, quantity: 1}]);
  assert.equal(fixture.cartReads, 2);
  assert.equal(fixture.calls.some(call => /clear|update|checkout/.test(call.url)), false);
});

test('fresh signed-out or unknown account HTML stops the operation before any cart mutation', async (t) => {
  const fixture = store(t, {html: signedOutHeader});
  // An old open page still showing an avatar must not override the fresh response.
  replaceGlobal(t, 'document', {documentElement: {outerHTML: signedInHeader}});
  for (const [html, code] of [[signedOutHeader, 'SIGN_IN_REQUIRED'], ['<header>Loading</header>', 'ACCOUNT_UNKNOWN']]) {
    fixture.html = html;
    const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
    assert.equal(result.code, code);
    assert.equal(result.authRequired, true);
    assert.equal(result.mutationStarted, false);
  }
  assert.equal(fixture.posts.length, 0);
  assert.equal(fixture.cartReads, 0);
});

test('cart writes require the actual Bullseye origin', async (t) => {
  const fixture = store(t);
  replaceGlobal(t, 'location', {origin: 'chrome-extension://fixture', protocol: 'chrome-extension:'});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'STORE_TAB_REQUIRED');
  assert.equal(fixture.calls.length, 0);
});

test('an unreadable existing cart prevents adding before the baseline is known', async (t) => {
  const fixture = store(t, {cartRead: () => Response.json({error: 'Down'}, {status: 503})});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'CART_UNAVAILABLE');
  assert.equal(result.mutationStarted, false);
  assert.equal(fixture.posts.length, 0);
});

test('native stock rejection is surfaced and is not retried', async (t) => {
  const fixture = store(t, {post: () => Response.json({description: 'The requested jar is sold out.'}, {status: 422})});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'CART_REJECTED');
  assert.equal(result.uncertain, false);
  assert.match(result.error, /sold out/);
  assert.equal(fixture.posts.length, 1);
});

test('partial inventory fulfillment reports exactly what changed and never sends another POST', async (t) => {
  const fixture = store(t, {post: (_body, current) => {
    current.cart[1].quantity += 1;
    return Response.json({description: 'Only one jar is available.'}, {status: 422});
  }});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'CART_PARTIAL');
  assert.equal(result.uncertain, true);
  assert.deepEqual(result.addedItems.map(item => item.added), [1, 0]);
  assert.equal(fixture.posts.length, 1);
});

test('a lost add response is recovered from the native cart without duplicating quantities', async (t) => {
  const fixture = store(t, {post: (body, current) => {
    for (const item of body.items) {
      const line = current.cart.find(value => value.id === item.id);
      if (line) line.quantity += item.quantity;
      else current.cart.push({...item});
    }
    throw new Error('Connection dropped after store accepted the jars.');
  }});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.added, true);
  assert.equal(fixture.posts.length, 1);
});

test('a lost response with no confirmed quantities stays uncertain instead of retrying', async (t) => {
  const fixture = store(t, {post: () => { throw new Error('No response'); }});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'CART_UNCONFIRMED');
  assert.equal(result.uncertain, true);
  assert.equal(fixture.posts.length, 1);
});

test('verification failure after a POST is uncertain even if the initial response was successful', async (t) => {
  const fixture = store(t, {cartRead: current => current.cartReads === 1
    ? Response.json({items: current.cart}) : Response.json({error: 'Down'}, {status: 503})});
  const result = await runBullseyeStoreAction({kind: 'add', items: chosen});
  assert.equal(result.code, 'CART_UNCONFIRMED');
  assert.equal(result.uncertain, true);
  assert.equal(fixture.posts.length, 1);
});

test('cart API calls follow the store locale while rejecting external route values', async (t) => {
  const fixture = store(t, {html: signedInHeader + '<script>Shopify.routes.root = "/en/";</script>'});
  assert.equal((await runBullseyeStoreAction({kind: 'add', items: chosen})).cartUrl, `${BULLSEYE_ORIGIN}/en/cart`);
  assert.ok(fixture.calls.filter(call => call.url.endsWith('.js')).every(call => new URL(call.url).pathname.startsWith('/en/')));
  fixture.html = signedInHeader + '<script>Shopify.routes.root = "https://evil.example/";</script>';
  assert.equal((await runBullseyeStoreAction({kind: 'add', items: chosen})).cartUrl, `${BULLSEYE_ORIGIN}/cart`);
});

test('explicit empty-cart action clears once and verifies the website cart using the locale route', async t => {
  const fixture = store(t,{html:signedInHeader + '<script>Shopify.routes.root = "/en/";</script>'});
  const result = await runBullseyeStoreAction({kind:'clear-cart'});
  assert.equal(result.cleared,true);
  assert.equal(result.itemCount,0);
  assert.equal(result.cartUrl,`${BULLSEYE_ORIGIN}/en/cart`);
  assert.deepEqual(fixture.cart,[]);
  assert.deepEqual(fixture.clearPosts,[{}]);
  assert.equal(fixture.posts.length,0);
  assert.equal(fixture.cartReads,1);
  assert.deepEqual(fixture.calls.filter(call=>call.url.endsWith('.js')).map(call=>[new URL(call.url).pathname,call.method]),[
    ['/en/cart/clear.js','POST'],['/en/cart.js','GET'],
  ]);
});

test('empty additions and read-only account checks cannot clear a cart', async t => {
  const fixture = store(t);
  const before = structuredClone(fixture.cart);
  assert.equal((await runBullseyeStoreAction({kind:'add',items:[]})).code,'INVALID_ITEMS');
  assert.equal((await runBullseyeStoreAction({kind:'account'})).signedIn,true);
  assert.deepEqual(fixture.cart,before);
  assert.equal(fixture.clearPosts.length,0);
});

test('empty-cart actions require native store origin and fresh signed-in customer HTML', async t => {
  const fixture = store(t,{html:signedOutHeader});
  assert.equal((await runBullseyeStoreAction({kind:'clear-cart'})).code,'SIGN_IN_REQUIRED');
  fixture.html = '<header>Loading</header>';
  assert.equal((await runBullseyeStoreAction({kind:'clear-cart'})).code,'ACCOUNT_UNKNOWN');
  globalThis.location = {origin:'chrome-extension://fixture',protocol:'chrome-extension:'};
  const calls = fixture.calls.length;
  assert.equal((await runBullseyeStoreAction({kind:'clear-cart'})).code,'STORE_TAB_REQUIRED');
  assert.equal(fixture.calls.length,calls);
  assert.equal(fixture.clearPosts.length,0);
});

test('a lost clear response is verified by reading the cart and is never POSTed again', async t => {
  const fixture = store(t,{clearPost:(_body,current)=>{current.cart=[];throw new Error('Lost response');}});
  assert.equal((await runBullseyeStoreAction({kind:'clear-cart'})).cleared,true);
  assert.equal(fixture.clearPosts.length,1);
  assert.equal(fixture.cartReads,1);
});

test('a failed clear or unreadable verification is surfaced without a second POST', async t => {
  const fixture = store(t,{clearPost:()=>Response.json({description:'Cart is unavailable.'},{status:422})});
  const result = await runBullseyeStoreAction({kind:'clear-cart'});
  assert.equal(result.code,'CART_CLEAR_REJECTED');
  assert.equal(result.uncertain,false);
  assert.equal(result.cleared,undefined);
  assert.match(result.error,/unavailable/);
  assert.equal(fixture.clearPosts.length,1);
});

test('clear verification failure stays uncertain even when the POST returned an empty cart', async t => {
  const fixture = store(t,{cartRead:()=>Response.json({error:'Unavailable'},{status:503})});
  const result = await runBullseyeStoreAction({kind:'clear-cart'});
  assert.equal(result.code,'CART_CLEAR_UNCONFIRMED');
  assert.equal(result.uncertain,true);
  assert.equal(result.cleared,undefined);
  assert.equal(fixture.clearPosts.length,1);
});
