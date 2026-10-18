/**
 * Purpose: Smoke-test MV3 worker startup and regressions in image handoff ordering/quota.
 * Setup: Run node --test tests/service-worker.test.js; Chrome and image codecs are mocked.
 * Destructive behavior: None; no browser tabs, network requests, account actions, or writes.
 * Constraints: These tests exercise the real worker's control flow, not Chrome's image decoder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let workerSequence = 0;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushTasks() {
  for (let turn = 0; turn < 12; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(condition, description) {
  for (let turn = 0; turn < 100; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(description);
}

function imageResponse(label) {
  return new Response(new Blob([label], { type: 'image/png' }));
}

async function workerHarness(t) {
  const previousGlobals = new Map(
    ['chrome', 'fetch', 'createImageBitmap', 'OffscreenCanvas'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  t.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const events = {};
  function event(name) {
    const listeners = new Set();
    const value = {
      listeners,
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
      emit(...args) { return [...listeners].map((listener) => listener(...args)); },
    };
    events[name] = value;
    return value;
  }

  const harness = {
    events,
    session: {},
    menus: [],
    panelBehavior: null,
    openingGestures: [],
    fetchCalls: [],
    writeSizes: [],
    quotaFailures: 0,
    inGesture: false,
    fetchImpl: async () => imageResponse('default-image'),
  };

  globalThis.chrome = {
    runtime: {
      id: 'bullseye-worker-test',
      getURL: (path) => 'chrome-extension://bullseye-worker-test/' + path,
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
    },
    contextMenus: {
      onClicked: event('context'),
      async removeAll() { harness.menus.length = 0; },
      create(options) { harness.menus.push(options); },
    },
    sidePanel: {
      async setPanelBehavior(options) { harness.panelBehavior = options; },
      open() {
        harness.openingGestures.push(harness.inGesture);
        return Promise.resolve();
      },
    },
    storage: {
      session: {
        async get() { return { ...harness.session }; },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete harness.session[key];
        },
        async set(values) {
          const bytes = Buffer.byteLength(JSON.stringify({ ...harness.session, ...values }));
          harness.writeSizes.push(bytes);
          if (bytes > 10 * 1024 * 1024) {
            harness.quotaFailures += 1;
            throw new Error('QUOTA_BYTES quota exceeded');
          }
          Object.assign(harness.session, values);
        },
      },
    },
    permissions: { contains: async () => true },
    tabs: {
      query: async () => [{ id: 7, windowId: 2, url: 'https://page.example/photos' }],
      captureVisibleTab: async () => 'data:image/png;base64,capture-fixture',
    },
  };

  globalThis.fetch = async (url, options) => {
    // Keep only sizes/protocols in diagnostics; never dump an inline photo into a failure.
    harness.fetchCalls.push({ length: String(url).length, inline: String(url).startsWith('data:') });
    return harness.fetchImpl(url, options);
  };
  globalThis.createImageBitmap = async (blob) => ({
    width: 320,
    height: 180,
    label: await blob.text(),
    close() {},
  });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage: (bitmap) => { this.label = bitmap.label; } }; }
    async convertToBlob() { return new Blob([this.label], { type: 'image/png' }); }
  };

  harness.clickImage = (sourceUrl) => {
    harness.inGesture = true;
    try {
      events.context.emit(
        { menuItemId: 'bullseye-palette-from-image', srcUrl: sourceUrl },
        { id: 7, windowId: 2, url: 'https://page.example/photos' },
      );
    } finally { harness.inGesture = false; }
  };
  harness.send = (request) => new Promise((resolve) => {
    const results = events.message.emit(
      request,
      { id: chrome.runtime.id, url: chrome.runtime.getURL('picker.html') },
      resolve,
    );
    assert.ok(results.includes(true), 'The worker must keep the asynchronous response channel open.');
  });

  const workerUrl = new URL('../extension/service-worker.js', import.meta.url);
  workerUrl.searchParams.set('regression', String(++workerSequence));
  await import(workerUrl.href);
  return harness;
}

test('MV3 worker imports without DOM globals and registers/configures its entry points', async (t) => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const harness = await workerHarness(t);
  for (const name of ['installed', 'startup', 'context', 'message']) {
    assert.equal(harness.events[name].listeners.size, 1, name + ' listener was not registered.');
  }
  assert.equal(harness.fetchCalls.length, 0, 'Startup must not fetch a selected image.');
  harness.events.installed.emit();
  await waitFor(() => harness.panelBehavior !== null, 'Install configuration did not complete.');
  assert.deepEqual(harness.menus.map((menu) => [menu.id, menu.contexts]), [
    ['bullseye-palette-from-image', ['image']],
    ['bullseye-palette-from-page', ['page']],
  ]);
  assert.deepEqual(harness.panelBehavior, { openPanelOnActionClick: true });
});

test('latest image selection wins over an earlier slow success or error', async (t) => {
  const harness = await workerHarness(t);
  for (const outcome of ['success', 'error']) {
    const slow = deferred();
    const olderUrl = 'https://images.example/older-' + outcome + '.png';
    const newerUrl = 'https://images.example/newer-' + outcome + '.png';
    harness.fetchImpl = async (url) => url === olderUrl ? slow.promise : imageResponse('newer-' + outcome);
    harness.clickImage(olderUrl);
    harness.clickImage(newerUrl);
    await waitFor(
      () => harness.session.pendingImage?.sourceUrl === newerUrl && !!harness.session.pendingImage?.dataUrl,
      'The newer image did not finish first.',
    );

    slow.resolve(outcome === 'success'
      ? imageResponse('older-image')
      : new Response('Unavailable', { status: 403 }));
    await flushTasks();

    const pending = harness.session.pendingImage;
    assert.equal(pending.sourceUrl, newerUrl, 'An obsolete request overwrote the latest selected image.');
    assert.equal(pending.error, undefined, 'An obsolete error replaced a successful image.');
    assert.equal(Buffer.from(pending.dataUrl.split(',')[1], 'base64').toString(), 'newer-' + outcome);
  }
  assert.ok(harness.openingGestures.every(Boolean), 'The panel must open synchronously inside the context-menu gesture.');
});

test('obsolete permission-retry replies contain neither stale image bytes nor stale errors', async (t) => {
  const harness = await workerHarness(t);
  for (const outcome of ['success', 'error']) {
    const slow = deferred();
    const olderUrl = 'https://images.example/permission-retry-' + outcome + '.png';
    const newerUrl = 'https://images.example/latest-selection-' + outcome + '.png';
    let retryStarted = false;
    harness.fetchImpl = async (url) => {
      if (url === olderUrl) { retryStarted = true; return slow.promise; }
      return imageResponse('latest-selection');
    };
    const retryReply = harness.send({ type: 'FETCH_SELECTED_IMAGE', sourceUrl: olderUrl });
    await waitFor(() => retryStarted, 'The earlier permission retry did not start.');
    harness.clickImage(newerUrl);
    await waitFor(
      () => harness.session.pendingImage?.sourceUrl === newerUrl && !!harness.session.pendingImage?.dataUrl,
      'The latest selected image did not finish before the permission retry.',
    );
    slow.resolve(outcome === 'success'
      ? imageResponse('obsolete-permission-image')
      : new Response('Unavailable', { status: 403 }));

    assert.deepEqual(await retryReply, { stale: true }, 'An obsolete reply can bypass storage ordering in its UI caller.');
    assert.equal(harness.session.pendingImage.sourceUrl, newerUrl);
    assert.equal(harness.session.pendingImage.error, undefined);
  }
});

test('starting a visible-page capture invalidates an older image download', async (t) => {
  const harness = await workerHarness(t);
  const slow = deferred();
  let olderStarted = false;
  harness.fetchImpl = async (url) => {
    if (String(url).startsWith('data:')) return imageResponse('new-capture');
    olderStarted = true;
    return slow.promise;
  };
  harness.clickImage('https://images.example/older-than-capture.png');
  await waitFor(() => olderStarted, 'The original image download did not start.');
  const pendingBeforeCapture = harness.session.pendingImage;
  const capture = await harness.send({ type: 'CAPTURE_VISIBLE' });
  assert.equal(Buffer.from(capture.dataUrl.split(',')[1], 'base64').toString(), 'new-capture');
  slow.resolve(imageResponse('obsolete-image'));
  await flushTasks();
  assert.equal(harness.session.pendingImage, pendingBeforeCapture, 'The obsolete download published after capture started.');
});

test('cancelling a pending image removes it and prevents an in-flight retry from restoring it', async (t) => {
  const harness = await workerHarness(t);
  const slow = deferred();
  let retryStarted = false;
  harness.session.pendingImage = { sourceUrl: 'https://images.example/old.png', dataUrl: 'old-image' };
  harness.fetchImpl = async () => { retryStarted = true; return slow.promise; };
  const retry = harness.send({ type: 'FETCH_SELECTED_IMAGE', sourceUrl: 'https://images.example/pending.png' });
  await waitFor(() => retryStarted, 'The in-flight retry did not start.');
  assert.deepEqual(await harness.send({ type: 'CANCEL_PENDING_IMAGE' }), { cancelled: true });
  assert.equal(harness.session.pendingImage, undefined);
  slow.resolve(imageResponse('cancelled-image'));
  assert.deepEqual(await retry, { stale: true });
  assert.equal(harness.session.pendingImage, undefined, 'A cancelled image reappeared in session storage.');
});

test('large inline source URLs are decoded without duplicating their payload in session metadata', async (t) => {
  const harness = await workerHarness(t);
  const inlineSource = 'data:image/png;base64,' + 'A'.repeat(11 * 1024 * 1024);
  harness.fetchImpl = async () => imageResponse('small-reduced-image');
  harness.clickImage(inlineSource);
  await waitFor(() => !!harness.session.pendingImage?.dataUrl, 'The inline image was not handed to the picker.');
  await flushTasks();
  assert.equal(harness.fetchCalls[0].length, inlineSource.length, 'The decoder needs the original image source.');
  assert.equal(harness.fetchCalls[0].inline, true);
  assert.equal(harness.session.pendingImage.sourceUrl, '');
  assert.equal(harness.quotaFailures, 0, 'Raw inline image metadata exceeded session quota.');
  assert.ok(Math.max(...harness.writeSizes) < 4096, 'Only the mocked reduced image and small metadata should be stored.');

  const reply = await harness.send({ type: 'FETCH_SELECTED_IMAGE', sourceUrl: inlineSource });
  assert.equal(reply.sourceUrl, '', 'The message reply must not duplicate the original inline payload.');
  assert.ok(reply.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(harness.quotaFailures, 0);
});
