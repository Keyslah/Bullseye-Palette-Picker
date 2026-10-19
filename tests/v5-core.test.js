/**
 * Purpose: verify recovered v5 color, tint and settings behavior without network.
 * Setup: node --test; real bundled catalog plus deterministic test images.
 * Writes: test-only memory storage. Constraints: no user data or shopping actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {matchCatalog, sampleThickness, extractPalette} from '../extension/lib/palette.js';
import {isTint, includedGlass} from '../extension/lib/material-filters.js';
import {normalizeSettings} from '../extension/lib/settings.js';
import {listSettingsPresets, saveSettingsPreset, PRESETS_KEY} from '../extension/lib/settings-presets.js';
const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url)));

test('v5 retains twenty tints in catalog but excludes them by default', () => {
  const tints = products.filter(isTint);
  assert.equal(tints.length, 20);
  assert.ok(tints.every(product => !includedGlass(product)));
  assert.ok(tints.every(product => includedGlass(product, {includeTints:true})));
  assert.ok(tints.every(product => !includedGlass(product, {includeTints:true,glassTypes:{transparent:false}})));
});
test('Dark Forest Green has different photo-strength percentages without changing its matches', () => {
  const product = products.find(value => value.id === '000141');
  const before = JSON.stringify(product);
  const dark = matchCatalog('#313924', [product])[0];
  const light = matchCatalog('#687F49', [product])[0];
  const values = [sampleThickness(dark.sample, product), sampleThickness(light.sample, product)];
  console.log('Dark Forest Green screenshot samples:', values.map(Math.round));
  assert.ok(values[0] > values[1] + 10);
  assert.equal(sampleThickness(product.thicknessReference, product), 100);
  assert.equal(JSON.stringify(product), before);
  assert.ok(products.filter(p => p.colorFamily === 'neutral' && p.type === 'Opalescent').every(p => sampleThickness(p.samples[0],p) === 100));
});
test('view defaults and preset names are validated', () => {
  assert.equal(normalizeSettings().includeTints, false);
  assert.equal(normalizeSettings().showFullPalette, true);
  assert.equal(normalizeSettings({includeTints:true,showFullPalette:false}).showFullPalette, false);
  assert.throws(() => normalizeSettings({includeTints:'false'}), /on or off/);
});
test('named presets round-trip, remain independent, and serialize concurrent saves', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const values = new Map([['bullseyeProjectV1','keep-photo']]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
  t.after(() => { if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage; });
  const [first,second] = await Promise.all([saveSettingsPreset('Fine work',{format:'fine'}),saveSettingsPreset('Sheets',{format:'sheets'})]);
  assert.equal((await listSettingsPresets()).length,2);
  await saveSettingsPreset('Fine work',{format:'coarse'},first.id);
  assert.equal((await listSettingsPresets()).find(p=>p.id===second.id).settings.format,'sheets');
  assert.equal(values.get('bullseyeProjectV1'),'keep-photo');
  assert.ok(values.has(PRESETS_KEY));
  await assert.rejects(saveSettingsPreset('',{}),/name/);
});
test('seeded remix uses actual pixels and leaves ordinary extraction repeatable', () => {
  const width=100,height=100,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){data[i*4]=(i*37)%256;data[i*4+1]=(i*11)%256;data[i*4+2]=(i*79)%256;data[i*4+3]=255;}
  const image={width,height,data};
  const original=extractPalette(image,{count:6});
  assert.deepEqual(extractPalette(image,{count:6}),original);
  const remixes=[1,2,3,4].map(seed=>extractPalette(image,{count:6,seed}));
  assert.ok(remixes.some(result=>JSON.stringify(result)!==JSON.stringify(original)));
  for(const result of remixes)for(const point of result){const i=(Math.floor(point.y*height)*width+Math.floor(point.x*width))*4;assert.deepEqual(point.rgb,Array.from(data.slice(i,i+3)));}
});
