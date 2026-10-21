/**
 * Purpose: keep regular Black available alongside transparent glass in picker/cart.
 * Setup: node --test; uses the bundled catalog and verified form records.
 * Writes: none. Constraints: retain real materials, tint exclusions and exact SKUs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {includedGlass, isTint} from '../extension/lib/material-filters.js';
import {matchCatalog} from '../extension/lib/palette.js';
import {productForForm, defaultFormatVariant} from '../extension/lib/product-formats.js';
import {productWithFormSamples} from '../extension/lib/form-samples.js';

const read = name => JSON.parse(readFileSync(new URL(`../extension/data/${name}.json`, import.meta.url)));
const {products} = read('catalog');
const formats = read('product-formats');
const samples = read('form-samples');
const transparentOnly = {glassTypes:{transparent:true, opalescent:false}};
const black = products.find(product => product.id === '000100');

test('Transparent includes regular Black without admitting other opalescent glass', () => {
  const selected = products.filter(product => includedGlass(product, transparentOnly));
  assert.equal(black.name, 'Black');
  assert.equal(black.type, 'Opalescent');
  assert.ok(selected.includes(black));
  assert.deepEqual(selected.filter(product => product.type !== 'Transparent').map(product => product.id), ['000100']);
  for (const id of ['000101', '000102']) assert.ok(!selected.some(product => product.id === id));
});

test('Black keeps its actual catalog metadata and respects both material filters being off', () => {
  const before = JSON.stringify(black);
  assert.equal(includedGlass(black, {glassTypes:{transparent:false, opalescent:true}}), true);
  assert.equal(includedGlass(black, {glassTypes:{transparent:false, opalescent:false}}), false);
  assert.equal(includedGlass(black, {glassTypes:{opalescent:false}}), true);
  assert.equal(products.some(product => includedGlass(product, {includeTints:true, glassTypes:{transparent:false, opalescent:false}})), false);
  assert.equal(JSON.stringify(black), before);
});

test('the Black exception leaves explicit tint inclusion unchanged', () => {
  const tints = products.filter(isTint);
  assert.ok(tints.length > 0);
  assert.ok(tints.every(product => !includedGlass(product, transparentOnly)));
  assert.ok(tints.every(product => includedGlass(product, {...transparentOnly, includeTints:true})));
});

test('transparent-only black targets match regular Black in every real purchase form', () => {
  for (const form of ['powder', 'fine', 'medium', 'coarse', 'sheets']) {
    const selected = products.map(product => productWithFormSamples(productForForm(product, formats, form), form, samples))
      .filter(product => includedGlass(product, transparentOnly));
    const match = matchCatalog('#000000', selected)[0];
    assert.equal(match.product.id, '000100', form);
    const variant = defaultFormatVariant(match.product, form);
    assert.ok(variant?.available && variant.id && variant.sku.startsWith('000100-'), form);
  }
});
