/**
 * Purpose: keep saved target-to-glass choices through the per-form photo migration.
 * Setup: node --test; pure workspace fixtures with valid catalog IDs.
 * Writes: none; no browser storage, photo operations, accounts, or cart requests.
 * Constraints: explicit choices win; fresh/current records keep automatic matching.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {preservedPhotoGuideMatches} from '../extension/lib/photo-guide-workspace.js';

const targets = [
  {id:'blue',rgb:[40,110,130],custom:true,x:.2,y:.3},
  {id:'orange',rgb:[245,145,20],x:.6,y:.2},
  {id:'excluded',rgb:[135,180,130],x:.8,y:.7},
];
const products = [{id:'001108'}, {id:'001025'}, {id:'001321'}, {id:'001247'}];

test('older workspaces retain valid saved automatic target bindings without guessing from cart items', () => {
  const saved = {
    version:6, chosenMatches:{orange:'001025'}, targets, sourceDataUrl:'data:image/png;base64,stored-photo',
    selection:{version:1,targetKeys:{blue:'001108:52850285576465',orange:'001321:52850285609233',excluded:'001247:52850285642001'},
      excludedTargetIds:['excluded'],excludedProductIds:['001247'],manualKeys:['001321:52850285609233']},
    cart:[{productId:'001321',variantId:52850285609233,quantity:7}],
  };
  const before = structuredClone(saved);
  assert.deepEqual(preservedPhotoGuideMatches(saved, targets, products), {orange:'001025',blue:'001108',excluded:'001247'});
  assert.deepEqual(saved, before);
});

test('current photo-guide records keep normal automatic matching for fresh or edited targets', () => {
  const saved = {photoGuideVersion:1, chosenMatches:{orange:'001025'},
    selection:{targetKeys:{blue:'001108:52850285576465',orange:'001321:52850285609233'}}};
  const result = preservedPhotoGuideMatches(saved, targets, products);
  assert.deepEqual(result, {orange:'001025'});
  assert.notEqual(result, saved.chosenMatches);
});

test('missing bindings and unrelated saved cart products cannot become chosen matches', () => {
  for (const selection of [undefined, {}, {targetKeys:[]}, {manualKeys:['001108:52850285576465']}]) {
    const saved = {selection,cart:[{productId:'001108',variantId:52850285576465}],chosenMatches:{orange:'001025'}};
    assert.deepEqual(preservedPhotoGuideMatches(saved, targets, products), {orange:'001025'});
  }
});

test('unknown targets, unknown glass and malformed keys cannot produce migrated bindings', () => {
  const invalidKeys = ['unknown:123', '001108', ':123', '001108:', '001108:0', '001108:-1', '001108:abc', '001108:12:34', 123, null];
  for (const key of invalidKeys) assert.deepEqual(preservedPhotoGuideMatches({selection:{targetKeys:{blue:key}}}, targets, products), {});
  assert.deepEqual(preservedPhotoGuideMatches({selection:{targetKeys:{deleted:'001108:123'}}}, targets, products), {});
  assert.deepEqual(preservedPhotoGuideMatches({selection:{targetKeys:{blue:'001108:123'}}}, [], products), {});
  assert.deepEqual(preservedPhotoGuideMatches({selection:{targetKeys:{blue:'001108:123'}}}, targets, []), {});
});

test('existing own overrides remain unchanged and inherited entries are ignored', () => {
  const chosenMatches = Object.assign(Object.create({blue:'001321'}), {orange:'001025',excluded:null});
  const targetKeys = Object.assign(Object.create({orange:'001321:456'}), {blue:'001108:123',excluded:'001247:789'});
  const result = preservedPhotoGuideMatches({chosenMatches,selection:{targetKeys}}, targets, products);
  assert.deepEqual(result, {orange:'001025',excluded:null,blue:'001108'});
  assert.notEqual(result, chosenMatches);
});

test('a target ID resembling a JavaScript property remains an ordinary safe map entry', () => {
  const targetKeys = Object.fromEntries([['__proto__','001108:123']]);
  const result = preservedPhotoGuideMatches({selection:{targetKeys}}, [{id:'__proto__'}], products);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__, '001108');
});
