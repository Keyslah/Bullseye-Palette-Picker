"""Purpose: reconstruct v5 color/settings changes on the verified v4 source.
Setup: run once from repository root; the recovery workflow records applied patches.
Writes: only named source files and their focused regression tests; no catalog changes.
Constraints: preserve default extraction/ranking and all existing local storage keys.
"""
from pathlib import Path
import json

def change(path, old, new):
    file = Path(path)
    text = file.read_text()
    assert old in text, f'Missing patch anchor in {path}: {old[:100]}'
    file.write_text(text.replace(old, new, 1))

for name in ('extension/manifest.json', 'package.json'):
    change(name, '"version": "0.4.0"', '"version": "0.5.0"')

change('extension/lib/settings.js', "paletteCount:6, imageSize:'fit',", "paletteCount:6, imageSize:'fit', includeTints:false, showFullPalette:true,")
change('extension/lib/settings.js', '  return {\n    version:1,', "  for (const flag of ['includeTints','showFullPalette']) {\n    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Error('View settings must be on or off.');\n  }\n  return {\n    version:1,\n    includeTints:value.includeTints ?? false, showFullPalette:value.showFullPalette ?? true,")
change('tests/settings.test.js', "paletteCount:6,imageSize:'fit',", "paletteCount:6,imageSize:'fit',includeTints:false,showFullPalette:true,")

change('extension/lib/palette.js', "  if (type === 'opalescent' || type === 'opaque') return 100;", "  // Neutral opaque black/white use their full-color reference. Chromatic opals\n  // use the same photo-strength comparison as transparent glass, not a constant.\n  if ((type === 'opalescent' || type === 'opaque')\n    && (product?.colorFamily || getColorFamily(sample)) === 'neutral') return 100;")
change('extension/lib/palette.js', " * Opaque/opalescent grain color cannot reveal depth, so it uses the 100%\n * full-color reference. Returns null when transparent reference data is unusable.", " * Chromatic opals also compare photographed color strength. Neutral opaque\n * glass retains its 100% full-color reference. Neither is physical calibration.\n * Returns null when reference data is unusable.")
change('extension/lib/palette.js', 'function deterministicRandom() {\n  let state = 0x72a31f49;', 'function deterministicRandom(seed = 0x72a31f49) {\n  let state = (Number(seed) >>> 0) || 0x72a31f49;')
change('extension/lib/palette.js', 'function sampledColors(data, maxSamples, width, height) {\n  const random = deterministicRandom();', 'function sampledColors(data, maxSamples, width, height, seed) {\n  const random = deterministicRandom(seed);')
change('extension/lib/palette.js', 'function initialCenters(points, count) {', 'function initialCenters(points, count, random = null) {')
change('extension/lib/palette.js', '  const centers = [mostCommon.lab.slice()];', '''  const pickWeighted = scores => {
    let remaining = random() * scores.reduce((sum, score) => sum + score, 0);
    for (let i = 0; i < scores.length; i++) { remaining -= scores[i]; if (remaining < 0) return i; }
    return scores.length - 1;
  };
  if (random) mostCommon = points[pickWeighted(points.map(point => point.weight))];
  const centers = [mostCommon.lab.slice()];''')
change('extension/lib/palette.js', '    if (next < 0) break;', '    if (next < 0) break;\n    if (random) next = pickWeighted(points.map((point, index) => distances[index] * point.weight));')
change('extension/lib/palette.js', 'export function extractPalette(imageData, { count = 8, maxSamples = 12000 } = {}) {', 'export function extractPalette(imageData, { count = 8, maxSamples = 12000, seed } = {}) {')
change('extension/lib/palette.js', 'sampledColors(data, sampleLimit, dimensionsValid && width, dimensionsValid && height);', 'sampledColors(data, sampleLimit, dimensionsValid && width, dimensionsValid && height, seed);')
change('extension/lib/palette.js', 'initialCenters(points, Math.min(desiredCount, points.length));', 'initialCenters(points, Math.min(desiredCount, points.length), seed === undefined ? null : deterministicRandom(seed));')

Path('extension/lib/material-filters.js').write_text('''/**
 * Purpose: share explicit material/tint filtering between picker and cart.
 * Setup: pass reviewed catalog products; tints remain bundled and purchasable.
 * Writes: none. Constraints: never classify a product by its sampled brightness.
 */
export function isTint(product) {
  return product?.isTint === true || /\\btint\\b/i.test(`${product?.name || ''} ${product?.fullName || ''}`);
}
export function includedGlass(product, {glassTypes = {}, includeTints = false} = {}) {
  if (!includeTints && isTint(product)) return false;
  const type = String(product?.type || '').toLowerCase();
  return type === 'transparent' ? glassTypes.transparent !== false
    : ['opalescent','opaque'].includes(type) && glassTypes.opalescent !== false;
}
''')

# Presets live separately from defaults, photo palettes and carts. Serialize writes.
Path('extension/lib/settings-presets.js').write_text('''/**
 * Purpose: named settings presets, separate from photos, carts and working state.
 * Setup: Chrome local storage in the extension; localStorage only in previews.
 * Writes: explicit saves replace only a named preset with the same id.
 * Constraints: propagate storage failures; never send preferences over the network.
 */
import {normalizeSettings} from './settings.js';
export const PRESETS_KEY = 'bullseyeSettingsPresetsV1';
const inExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
let writes = Promise.resolve();
async function read() {
  const value = inExtension() ? (await chrome.storage.local.get(PRESETS_KEY))[PRESETS_KEY]
    : JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Saved settings could not be read.');
  return value.map(record => {
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') throw new Error('A saved settings preset is damaged.');
    return {...record, settings:normalizeSettings(record.settings)};
  });
}
export async function listSettingsPresets() {
  await writes.catch(() => {});
  return (await read()).sort((a,b) => b.updatedAt - a.updatedAt);
}
export function saveSettingsPreset(name, settings, id = null) {
  const action = writes.catch(() => {}).then(async () => {
    const clean = String(name || '').trim();
    if (!clean || clean.length > 80) throw new Error('Give these settings a name of 1 to 80 characters.');
    const normalized = normalizeSettings(settings), records = await read();
    const existing = id ? records.find(record => record.id === id) : null;
    if (id && !existing) throw new Error('These saved settings no longer exist. Save with a new name.');
    const record = {id:existing?.id || crypto.randomUUID(), name:clean, settings:normalized, updatedAt:Date.now()};
    const next = records.filter(value => value.id !== record.id).concat(record);
    if (inExtension()) await chrome.storage.local.set({[PRESETS_KEY]:next});
    else localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    return structuredClone(record);
  });
  writes = action;
  return action;
}
''')

Path('tests/v5-core.test.js').write_text('''/**
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
''')
print('Core v5 source and regression tests written; catalog untouched.')
