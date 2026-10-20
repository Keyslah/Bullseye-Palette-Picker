/**
 * Purpose: verify the user's Orange Striker preference without changing color scores.
 * Setup: node --test with synthetic matches plus the bundled catalog.
 * Writes: none. Constraints: no product removal, no stock or filter bypass, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preferredAutomaticMatch} from '../extension/lib/match-preference.js';
import {matchCatalog} from '../extension/lib/palette.js';
import {includedGlass} from '../extension/lib/material-filters.js';
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
