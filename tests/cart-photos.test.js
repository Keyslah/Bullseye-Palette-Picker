/**
 * Purpose: verify cart-only clear products and correctly attributed grade/variant images.
 * Setup: node --test with the bundled public product metadata and isolated examples.
 * Writes: none. Constraints: no network, user account, or original catalog changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cartPhotoSpec} from '../extension/lib/cart-photos.js';
import {productForForm} from '../extension/lib/product-formats.js';
import {cartVariants, cartSizeKey, cartSizeChoices, exactCartVariant} from '../extension/lib/cart-options.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../extension/data/'+name,import.meta.url)));
const original=read('catalog.json'),formats=read('product-formats.json');
const photos=read('cart-photos.json'),clear=read('clear-cart.json');
const vanilla=productForForm(original.products.find(p=>p.id==='000137'),formats,'medium');

test('cart photo follows the selected grade instead of the original medium-frit reference',()=>{
  const urls=[];
  for(const form of ['powder','fine','medium','coarse','sheets']){
    const variant=cartVariants(vanilla,form)[0];
    const image=cartPhotoSpec(vanilla,variant,photos);
    assert.equal(image.form,form);assert.equal(image.handle,variant.handle);
    assert.notEqual(image.kind,'reference');assert.ok(image.images.length);
    assert.ok(photos.products[variant.handle].images.includes(image.images[0]) || photos.products[variant.handle].variantImages[String(variant.id)]===image.images[0]);
    urls.push(image.images[0]);
  }
  assert.ok(new Set(urls).size>1);
});
test('variant-assigned image takes priority without fabricating unique jar photos',()=>{
  const product={name:'Test',form:'fine'},variant={id:7,form:'fine',title:'1 lb. jar',handle:'glass'};
  const index={products:{glass:{images:['https://example.invalid/shared.jpg'],variantImages:{'7':'https://example.invalid/one-lb.jpg'}}}};
  const image=cartPhotoSpec(product,variant,index);
  assert.equal(image.kind,'variant');assert.equal(image.images[0],'https://example.invalid/one-lb.jpg');
  assert.equal(cartPhotoSpec(product,{...variant,id:8},index).kind,'product');
  assert.match(cartPhotoSpec(product,{...variant,id:8},index).note,/share/);
  assert.match(cartPhotoSpec({...product,image:'ref.jpg'},variant,{}).note,/Medium-frit color reference/);
});
test('clear products never join the original automatic matching catalog',()=>{
  assert.equal(clear.products.length,3);
  const ids=new Set(original.products.map(p=>p.id));
  for(const p of clear.products){assert.equal(p.isClear,true);assert.equal(p.cartOnly,true);assert.ok(!ids.has(p.id));assert.deepEqual(p.samples,[]);}
});
test('clear frit and Tekta sheet sizes are real unique purchasable variants with source records',()=>{
  const all=[];
  for(const p of clear.products)for(const v of p.allVariants){
    assert.ok(v.sku.startsWith(p.id+'-'));assert.ok(Number.isSafeInteger(v.id));assert.equal(typeof v.available,'boolean');
    assert.ok(v.price>=0);assert.ok(p.sources.some(s=>s.url===v.productUrl+'.js'));
    const spec=cartPhotoSpec(p,v,photos);assert.ok(spec.images.length);assert.equal(spec.handle,v.handle);
    if(v.form==='sheets'){assert.ok(v.thicknessMm>0);assert.ok(v.sourceTitle);}
    if(v.available)assert.equal(exactCartVariant(p,v.form,cartSizeKey(v)).id,v.id);
    all.push(v.id);
  }
  assert.equal(new Set(all).size,all.length);
  for(const form of ['powder','fine','medium','coarse','sheets'])assert.ok(clear.products.some(p=>cartVariants(p,form).length));
  const choices=cartSizeChoices(clear.products,'sheets');
  assert.ok(choices.some(c=>/^3 mm/.test(c.label)));assert.ok(choices.some(c=>/^6 mm/.test(c.label)));
});
test('photo index uses public HTTPS assets and records independently hashed product sources',()=>{
  assert.ok(Object.keys(photos.products).length>800);
  for(const [handle,entry] of Object.entries(photos.products)){
    assert.equal(entry.source.url,`https://shop.bullseyeglass.com/products/${handle}.js`);
    assert.match(entry.source.sha256,/^[0-9a-f]{64}$/);
    for(const image of [...entry.images,...Object.values(entry.variantImages)]){
      const url=new URL(image);assert.equal(url.protocol,'https:');assert.ok(['shop.bullseyeglass.com','cdn.shopify.com'].includes(url.hostname));
    }
  }
});

test('an unavailable size never borrows another grade listing as though it matched',()=>{
  const photo=cartPhotoSpec(vanilla,{form:'sheets',title:'Unknown size'},photos);
  assert.equal(photo.kind,'reference');assert.equal(photo.form,'sheets');
  assert.match(photo.note,/reference/);
});
