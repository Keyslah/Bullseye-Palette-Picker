/**
 * Purpose: regress exact-form samples, shared references and valid photo inspection.
 * Setup: node --test; uses bundled catalog and measured real-photo metadata.
 * Writes: none; no network, browser storage, account access, or shopping requests.
 * Constraints: tests actual catalog coordinates/variants, never synthetic SKU guesses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {rgbToLab} from '../extension/lib/color.js';
import {matchCatalog, sampleThickness} from '../extension/lib/palette.js';
import {productForForm} from '../extension/lib/product-formats.js';
import {productPhotoSpec} from '../extension/lib/cart-photos.js';
import {SAMPLED_FORMS, productWithFormSamples, samplesForForm, samplesForPhoto, nearestPhotoSample} from '../extension/lib/form-samples.js';

const read = name => JSON.parse(readFileSync(fileURLToPath(new URL(`../extension/data/${name}.json`, import.meta.url))));
const catalog = read('catalog').products;
const formats = read('product-formats');
const photos = read('cart-photos');
const index = read('form-samples');

test('all 564 actual frit photos have independent coordinates bound to their selected URL', () => {
  let count = 0;
  for (const base of catalog) for (const form of SAMPLED_FORMS) {
    const record = samplesForForm(base, form, index);
    const product = productWithFormSamples(productForForm(base, formats, form), form, index);
    assert.ok(record && record.samples.length >= 12 && record.samples.length <= 40, `${base.id} ${form}`);
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(record.pixels.length, 2);
    for (const variant of product.variants) assert.equal(productPhotoSpec(product, variant, photos).images[0], record.imageUrl);
    assert.equal(product.thicknessReference, base.thicknessReference);
    assert.equal(samplesForPhoto(product, record.imageUrl), record.samples);
    assert.deepEqual(samplesForPhoto(product, base.image), []);
    for (const other of SAMPLED_FORMS.filter(value => value !== form)) {
      assert.deepEqual(samplesForPhoto(product, index.products[base.id][other].imageUrl), []);
    }
    count += 1;
  }
  assert.equal(count, 564);
});

test('photo samples stay inside reviewed material regions with full valid RGB', () => {
  for (const base of catalog) for (const form of SAMPLED_FORMS) {
    const record = index.products[base.id][form], [left, top, right, bottom] = record.region.rect;
    for (const sample of [...record.samples, ...record.inspectionSamples]) {
      assert.ok(sample.x >= left && sample.x <= right && sample.y >= top && sample.y <= bottom, `${base.id} ${form} ${sample.id}`);
      assert.ok(sample.rgb.length === 3 && sample.rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
      const lab = rgbToLab(sample.rgb), chroma = Math.hypot(lab[1], lab[2]);
      assert.ok(record.colorFamily === 'neutral' ? chroma < 10 : chroma >= 10);
      if (record.region.shape === 'circle') assert.ok((sample.x - .5) ** 2 + (sample.y - .5) ** 2 <= .32 ** 2 + 1e-7);
      if (record.region.lightnessRange) assert.ok(lab[0] >= record.region.lightnessRange[0] && lab[0] <= record.region.lightnessRange[1]);
    }
  }
});

test('Aquamarine form ranges retain the shared reference rather than stretching each minimum to zero', () => {
  const base = catalog.find(value => value.id === '001108');
  const ranges = {};
  for (const form of SAMPLED_FORMS) {
    const product = productWithFormSamples(base, form, index);
    const percentages = product.samples.map(sample => sampleThickness(sample, product));
    ranges[form] = [Math.round(Math.min(...percentages)), Math.round(Math.max(...percentages))];
    assert.equal(sampleThickness({rgb:[80, 140, 150]}, product), sampleThickness({rgb:[80, 140, 150]}, base));
  }
  assert.deepEqual(ranges, {powder:[20,100], fine:[18,100], medium:[35,100], coarse:[45,100]});
  const fine = productWithFormSamples(base, 'fine', index);
  const coarse = productWithFormSamples(base, 'coarse', index);
  assert.notDeepEqual(fine.samples.map(s => [s.x,s.y]), coarse.samples.map(s => [s.x,s.y]));
});

test('full-color matcher uses real selected-form RGB with its own marker position', () => {
  const base = catalog.find(value => value.id === '001108');
  for (const form of SAMPLED_FORMS) {
    const product = productWithFormSamples(base, form, index), sample = product.samples[12];
    const match = matchCatalog(sample.rgb, [product])[0];
    assert.equal(match.deltaE, 0);
    assert.deepEqual(match.sample.rgb, sample.rgb);
    assert.ok(product.samples.includes(match.sample));
  }
});

test('nearby photo inspection snaps to measured glass and rejects remote background clicks', () => {
  const record = index.products['001247'].fine;
  const sample = record.inspectionSamples[10];
  assert.equal(nearestPhotoSample(record.inspectionSamples, sample.x, sample.y), sample);
  assert.equal(nearestPhotoSample(record.inspectionSamples, 0, 0), null);
  assert.equal(nearestPhotoSample(record.inspectionSamples, -1, .5), null);
  assert.equal(nearestPhotoSample(record.inspectionSamples, NaN, .5), null);
  const invalid = {rgb:[255,255,255],x:.5,y:.5,background:true};
  assert.equal(nearestPhotoSample([invalid], .5, .5), null);
});

test('missing form samples never borrow Medium coordinates and sheets preserve their existing guide', () => {
  const base = catalog[0];
  assert.deepEqual(productWithFormSamples(base, 'fine', {}).samples, []);
  assert.equal(productWithFormSamples(base, 'sheets', index), base);
  assert.equal(samplesForForm(base, 'sheets', index), null);
});

test('verified neutral Powder appearances retain original shared reference identity', () => {
  for (const id of ['000137','000206','001864']) {
    const base = catalog.find(value => value.id === id), product = productWithFormSamples(base, 'powder', index);
    assert.equal(product.colorFamily, 'neutral');
    assert.equal(product.referenceColorFamily, base.colorFamily);
    assert.equal(product.thicknessReference, base.thicknessReference);
    assert.equal(matchCatalog(product.samples[0].rgb, [product])[0].deltaE, 0);
  }
});

test('neutral Powder appearances use the original shared percentage scale across every form', () => {
  for (const id of ['000137','000206','001864']) {
    const base = catalog.find(value => value.id === id);
    for (const form of SAMPLED_FORMS) {
      const product = productWithFormSamples(base, form, index);
      for (const sample of product.samples) {
        assert.equal(sampleThickness(sample, product), sampleThickness(sample, base), `${id} ${form} ${sample.id}`);
      }
    }
    const powder = productWithFormSamples(base, 'powder', index);
    const percentages = powder.samples.map(sample => sampleThickness(sample, powder));
    assert.ok(Math.min(...percentages) > 0, `${id} has no fabricated 0% endpoint`);
    assert.ok(percentages.some(value => value < 100), `${id} is not forced to neutral-opal 100%`);
  }
  const vanilla = productWithFormSamples(catalog.find(value => value.id === '000137'), 'powder', index);
  assert.equal(Math.round(Math.min(...vanilla.samples.map(s => sampleThickness(s, vanilla)))), 36);
  assert.equal(Math.round(Math.max(...vanilla.samples.map(s => sampleThickness(s, vanilla)))), 63);
});

test('original neutral opalescent glass retains its existing full-color 100% guide', () => {
  for (const base of catalog.filter(product => product.colorFamily === 'neutral' && product.type === 'Opalescent')) {
    for (const form of SAMPLED_FORMS) {
      const product = productWithFormSamples(base, form, index);
      for (const sample of product.samples) assert.equal(sampleThickness(sample, product), 100, `${base.id} ${form}`);
    }
  }
});
