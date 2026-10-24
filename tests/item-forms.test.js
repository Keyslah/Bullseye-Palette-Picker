/**
 * Purpose: verify independent item-form restoration and real catalog size selection.
 * Setup: Node test runner and the bundled Bullseye catalog; no browser or network.
 * Destructive behavior: none. Constraints: only real variant/SKU records are accepted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {itemForm, normalizeItemForms} from '../extension/lib/item-forms.js';
import {productForForm} from '../extension/lib/product-formats.js';
import {switchedCartVariant, cartSizeKey, cartSizeLabel, cartSelectable} from '../extension/lib/cart-options.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url)));
const formats=JSON.parse(fs.readFileSync(new URL('../extension/data/product-formats.json',import.meta.url)));
const aqua=catalog.products.find(product=>product.id==='001108');
const orange=catalog.products.find(product=>product.id==='001025');

test('saved per-color forms restore independently and old workspaces retain the global form',()=>{
  const saved={'001108':'fine','001025':'sheets','missing':'coarse','001215':'invalid'};
  const copy=structuredClone(saved),restored=normalizeItemForms(saved,catalog.products);
  assert.deepEqual(restored,{'001108':'fine','001025':'sheets'});
  assert.deepEqual(saved,copy);
  assert.equal(itemForm(aqua,restored,'powder'),'fine');
  assert.equal(itemForm(orange,restored,'powder'),'sheets');
  assert.equal(itemForm(aqua,normalizeItemForms(undefined,catalog.products),'powder'),'powder');
  assert.deepEqual(normalizeItemForms(['fine'],catalog.products),{});
});

test('an individual override survives a global default change without spreading to another color',()=>{
  const overrides={'001108':'fine'};
  const before=catalog.products.map(product=>itemForm(product,overrides,'medium'));
  const after=catalog.products.map(product=>itemForm(product,overrides,'coarse'));
  assert.equal(before.filter(form=>form==='fine').length,1);
  assert.equal(after.filter(form=>form==='fine').length,1);
  assert.equal(itemForm(orange,overrides,'coarse'),'coarse');
  assert.equal(itemForm(aqua,overrides,'coarse'),'fine');
});

test('each frit form retains the chosen jar weight using an actual corresponding variant',()=>{
  for(const base of catalog.products){
    const medium=productForForm(base,formats,'medium');
    const previous=medium.variants.find(variant=>variant.available && cartSizeKey(variant)==='1lb');
    if(!previous)continue;
    for(const form of ['powder','fine','medium','coarse']){
      const product=productForForm(base,formats,form);
      const next=switchedCartVariant(product,form,previous);
      if(!product.variants.some(cartSelectable))assert.equal(next,null);
      else {
        assert.ok(product.variants.some(variant=>variant.id===next.id && variant.sku===next.sku));
        assert.equal(next.form,form);
        if(product.variants.some(variant=>cartSelectable(variant) && cartSizeKey(variant)==='1lb'))assert.equal(cartSizeKey(next),'1lb');
      }
    }
  }
});

test('sheet choices expose their real dimensions and thickness, with missing sheets unavailable',()=>{
  const sheet=productForForm(aqua,formats,'sheets');
  for(const variant of sheet.variants){
    assert.match(cartSizeLabel(variant),new RegExp(variant.thicknessMm+' mm'));
    assert.ok(cartSizeLabel(variant).includes(variant.sourceTitle));
  }
  const noSheets=catalog.products.find(product=>product.id==='001247');
  const missing=productForForm(noSheets,formats,'sheets');
  assert.equal(switchedCartVariant(missing,'sheets',noSheets.variants[0]),null);
});
