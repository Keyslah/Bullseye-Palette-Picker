/**
 * Purpose: verify active-cart persistence, repeated additions and concurrent edits.
 * Setup: node --test with isolated Chrome storage and a shared Web Locks stand-in.
 * Writes: disposable test memory only; no user's data, account or website actions.
 * Constraints: two separately imported modules model two open extension tabs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'bullseyeWorkingCartV1';
const black = {productId:'000100',variantId:52850314739985,quantity:1,name:'Black',title:'5 lb. jar',form:'fine',available:true};
const pink = {productId:'001215',variantId:52850270011665,quantity:2,name:'Light Pink',title:'5 lb. jar',form:'medium',available:true};
let moduleCount = 0;
const fresh = () => import(`../extension/lib/working-cart.js?working-cart-test=${++moduleCount}`);
function replaceGlobal(t, name, value) {
  const prior=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];});
}
function storage(t, initial = {}) {
  const values=structuredClone(initial),writes=[],listeners=new Set(),locks=new Map();
  replaceGlobal(t,'chrome',{runtime:{id:'working-cart-test'},storage:{local:{
    async get(key){return {[key]:structuredClone(values[key])};},
    async set(update){
      const before=structuredClone(values);Object.assign(values,structuredClone(update));writes.push(structuredClone(update));
      for(const callback of listeners)callback(Object.fromEntries(Object.keys(update).map(key=>[key,{oldValue:before[key],newValue:structuredClone(update[key])}])),'local');
    },
  },onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)}}});
  replaceGlobal(t,'navigator',{locks:{request(name,action){
    const task=(locks.get(name)||Promise.resolve()).then(action,action);locks.set(name,task.catch(()=>{}));return task;
  }}});
  replaceGlobal(t,'localStorage',{getItem(){throw new Error('No preview fallback');},setItem(){throw new Error('No preview fallback');}});
  return {values,writes,listeners};
}
const cart=(items=[black],other={})=>({version:1,id:null,name:'My cart',items,dirty:true,createdAt:100,updatedAt:200,...other});

test('active cart roundtrip retains named identity, exact variants and unsaved draft choices', async t=>{
  const harness=storage(t,{unrelated:'keep'}),module=await fresh();
  assert.equal(await module.loadWorkingCart(),null);
  const saved=await module.saveWorkingCart(cart([black,pink],{id:'my-saved-cart',name:'Kiln work'}));
  const loaded=await module.loadWorkingCart();
  assert.deepEqual(loaded,saved);
  assert.equal(loaded.id,'my-saved-cart');
  assert.equal(loaded.items[0].variantId,black.variantId);
  assert.equal(loaded.items[1].quantity,2);
  assert.equal(loaded.dirty,true);
  assert.equal(loaded.createdAt,100);
  assert.equal(harness.values.unrelated,'keep');
  loaded.items[0].quantity=8;
  assert.equal((await module.loadWorkingCart()).items[0].quantity,1);
});

test('unavailable glass remains in the working cart through additions, quantity edits and saving',async t=>{
  storage(t);const module=await fresh();
  const unavailable={...pink,form:'fine',sku:'001215-0001-F-P005',available:false};
  await module.addWorkingCartItems([unavailable]);
  await module.addWorkingCartItems([{...unavailable,quantity:3},black]);
  const before=await module.loadWorkingCart();
  const selected=before.items.find(item=>item.variantId===unavailable.variantId);
  assert.equal(selected.quantity,5);
  assert.equal(selected.available,false);
  const after=structuredClone(before);after.items.find(item=>item.variantId===unavailable.variantId).quantity=7;
  const edited=await module.patchWorkingCart(before,after);
  await module.saveWorkingCart({...edited,id:'saved-unavailable-cart',dirty:false});
  const retained=(await module.loadWorkingCart()).items.find(item=>item.variantId===unavailable.variantId);
  assert.equal(retained.quantity,7);
  assert.equal(retained.available,false);
  assert.equal(retained.form,'fine');
  assert.equal(retained.sku,unavailable.sku);
  assert.equal(retained.title,unavailable.title);
});

test('separate tabs serialize deliberate Add to Cart actions without losing or duplicating additions', async t=>{
  storage(t);const first=await fresh(),second=await fresh();
  await Promise.all([first.addWorkingCartItems([black]),second.addWorkingCartItems([pink]),first.addWorkingCartItems([black]),second.addWorkingCartItems([black])]);
  const loaded=await first.loadWorkingCart();
  assert.equal(loaded.items.length,2);
  assert.equal(loaded.items.find(item=>item.variantId===black.variantId).quantity,3);
  assert.equal(loaded.items.find(item=>item.variantId===pink.variantId).quantity,2);
});

test('a cart edit preserves a new color concurrently added from another picker tab', async t=>{
  storage(t,{[KEY]:cart()});const editor=await fresh(),picker=await fresh();
  const before=await editor.loadWorkingCart();
  await picker.addWorkingCartItems([pink]);
  const after=structuredClone(before);after.items[0].quantity=4;after.name='Edited name';
  await editor.patchWorkingCart(before,after);
  const loaded=await picker.loadWorkingCart();
  assert.equal(loaded.items.find(item=>item.variantId===black.variantId).quantity,4);
  assert.equal(loaded.items.find(item=>item.variantId===pink.variantId).quantity,2);
  assert.equal(loaded.name,'Edited name');
});

test('removing an edited row keeps unrelated additions from another tab', async t=>{
  storage(t,{[KEY]:cart()});const editor=await fresh(),picker=await fresh();
  const before=await editor.loadWorkingCart();await picker.addWorkingCartItems([pink]);
  await editor.patchWorkingCart(before,{...before,items:[]});
  const loaded=await picker.loadWorkingCart();
  assert.deepEqual(loaded.items.map(item=>item.variantId),[pink.variantId]);
});

test('stale edits cannot be merged into a different saved cart opened by another tab', async t=>{
  const harness=storage(t,{[KEY]:cart([black],{id:'cart-a',name:'Cart A'})});
  const first=await fresh(),second=await fresh(),before=await first.loadWorkingCart();
  await second.saveWorkingCart(cart([pink],{id:'cart-b',name:'Cart B'}));
  const expected=structuredClone(harness.values[KEY]);
  await assert.rejects(first.patchWorkingCart(before,{...before,name:'Stale A change'}),/changed|another|reload/i);
  assert.deepEqual(harness.values[KEY],expected);
});

test('new unnamed carts receive distinct working-copy identities despite both having null saved IDs', async t=>{
  const harness=storage(t),module=await fresh();
  const before=await module.saveWorkingCart(cart([black]));
  await module.saveWorkingCart(cart([]));
  assert.notEqual(harness.values[KEY].instanceId,before.instanceId);
  assert.equal(harness.values[KEY].id,null);
  await assert.rejects(module.patchWorkingCart(before,{...before,items:[pink]}),/another|reload/i);
  assert.deepEqual(harness.values[KEY].items,[]);
});

test('saving the same working copy preserves its identity and allows already queued edits', async t=>{
  storage(t);const module=await fresh();
  const before=await module.saveWorkingCart(cart([black],{instanceId:'chosen-copy'}));
  await module.saveWorkingCart({...before,id:'new-named-save',dirty:false});
  const result=await module.patchWorkingCart(before,{...before,items:[{...black,quantity:4}]});
  assert.equal(result.instanceId,'chosen-copy');
  assert.equal(result.id,'new-named-save');
  assert.equal(result.items[0].quantity,4);
});

test('overflow and invalid quantities reject without replacing the existing cart', async t=>{
  const harness=storage(t,{[KEY]:cart([{...black,quantity:999}])}),module=await fresh();
  const expected=structuredClone(harness.values[KEY]);
  await assert.rejects(module.addWorkingCartItems([black]),/999/);
  assert.throws(()=>module.addWorkingCartItems([{...pink,quantity:0}]),/quantit/i);
  assert.deepEqual(harness.values[KEY],expected);
  assert.deepEqual(harness.writes,[]);
});

test('read/write errors reject and a subsequent valid write can recover the queue', async t=>{
  const harness=storage(t),module=await fresh(),originalGet=chrome.storage.local.get,originalSet=chrome.storage.local.set;
  chrome.storage.local.get=async()=>{throw new Error('Read denied');};
  await assert.rejects(module.addWorkingCartItems([black]),/Read denied/);
  assert.deepEqual(harness.writes,[]);
  chrome.storage.local.get=originalGet;
  chrome.storage.local.set=async()=>{throw new Error('Write denied');};
  await assert.rejects(module.addWorkingCartItems([black]),/Write denied/);
  assert.equal(harness.values[KEY],undefined);
  chrome.storage.local.set=originalSet;
  await module.addWorkingCartItems([pink]);
  assert.deepEqual((await module.loadWorkingCart()).items.map(item=>item.variantId),[pink.variantId]);
});

test('unrecognized stored cart versions cannot silently downgrade and erase newer data', async t=>{
  const future=cart([black],{version:2,newImportantField:'keep'}),harness=storage(t,{[KEY]:future}),module=await fresh();
  await assert.rejects(module.loadWorkingCart(),/version|update|read/i);
  await assert.rejects(module.addWorkingCartItems([pink]),/version|update|read/i);
  assert.deepEqual(harness.values[KEY],future);
  assert.deepEqual(harness.writes,[]);
});

test('count subscriptions react only to the working-cart key and can unsubscribe', async t=>{
  const harness=storage(t),module=await fresh(),changes=[];
  const unsubscribe=module.subscribeWorkingCart(value=>changes.push(value));
  for(const listener of harness.listeners)listener({unrelated:{newValue:'ignore'}},'local');
  for(const listener of harness.listeners)listener({[KEY]:{newValue:cart()}},'session');
  assert.equal(changes.length,0);
  await module.addWorkingCartItems([black]);assert.equal(changes.length,1);
  unsubscribe();await module.addWorkingCartItems([black]);assert.equal(changes.length,1);
});
