/** Purpose: verify explicit alternatives without weakening automatic matching.
 * Setup: node --test with the unchanged catalog. Writes: none, read-only fixtures.
 * Constraints: honor filters and never match background gaps of colored glass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {matchCatalog,getColorFamily} from '../extension/lib/palette.js';
import {includedGlass} from '../extension/lib/material-filters.js';
const products=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url))).products;
test('French Vanilla and Sunset Coral are explicit alternatives to a pale cream',()=>{
 const ps=products.filter(p=>includedGlass(p));
 const strict=matchCatalog('#F7F4E3',ps,{limit:Infinity});
 assert.ok(strict.every(m=>m.product.colorFamily==='neutral'));
 const alternatives=matchCatalog('#F7F4E3',ps,{limit:Infinity,includeOtherFamilies:true});
 for(const name of ['French Vanilla','Sunset Coral'])assert.ok(alternatives.some(m=>m.product.name===name));
 assert.equal(alternatives.length,ps.length);
 assert.ok(alternatives.every(m=>getColorFamily(m.sample)===m.product.colorFamily));
 assert.deepEqual(strict,matchCatalog('#F7F4E3',ps,{limit:Infinity}));
});
test('Coral Orange Tint obeys explicit tint inclusion and material settings',()=>{
 for(const includeTints of [false,true]){
  const ps=products.filter(p=>includedGlass(p,{includeTints}));
  const m=matchCatalog('#EF964D',ps,{limit:Infinity,includeOtherFamilies:true});
  assert.equal(m.some(m=>m.product.name==='Coral Orange Tint'),includeTints);
 }
 const ps=products.filter(p=>includedGlass(p,{includeTints:true,glassTypes:{transparent:false}}));
 assert.ok(matchCatalog('#F7F4E3',ps,{limit:Infinity,includeOtherFamilies:true}).every(m=>m.product.type==='Opalescent'));
});
