/**
 * Purpose: verify source-tab handoff, pending-image cancellation, and valid SKU orders.
 * Setup: run with node --test; no Chrome account or store connection is required.
 * Destructive behavior: none; these tests never contact or change a shopping cart.
 * Constraints: Chrome calls are mocked; these tests do not verify real browser permissions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelPendingImage, openWorkspace, validateOrderLines} from '../extension/lib/extension.js';

test('Quick Add order preserves distinct real package SKUs and whole jar quantities', () => {
  assert.equal(validateOrderLines('001426-0002-F-P001 2\n001120-0002-F-OZ05\t1'), '001426-0002-F-P001 2\n001120-0002-F-OZ05 1');
});
test('Quick Add rejects empty, fractional, zero, negative, and markup-bearing lines', () => {
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
