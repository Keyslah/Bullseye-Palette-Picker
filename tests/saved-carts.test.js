/**
 * Validate saved order data and ensure failed browser storage cannot report a save.
 * Native IndexedDB roundtrip/duplicate coverage runs in disposable Chrome QA.
 * These tests never open Bullseye or submit a cart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCartName, normalizeCartItems, copiedCartName} from '../extension/lib/saved-carts.js';

const pink = Object.freeze({
  productId:'001215', variantId:52850270011665, quantity:2,
  name:'Light Pink Striker', sku:'001215-0002-F-P005', title:'5 lb. jar',
  image:'assets/glass/001215.jpg', price:31335, available:false,
});
const black = Object.freeze({
  productId:'000100', variantId:52850314739985, quantity:1,
  name:'Black', sku:'000100-0002-F-P005', title:'5 lb. jar',
  image:'assets/glass/000100.jpg', price:10750, available:true,
});

test('saved jars preserve chosen IDs, sizes, quantities, and unavailable status without retaining unrelated data', () => {
  const source = Object.freeze([{...pink, sourceDataUrl:'private-photo', nested:{private:true}}, black]);
  const saved = normalizeCartItems(source);
  assert.equal(saved[0].variantId, pink.variantId);
  assert.equal(saved[0].title, '5 lb. jar');
  assert.equal(saved[0].quantity, 2);
  assert.equal(saved[0].available, false, 'Storage must not substitute another in-stock size.');
  assert.equal(saved[0].key, `001215:${pink.variantId}`);
  assert.equal(saved[0].name, pink.name);
  assert.equal(saved[0].sku, pink.sku);
  assert.equal(saved[0].image, pink.image);
  assert.equal(saved[0].price, pink.price);
  assert.equal('sourceDataUrl' in saved[0], false);
  assert.equal('nested' in saved[0], false);
  saved[0].quantity = 9;
  assert.equal(source[0].quantity, 2, 'Saved edits must not alter the source palette selection.');
  assert.notEqual(saved[1], black);
});

test('repeated variants merge once while preserving distinct colors and caller data', () => {
  const input = Object.freeze([pink, black, Object.freeze({...pink, variantId:String(pink.variantId), quantity:3})]);
  const saved = normalizeCartItems(input);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map(item => [item.variantId, item.quantity]), [[pink.variantId,5],[black.variantId,1]]);
  assert.equal(input[0].quantity, 2);
  assert.throws(() => normalizeCartItems([pink, {...pink, productId:black.productId}]), /two glass colors/);
});

test('invalid order IDs and glass codes are rejected instead of repaired or invented', () => {
  for (const variantId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER+1, Infinity, null, undefined, '', '0', '01', '1e3', '12.5', ' 123 ']) {
    assert.throws(() => normalizeCartItems([{...pink, variantId}]), /variant ID/, `Rejected ${String(variantId)}`);
  }
  for (const productId of ['', ' ', null, undefined, 1215, 'x'.repeat(121)]) {
    assert.throws(() => normalizeCartItems([{...pink, productId}]), /glass code/);
  }
  for (const input of [null, {}, 'jars']) assert.throws(() => normalizeCartItems(input), /list of jars/);
});

test('quantities must be whole positive jars and duplicates cannot silently exceed 999', () => {
  for (const quantity of [0, -1, 1.5, '2', 1000, Infinity, NaN, null]) {
    assert.throws(() => normalizeCartItems([{...pink, quantity}]), /between 1 and 999/);
  }
  assert.equal(normalizeCartItems([{...pink, quantity:999}])[0].quantity, 999);
  assert.equal(normalizeCartItems([{...pink, quantity:998}, {...pink, quantity:1}])[0].quantity, 999);
  assert.throws(() => normalizeCartItems([{...pink, quantity:999}, {...pink, quantity:1}]), /combined quantity/);
  assert.deepEqual(normalizeCartItems([]), [], 'An edited cart can be saved after its last jar is removed.');
});

test('cart names trim whitespace and reject missing or overlong names', () => {
  assert.equal(normalizeCartName('  Spring kiln  '), 'Spring kiln');
  assert.equal(normalizeCartName('x'.repeat(80)), 'x'.repeat(80));
  for (const name of ['', ' \n ', null, undefined, {}, 12]) assert.throws(() => normalizeCartName(name), /name/);
  assert.throws(() => normalizeCartName('x'.repeat(81)), /80 characters/);
});

test('copy names remain recognizable and unique within the name length limit', () => {
  assert.equal(copiedCartName('Spring kiln'), 'Spring kiln copy');
  assert.equal(copiedCartName('Spring kiln', ['SPRING KILN COPY', 'Spring kiln copy 2']), 'Spring kiln copy 3');
  assert.equal(copiedCartName('Spring kiln', ['Spring kiln copy 2']), 'Spring kiln copy');
  const long = 'x'.repeat(80), first = copiedCartName(long), second = copiedCartName(long, [first]);
  assert.equal(first.length, 80);
  assert.equal(second.length, 80);
  assert.ok(first.endsWith(' copy'));
  assert.ok(second.endsWith(' copy 2'));
  assert.notEqual(first, second);
});

let moduleNumber = 0;
const freshModule = () => import(`../extension/lib/saved-carts.js?test=${++moduleNumber}`);

function setIndexedDB(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {configurable:true, writable:true, value});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  });
}

test('invalid save/load/delete requests fail before opening browser storage', async t => {
  let openings = 0;
  setIndexedDB(t, {open() { openings++; throw new Error('Must not open'); }});
  const {saveCart, loadCart, duplicateCart, deleteCart} = await freshModule();
  await assert.rejects(saveCart('', [pink]), /name/);
  await assert.rejects(saveCart('Spring', [{...pink, quantity:0}]), /quantities/);
  await assert.rejects(saveCart('Spring', [pink], ''), /valid ID/);
  await assert.rejects(loadCart(''), /valid ID/);
  await assert.rejects(duplicateCart(''), /valid ID/);
  await assert.rejects(deleteCart(''), /valid ID/);
  assert.equal(openings, 0);
});

test('unavailable storage and open errors surface, and an open failure can be retried', async t => {
  setIndexedDB(t, undefined);
  const {listCarts} = await freshModule();
  await assert.rejects(listCarts(), /unavailable in this browser/);
  let openings = 0;
  const unavailable = new Error('The browser refused saved-cart storage.');
  globalThis.indexedDB = {open(name, version) {
    openings++;
    assert.equal(name, 'bullseyeSavedCarts');
    assert.equal(version, 1);
    const request = {error:unavailable};
    queueMicrotask(() => request.onerror());
    return request;
  }};
  await assert.rejects(listCarts(), error => error === unavailable);
  await assert.rejects(listCarts(), error => error === unavailable);
  assert.equal(openings, 2, 'A failed opening must not leave a permanently rejected cache.');
});

test('a staged write that aborts never reports a successfully saved cart', async t => {
  const quota = new Error('Saved-cart storage is full.');
  let staged;
  setIndexedDB(t, {open() {
    const request = {result:{
      transaction(storeName, mode) {
        assert.equal(storeName, 'carts');
        assert.equal(mode, 'readwrite');
        const tx = {error:null, objectStore() { return {add(value) {
          staged = value;
          queueMicrotask(() => {
            tx.error = quota;
            tx.onerror({target:{error:quota}});
            tx.onabort();
          });
        }}; }};
        return tx;
      },
    }};
    queueMicrotask(() => request.onsuccess());
    return request;
  }});
  const {saveCart} = await freshModule();
  await assert.rejects(saveCart('Spring', [pink, black]), error => error === quota);
  assert.equal(staged.colorCount, 2);
  assert.equal(staged.jarCount, 3);
  assert.equal(staged.items[0].variantId, pink.variantId);
});

test('a blocked opening reports the problem and closes a connection that arrives afterward', async t => {
  let request, closed = 0;
  setIndexedDB(t, {open() {
    request = {};
    queueMicrotask(() => request.onblocked());
    return request;
  }});
  const {listCarts} = await freshModule();
  await assert.rejects(listCarts(), /Close other Bullseye picker tabs/);
  request.result = {close() { closed++; }};
  request.onsuccess();
  assert.equal(closed, 1);
});
