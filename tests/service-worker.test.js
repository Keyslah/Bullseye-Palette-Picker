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
    local: {},
    menus: [],
    panelBehavior: null,
    openingGestures: [],
    fetchCalls: [],
    writeSizes: [],
    quotaFailures: 0,
    inGesture: false,
    fetchImpl: async () => imageResponse('default-image'),
    tabs: [{id: 7, windowId: 2, status: 'complete', url: 'https://page.example/photos'}],
    scripts: [],
    tabCreates: [],
    tabUpdates: [],
    scriptImpl: async () => ({signedIn: true, status: 'signed_in'}),
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
      local: {
        async get() { return structuredClone(harness.local); },
        async set(values) { Object.assign(harness.local, structuredClone(values)); },
      },
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
      query: async () => harness.tabs,
      get: async id => {
        const tab = harness.tabs.find(value => value.id === id);
        if (!tab) throw new Error('No tab with this ID.');
        return {...tab};
      },
      onUpdated: event('tabUpdated'),
      create: async options => {
        harness.tabCreates.push({...options});
        const tab = {id: 80 + harness.tabs.length, windowId: 2, status: 'complete', ...options};
        harness.tabs.push(tab);
        return tab;
      },
      update: async (id, options) => {
        harness.tabUpdates.push({id, ...options});
        const tab = harness.tabs.find(value => value.id === id);
        Object.assign(tab, options);
        return tab;
      },
      captureVisibleTab: async () => 'data:image/png;base64,capture-fixture',
    },
    scripting: {
      executeScript: async options => {
        harness.scripts.push(options);
        return [{frameId: 0, result: await harness.scriptImpl(options)}];
      },
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

  harness.clickContext = (info) => {
    harness.inGesture = true;
    try {
      events.context.emit(
        { menuItemId: 'bullseye-palette-from-image', ...info },
        { id: 7, windowId: 2, url: 'https://page.example/photos' },
      );
    } finally { harness.inGesture = false; }
  };
  harness.clickImage = (sourceUrl) => harness.clickContext({srcUrl: sourceUrl});
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
    ['bullseye-palette-from-image', ['image', 'link']],
    ['bullseye-palette-from-page', ['page']],
  ]);
  assert.deepEqual(harness.panelBehavior, { openPanelOnActionClick: true });
});

test('workspace saves survive page handoff and a new load waits for them in receive order', async t=>{
  const harness=await workerHarness(t),gate=deferred(),started=deferred();
  const originalGet=chrome.storage.local.get,writes=[];
  let delay=true;
  chrome.storage.local.get=async key=>{
    if(key==='bullseyePersonalDataGenerationV1' && delay){delay=false;started.resolve();await gate.promise;}
    return originalGet(key);
  };
  chrome.storage.local.set=async values=>{writes.push(structuredClone(values));Object.assign(harness.local,structuredClone(values));};
  harness.local.bullseyeProjectV1={format:'medium'};
  const fine={version:6,format:'fine',targets:[]};
  const powder={version:6,format:'powder',targets:[]};
  const first=harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:fine,generation:''});
  const second=harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:powder,generation:''});
  let loaded=false;
  const reading=harness.send({type:'BULLSEYE_LOAD_WORKSPACE'}).then(value=>{loaded=true;return value;});
  await started.promise;await flushTasks();
  assert.equal(loaded,false,'The next picker must not restore the old Medium setting while the final save is pending.');
  assert.deepEqual(writes,[]);
  gate.resolve();
  assert.deepEqual(await first,{saved:true});assert.deepEqual(await second,{saved:true});
  assert.deepEqual(await reading,{loaded:true,workspace:powder});
  assert.deepEqual(writes.map(value=>value.bullseyeProjectV1.format),['fine','powder']);
});

test('workspace worker rejects a stale restored-data generation without blocking fresh loads or saves', async t=>{
  const harness=await workerHarness(t);
  harness.local.bullseyePersonalDataGenerationV1={generation:'restored-generation',restoring:false};
  harness.local.bullseyeProjectV1={format:'fine'};
  const rejected=await harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:{format:'medium'},generation:''});
  assert.match(rejected.error,/changed in another picker tab/);
  assert.deepEqual(await harness.send({type:'BULLSEYE_LOAD_WORKSPACE'}),{loaded:true,workspace:{format:'fine'}});
  assert.deepEqual(await harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:{format:'coarse'},generation:'restored-generation'}),{saved:true});
  assert.equal(harness.local.bullseyeProjectV1.format,'coarse');
});

test('workspace worker reports read/write failures and rejects malformed handoffs', async t=>{
  const harness=await workerHarness(t);
  const originalSet=chrome.storage.local.set;
  chrome.storage.local.set=async()=>{throw new Error('Workspace quota exceeded');};
  assert.match((await harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:{targets:[]},generation:''})).error,/quota exceeded/);
  chrome.storage.local.set=originalSet;
  assert.match((await harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:[],generation:''})).error,/not valid/);
  assert.match((await harness.send({type:'BULLSEYE_SAVE_WORKSPACE',workspace:{targets:[]}})).error,/session is not valid/);
  chrome.storage.local.get=async()=>{throw new Error('Workspace read denied');};
  assert.match((await harness.send({type:'BULLSEYE_LOAD_WORKSPACE'})).error,/read denied/);
});

test('Pinterest link-only clicks resolve the linked image in the clicked frame', async (t) => {
  const harness = await workerHarness(t);
  for (const frameId of [undefined, 9]) {
    const linkUrl = 'https://www.pinterest.com/pin/123456/';
    const sourceUrl = `https://images.example/pin-${frameId ?? 0}.png`;
    harness.scriptImpl = async options => {
      assert.deepEqual(options.target, {tabId: 7, frameIds: [frameId ?? 0]});
      assert.equal(options.world, 'ISOLATED');
      assert.equal(options.func.name, 'findLinkedImage');
      assert.deepEqual(options.args, [linkUrl]);
      return sourceUrl;
    };
    harness.clickContext({linkUrl, frameId});
    await waitFor(() => harness.session.pendingImage?.sourceUrl === sourceUrl && !!harness.session.pendingImage?.dataUrl,
      'The photo underneath the link was not handed to the picker.');
  }
  assert.ok(harness.openingGestures.every(Boolean), 'Link selection must still open the panel inside the original gesture.');
});

test('a directly clicked image takes precedence over its surrounding link', async (t) => {
  const harness = await workerHarness(t);
  const sourceUrl = 'https://images.example/direct.png';
  harness.clickContext({srcUrl: sourceUrl, linkUrl: 'https://www.pinterest.com/pin/123456/'});
  await waitFor(() => !!harness.session.pendingImage?.dataUrl, 'The direct image did not load.');
  assert.equal(harness.session.pendingImage.sourceUrl, sourceUrl);
  assert.equal(harness.scripts.length, 0, 'Ordinary image clicks do not need page inspection.');
});

test('missing linked images and denied page access give capture feedback without guessing an image', async (t) => {
  const harness = await workerHarness(t);
  for (const outcome of ['missing', 'malformed', 'denied']) {
    harness.scriptImpl = async () => {
      if (outcome === 'denied') throw new Error('Cannot access frame');
      return outcome === 'missing' ? '' : {unrelated: 'not an image URL'};
    };
    harness.clickContext({linkUrl: 'https://www.pinterest.com/pin/123456/'});
    await flushTasks();
    assert.match(harness.session.pendingImage.error, /Capture page/);
    assert.equal(harness.session.pendingImage.dataUrl, undefined);
  }
  assert.equal(harness.fetchCalls.length, 0, 'An unresolved link must never be fetched as though it were a photo.');
});

test('a delayed linked-image lookup cannot replace or download over a newer photo', async (t) => {
  const harness = await workerHarness(t);
  const slow = deferred();
  const olderUrl = 'https://images.example/older-link.png';
  const newerUrl = 'https://images.example/newer-direct.png';
  let obsoleteFetched = false;
  harness.scriptImpl = async () => slow.promise;
  harness.fetchImpl = async url => {
    if (url === olderUrl) obsoleteFetched = true;
    return imageResponse('newer-direct');
  };
  harness.clickContext({linkUrl: 'https://www.pinterest.com/pin/123456/'});
  await waitFor(() => harness.scripts.length === 1, 'The link lookup did not start.');
  harness.clickImage(newerUrl);
  await waitFor(() => harness.session.pendingImage?.sourceUrl === newerUrl && !!harness.session.pendingImage?.dataUrl,
    'The newer direct image did not finish.');
  slow.resolve(olderUrl);
  await flushTasks();
  assert.equal(harness.session.pendingImage.sourceUrl, newerUrl);
  assert.equal(harness.session.pendingImage.error, undefined);
  assert.equal(obsoleteFetched, false, 'A stale lookup should stop before downloading its image.');
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

test('account checks prefer a fresh native-store request over an extension cookie context', async (t) => {
  const harness = await workerHarness(t);
  harness.tabs.push({id: 91, windowId: 2, status: 'complete', url: 'https://shop.bullseyeglass.com/products/green'});
  harness.scriptImpl = async options => {
    assert.deepEqual(options.target, {tabId: 91});
    assert.equal(options.world, 'ISOLATED');
    assert.equal(options.args[0].kind, 'account');
    return {signedIn: true, status: 'signed_in'};
  };
  const result = await harness.send({type: 'BULLSEYE_ACCOUNT'});
  assert.equal(result.signedIn, true);
  assert.equal(harness.fetchCalls.length, 0, 'A native store tab must take precedence over cross-origin account checks.');
  assert.equal(harness.tabs.length, 2, 'Read-only account checks should not create extra tabs.');
});

test('direct cart journals before execution, coalesces double clicks, and opens the native cart once', async (t) => {
  const harness = await workerHarness(t);
  const source={id:91,windowId:2,status:'complete',url:'https://shop.bullseyeglass.com/products/source-glass',active:true};
  const sourceBefore=structuredClone(source);harness.tabs.push(source);
  const pause = deferred();
  let started = false;
  harness.scriptImpl = async options => {
    assert.equal(options.args[0].kind, 'add');
    assert.equal(options.world, 'ISOLATED');
    assert.equal(harness.local.bullseyeCartRequestsV1[0].status, 'pending', 'The replay guard must exist before a POST is possible.');
    started = true;
    await pause.promise;
    return {added: true, itemCount: 2, cartUrl: 'https://shop.bullseyeglass.com/cart'};
  };
  const request = {type: 'BULLSEYE_SEND_CART', requestId: 'test-request-1234567890', items: [{variantId: 100, quantity: 2}]};
  const first = harness.send(request);
  await waitFor(() => started, 'The native cart operation did not begin.');
  const doubleClick = harness.send({...request, requestId: 'test-request-9876543210'});
  pause.resolve();
  assert.equal((await first).added, true);
  assert.equal((await doubleClick).added, true);
  assert.equal(harness.scripts.length, 1);
  assert.deepEqual(harness.tabCreates,[{url:'https://shop.bullseyeglass.com/cart',active:true}]);
  assert.equal(harness.tabUpdates.length,0,'Displaying a cart must never navigate an existing source tab.');
  assert.deepEqual(source,sourceBefore);
  assert.equal(harness.local.bullseyeCartRequestsV1[0].status, 'complete');

  const replay = await harness.send(request);
  assert.equal(replay.added, true);
  assert.equal(replay.duplicate, true);
  assert.equal(harness.scripts.length, 1, 'The same transaction must not cause a second native cart write.');
  assert.equal(harness.tabCreates.length,2,'Even a replay displays the existing cart in a new tab.');
  assert.equal(harness.tabUpdates.length,0);
});

test('empty and uncertain cart results open new tabs while preserving the Bullseye source page', async t=>{
  const harness=await workerHarness(t);
  const source={id:91,windowId:2,status:'complete',url:'https://shop.bullseyeglass.com/products/source-glass',active:true};
  const sourceBefore=structuredClone(source);harness.tabs.push(source);
  harness.scriptImpl=async()=>({cleared:true,itemCount:0,cartUrl:'https://shop.bullseyeglass.com/en/cart'});
  assert.equal((await harness.send({type:'BULLSEYE_EMPTY_CART'})).opened,true);
  assert.deepEqual(harness.tabCreates,[{url:'https://shop.bullseyeglass.com/en/cart',active:true}]);
  harness.scriptImpl=async()=>({error:'Check cart',code:'CART_UNCONFIRMED',uncertain:true,cartUrl:'https://wrong.example/cart'});
  assert.equal((await harness.send({type:'BULLSEYE_SEND_CART',requestId:'new-tab-uncertain-123456',items:[{variantId:100,quantity:1}]})).uncertain,true);
  assert.equal(harness.tabCreates.at(-1).url,'https://shop.bullseyeglass.com/cart','An untrusted destination still falls back to the verified cart.');
  assert.equal(harness.tabCreates.length,2);
  assert.equal(harness.tabUpdates.length,0);
  assert.deepEqual(source,sourceBefore);
});

test('immediate repeat sends and empty use the established store tab while new result tabs navigate', async t=>{
  const harness=await workerHarness(t);
  const source={id:91,windowId:2,status:'complete',url:'https://shop.bullseyeglass.com/products/source-glass'};
  harness.tabs.push(source);
  harness.scriptImpl=async options=>options.args[0].kind==='clear-cart'
    ? {cleared:true,itemCount:0,cartUrl:'https://shop.bullseyeglass.com/cart'}
    : {added:true,itemCount:1,cartUrl:'https://shop.bullseyeglass.com/cart'};
  const request={type:'BULLSEYE_SEND_CART',requestId:'stable-store-first-123456',items:[{variantId:100,quantity:1}]};
  assert.equal((await harness.send(request)).added,true);
  // Chrome may report the previous document as complete before this navigation commits.
  harness.tabs.at(-1).pendingUrl='https://shop.bullseyeglass.com/cart';
  assert.equal((await harness.send({...request,requestId:'stable-store-second-123456'})).added,true);
  // Even once a result page has loaded, subsequent actions keep the working document.
  assert.equal((await harness.send({type:'BULLSEYE_EMPTY_CART'})).cleared,true);
  assert.deepEqual(harness.scripts.map(options=>options.target.tabId),[91,91,91]);
  assert.equal(harness.tabCreates.length,3);
  assert.equal(harness.tabUpdates.length,0);
  assert.equal(source.url,'https://shop.bullseyeglass.com/products/source-glass');
});

test('store requests wait for a pending navigation even when Chrome reports complete', async t=>{
  const harness=await workerHarness(t);
  const tab={id:91,windowId:2,status:'complete',url:'https://shop.bullseyeglass.com/cart',
    pendingUrl:'https://shop.bullseyeglass.com/cart'};
  harness.tabs.push(tab);
  harness.scriptImpl=async()=>({items:[],itemCount:0});
  const pending=harness.send({type:'BULLSEYE_READ_CART'});
  await waitFor(()=>harness.events.tabUpdated.listeners.size>0,'The worker did not wait for the pending store document.');
  harness.events.tabUpdated.emit(91,{status:'complete'});
  await flushTasks();
  assert.equal(harness.scripts.length,0,'A complete old document must not receive the next store request.');
  delete tab.pendingUrl;
  harness.events.tabUpdated.emit(91,{status:'complete'});
  assert.deepEqual(await pending,{items:[],itemCount:0});
  assert.equal(harness.scripts.length,1);
  assert.equal(harness.events.tabUpdated.listeners.size,0);
});

test('an uncertain native cart attempt blocks a new-ID retry of the same selection', async (t) => {
  const harness = await workerHarness(t);
  harness.scriptImpl = async () => ({error: 'Check your cart', code: 'CART_UNCONFIRMED', uncertain: true});
  const request = {type: 'BULLSEYE_SEND_CART', requestId: 'uncertain-request-123456', items: [{variantId: 100, quantity: 2}]};
  const first = await harness.send(request);
  assert.equal(first.uncertain, true);
  const second = await harness.send({...request, requestId: 'uncertain-request-654321'});
  assert.equal(second.uncertain, true);
  assert.equal(harness.scripts.length, 1, 'A lost response must not silently double the same jars.');
  assert.equal(harness.local.bullseyeCartRequestsV1[0].status, 'uncertain');
});

test('signed-out rejection is safe to retry after sign-in, without poisoning the cart journal', async (t) => {
  const harness = await workerHarness(t);
  harness.scriptImpl = async () => ({error: 'Sign in first', code: 'SIGN_IN_REQUIRED', authRequired: true, mutationStarted: false});
  const request = {type: 'BULLSEYE_SEND_CART', requestId: 'signed-out-request-12345', items: [{variantId: 100, quantity: 1}]};
  assert.equal((await harness.send(request)).authRequired, true);
  assert.equal(harness.local.bullseyeCartRequestsV1.length, 0);
  assert.equal(harness.tabUpdates.length, 0, 'Do not claim a cart addition or navigate to it after sign-in rejection.');
  harness.scriptImpl = async () => ({added: true, itemCount: 1, cartUrl: 'https://shop.bullseyeglass.com/cart'});
  assert.equal((await harness.send({...request, requestId: 'signed-in-request-12345'})).added, true);
  assert.equal(harness.scripts.length, 2);
});

test('an interrupted worker record prevents blind resend after restart', async (t) => {
  const harness = await workerHarness(t);
  const items = [{variantId: 100, quantity: 1}];
  harness.local.bullseyeCartRequestsV1 = [{requestId: 'previous-worker-12345678', signature: JSON.stringify(items), status: 'pending', updatedAt: Date.now()}];
  const result = await harness.send({type: 'BULLSEYE_SEND_CART', requestId: 'restarted-worker-1234567', items});
  assert.equal(result.uncertain, true);
  assert.equal(harness.scripts.length, 0);
});

test('new explicit send IDs can add the same quantities again immediately after success', async t => {
  const harness = await workerHarness(t);
  harness.scriptImpl = async()=>({added:true,itemCount:1,cartUrl:'https://shop.bullseyeglass.com/cart'});
  const request = {type:'BULLSEYE_SEND_CART',requestId:'repeat-send-first-123456',items:[{variantId:100,quantity:1}]};
  assert.equal((await harness.send(request)).added,true);
  assert.equal((await harness.send({...request,requestId:'repeat-send-second-12345'})).added,true);
  assert.equal(harness.scripts.length,2,'A completed selection must not suppress a new deliberate click.');
  assert.equal((await harness.send(request)).duplicate,true);
  assert.equal(harness.scripts.length,2,'Replaying the same request ID remains protected.');
});

test('empty website cart resolves uncertain adds, preserves personal data, and retains completed replay IDs', async t => {
  const harness = await workerHarness(t);
  const items = [{variantId:100,quantity:1}];
  const completed = {requestId:'completed-add-123456789',signature:JSON.stringify([{variantId:200,quantity:1}]),
    status:'complete',updatedAt:Date.now(),result:{added:true,itemCount:1,cartUrl:'https://shop.bullseyeglass.com/cart'}};
  harness.local.bullseyeCartRequestsV1 = [completed,
    {requestId:'uncertain-add-123456789',signature:JSON.stringify(items),status:'uncertain',updatedAt:Date.now()},
    {requestId:'pending-add-12345678900',signature:JSON.stringify(items),status:'pending',updatedAt:Date.now()}];
  harness.local.bullseyeWorkingCartV1 = {items:[{variantId:100,quantity:1}]};
  harness.local.bullseyeSettingsV1 = {format:'fine'};
  harness.scriptImpl = async options=>options.args[0].kind === 'clear-cart'
    ? {cleared:true,itemCount:0,cartUrl:'https://shop.bullseyeglass.com/cart'}
    : {added:true,itemCount:1,cartUrl:'https://shop.bullseyeglass.com/cart'};
  const cleared = await harness.send({type:'BULLSEYE_EMPTY_CART'});
  assert.equal(cleared.cleared,true);
  assert.equal(cleared.opened,true);
  assert.equal(harness.scripts[0].args[0].kind,'clear-cart');
  assert.deepEqual(harness.local.bullseyeCartRequestsV1,[completed]);
  assert.deepEqual(harness.local.bullseyeWorkingCartV1,{items:[{variantId:100,quantity:1}]});
  assert.deepEqual(harness.local.bullseyeSettingsV1,{format:'fine'});
  assert.equal((await harness.send({type:'BULLSEYE_SEND_CART',requestId:'after-clear-send-1234567',items})).added,true);
  assert.equal((await harness.send({type:'BULLSEYE_SEND_CART',requestId:completed.requestId,items:[{variantId:200,quantity:1}]})).duplicate,true);
  assert.equal(harness.scripts.length,2);
});

test('worker serializes add and empty operations and coalesces concurrent empty clicks', async t => {
  const harness = await workerHarness(t);
  const addPause = deferred(), clearPause = deferred();
  harness.scriptImpl = async options=>{
    if (options.args[0].kind === 'add') {await addPause.promise;return {added:true,itemCount:1};}
    await clearPause.promise;return {cleared:true,itemCount:0};
  };
  const request = {type:'BULLSEYE_SEND_CART',requestId:'parallel-add-123456789',items:[{variantId:100,quantity:1}]};
  const adding = harness.send(request);
  await waitFor(()=>harness.scripts.length===1,'Addition did not begin.');
  assert.equal((await harness.send({type:'BULLSEYE_EMPTY_CART'})).code,'CART_BUSY');
  addPause.resolve();await adding;
  const clearing = harness.send({type:'BULLSEYE_EMPTY_CART'});
  await waitFor(()=>harness.scripts.length===2,'Clear did not begin.');
  const repeatedClear = harness.send({type:'BULLSEYE_EMPTY_CART'});
  assert.equal((await harness.send({...request,requestId:'parallel-add-new-123456'})).code,'CART_BUSY');
  clearPause.resolve();
  assert.equal((await clearing).cleared,true);
  assert.equal((await repeatedClear).cleared,true);
  assert.equal(harness.scripts.length,2);
});

test('unconfirmed empty preserves replay guards and does not retry the store mutation', async t => {
  const harness = await workerHarness(t);
  harness.local.bullseyeCartRequestsV1 = [{requestId:'old-uncertain-123456789',status:'uncertain',signature:'keep'}];
  const before = structuredClone(harness.local);
  harness.scriptImpl = async()=>{throw new Error('Tab gone');};
  const result = await harness.send({type:'BULLSEYE_EMPTY_CART'});
  assert.equal(result.code,'CART_CLEAR_UNCONFIRMED');
  assert.equal(result.uncertain,true);
  assert.equal(harness.scripts.length,1);
  assert.deepEqual(harness.local,before);
});
