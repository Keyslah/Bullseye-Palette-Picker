/**
 * Purpose: verify source-tab handoff, pending-image cancellation, and valid SKU orders.
 * Setup: run with node --test; no Chrome account or store connection is required.
 * Destructive behavior: none; these tests never contact or change a shopping cart.
 * Constraints: Chrome calls are mocked; these tests do not verify real browser permissions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelPendingImage, emptyBullseyeCart, getBullseyeAccount, loadState, saveState, openCartPage, openWorkspace, sendToCart, signInToBullseye, validateOrderLines} from '../extension/lib/extension.js';

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
      create: async ({url,active}) => {
        order.push('open');
        assert.equal(saved.sourceTabId, 42);
        assert.equal(saved.sourceWindowId, 3);
        assert.equal(url, 'chrome-extension://bridge-test/picker.html?workspace=1');
        assert.equal(active,true);
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

test('Cart always creates an active extension tab without navigating any existing tab', async t => {
  const source={id:42,url:'https://shop.bullseyeglass.com/products/source-glass',active:true};
  const sourceBefore=structuredClone(source),created=[];
  replaceGlobal(t,'chrome',{
    runtime:{id:'bridge-test',getURL:path=>'chrome-extension://bridge-test/'+path},
    tabs:{
      query:async()=>[source],
      update:async()=>assert.fail('Cart must never navigate or reuse the source tab.'),
      create:async options=>{created.push(options);return {id:42+created.length,...options};},
    },
  });
  for(const mode of ['working','list','selection'])await openCartPage(mode);
  assert.deepEqual(created,['working','list','working'].map(mode=>({
    url:`chrome-extension://bridge-test/picker.html?workspace=1&cart=1&mode=${mode}`,active:true,
  })));
  assert.deepEqual(source,sourceBefore);
});

test('preview Cart opens a separate browsing context without changing the source location', async t => {
  const opened=[];
  replaceGlobal(t,'chrome',undefined);
  replaceGlobal(t,'location',{href:'http://localhost:8080/picker.html?workspace=1'});
  replaceGlobal(t,'window',{open:(...args)=>{opened.push(args);return null;}});
  const opening=openCartPage('list');
  assert.deepEqual(opened,[['http://localhost:8080/picker.html?workspace=1&cart=1&mode=list','_blank','noopener']]);
  await opening;
  assert.equal(location.href,'http://localhost:8080/picker.html?workspace=1');
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

test('a new deliberate send after success receives a fresh request ID immediately', async t => {
  const sent = [];
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async request=>{
    sent.push(request);return {added:true,itemCount:1};
  }}});
  const items = [{variantId:778899,quantity:1}];
  await sendToCart(items);
  await sendToCart(items);
  assert.equal(sent.length,2);
  assert.notEqual(sent[0].requestId,sent[1].requestId);
});

test('empty-cart bridge coalesces active clears, blocks additions, and releases the guard afterward', async t => {
  const sent = [];
  let resolve;
  const pending = new Promise(done=>{resolve=done;});
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async request=>{
    sent.push(request);
    return request.type === 'BULLSEYE_EMPTY_CART' ? pending : {added:true,itemCount:1};
  }}});
  const first = emptyBullseyeCart(), second = emptyBullseyeCart();
  await assert.rejects(sendToCart([{variantId:891234,quantity:1}]),/still being updated/);
  assert.deepEqual(sent,[{type:'BULLSEYE_EMPTY_CART'}]);
  resolve({cleared:true,itemCount:0});
  assert.equal((await first).cleared,true);
  assert.equal((await second).cleared,true);
  assert.equal((await sendToCart([{variantId:891234,quantity:1}])).added,true);
});

test('confirmed empty forgets an uncertain add ID so a later explicit addition starts fresh', async t => {
  const sent = [];
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async request=>{
    sent.push(request);
    if (request.type === 'BULLSEYE_EMPTY_CART') return {cleared:true,itemCount:0};
    if (sent.length === 1) return {error:'Check your cart',uncertain:true,code:'CART_UNCONFIRMED'};
    return {added:true,itemCount:1};
  }}});
  const items = [{variantId:991234,quantity:1}];
  await assert.rejects(sendToCart(items),error=>error.uncertain);
  await emptyBullseyeCart();
  await sendToCart(items);
  assert.notEqual(sent[0].requestId,sent[2].requestId);
});

test('empty-cart bridge rejects malformed confirmation and propagates sign-in failures', async t => {
  let result = {cleared:true,itemCount:2};
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async()=>result}});
  await assert.rejects(emptyBullseyeCart(),error=>error.code==='CART_CLEAR_UNCONFIRMED' && error.uncertain);
  result = {error:'Sign in first',code:'SIGN_IN_REQUIRED',authRequired:true};
  await assert.rejects(emptyBullseyeCart(),error=>error.authRequired && error.code==='SIGN_IN_REQUIRED');
});

test('workspace load errors propagate so startup cannot replace unread personal data with defaults', async t => {
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async()=>({error:'Storage unavailable'})}});
  await assert.rejects(loadState(),/Storage unavailable/);
  globalThis.chrome = undefined;
  replaceGlobal(t,'localStorage',{getItem:()=>'{broken'});
  await assert.rejects(loadState(),SyntaxError);
  globalThis.localStorage = {getItem:()=>null};
  assert.equal(await loadState(),null,'A genuinely missing project is still a new workspace.');
});

test('workspace saves hand off synchronously so immediate page unload cannot cancel the guard', async t => {
  const calls=[];let acknowledge;
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:request=>{
    calls.push(request);return new Promise(resolve=>{acknowledge=resolve;});
  }},storage:{local:{set(){throw new Error('The page must hand off to the worker.');}}}});
  const workspace={version:6,format:'fine',glassTypes:{transparent:true,opalescent:false},targets:[]};
  const saving=saveState(workspace);
  assert.deepEqual(calls,[{type:'BULLSEYE_SAVE_WORKSPACE',workspace,generation:''}]);
  acknowledge({saved:true});await saving;
});

test('workspace load uses the worker save barrier and rejects missing acknowledgements', async t=>{
  const calls=[];let result={loaded:true,workspace:{format:'fine'}};
  replaceGlobal(t,'chrome',{runtime:{id:'bridge-test',sendMessage:async request=>{calls.push(request);return result;}}});
  assert.deepEqual(await loadState(),{format:'fine'});
  assert.deepEqual(calls,[{type:'BULLSEYE_LOAD_WORKSPACE'}]);
  result={};await assert.rejects(loadState(),/could not be read/);
  await assert.rejects(saveState({targets:[]}),/not confirmed/);
  result={error:'Storage quota reached'};await assert.rejects(saveState({targets:[]}),/Storage quota/);
});
