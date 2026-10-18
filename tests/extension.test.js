/**
 * Purpose: verify source-tab handoff, pending-image cancellation, and valid SKU orders.
 * Setup: run with node --test; no Chrome account or store connection is required.
 * Destructive behavior: none; these tests never contact or change a shopping cart.
 * Constraints: Chrome calls are mocked; these tests do not verify real browser permissions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelPendingImage, getBullseyeAccount, openWorkspace, sendToCart, signInToBullseye, validateOrderLines} from '../extension/lib/extension.js';

test('Copied SKU order preserves distinct real package SKUs and whole jar quantities', () => {
  assert.equal(validateOrderLines('001426-0002-F-P001 2\n001120-0002-F-OZ05\t1'), '001426-0002-F-P001 2\n001120-0002-F-OZ05 1');
});
test('Copied SKU order rejects empty, fractional, zero, negative, and markup-bearing lines', () => {
  for (const value of ['', '001426-0002-F-P001 0', '001426-0002-F-P001 -1', '001426-0002-F-P001 1.5', '<script> 1', '001426-0002-F-P001 2\nhttp://example.com 1']) {
    assert.throws(() => validateOrderLines(value));
  }
});

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

test('opening a workspace saves the source tab before switching to the extension tab', async (t) => {
  const saved = {};
  const order = [];
  let active = {id: 42, windowId: 3, url: 'https://photos.example/inspiration'};
  replaceGlobal(t, 'chrome', {
    runtime: {id: 'bridge-test', getURL: (path) => 'chrome-extension://bridge-test/' + path},
    storage: {session: {set: async (values) => { Object.assign(saved, values); order.push('save'); }}},
    tabs: {
      query: async () => [active],
      create: async ({url}) => {
        order.push('open');
        assert.equal(saved.sourceTabId, 42);
        assert.equal(saved.sourceWindowId, 3);
        assert.equal(url, 'chrome-extension://bridge-test/picker.html?workspace=1');
        return {id: 43};
      },
    },
  });
  assert.deepEqual(await openWorkspace(), {id: 43});
  assert.deepEqual(order, ['save', 'open']);
  active = {id: 43, windowId: 3, url: 'chrome-extension://bridge-test/picker.html'};
  await openWorkspace();
  assert.deepEqual(order, ['save', 'open', 'open'], 'An extension tab must not replace the remembered source.');
});

test('preview workspace opening stays synchronous and image cancellation is harmless', async (t) => {
  let opened = false;
  replaceGlobal(t, 'chrome', undefined);
  replaceGlobal(t, 'location', {href: 'http://localhost:8080/picker.html'});
  replaceGlobal(t, 'window', {open(url, target, features) {
    opened = true;
    assert.equal(url, 'http://localhost:8080/picker.html?workspace=1');
    assert.equal(target, '_blank');
    assert.equal(features, 'noopener');
    return null;
  }});
  const opening = openWorkspace();
  assert.equal(opened, true, 'Do not await anything before opening a preview tab.');
  await opening;
  assert.deepEqual(await cancelPendingImage(), {cancelled: true});
});

test('the cancellation bridge awaits the worker acknowledgement', async (t) => {
  const sent = [];
  replaceGlobal(t, 'chrome', {
    runtime: {
      id: 'bridge-test',
      sendMessage: async (request) => { sent.push(request); return {cancelled: true}; },
    },
  });
  assert.deepEqual(await cancelPendingImage(), {cancelled: true});
  assert.deepEqual(sent, [{type: 'CANCEL_PENDING_IMAGE'}]);
});

test('account bridge reports a preview without pretending to be authenticated', async (t) => {
  replaceGlobal(t, 'chrome', undefined);
  const result = await getBullseyeAccount();
  assert.equal(result.signedIn, null);
  assert.equal(result.status, 'preview');
});

test('the account and sign-in bridge use only their scoped worker actions', async (t) => {
  const sent = [];
  replaceGlobal(t, 'chrome', {runtime: {id: 'bridge-test', sendMessage: async request => {
    sent.push(request);
    return request.type === 'BULLSEYE_ACCOUNT' ? {signedIn: true, status: 'signed_in'} : {opened: true};
  }}});
  assert.equal((await getBullseyeAccount()).signedIn, true);
  assert.deepEqual(await signInToBullseye(), {opened: true});
  assert.deepEqual(sent, [{type: 'BULLSEYE_ACCOUNT'}, {type: 'BULLSEYE_SIGN_IN'}]);
});

test('concurrent send clicks share one request and preserve the selected jar quantities', async (t) => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const sent = [];
  replaceGlobal(t, 'chrome', {runtime: {id: 'bridge-test', sendMessage: async request => { sent.push(request); return pending; }}});
  const items = [{variantId: 123456, quantity: 1}, {variantId: 123456, quantity: 2}];
  const first = sendToCart(items);
  const second = sendToCart(items);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'BULLSEYE_SEND_CART');
  assert.match(sent[0].requestId, /^[a-zA-Z0-9-]{16,80}$/);
  assert.deepEqual(sent[0].items, [{variantId: 123456, quantity: 3}]);
  resolve({added: true, itemCount: 3, cartUrl: 'https://shop.bullseyeglass.com/cart'});
  assert.equal((await first).added, true);
  assert.equal((await second).added, true);
});

test('auth errors reach the picker and an uncertain attempt retains its request ID', async (t) => {
  const sent = [];
  let outcome = {error: 'Sign in first', code: 'SIGN_IN_REQUIRED', authRequired: true};
  replaceGlobal(t, 'chrome', {runtime: {id: 'bridge-test', sendMessage: async request => { sent.push(request); return outcome; }}});
  const items = [{variantId: 567890, quantity: 1}];
  await assert.rejects(sendToCart(items), error => error.authRequired === true && error.code === 'SIGN_IN_REQUIRED');
  outcome = {error: 'Check your cart', code: 'CART_UNCONFIRMED', uncertain: true, cartUrl: 'https://shop.bullseyeglass.com/cart'};
  await assert.rejects(sendToCart(items), error => error.uncertain === true && error.cartUrl.endsWith('/cart'));
  await assert.rejects(sendToCart(items), error => error.code === 'CART_UNCONFIRMED');
  assert.notEqual(sent[0].requestId, sent[1].requestId, 'A safe pre-mutation rejection can be retried after sign-in.');
  assert.equal(sent[1].requestId, sent[2].requestId, 'An uncertain add must not become an unrelated new request.');
});

test('missing or malformed worker replies never become a successful cart or sign-in confirmation', async (t) => {
  const sent = [];
  let response;
  replaceGlobal(t, 'chrome', {runtime: {id: 'bridge-test', sendMessage: async request => { sent.push(request); return response; }}});
  assert.equal((await getBullseyeAccount()).signedIn, null);
  const items = [{variantId: 765432, quantity: 1}];
  await assert.rejects(sendToCart(items), error => error.code === 'CART_UNCONFIRMED' && error.uncertain === true);
  response = {opened: true};
  await assert.rejects(sendToCart(items), error => error.code === 'CART_UNCONFIRMED' && error.uncertain === true);
  assert.equal(sent[1].requestId, sent[2].requestId, 'Malformed replies must retain the operation identity.');
});
