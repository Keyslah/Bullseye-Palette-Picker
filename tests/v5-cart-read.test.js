/**
 * Purpose: test the user-clicked website-cart copy and its read-only boundary.
 * Setup: node --test; synthetic account HTML and cart data replace every request.
 * Writes: test globals only, restored afterward. No network or real user data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runBullseyeStoreAction} from '../extension/lib/commerce.js';

function environment(t, options={}) {
  const calls=[];
  const values={location:{origin:'https://shop.bullseyeglass.com',protocol:'https:'},
    fetch:async(url,settings={})=>{
      calls.push({url:String(url),method:settings.method || 'GET'});
      assert.equal(settings.method || 'GET','GET','Copy must never POST');
      if(String(url).includes('/cart.js'))return new Response(JSON.stringify(options.cart ?? {items:[{variant_id:12345,quantity:2,product_title:'Test glass',variant_title:'5 lb.',sku:'000141-0002-F-P005',price:8000}],currency:'USD',token:'PRIVATE_TOKEN',note:'PRIVATE_NOTE',attributes:{private:'DO_NOT_COPY'}}),{status:options.status || 200});
      return new Response(options.html ?? '<span class="account-actions__email">private@example.invalid</span>',{status:200});
    }};
  for(const [name,value] of Object.entries(values)){
    const previous=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
  }
  return calls;
}
test('website copy performs only GET and returns only necessary product fields',async t=>{
  const calls=environment(t);
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.read,true);
  assert.equal(result.mutationStarted,false);
  assert.equal(result.itemCount,2);
  assert.equal(result.items[0].variantId,12345);
  assert.equal(result.items[0].quantity,2);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.method==='GET'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|DO_NOT_COPY|private@example/);
});
test('signed-out copy cannot read cart items and cannot write',async t=>{
  const calls=environment(t,{html:'<div class="account-actions__sign-ins">Sign in</div>'});
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.code,'SIGN_IN_REQUIRED');
  assert.equal(result.mutationStarted,false);
  assert.equal(calls.length,1);
});
test('copy requires a native same-origin store tab',async t=>{
  const calls=environment(t);globalThis.location={origin:'https://example.invalid',protocol:'https:'};
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.code,'STORE_TAB_REQUIRED');assert.equal(calls.length,0);
});
test('unreadable carts are errors rather than invented empty copies',async t=>{
  environment(t,{cart:{items:'broken'}});
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.read,undefined);assert.equal(result.code,'CART_READ_FAILED');
});
test('empty website carts remain valid empty copies',async t=>{
  environment(t,{cart:{items:[],currency:'USD'}});
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.read,true);assert.deepEqual(result.items,[]);assert.equal(result.itemCount,0);
});
test('custom cart items are not silently changed into ordinary products',async t=>{
  environment(t,{cart:{items:[{variant_id:12345,quantity:1,properties:{engraving:'Custom'}}],currency:'USD'}});
  const result=await runBullseyeStoreAction({kind:'read-cart'});
  assert.equal(result.code,'CART_READ_FAILED');assert.match(result.error,/custom or subscription/i);
});
