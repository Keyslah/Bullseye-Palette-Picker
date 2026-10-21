/**
 * Purpose: verify purple hue fidelity and Orange Striker choices without changing color scores.
 * Setup: node --test with synthetic matches plus the bundled catalog.
 * Writes: none. Constraints: no product removal, no stock or filter bypass, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preferredAutomaticMatch} from '../extension/lib/match-preference.js';
import {matchCatalog} from '../extension/lib/palette.js';
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
