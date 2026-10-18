/**
 * Purpose: Verify full-color palette extraction and strict product-match behavior.
 * Setup: Run node --test from the project root with the included synthetic image data.
 * Destructive behavior: None; tests do not access images, accounts, or external services.
 * Constraints: Darkness is a display label; equal lightness never makes unlike hues match.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, labToRgb, rgbToHex, rgbToLab } from '../extension/lib/color.js';
import { extractPalette, matchCatalog } from '../extension/lib/palette.js';
import fs from 'node:fs';

function pixels(groups) {
  const data = [];
  for (const { rgb, count, alpha = 255 } of groups) {
    for (let index = 0; index < count; index += 1) data.push(...rgb, alpha);
  }
  return { data: Uint8ClampedArray.from(data), width: data.length / 4, height: 1 };
}

function sample(rgb, darkness = 50, other = {}) {
  return { rgb, hex: rgbToHex(rgb), lab: rgbToLab(rgb), darkness, x: 0.5, y: 0.5, ...other };
}

function product(id, samples) {
  return { id, name: id, samples };
}

test('palette preserves distinct equal-lightness hues and their area weights', () => {
  const red = labToRgb([55, 45, 15]);
  const green = labToRgb([55, -35, 15]);
  const blue = labToRgb([55, 5, -35]);
  const data = pixels([{ rgb: red, count: 70 }, { rgb: green, count: 25 }, { rgb: blue, count: 5 }]);
  const palette = extractPalette(data, { count: 3 });
  assert.deepEqual(palette.map((color) => color.rgb), [red, green, blue]);
  assert.deepEqual(palette.map((color) => color.weight), [0.7, 0.25, 0.05]);
  assert.deepEqual(extractPalette(data, { count: 3 }), palette);
  for (const color of palette) assert.deepEqual(color.lab, rgbToLab(color.rgb));
});

test('transparent pixels are ignored and partly transparent colors are opacity-weighted', () => {
  const data = pixels([
    { rgb: [0, 0, 255], count: 1000, alpha: 0 },
    { rgb: [255, 0, 0], count: 10 },
    { rgb: [0, 255, 0], count: 10, alpha: 128 },
  ]);
  const palette = extractPalette(data, { count: 3 });
  assert.equal(palette.length, 2);
  assert.equal(palette[0].hex, '#FF0000');
  assert.ok(Math.abs(palette[0].weight - 255 / 383) < 1e-12);
  assert.ok(Math.abs(palette.reduce((sum, color) => sum + color.weight, 0) - 1) < 1e-12);
  assert.deepEqual(extractPalette(pixels([{ rgb: [255, 0, 0], count: 10, alpha: 0 }])), []);
});

test('deterministic reservoir sampling keeps dominant colors and an accent', () => {
  const data = pixels([
    { rgb: [20, 90, 170], count: 22000 },
    { rgb: [170, 170, 140], count: 16000 },
    { rgb: [240, 20, 50], count: 2000 },
  ]);
  const options = { count: 3, maxSamples: 3000 };
  const first = extractPalette(data, options);
  assert.deepEqual(first, extractPalette(data, options));
  assert.equal(first.length, 3);
  const accent = first.find((color) => color.hex === '#F01432');
  assert.ok(accent && accent.weight > 0.03 && accent.weight < 0.07);
});

test('representatives are actual input colors and count is bounded', () => {
  const colors = Array.from({ length: 30 }, (_, index) => [index * 8, 255 - index * 7, (index * 29) % 256]);
  const data = pixels(colors.map((rgb) => ({ rgb, count: 3 })));
  const actualHex = new Set(colors.map(rgbToHex));
  const palette = extractPalette(data, { count: 100 });
  assert.ok(palette.length <= 12 && palette.length > 1);
  assert.ok(palette.every((color) => actualHex.has(color.hex)));
  assert.equal(extractPalette(data, { count: 1 }).length, 2);
  assert.equal(extractPalette(pixels([{ rgb: [15, 80, 190], count: 10 }])).length, 1);
});

test('same grayscale lightness but different hue is never treated as a match', () => {
  const red = labToRgb([55, 45, 15]);
  const green = labToRgb([55, -35, 15]);
  assert.ok(Math.abs(rgbToLab(red)[0] - rgbToLab(green)[0]) < 0.3);
  const matching = product('red', [sample(red, 20)]);
  // Deliberately wrong cached Lab and identical darkness must not disguise green RGB.
  const wrongHue = product('green', [sample(green, 20, { lab: rgbToLab(red) })]);
  assert.ok(deltaE2000(rgbToLab(red), rgbToLab(green)) > 30);
  const matches = matchCatalog({ rgb: red }, [wrongHue, matching], { tolerance: 3 });
  assert.deepEqual(matches.map((match) => match.product.id), ['red']);
  assert.equal(matches[0].deltaE, 0);
});

test('one nearest actual full-color sample is returned per product regardless of darkness', () => {
  const target = [20, 95, 190];
  const exact = sample(target, 31);
  const glass = product('blue', [sample([150, 170, 225], 50), exact, sample([12, 31, 50], 85)]);
  const result = matchCatalog(target, [glass], { tolerance: 0 });
  assert.equal(result.length, 1);
  assert.equal(result[0].product, glass);
  assert.equal(result[0].sample, exact);
  assert.equal(result[0].sample.darkness, 31);
  assert.equal(result[0].deltaE, 0);
  assert.equal(result[0].withinTolerance, true);
});

test('loosening tolerance only adds valid alternatives without silently widening', () => {
  const target = [50, 100, 175];
  const catalog = [
    product('exact', [sample(target)]),
    product('near', [sample([54, 103, 178])]),
    product('farther', [sample([84, 116, 184])]),
    product('wrong-hue', [sample([190, 110, 70])]),
  ];
  let previous = [];
  for (const tolerance of [0, 2, 6, 12, 30, Infinity]) {
    const result = matchCatalog(rgbToHex(target), catalog, { tolerance, limit: Infinity });
    const ids = result.map((match) => match.product.id);
    assert.ok(previous.every((id) => ids.includes(id)));
    assert.ok(result.every((match) => match.deltaE <= tolerance && match.withinTolerance));
    assert.ok(result.every((match, index) => index === 0 || result[index - 1].deltaE <= match.deltaE));
    previous = ids;
  }
  assert.deepEqual(matchCatalog(target, [catalog[3]], { tolerance: 1 }), []);
  assert.equal(matchCatalog(target, catalog, { tolerance: Infinity, limit: 2 }).length, 2);
});

test('matching leaves catalog inputs untouched and skips incomplete samples', () => {
  const rgb = [180, 100, 30];
  const catalog = [product('missing', [{}]), product('valid', [{}, sample(rgb)])];
  const before = JSON.stringify(catalog);
  assert.equal(matchCatalog({ hex: rgbToHex(rgb) }, catalog, { tolerance: 0 }).length, 1);
  assert.equal(JSON.stringify(catalog), before);
  assert.deepEqual(matchCatalog(rgb, catalog, { tolerance: Infinity, limit: 0 }), []);
});

test('every automatic dot identifies its actual image color, including disjoint regions', () => {
  const image = pixels([
    {rgb: [20, 90, 160], count: 15},
    {rgb: [190, 30, 50], count: 40},
    {rgb: [20, 90, 160], count: 15},
    {rgb: [0, 0, 0], count: 10},
    {rgb: [150, 150, 150], count: 10},
    {rgb: [255, 255, 255], count: 10},
  ]);
  image.width = 10; image.height = 10;
  const palette = extractPalette(image, {count: 5});
  assert.equal(palette.length, 5);
  for (const dot of palette) {
    assert.ok(dot.x > 0 && dot.x < 1 && dot.y > 0 && dot.y < 1);
    const offset = (Math.floor(dot.y * image.height) * image.width + Math.floor(dot.x * image.width)) * 4;
    assert.deepEqual([...image.data.slice(offset, offset + 3)], dot.rgb);
    assert.equal(image.data[offset + 3], 255);
  }
  assert.ok(palette.some(dot => dot.hex === '#000000'));
  assert.ok(palette.some(dot => dot.hex === '#969696'));
});

test('white and gray cannot match the white gaps of colored glass, even with unlimited tolerance', () => {
  const blue = {...product('blue', [sample([227, 227, 227], 0), sample([80, 130, 210], 100)]), colorFamily: 'chromatic'};
  const gray = {...product('gray', [sample([227, 227, 227], 20), sample([110, 110, 110], 100)]), colorFamily: 'neutral'};
  const clear = {...product('clear', [sample([227, 227, 227])]), name: 'Clear Transparent'};
  assert.deepEqual(matchCatalog('#E3E3E3', [blue, gray, clear], {tolerance: Infinity}).map(m => m.product.id), ['gray']);
  assert.deepEqual(matchCatalog('#FFFFFF', [blue], {tolerance: Infinity}), []);
  // Old catalogs without family metadata still cannot reclassify a blue product.
  delete blue.colorFamily;
  assert.deepEqual(matchCatalog('#E3E3E3', [blue], {tolerance: Infinity}), []);
});

test('colored targets cannot use near-white samples, and black matches neutral glass', () => {
  const blue = {...product('blue', [sample([243, 244, 250], 0), sample([80, 130, 210], 100)]), colorFamily: 'chromatic'};
  const black = {...product('black', [sample([12, 12, 12], 100)]), colorFamily: 'neutral'};
  const match = matchCatalog([150, 170, 215], [blue, black], {tolerance: Infinity});
  assert.equal(match.length, 1);
  assert.deepEqual(match[0].sample.rgb, [80, 130, 210]);
  assert.equal(matchCatalog([12, 12, 12], [blue, black], {tolerance: 0})[0].product.id, 'black');
});

test('real catalog regression: screenshot gray #E3E3E3 never returns Light Sky Blue or another colored product', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  for (const target of ['#E3E3E3', '#FFFFFF', '#777777', '#050505']) {
    for (const match of matchCatalog(target, products, {tolerance: Infinity, limit: Infinity})) {
      assert.equal(match.product.colorFamily, 'neutral');
    }
  }
  const sky = products.find(p => p.id === '001414');
  assert.ok(sky);
  assert.deepEqual(matchCatalog('#E3E3E3', [sky], {tolerance: Infinity}), []);
});

test('the real neutral catalog matches actual black, white, and gray without substituting colored frit', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  const black = matchCatalog('#000000', products)[0];
  const white = matchCatalog('#FFFFFF', products)[0];
  const midGray = matchCatalog('#777777', products)[0];
  const lightGray = matchCatalog('#E3E3E3', products)[0];
  assert.equal(black?.product.id, '000100');
  assert.equal(white?.product.id, '000113');
  assert.equal(midGray?.product.id, '001129');
  assert.match(lightGray?.product.name || '', /Gray/);
  assert.equal(lightGray?.product.type, 'Transparent');
});
