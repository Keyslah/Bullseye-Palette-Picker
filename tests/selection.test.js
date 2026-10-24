/** Local selection transitions; no browser, network, or Bullseye cart writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {availableVariant, emptySelection, restoreSelection, reconcileSelection, setItemSelected, changeSelectedVariant} from '../extension/lib/selection.js';

const item = (productId, variantId = 1, quantity = 1, available = true) => ({
  key:`${productId}:${variantId}`, productId, variantId, quantity, available, sku:`${productId}-${variantId}`,
});
const suggestion = (targetId, glass) => ({targetId, item:glass});
const start = suggestions => reconcileSelection(emptySelection(), suggestions, []);
const keys = result => result.cart.map(entry => entry.key);

test('default jars prefer an available saved size, then 5 lb, then another real purchasable size', () => {
  const variants = [
    {id:1,title:'1 lb',available:true,sku:'large'},
    {id:2,title:'5 lb',available:false,sku:'large'},
    {id:3,title:'5 lb',available:true,sku:'large-alt'},
    {id:4,title:'5 lb',available:true,sku:''},
  ];
  assert.equal(availableVariant({variants}, 1).id, 1);
  assert.equal(availableVariant({variants}, 2).id, 3);
  assert.equal(availableVariant({variants:variants.slice(0,2)}).id, 1);
  assert.equal(availableVariant({variants:[variants[1],variants[3]]}), null);
});

test('new targets are selected once per unique jar; edits, shared targets, and removal replace only automatic jars', () => {
  const red=item('red'), green=item('green'), blue=item('blue');
  let result=start([suggestion('a',red),suggestion('b',red),suggestion('c',green)]);
  assert.deepEqual(keys(result), ['red:1','green:1']);
  assert.deepEqual(result.cart.map(entry=>entry.quantity), [1,1]);
  result.cart[0].quantity=4;
  result=reconcileSelection(result.selection,[suggestion('a',blue),suggestion('b',red)],result.cart);
  assert.deepEqual(keys(result), ['red:1','blue:1']);
  assert.equal(result.cart[0].quantity,4);
  result=reconcileSelection(result.selection,[suggestion('a',blue)],result.cart);
  assert.deepEqual(keys(result), ['blue:1']);
});

test('unchecking a shared glass stays unchecked after replacement, new matching targets, persistence, and rechecking', () => {
  const red=item('red'), green=item('green');
  let suggestions=[suggestion('a',red),suggestion('b',red)];
  let result=start(suggestions);
  result.selection=setItemSelected(result.selection,red.key,false);
  result=reconcileSelection(result.selection,suggestions,[]);
  assert.deepEqual(keys(result),[]);
  suggestions=[suggestion('a',green),suggestion('b',red),suggestion('c',red)];
  const saved=JSON.parse(JSON.stringify(result.selection));
  result=reconcileSelection(restoreSelection(saved,suggestions,[]),suggestions,[]);
  assert.deepEqual(keys(result),[]);
  result.selection=setItemSelected(result.selection,red.key,true);
  result=reconcileSelection(result.selection,suggestions,[red]);
  assert.deepEqual(keys(result),['red:1']);
  assert.ok(result.selection.excludedTargetIds.includes('a'));
});

test('unchecked jar size and quantity edits do not reselect the color or create a manual extra when rechecked', () => {
  const small=item('red'),large=item('red',2,7);
  let result=start([suggestion('a',small)]);
  result.selection=setItemSelected(result.selection,small.key,false);
  result=reconcileSelection(result.selection,[suggestion('a',large)],[]);
  assert.deepEqual(keys(result),[]);
  result.selection=setItemSelected(result.selection,large.key,true);
  result=reconcileSelection(result.selection,[suggestion('a',large)],[large]);
  assert.equal(result.cart[0].quantity,7);
  assert.deepEqual(result.selection.manualKeys,[]);
  result=reconcileSelection(emptySelection(result.selection.manualKeys),[],result.cart);
  assert.deepEqual(keys(result),[]);
});

test('manual extra jars survive a new photo; automatic jars and exclusions start fresh', () => {
  const red=item('red'),extra=item('extra',2,3),blue=item('blue');
  let result=start([suggestion('a',red)]);
  result.cart.push(extra);
  result.selection=setItemSelected(result.selection,extra.key,true);
  result=reconcileSelection(emptySelection(result.selection.manualKeys),[suggestion('new',blue)],result.cart);
  assert.deepEqual(keys(result),['extra:2','blue:1']);
  assert.equal(result.cart[0].quantity,3);
});

test('both material filters off freeze surviving target jars and do not manufacture new matches', () => {
  const red=item('red'),green=item('green');
  let result=start([suggestion('a',red),suggestion('b',green)]);
  result=reconcileSelection(result.selection,[suggestion('a',null),suggestion('b',null),suggestion('c',null)],result.cart,{freeze:true});
  assert.deepEqual(keys(result),['red:1','green:1']);
  result=reconcileSelection(result.selection,[suggestion('b',null)],result.cart,{freeze:true});
  assert.deepEqual(keys(result),['green:1']);
});

test('an unavailable explicit alternative stays checked alongside other default selections', () => {
  const unavailable=item('pink',1,1,false),red=item('red');
  const result=start([suggestion('a',unavailable),suggestion('b',red)]);
  assert.deepEqual(keys(result),['pink:1','red:1']);
  assert.equal(result.selection.targetKeys.a,unavailable.key);
});

test('stock loss retains exact selected variant and quantity through uncheck, recheck and restore', () => {
  let result=start([suggestion('a',item('pink',2,4))]);
  const soldOut=item('pink',2,1,false),suggestions=[suggestion('a',soldOut)];
  result=reconcileSelection(result.selection,suggestions,result.cart);
  assert.deepEqual(result.cart,[{...soldOut,quantity:4}]);
  const stored=JSON.parse(JSON.stringify(result));
  result=reconcileSelection(restoreSelection(stored.selection,suggestions,stored.cart),suggestions,stored.cart);
  assert.deepEqual(result.cart,stored.cart);
  result.selection=setItemSelected(result.selection,soldOut.key,false);
  result=reconcileSelection(result.selection,suggestions,[]);
  assert.deepEqual(result.cart,[]);
  result.selection=setItemSelected(result.selection,soldOut.key,true);
  result=reconcileSelection(result.selection,suggestions,[{...soldOut,quantity:7}]);
  assert.deepEqual(result.cart,[{...soldOut,quantity:7}]);
});

test('legacy empty workspaces get defaults once while a deliberately empty v1 palette stays empty', () => {
  const red=item('red'),suggestions=[suggestion('a',red)];
  const migrated=restoreSelection(undefined,suggestions,[]);
  let result=reconcileSelection(migrated,suggestions,[]);
  assert.deepEqual(keys(result),['red:1']);
  result.selection=setItemSelected(result.selection,red.key,false);
  const restored=restoreSelection(JSON.parse(JSON.stringify(result.selection)),suggestions,[]);
  result=reconcileSelection(restored,suggestions,[]);
  assert.deepEqual(keys(result),[]);
});

test('legacy partial selections retain their jars, quantities, unavailable extras, and unchecked targets', () => {
  const red=item('red',2,4),green=item('green'),extra=item('old',3,2,false);
  const suggestions=[suggestion('a',red),suggestion('b',green)];
  let selection=restoreSelection(undefined,suggestions,[red,extra]);
  let result=reconcileSelection(selection,suggestions,[red,extra]);
  assert.deepEqual(result.cart,[red,extra]);
  assert.deepEqual(result.selection.excludedTargetIds,['b']);
  assert.deepEqual(result.selection.manualKeys,['old:3']);
  const next=[suggestion('a',red),suggestion('b',item('blue'))];
  result=reconcileSelection(result.selection,next,result.cart);
  assert.deepEqual(result.cart,[red,extra]);
});

test('legacy explicitly chosen unavailable primary jars remain visible instead of being silently dropped', () => {
  const pink=item('pink',2,4,false),suggestions=[suggestion('a',pink)];
  const selection=restoreSelection(undefined,suggestions,[pink]);
  const result=reconcileSelection(selection,suggestions,[pink]);
  assert.deepEqual(result.cart,[pink]);
  assert.deepEqual(result.selection.manualKeys,['pink:2']);
});

test('variant replacement moves target/manual ownership and merges to an already chosen jar without extra defaults', () => {
  const red=item('red'),large=item('red',2,5),extra=item('extra',3,2);
  let result=start([suggestion('a',red),suggestion('b',red)]);
  result.cart.push(extra);
  result.selection=setItemSelected(result.selection,extra.key,true);
  result.selection=changeSelectedVariant(result.selection,red.key,large.key);
  result=reconcileSelection(result.selection,[suggestion('a',large),suggestion('b',large)],[large,extra]);
  assert.deepEqual(result.cart,[large,extra]);
  result.selection=changeSelectedVariant(result.selection,extra.key,'extra:4');
  assert.deepEqual(result.selection.manualKeys,['extra:4']);
  assert.deepEqual(Object.values(result.selection.targetKeys),['red:2','red:2']);
});

test('availability fallback changes automatic jar size while retaining quantity and manual unavailable extras', () => {
  const red=item('red',1,6),extra=item('extra',3,2,false);
  let result=start([suggestion('a',red)]);
  result.cart.push(extra);
  result.selection=setItemSelected(result.selection,extra.key,true);
  result=reconcileSelection(result.selection,[suggestion('a',item('red',2))],result.cart);
  assert.equal(result.cart.find(entry=>entry.key==='red:2').quantity,6);
  assert.deepEqual(result.cart.find(entry=>entry.key==='extra:3'),extra);
});

test('incomplete selection metadata retains existing jars instead of silently dropping explicit selections', () => {
  const extra=item('extra',2,5);
  const selection=restoreSelection({version:1,excludedTargetIds:['a']},[suggestion('a',item('red'))],[extra]);
  const result=reconcileSelection(selection,[suggestion('a',item('red'))],[extra]);
  assert.deepEqual(result.cart,[extra]);
  const incomplete=restoreSelection({version:1},[suggestion('a',item('red')),suggestion('b',extra)],[extra]);
  assert.deepEqual(reconcileSelection(incomplete,[suggestion('a',item('red')),suggestion('b',extra)],[extra]).cart,[extra]);
  const empty=restoreSelection({version:1},[suggestion('a',item('red'))],[]);
  assert.deepEqual(reconcileSelection(empty,[suggestion('a',item('red'))],[]).cart,[]);
});
