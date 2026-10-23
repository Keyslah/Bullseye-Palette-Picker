/**
 * Purpose: verify ordinary Black, purple hue fidelity and Orange Striker automatic choices.
 * Setup: node --test with synthetic matches plus the bundled catalog.
 * Writes: none. Constraints: no product removal, no stock or filter bypass, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preferredAutomaticMatch} from '../extension/lib/match-preference.js';
import {extractPalette, matchCatalog} from '../extension/lib/palette.js';
import {hexToRgb} from '../extension/lib/color.js';
import {includedGlass} from '../extension/lib/material-filters.js';
import {productForForm, defaultFormatVariant} from '../extension/lib/product-formats.js';
import {productWithFormSamples} from '../extension/lib/form-samples.js';
const matches=[{product:{id:'001321'},deltaE:1},{product:{id:'001025'},deltaE:6},{product:{id:'000141'},deltaE:12}];
test('only a would-be Carnelian primary is replaced by Orange Striker',()=>{
  assert.equal(preferredAutomaticMatch(matches),matches[1]);
  assert.equal(preferredAutomaticMatch([matches[2],...matches]),matches[2]);
  assert.equal(preferredAutomaticMatch([]),null);
});
test('the preference cannot invent filtered or unavailable Orange Striker',()=>{
  assert.equal(preferredAutomaticMatch([matches[0],matches[2]]),matches[0]);
  assert.equal(preferredAutomaticMatch(matches,m=>m.product.id!=='001025'),matches[0]);
});
test('Carnelian remains in the unchanged alternatives list with unchanged scores',()=>{
  const before=JSON.stringify(matches);preferredAutomaticMatch(matches);
  assert.equal(JSON.stringify(matches),before);assert.equal(matches[0].product.id,'001321');
});
test('actual catalog regression chooses Light Orange Striker for the former Carnelian target',()=>{
  const products=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url))).products.filter(p=>includedGlass(p));
  const ranked=matchCatalog('#F9994F',products,{tolerance:Infinity,limit:Infinity});
  assert.equal(ranked[0].product.id,'001321');
  assert.equal(preferredAutomaticMatch(ranked).product.id,'001025');
  assert.ok(ranked.some(match=>match.product.id==='001321'));
});

const read = name => JSON.parse(fs.readFileSync(new URL(`../extension/data/${name}.json`,import.meta.url)));
const catalog = read('catalog'), formats = read('product-formats'), photos = read('form-samples');
const inStock = match => Boolean(defaultFormatVariant(match.product,match.product.form)?.available);
function realMatches(target,form='fine',options={}) {
  const products = catalog.products.map(base=>productWithFormSamples(productForForm(base,formats,form),form,photos))
    .filter(product=>includedGlass(product,{glassTypes:{transparent:true,opalescent:false}}));
  return matchCatalog(target,products,{limit:Infinity,...options});
}

test('near-black photo casts no longer choose blue or gray instead of regular Black',()=>{
  // These actual catalog/form cases failed even after Black was made eligible:
  // the available blue/gray photograph had a smaller raw color difference.
  for (const [form,targets] of Object.entries({
    powder:['#1C1721'],fine:['#202729','#1C1721','#191E28'],
    medium:['#202729','#1C1721'],coarse:['#101010','#202020','#303030'],
    sheets:['#101010','#202020','#303030'],
  })) {
    for (const target of targets) {
      const ranked=realMatches(target,form), before=JSON.stringify(ranked);
      const previous=ranked.find(inStock), black=ranked.find(match=>match.product.id==='000100');
      assert.notEqual(previous.product.id,'000100',`${form} ${target}: reproduce photo bias`);
      assert.ok(black.deltaE>previous.deltaE+.25,'the previous near-tie rule could not help');
      const choice=preferredAutomaticMatch(ranked,inStock,target);
      assert.equal(choice,black,`${form} ${target}`);
      assert.ok(inStock(choice));
      assert.ok(choice.product.samples.includes(choice.sample),'retain the real marker sample');
      if (form!=='sheets') assert.ok(photos.products['000100'][form].samples.includes(choice.sample));
      assert.equal(JSON.stringify(ranked),before,'do not rewrite scores, samples or alternatives');
    }
  }
});

test('actual image-extracted black and near-black colors select regular Black in every form',()=>{
  const colors=['#000000','#101010','#202020','#303030','#202729','#1C1721'];
  const pixels=new Uint8ClampedArray(colors.flatMap(hex=>[...hexToRgb(hex),255]));
  const targets=extractPalette({width:colors.length,height:1,data:pixels},{count:colors.length});
  assert.equal(targets.length,colors.length);
  for (const form of ['powder','fine','medium','coarse','sheets']) {
    for (const target of targets) {
      const ranked=realMatches(target,form);
      assert.equal(preferredAutomaticMatch(ranked,inStock,target).product.id,'000100',`${form} ${target.hex}`);
    }
  }
});

test('Black automatic preference does not replace visible dark hues or lighter grays',()=>{
  for (const form of ['powder','fine','medium','coarse','sheets']) {
    for (const target of ['#0A1429','#242032','#3B1020','#133B20','#3F3F3F','#777777','#E3E3E3']) {
      const ranked=realMatches(target,form), previous=ranked.find(inStock);
      assert.notEqual(previous.product.id,'000100',`${form} ${target}: meaningful color control`);
      assert.equal(preferredAutomaticMatch(ranked,inStock,target),previous,`${form} ${target}`);
    }
  }
});

test('Black automatic preference respects availability, material filtering and strict tolerance',()=>{
  const target='#202729', ranked=realMatches(target);
  const available=match=>match.product.id!=='000100'&&inStock(match);
  assert.equal(preferredAutomaticMatch(ranked,available,target),ranked.find(available));
  const filtered=ranked.filter(match=>match.product.id!=='000100');
  assert.equal(preferredAutomaticMatch(filtered,inStock,target),filtered.find(inStock));
  const strict=realMatches(target,'fine',{tolerance:ranked.find(inStock).deltaE});
  assert.ok(strict.length>0 && strict.every(match=>match.product.id!=='000100'));
  assert.equal(preferredAutomaticMatch(strict,inStock,target),strict.find(inStock));
  assert.equal(preferredAutomaticMatch([],inStock,target),null);
});

test('screenshot purple #6A12DE chooses an actual purple photo sample in every frit form',()=>{
  // Flat fill measured in the reported numbered purple dot: RGB(106,18,222).
  const target = {rgb:[106,18,222],hex:'#6A12DE'};
  // Gold Purple Medium is unavailable in the bundled stock snapshot, so the
  // available Violet Striker photo is used instead of bypassing availability.
  for (const [form,id] of Object.entries({powder:'001334',fine:'001334',medium:'001234',coarse:'001234'})) {
    const ranked = realMatches(target,form), before = JSON.stringify(ranked);
    assert.equal(ranked[0].product.id,'001114',`${form}: reproduce the old blue result`);
    const choice = preferredAutomaticMatch(ranked,inStock,target);
    assert.equal(choice.product.id,id,form);
    assert.ok(choice.product.samples.includes(choice.sample));
    assert.ok(photos.products[id][form].samples.includes(choice.sample));
    assert.equal(choice,ranked.find(match=>match.product.id===id));
    assert.equal(JSON.stringify(ranked),before,'raw ranking, scores and samples remain intact');
  }
});

test('other clear purple targets retain purple choices without favoring a named product',()=>{
  for (const form of ['powder','fine','medium','coarse','sheets']) {
    for (const target of ['#6600FF','#8322CC','#562292']) {
      const ranked = realMatches(target,form);
      const choice = preferredAutomaticMatch(ranked,inStock,target);
      assert.match(choice.product.name,/Purple|Violet/,`${form} ${target}`);
    }
  }
});

test('blue and blue-violet controls keep their full-color automatic match',()=>{
  for (const form of ['powder','fine','medium','coarse','sheets']) {
    for (const target of ['#0000FF','#4000FF','#5000FF','#2B3EB6','#263AB5']) {
      const ranked = realMatches(target,form);
      assert.equal(preferredAutomaticMatch(ranked,inStock,target),ranked.find(inStock),`${form} ${target}`);
    }
  }
});

test('already-purple matches and neutral targets are unchanged',()=>{
  for (const target of ['#9966CC','#6A4887','#A032D4','#777777','#000000','#F1F1F1']) {
    const ranked = realMatches(target);
    assert.equal(preferredAutomaticMatch(ranked,inStock,target),ranked.find(inStock),target);
  }
});

test('purple preference respects availability, material filtering and strict color tolerance',()=>{
  const target = '#6A12DE', ranked = realMatches(target);
  const available = match => match.product.id!=='001334' && inStock(match);
  const choice = preferredAutomaticMatch(ranked,available,target);
  assert.ok(available(choice));
  assert.notEqual(choice.product.id,'001334');
  const filtered = ranked.filter(match=>match.product.id!=='001334');
  assert.ok(filtered.includes(preferredAutomaticMatch(filtered,inStock,target)));
  const strict = realMatches(target,'fine',{tolerance:15});
  assert.ok(strict.every(match=>match.product.id!=='001334' && match.deltaE<=15));
  assert.equal(preferredAutomaticMatch(strict,inStock,target),strict.find(inStock));
});

test('a remotely similar hue cannot replace a much closer full-color match',()=>{
  const target = '#6A12DE';
  const ranked = matchCatalog(target,[
    {id:'blue',samples:[{rgb:[38,58,181]}]},
    {id:'pale-purple',samples:[{rgb:[237,221,255]}]},
  ]);
  assert.equal(ranked[0].product.id,'blue');
  assert.ok(ranked[1].deltaE>25);
  assert.equal(preferredAutomaticMatch(ranked,()=>true,target),ranked[0]);
});

test('missing or unusable target colors retain the existing automatic choice',()=>{
  const ranked = realMatches('#6A12DE');
  for (const target of [null,{},'#wrong',{rgb:[1,2]},{rgb:[NaN,0,1]}]) {
    assert.equal(preferredAutomaticMatch(ranked,inStock,target),ranked.find(inStock));
  }
  assert.equal(preferredAutomaticMatch([],inStock,'#6A12DE'),null);
});
