/**
 * Purpose: enforce exact grade photographs throughout the picker and cart.
 * Setup: node --test; uses the real bundled catalog and verified store photo index.
 * Writes: none. Constraints: no synthetic photo coverage claims or matching changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {productPhotoSpec,cartPhotoSpec} from '../extension/lib/cart-photos.js';
import {productForForm} from '../extension/lib/product-formats.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../extension/data/'+name,import.meta.url)));
const catalog=read('catalog.json'),formats=read('product-formats.json'),photos=read('cart-photos.json');
const grades={powder:'0008',fine:'0001',medium:'0002',coarse:'0003'};

test('picker and cart use the identical photo selector',()=>assert.equal(productPhotoSpec,cartPhotoSpec));
test('all 141 colors have four real matching-grade photo records, with no medium substitution',()=>{
  let checked=0;
  for(const base of catalog.products){
    const images=[];
    for(const [form,code] of Object.entries(grades)){
      const product=productForForm(base,formats,form),variant=product.variants[0];assert.ok(variant);
      const photo=productPhotoSpec(product,variant,photos);
      assert.equal(photo.form,form);assert.equal(photo.handle,variant.handle);
      assert.notEqual(photo.kind,'reference');
      assert.match(photo.images[0],new RegExp(`${base.id}-${code}[-_]F`, 'i'));
      assert.notEqual(photo.images[0],base.image);
      images.push(photo.images[0]);checked++;
    }
    assert.equal(new Set(images).size,4,`${base.name} must use different grade image records`);
  }
  assert.equal(checked,564);
});
test('Aquamarine Blue screenshot regression: Fine and Powder use -0001 and -0008, not -0002',()=>{
  const base=catalog.products.find(p=>p.id==='001108');
  for(const form of ['fine','powder']){
    const product=productForForm(base,formats,form);
    for(const variant of product.variants){
      const photo=productPhotoSpec(product,variant,photos);
      assert.match(photo.images[0],new RegExp(`001108-${grades[form]}-F_01`));
      assert.doesNotMatch(photo.images[0],/001108-0002/);
    }
  }
});
test('an item in a mixed-grade cart follows its own variant, not the global product form',()=>{
  const product=productForForm(catalog.products.find(p=>p.id==='001108'),formats,'medium');
  for(const [form,code] of Object.entries(grades)){
    const variant=product.allVariants.find(v=>v.form===form);
    const photo=productPhotoSpec(product,variant,photos);
    assert.equal(photo.form,form);assert.match(photo.images[0],new RegExp(`001108-${code}[-_]F`));
  }
});
test('image lookup does not alter source samples, percentage references, variants or catalog',()=>{
  const before=JSON.stringify({catalog,formats,photos});
  for(const product of catalog.products)for(const form of Object.keys(grades)){
    const shown=productForForm(product,formats,form);productPhotoSpec(shown,shown.variants[0],photos);
  }
  assert.equal(JSON.stringify({catalog,formats,photos}),before);
});
