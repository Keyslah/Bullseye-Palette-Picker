/** Verify real purchase formats without changing the shared medium-frit guide. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FORM_OPTIONS, normalizeForm, getProductFormat, productForForm, defaultFormatVariant} from '../extension/lib/product-formats.js';
import {matchCatalog} from '../extension/lib/palette.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url),'utf8'));
const index=JSON.parse(fs.readFileSync(new URL('../extension/data/product-formats.json',import.meta.url),'utf8'));
const green=catalog.products.find(product=>product.id==='001426');
const codes={powder:'0008',fine:'0001',medium:'0002',coarse:'0003'};

test('all reviewed base colors have explicit entries for every purchase form and unique real variants',()=>{
  assert.deepEqual(FORM_OPTIONS.map(option=>option.id),['sheets','powder','fine','medium','coarse']);
  assert.deepEqual(Object.keys(index.products).sort(),catalog.products.map(product=>product.id).sort());
  const ids=new Set(),skus=new Set();
  for(const base of catalog.products)for(const {id:form} of FORM_OPTIONS){
    const entry=index.products[base.id][form];
    assert.equal(entry.form,form);
    assert.equal(entry.available,entry.variants.some(variant=>variant.available));
    if(entry.missing){assert.equal(entry.variants.length,0);assert.ok(entry.reason);continue;}
    assert.ok(entry.variants.length>0);
    for(const variant of entry.variants){
      assert.ok(Number.isSafeInteger(variant.id)&&variant.id>0);
      assert.ok(Number.isSafeInteger(variant.shopifyProductId)&&variant.shopifyProductId>0);
      assert.equal(typeof variant.available,'boolean');
      assert.ok(Number.isInteger(variant.price)&&variant.price>=0);
      assert.ok(!ids.has(variant.id),`Duplicate variant ${variant.id}`);ids.add(variant.id);
      assert.ok(!skus.has(variant.sku),`Duplicate SKU ${variant.sku}`);skus.add(variant.sku);
      const parts=variant.sku.split('-');assert.equal(parts[0],base.id);assert.equal(parts[2],'F');
      assert.equal(variant.form,form);
      assert.equal(variant.productUrl,`https://shop.bullseyeglass.com/products/${variant.handle}`);
      assert.ok(entry.sources.some(source=>source.handle===variant.handle&&source.shopifyProductId===variant.shopifyProductId));
      if(form==='sheets'){
        assert.equal(parts[1],{2:'0050',3:'0030',6:'0060'}[variant.thicknessMm]);
        assert.ok(variant.title.includes(`${variant.thicknessMm} mm`));
        assert.ok(variant.title.includes(variant.sourceTitle));
        assert.match(variant.handle,/-(double|thin|single)-rolled-(2|3|6)-mm-fusible$/);
      }else assert.equal(parts[1],codes[form]);
    }
  }
  assert.equal(ids.size,Object.values(index.counts).reduce((sum,count)=>sum+count.variants,0));
});

test('switching every purchase form preserves every existing photo, sample, and thickness reference',()=>{
  for(const base of catalog.products)for(const {id:form} of FORM_OPTIONS){
    const product=productForForm(base,index,form);
    assert.equal(product.id,base.id);
    assert.equal(product.image,base.image);
    assert.equal(product.samples,base.samples);
    assert.equal(product.thicknessReference,base.thicknessReference);
    assert.equal(product.type,base.type);
    assert.equal(product.source,base.source);
    assert.equal(product.colorGuideGrain,'Medium frit');
    assert.equal(product.form,form);
    assert.ok(product.variants.every(variant=>variant.form===form));
  }
});

test('full-color matching order and sample thickness data stay identical across purchase forms',()=>{
  const target={rgb:[73,139,67]};
  const expected=matchCatalog(target,catalog.products,{limit:141}).map(match=>[match.product.id,match.deltaE,match.sample.rgb]);
  for(const {id:form} of FORM_OPTIONS){
    const actual=matchCatalog(target,catalog.products.map(base=>productForForm(base,index,form)),{limit:141}).map(match=>[match.product.id,match.deltaE,match.sample.rgb]);
    assert.deepEqual(actual,expected);
  }
});

test('each green format selects a distinct actual SKU; frit defaults to 5 lb and sheets to 3 mm',()=>{
  const chosen=[];
  for(const {id:form} of FORM_OPTIONS){
    const product=productForForm(green,index,form),variant=defaultFormatVariant(product,form);
    assert.ok(variant?.available);chosen.push(variant.id);
    if(form==='sheets')assert.equal(variant.thicknessMm,3);
    else {assert.match(variant.title,/5 lb/);assert.equal(variant.sku.split('-')[1],codes[form]);}
  }
  assert.equal(new Set(chosen).size,5);
});

test('explicit choices are honored within the active form even out of stock, with saved global frit sizes respected',()=>{
  const powder=productForForm(green,index,'powder');
  const fine=productForForm(green,index,'fine');
  const small=powder.variants.find(variant=>/5 oz/.test(variant.title));
  assert.equal(defaultFormatVariant(powder,'powder',small.id).id,small.id);
  assert.equal(defaultFormatVariant(powder,'powder',null,'5oz').id,small.id);
  assert.match(defaultFormatVariant(powder,'powder',null,'1lb').title,/1 lb/);
  assert.notEqual(defaultFormatVariant(powder,'powder',fine.variants[0].id).id,fine.variants[0].id);
  assert.equal(defaultFormatVariant(powder,'fine'),null);
  const withoutPreferred={...powder,variants:powder.variants.map(variant=>({...variant,available:variant.id!==small.id}))};
  assert.equal(defaultFormatVariant(withoutPreferred,'powder',small.id).id,small.id);
  assert.equal(defaultFormatVariant(withoutPreferred,'powder',small.id).available,false);
  const soldOut={...powder,variants:powder.variants.map(variant=>({...variant,available:false}))};
  assert.equal(defaultFormatVariant(soldOut,'powder',small.id).id,small.id);
  assert.equal(defaultFormatVariant(soldOut,'powder',undefined,'5oz').id,small.id);
});

test('allVariants retains prior form IDs and sheet source records after changing the global form',()=>{
  const sheet=productForForm(green,index,'sheets'),powder=productForForm(green,index,'powder');
  assert.deepEqual(sheet.allVariants,powder.allVariants);
  assert.ok(powder.allVariants.some(variant=>variant.form==='medium'&&variant.id===green.variants[0].id));
  const thin=sheet.variants.find(variant=>variant.thicknessMm===2&&variant.available);
  assert.ok(thin);
  assert.equal(defaultFormatVariant(sheet,'sheets',thin.id).id,thin.id);
  assert.match(thin.handle,/thin-rolled-2-mm-fusible$/);
  assert.equal(thin.productUrl,`https://shop.bullseyeglass.com/products/${thin.handle}`);
});

test('missing standard sheets remain unavailable and never fall back to a medium-frit purchase SKU',()=>{
  assert.deepEqual(index.missing.map(entry=>entry.code).sort(),['000102','001242','001247','001838']);
  for(const {code} of index.missing){
    const base=catalog.products.find(product=>product.id===code),product=productForForm(base,index,'sheets');
    assert.equal(product.formatMissing,true);
    assert.equal(product.formatUnavailable,true);
    assert.equal(product.productUrl,null);
    assert.deepEqual(product.variants,[]);
    assert.equal(defaultFormatVariant(product,'sheets'),null);
    assert.ok(product.allVariants.some(variant=>variant.form==='medium'));
  }
});

test('partial index fallback uses the known medium snapshot only, with canonical sheet aliases',()=>{
  assert.equal(normalizeForm('sheet'),'sheets');
  assert.equal(normalizeForm(' Sheets '),'sheets');
  assert.equal(normalizeForm('garbage'),'medium');
  assert.equal(getProductFormat(green,{},'medium').variants,green.variants);
  assert.equal(getProductFormat(green,{},'powder').missing,true);
  assert.deepEqual(productForForm(green,{},'sheets').variants,[]);
});
