/**
 * Purpose: retain real unavailable cart variants without substituting stock or formats.
 * Setup: node --test with small synthetic catalog records; no browser or network.
 * Writes: none. Constraints: missing variant IDs/SKUs remain invalid local choices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cartSelectable, cartPurchasable, cartSizeKey, cartSizeChoices, exactCartVariant, preferredCartSize, switchedCartVariant} from '../extension/lib/cart-options.js';

const mediumSmall = {id:100,sku:'001215-0002-F-P001',form:'medium',title:'1 lb. jar',available:true};
const mediumLarge = {id:101,sku:'001215-0002-F-P005',form:'medium',title:'5 lb. jar',available:true};
const fineSmall = {id:102,sku:'001215-0001-F-P001',form:'fine',title:'1 lb. jar',available:false};
const fineLarge = {id:103,sku:'001215-0001-F-P005',form:'fine',title:'5 lb. jar',available:true};
const product = {id:'001215',form:'medium',variants:[mediumSmall,mediumLarge],allVariants:[mediumSmall,mediumLarge,fineSmall,fineLarge]};

test('a real sold-out variant is selectable locally without being purchasable',()=>{
  assert.equal(cartSelectable(fineSmall),true);
  assert.equal(cartPurchasable(fineSmall),false);
  assert.equal(cartPurchasable(fineLarge),true);
  for(const variant of [null,{...fineSmall,id:0},{...fineSmall,id:1.5},{...fineSmall,sku:''}])assert.equal(cartSelectable(variant),false);
});

test('Add Colors resolves the exact unavailable package instead of another size or grade',()=>{
  assert.equal(exactCartVariant(product,'fine','1lb'),fineSmall);
  assert.equal(exactCartVariant(product,'medium','1lb'),mediumSmall);
  assert.equal(exactCartVariant(product,'fine','5oz'),null);
  assert.equal(exactCartVariant(product,'coarse','1lb'),null);
});

test('changing grade preserves a real matching jar size even when that size is sold out',()=>{
  assert.equal(switchedCartVariant(product,'fine',mediumSmall,'5lb'),fineSmall);
  assert.equal(switchedCartVariant(product,'fine',fineSmall,'5lb'),fineSmall);
  assert.equal(switchedCartVariant(product,'medium',fineSmall,'5lb'),mediumSmall);
});

test('a fully unavailable grade still exposes its real options and explicit default weight',()=>{
  const soldOut = {...product,allVariants:[mediumSmall,{...fineLarge,available:false},fineSmall]};
  const choices = cartSizeChoices([soldOut],'fine');
  assert.equal(choices.length,2);
  assert.ok(choices.every(choice=>choice.available===false));
  assert.equal(preferredCartSize(choices,'fine','1lb'),'1lb');
  assert.equal(switchedCartVariant(soldOut,'fine',null,'1lb').id,fineSmall.id);
  assert.equal(switchedCartVariant(soldOut,'fine',mediumSmall).id,fineSmall.id);
});

test('unavailable sheets preserve exact dimensions and thickness and missing listings stay absent',()=>{
  const thin={id:200,sku:'001215-0030-F-1010',form:'sheets',title:'3 mm · 10x10 in.',sourceTitle:'10x10 in.',thicknessMm:3,available:false};
  const thick={id:201,sku:'001215-0060-F-1010',form:'sheets',title:'6 mm · 10x10 in.',sourceTitle:'10x10 in.',thicknessMm:6,available:true};
  const sheets={...product,allVariants:[thin,thick,{...thin,id:0,sourceTitle:'20x20 in.'}]};
  assert.equal(exactCartVariant(sheets,'sheets',cartSizeKey(thin)),thin);
  assert.equal(switchedCartVariant(sheets,'sheets',thin),thin);
  assert.equal(cartSizeChoices([sheets],'sheets').length,2);
  assert.equal(exactCartVariant(sheets,'sheets','3 mm · 20x20 in.'),null);
});
