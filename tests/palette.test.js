/**
 * Purpose: Verify full-color extraction, automatic matching, and photo thickness estimates.
 * Setup: Run node --test from the project root with the included synthetic image data.
 * Destructive behavior: None; tests do not access images, accounts, or external services.
 * Constraints: Thickness estimates are display-only; equal lightness never equates unlike hues.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, labToRgb, rgbToHex, rgbToLab } from '../extension/lib/color.js';
import { extractPalette, selectDistinctPalette, matchCatalog, sampleDarkness, sampleThickness } from '../extension/lib/palette.js';
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

test('automatic extraction replaces black before a limited reservoir is filled', () => {
  const blue = [20, 90, 170];
  const image = pixels([
    { rgb: [0, 0, 0], count: 20000 },
    { rgb: [32, 39, 41], count: 1000 },
    { rgb: blue, count: 1 },
  ]);
  const before = image.data.slice();
  for (const prominence of [false, true]) {
    for (const seed of [1, 17, 491]) {
      const palette = extractPalette(image, { count: 6, maxSamples: 1, prominence, seed });
      assert.deepEqual(palette.map(color => color.rgb), [blue]);
      assert.equal(palette[0].weight, 1);
      const offset = Math.floor(palette[0].x * image.width) * 4;
      assert.deepEqual([...image.data.slice(offset, offset + 3)], blue);
    }
  }
  assert.deepEqual(image.data, before);
});

test('only-black images return no invented color and explicit legacy extraction retains black', () => {
  const image = pixels([
    { rgb: [0, 0, 0], count: 20 },
    { rgb: [32, 39, 41], count: 10 },
    { rgb: [48, 48, 48], count: 10 },
  ]);
  assert.deepEqual(extractPalette(image), []);
  assert.deepEqual(extractPalette(image, { prominence: true, seed: 7 }), []);
  const legacy = extractPalette(image, { count: 3, excludeBlack: false });
  assert.deepEqual(legacy.map(color => color.hex), ['#000000', '#202729', '#303030']);
  assert.deepEqual(legacy.map(color => color.weight), [0.5, 0.25, 0.25]);
});

test('automatic black exclusion keeps visibly colored navy, forest green, burgundy and lighter neutrals', () => {
  const darkColors = [[10, 20, 41], [12, 40, 23], [59, 16, 32]];
  for (const rgb of darkColors) {
    const [lightness, a, b] = rgbToLab(rgb);
    assert.ok(lightness < 20 && Math.hypot(a, b) > 10, 'the fixture must be dark and visibly chromatic');
  }
  const retained = [...darkColors, [49, 49, 49], [150, 150, 150], [255, 255, 255]];
  const image = pixels([...retained, [0, 0, 0], [32, 39, 41]].map(rgb => ({ rgb, count: 20 })));
  for (const prominence of [false, true]) {
    const palette = extractPalette(image, { count: 8, prominence });
    assert.deepEqual(new Set(palette.map(color => color.hex)), new Set(retained.map(rgbToHex)));
    assert.ok(Math.abs(palette.reduce((sum, color) => sum + color.weight, 0) - 1) < 1e-12);
  }
});

function texturedTheme() {
  const blue = Array.from({ length: 10 }, (_, index) => [25 + index * 2, 80 + index * 3, 140 + index * 2]);
  const green = Array.from({ length: 8 }, (_, index) => [50 + index * 3, 100 + index * 2, 45 + index]);
  return {
    blue: new Set(blue.map(rgbToHex)), green: new Set(green.map(rgbToHex)),
    image: pixels([
      ...blue.map(rgb => ({ rgb, count: 90 })),
      ...green.map(rgb => ({ rgb, count: 100 })),
      { rgb: [255, 255, 255], count: 5 },
      { rgb: [255, 0, 255], count: 5 },
    ]),
  };
}

test('Prominence keeps the broad theme instead of giving isolated accents and gaps a full slot', () => {
  const { image, blue, green } = texturedTheme();
  const broad = extractPalette(image, { count: 6, prominence: false });
  assert.ok(broad.some(color => color.hex === '#FFFFFF'));
  assert.ok(broad.some(color => color.hex === '#FF00FF'));
  const prominent = extractPalette(image, { count: 6, prominence: true });
  assert.equal(prominent.length, 6);
  assert.ok(prominent.every(color => blue.has(color.hex) || green.has(color.hex)));
  assert.ok(prominent.some(color => blue.has(color.hex)));
  assert.ok(prominent.some(color => green.has(color.hex)));
  assert.ok(Math.abs(prominent.reduce((sum, color) => sum + color.weight, 0) - 1) < 1e-12);
  assert.deepEqual(extractPalette(image, { count: 6, prominence: true }), prominent);
});

test('Prominence counts related shades together rather than demanding repeated exact RGB pixels', () => {
  const shades = Array.from({ length: 400 }, (_, index) => [
    35 + index % 20, 80 + Math.floor(index / 20), 140 + (index * 7) % 23,
  ]);
  assert.equal(new Set(shades.map(rgbToHex)).size, shades.length);
  const image = pixels([
    ...shades.map(rgb => ({ rgb, count: 1 })),
    { rgb: [255, 0, 255], count: 5 },
    { rgb: [255, 255, 255], count: 3 },
  ]);
  const theme = new Set(shades.map(rgbToHex));
  for (const seed of [undefined, 1, 7]) {
    const palette = extractPalette(image, { count: 6, prominence: true, seed });
    assert.equal(palette.length, 6);
    assert.ok(palette.every(color => theme.has(color.hex)));
  }
});

test('Prominence Remix varies actual shades while preserving both major color regions', () => {
  const { image, blue, green } = texturedTheme();
  const signatures = new Set();
  for (let remix = 1; remix <= 16; remix += 1) {
    const seed = Math.imul(remix, 0x9e3779b9) >>> 0;
    const options = { count: 6, prominence: true, seed };
    const palette = extractPalette(image, options);
    assert.deepEqual(extractPalette(image, options), palette, 'the same seed must reproduce its palette');
    assert.ok(palette.some(color => blue.has(color.hex)));
    assert.ok(palette.some(color => green.has(color.hex)));
    assert.equal(new Set(palette.map(color => color.hex)).size, palette.length);
    for (const color of palette) {
      assert.ok(blue.has(color.hex) || green.has(color.hex));
      const offset = Math.floor(color.x * image.width) * 4;
      assert.deepEqual([...image.data.slice(offset, offset + 3)], color.rgb);
      assert.deepEqual(color.lab, rgbToLab(color.rgb));
    }
    signatures.add(palette.map(color => color.hex).sort().join(','));
  }
  assert.ok(signatures.size >= 4, 'Remix must vary the colors, not merely reorder the same top shades');
});

test('Prominence respects opacity and does not mistake nearly invisible clutter for the theme', () => {
  const image = pixels([
    { rgb: [30, 90, 160], count: 300 },
    { rgb: [80, 130, 60], count: 300 },
    { rgb: [255, 0, 255], count: 1000, alpha: 1 },
    { rgb: [255, 255, 255], count: 2000, alpha: 0 },
  ]);
  const palette = extractPalette(image, { count: 6, prominence: true });
  assert.deepEqual(palette.map(color => color.hex), ['#1E5AA0', '#50823C']);
  assert.deepEqual(palette.map(color => color.weight), [0.5, 0.5]);
});

test('flat images keep their real supported colors without inventing variation or dropping a useful accent', () => {
  const image = pixels([
    { rgb: [20, 90, 170], count: 70 },
    { rgb: [170, 170, 140], count: 25 },
    { rgb: [240, 20, 50], count: 5 },
  ]);
  const expected = extractPalette(image, { count: 6, prominence: true });
  assert.equal(expected.length, 3);
  assert.deepEqual(expected.map(color => color.weight), [0.7, 0.25, 0.05]);
  for (const seed of [1, 7, 31]) {
    assert.deepEqual(extractPalette(image, { count: 6, prominence: true, seed }), expected);
  }
});

function candidate(rgb, glass, weight, thickness = null) {
  return { ...sample(rgb), id:rgbToHex(rgb), glass, weight, thickness, x:0.25, y:0.75 };
}

test('distinct extraction honors zero or one remaining slot while ordinary extraction retains its minimum', () => {
  const image = pixels([
    { rgb:[20, 90, 170], count:70 },
    { rgb:[60, 130, 45], count:20 },
    { rgb:[220, 120, 35], count:10 },
  ]);
  let matched = 0;
  const distinctKey = color => { matched += 1; return color.hex; };
  assert.deepEqual(extractPalette(image, { count:0, distinctKey }), []);
  assert.equal(matched, 0, 'a full manual palette must not sample or match new colors');
  assert.equal(extractPalette(image, { count:1, distinctKey }).length, 1);
  assert.equal(extractPalette(image, { count:0 }).length, 2);
  assert.equal(extractPalette(image, { count:1 }).length, 2);
});

test('remaining capacity is applied before thickness fallback so two slots retain distinct products', () => {
  const candidates = [
    candidate([15, 50, 105], 'blue', 0.4, 90),
    candidate([60, 110, 180], 'blue', 0.3, 60),
    candidate([130, 170, 220], 'blue', 0.2, 30),
    candidate([60, 130, 45], 'green', 0.06, 80),
    candidate([220, 120, 35], 'orange', 0.04, 75),
  ];
  const byHex = new Map(candidates.map(color => [color.hex, color]));
  const image = pixels(candidates.map(color => ({ rgb:color.rgb, count:Math.round(color.weight * 1000) })));
  const options = {
    prominence:true, distinctKey:color => byHex.get(color.hex).glass,
    variationValue:color => byHex.get(color.hex).thickness,
  };
  const overfilled = extractPalette(image, { ...options, count:6 }).slice(0, 2);
  assert.deepEqual(overfilled.map(color => byHex.get(color.hex).glass), ['blue', 'blue'], 'reproduce the unsafe post-selection truncation');
  const fitted = extractPalette(image, { ...options, count:2 });
  assert.deepEqual(fitted.map(color => byHex.get(color.hex).glass), ['blue', 'green']);
});

test('distinct selection combines repeated glass area and prefers other supported glass before thickness repeats', () => {
  const candidates = [
    candidate([20, 90, 170], 'blue', 0.32, 90),
    candidate([90, 150, 210], 'blue', 0.28, 50),
    candidate([60, 130, 45], 'green', 0.25, 80),
    candidate([220, 120, 35], 'orange', 0.15, 75),
  ];
  const before = structuredClone(candidates);
  const options = { count:3, keyFor:color => color.glass, variationFor:color => color.thickness };
  const distinct = selectDistinctPalette(candidates, options);
  assert.deepEqual(distinct.map(color => color.glass), ['blue', 'green', 'orange']);
  for (const [index, expected] of [0.6, 0.25, 0.15].entries()) {
    assert.ok(Math.abs(distinct[index].weight - expected) < 1e-12);
  }
  assert.deepEqual(distinct[0].rgb, candidates[0].rgb);
  assert.deepEqual(candidates, before);
  assert.ok(distinct.every(color => candidates.some(source => source.hex === color.hex && source.x === color.x && source.y === color.y)));
});

test('distinct selection returns fewer colors if the image only offers repeated glass without known thickness variation', () => {
  const candidates = [
    candidate([20, 90, 170], 'blue', 0.7),
    candidate([90, 150, 210], 'blue', 0.3),
  ];
  for (const variationFor of [undefined, () => null, () => NaN, () => 120, () => 100]) {
    const selected = selectDistinctPalette(candidates, { count:6, keyFor:color => color.glass, variationFor });
    assert.equal(selected.length, 1);
    assert.deepEqual(selected[0].rgb, candidates[0].rgb);
    assert.equal(selected[0].weight, 1);
  }
});

test('thickness fallback needs a ten-point measured gap and a visibly different source shade', () => {
  const candidates = [
    candidate([15, 50, 105], 'blue', 0.4, 90),
    candidate([45, 100, 170], 'blue', 0.25, 81),
    candidate([85, 140, 210], 'blue', 0.2, 80),
    candidate([130, 180, 230], 'blue', 0.1, 70),
    candidate([86, 141, 211], 'blue', 0.05, 40),
  ];
  const selected = selectDistinctPalette(candidates, {
    count:6, keyFor:color => color.glass, variationFor:color => color.thickness,
  });
  assert.deepEqual(new Set(selected.map(color => color.thickness)), new Set([90, 80, 70]));
  for (let first = 0; first < selected.length; first += 1) {
    for (let second = first + 1; second < selected.length; second += 1) {
      assert.ok(Math.abs(selected[first].thickness - selected[second].thickness) >= 10);
      assert.ok(deltaE2000(selected[first].lab, selected[second].lab) >= 5);
    }
  }
  assert.ok(Math.abs(selected.reduce((sum, color) => sum + color.weight, 0) - 1) < 1e-12);
});

test('near-identical source swatches are avoided even when their glass IDs differ or matching is unavailable', () => {
  const candidates = [
    candidate([20, 90, 170], 'blue-one', 0.5),
    candidate([21, 91, 170], 'blue-two', 0.3),
    candidate([220, 120, 35], 'orange', 0.2),
  ];
  for (const keyFor of [color => color.glass, () => null, () => undefined]) {
    const selected = selectDistinctPalette(candidates, { count:6, keyFor });
    assert.equal(selected.length, 2);
    assert.deepEqual(selected.map(color => color.rgb), [candidates[0].rgb, candidates[2].rgb]);
  }
});

test('manual glass and colors stay protected in both distinct and thickness passes without mutation', () => {
  const candidates = [
    candidate([20, 90, 170], 'blue', 0.4, 90),
    candidate([90, 150, 210], 'blue', 0.3, 50),
    candidate([60, 130, 45], 'green', 0.2, 80),
    candidate([220, 120, 35], 'orange', 0.1, 75),
  ];
  const manual = [{ rgb:[219, 120, 35], id:'manual-orange', manual:true }];
  const excludedKeys = new Set(['blue']);
  const before = structuredClone({ candidates, manual });
  for (const seed of [undefined, 0x879abdef, 0xffffffff]) {
    const selected = selectDistinctPalette(candidates, {
      count:6, keyFor:color => color.glass, variationFor:color => color.thickness,
      excludedKeys, excludedColors:manual, seed,
    });
    assert.deepEqual(selected.map(color => color.glass), ['green']);
    assert.equal(selected[0].weight, 1);
    selected[0].rgb[0] = 0;
  }
  assert.deepEqual({ candidates, manual }, before);
  assert.deepEqual([...excludedKeys], ['blue']);
});

test('the larger distinct candidate pool replaces repeated matches with other supported source colors', () => {
  const blue = [[20, 90, 170], [35, 125, 200], [80, 155, 215]];
  const green = [60, 130, 45], orange = [220, 120, 35], purple = [150, 50, 170];
  const groups = new Map([
    ...blue.map(rgb => [rgbToHex(rgb), 'blue']),
    [rgbToHex(green), 'green'], [rgbToHex(orange), 'orange'], [rgbToHex(purple), 'purple'],
  ]);
  const image = pixels([
    ...blue.map(rgb => ({ rgb, count:300 })),
    { rgb:green, count:200 }, { rgb:orange, count:150 }, { rgb:purple, count:100 },
    { rgb:[255, 0, 0], count:1 },
  ]);
  const seen = new Set();
  const options = {
    count:3, prominence:true,
    distinctKey:color => { seen.add(color.hex); return groups.get(color.hex); },
    excludedKeys:['blue'],
  };
  const palette = extractPalette(image, options);
  assert.equal(seen.size, 6, 'the bounded pool must look beyond the requested three swatches');
  assert.equal(palette.length, 3);
  assert.deepEqual(palette.map(color => groups.get(color.hex)), ['green', 'orange', 'purple']);
  assert.ok(!seen.has('#FF0000'), 'a rare outlier must not be reintroduced just to fill the palette');
  for (const color of palette) {
    const offset = Math.floor(color.x * image.width) * 4;
    assert.deepEqual([...image.data.slice(offset, offset + 3)], color.rgb);
  }
  const fewer = extractPalette(image, { ...options, excludedColors:[{ rgb:green }] });
  assert.equal(fewer.length, 2);
});

test('source-supported measured glass thicknesses fill remaining slots after distinct products', () => {
  const shades = [[15, 50, 105], [60, 110, 180], [130, 170, 220]];
  const green = [25, 90, 40];
  const blueProduct = { ...product('blue', shades.map(rgb => sample(rgb))), type:'Transparent', thicknessReference:sample(shades[0]) };
  const greenProduct = { ...product('green', [sample(green)]), type:'Transparent', thicknessReference:sample(green) };
  const catalog = [blueProduct, greenProduct];
  const image = pixels([
    ...shades.map((rgb, index) => ({ rgb, count:500 - index * 150 })),
    { rgb:green, count:150 },
  ]);
  const matched = color => matchCatalog(color, catalog)[0];
  const options = {
    prominence:true, distinctKey:color => matched(color).product.id,
    variationValue:color => { const match = matched(color); return Math.round(sampleThickness(match.sample, match.product)); },
  };
  const distinct = extractPalette(image, { ...options, count:2 });
  assert.deepEqual(new Set(distinct.map(color => matched(color).product.id)), new Set(['blue', 'green']));
  const varied = extractPalette(image, { ...options, count:4 });
  assert.equal(varied.length, 4);
  const blueThicknesses = varied.filter(color => matched(color).product.id === 'blue').map(options.variationValue).sort((a, b) => a - b);
  assert.equal(blueThicknesses.length, 3);
  assert.ok(blueThicknesses.every((value, index) => !index || value - blueThicknesses[index - 1] >= 10));
  assert.ok(Math.abs(varied.reduce((sum, color) => sum + color.weight, 0) - 1) < 1e-12);
  assert.ok(varied.every(color => [...shades, green].some(rgb => rgbToHex(rgb) === color.hex)));
});

test('seeded distinct/thickness selection keeps the prominent theme and source coordinates', () => {
  const { image, blue, green } = texturedTheme();
  const keyFor = color => blue.has(color.hex) ? 'blue' : green.has(color.hex) ? 'green' : 'outlier';
  const variation = color => keyFor(color) === 'blue' ? 100 - (color.rgb[0] - 25) * 2.5 : 100 - (color.rgb[0] - 50) * 2;
  const signatures = new Set();
  for (const seed of [1, 0x879abdef, 0xffffffff, 0x213bafb7, 0x6c9ef173]) {
    const options = { count:6, prominence:true, seed, distinctKey:keyFor, variationValue:variation };
    const palette = extractPalette(image, options);
    assert.deepEqual(extractPalette(image, options), palette);
    assert.deepEqual(new Set(palette.map(keyFor)), new Set(['blue', 'green']));
    assert.ok(palette.length >= 2 && palette.length <= 6);
    for (let first = 0; first < palette.length; first += 1) {
      const color = palette[first], offset = Math.floor(color.x * image.width) * 4;
      assert.deepEqual([...image.data.slice(offset, offset + 3)], color.rgb);
      for (let second = first + 1; second < palette.length; second += 1) {
        assert.ok(deltaE2000(color.lab, palette[second].lab) >= 5);
        if (keyFor(color) === keyFor(palette[second])) assert.ok(Math.abs(variation(color) - variation(palette[second])) >= 10);
      }
    }
    signatures.add(palette.map(color => color.hex).sort().join(','));
  }
  assert.ok(signatures.size >= 3);
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

test('automatic matching immediately returns the nearest eligible glass beyond the old cutoff', () => {
  const target = '#FA4EB5';
  const catalog = [
    product('violet', [sample([169, 125, 176])]),
    product('light-pink', [sample([207, 115, 139])]),
    product('cranberry', [sample([208, 111, 130])]),
  ];
  const matches = matchCatalog(target, catalog);
  assert.equal(matches[0].product.id, 'light-pink');
  assert.ok(matches[0].deltaE > 12);
  assert.deepEqual(matches, matchCatalog(target, catalog, { tolerance: Infinity }));
  assert.deepEqual(matchCatalog(target, catalog, { tolerance: 12 }), []);
});

test('the actual Light Pink Striker sample is available automatically for screenshot pink #FA4EB5', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  // Keep this reported failure tied to the three original pink/purple products;
  // future additions may legitimately provide an even closer full-color match.
  const candidates = products.filter(p => ['001215', '001311', '001234'].includes(p.id));
  assert.equal(candidates.length, 3);
  const matches = matchCatalog('#FA4EB5', candidates);
  assert.equal(matches[0]?.product.id, '001215');
  assert.equal(matches[0]?.product.type, 'Transparent');
  assert.ok(matches[0].deltaE > 12);
});

test('darkness uses one perceptual scale for black, gray, white, and colored samples', () => {
  assert.equal(sampleDarkness('#000000'), 100);
  assert.ok(sampleDarkness('#FFFFFF') < 1e-10);
  assert.ok(sampleDarkness('#111111') > 90);
  assert.ok(sampleDarkness('#777777') > sampleDarkness('#BBBBBB'));
  assert.equal(sampleDarkness({ lab: [50, 0, 0] }), 50);
  assert.equal(sampleDarkness({ lab: [50, 35, -20] }), 50);
  // Perceptual lightness differs from simply dividing an encoded RGB value by 255.
  assert.ok(Math.abs(sampleDarkness('#808080') - 46.41499) < 0.001);
});

test('darkness ignores legacy relative labels and stale Lab when actual RGB is present', () => {
  const black = sample([8, 8, 8], 0, { lab: [100, 0, 0] });
  const before = JSON.stringify(black);
  assert.ok(sampleDarkness(black) > 97);
  assert.equal(sampleDarkness(black), sampleDarkness([8, 8, 8]));
  assert.equal(sampleDarkness({ hex: '#FFFFFF', darkness: 100 }), sampleDarkness('#FFFFFF'));
  assert.equal(JSON.stringify(black), before);
});

test('darkness is clamped to finite bounds and refuses incomplete color data', () => {
  assert.equal(sampleDarkness({ lab: [-5, 0, 0] }), 100);
  assert.equal(sampleDarkness({ lab: [105, 0, 0] }), 0);
  assert.throws(() => sampleDarkness({ darkness: 45 }), TypeError);
  assert.throws(() => sampleDarkness({ lab: [NaN, 0, 0] }), TypeError);
  assert.throws(() => sampleDarkness({ rgb: [1, 2, Infinity] }), TypeError);
});

test('black and white opalescent glass use the full-color thickness reference', () => {
  const black = { ...product('black', [sample([8, 8, 8], 0)]), type: 'Opalescent' };
  const white = { ...product('white', [sample([244, 244, 244], 0)]), type: 'Opalescent' };
  assert.equal(sampleThickness(black.samples[0], black), 100);
  assert.equal(sampleThickness(white.samples[0], white), 100);
  assert.equal(sampleThickness(sample([8, 8, 8]), { type: 'Opaque' }), 100);
});

test('transparent thickness is white-anchored and a light actual sample remains above zero', () => {
  const dense = { lab: [20, 0, 0] };
  const middle = { lab: [60, 0, 0] };
  const light = { lab: [90, 0, 0] };
  const glass = { ...product('gray', [middle, light, dense]), type: 'Transparent', thicknessReference: dense };
  assert.equal(sampleThickness(dense, glass), 100);
  assert.equal(sampleThickness(middle, glass), 50);
  assert.equal(sampleThickness(light, glass), 12.5);
  assert.equal(sampleThickness({ lab: [0, 0, 0] }, glass), 100);
  assert.equal(sampleThickness({ lab: [100, 0, 0] }, glass), 0);
});

test('thickness uses the explicit dense reference and actual RGB before stale labels or Lab', () => {
  const target = sample([100, 100, 100], 0, { lab: [100, 0, 0] });
  const reference = sample([30, 30, 30], 0, { lab: [100, 0, 0] });
  const glass = { ...product('gray', [sample([0, 0, 0]), target]), thicknessReference: reference };
  const expected = 100 * sampleDarkness([100, 100, 100]) / sampleDarkness([30, 30, 30]);
  assert.equal(sampleThickness(target, glass), expected);
  assert.notEqual(expected, sampleDarkness(target));
});

test('thickness fallback is independent of sample order and excludes background or ineligible samples', () => {
  const dense = { lab: [20, 0, 0] };
  const middle = { lab: [60, 0, 0] };
  const light = { lab: [90, 0, 0] };
  const samples = [middle, light, { lab: [0, 0, 0], background: true }, dense, { lab: [0, 0, 0], eligible: false }, {}];
  const glass = product('gray', samples);
  assert.equal(sampleThickness(middle, glass), 50);
  assert.equal(sampleThickness(middle, { ...glass, samples: [...samples].reverse() }), 50);
});

test('invalid or zero transparent references cannot produce an invented thickness percentage', () => {
  const target = { lab: [60, 0, 0] };
  const glass = { ...product('gray', [{ lab: [20, 0, 0] }]), thicknessReference: { rgb: [NaN, 0, 0] } };
  assert.equal(sampleThickness(target, glass), 50);
  assert.equal(sampleThickness(target, product('empty', [])), null);
  assert.equal(sampleThickness(target, product('white-only', [{ lab: [100, 0, 0] }])), null);
  assert.equal(sampleThickness(target, { thicknessReference: { lab: [Infinity, 0, 0] } }), null);
});

test('thickness estimates never alter catalog matching, samples, or their full-color ranking', () => {
  const products = [
    { ...product('pink', [sample([207, 115, 139]), sample([188, 87, 113])]), type: 'Transparent' },
    { ...product('violet', [sample([169, 125, 176])]), type: 'Opalescent' },
  ];
  const before = JSON.stringify(products);
  const matches = matchCatalog('#FA4EB5', products);
  for (const match of matches) {
    const thickness = sampleThickness(match.sample, match.product);
    assert.ok(Number.isFinite(thickness) && thickness > 0 && thickness <= 100);
  }
  assert.deepEqual(matchCatalog('#FA4EB5', products), matches);
  assert.equal(JSON.stringify(products), before);
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
  const palette = extractPalette(image, {count: 5, excludeBlack: false});
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

test('the core neutral catalog matches actual black, white, and gray without substituting colored frit', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  const originalNeutrals = products.filter(p => ['000100', '000113', '001129', '001429', '001449'].includes(p.id));
  const black = matchCatalog('#000000', originalNeutrals)[0];
  const white = matchCatalog('#FFFFFF', originalNeutrals)[0];
  const midGray = matchCatalog('#777777', originalNeutrals)[0];
  const lightGray = matchCatalog('#E3E3E3', originalNeutrals)[0];
  assert.equal(black?.product.id, '000100');
  assert.equal(white?.product.id, '000113');
  assert.equal(midGray?.product.id, '001129');
  assert.match(lightGray?.product.name || '', /Gray/);
  assert.equal(lightGray?.product.type, 'Transparent');
  assert.ok(sampleDarkness(black.sample) > 95);
  assert.ok(sampleDarkness(white.sample) < 15);
});

test('ordinary Black wins a near-black photo tie without changing actual scores or other ordering', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  const matches = matchCatalog('#000000', products, { limit: Infinity });
  assert.equal(matches[0].product.id, '000100');
  assert.ok(matches[0].deltaE > 0 && matches[0].deltaE <= 0.25);
  assert.equal(matches[1].product.id, '000102');
  assert.equal(matches[1].deltaE, 0);
  assert.ok(matches.slice(1).every((match, index, remaining) => index === 0 || remaining[index - 1].deltaE <= match.deltaE));
  assert.equal(matchCatalog('#000000', products, { limit: 1 })[0].product.id, '000100');
});

test('a meaningfully closer near-black sample stays ahead of ordinary Black', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  const matches = matchCatalog('#121715', products, { limit: Infinity });
  const ordinaryBlack = matches.find(match => match.product.id === '000100');
  assert.equal(matches[0].product.id, '001140');
  assert.ok(ordinaryBlack.deltaE - matches[0].deltaE > 0.25);
  assert.ok(matches.every((match, index) => index === 0 || matches[index - 1].deltaE <= match.deltaE));
});

test('ordinary Black preference never bypasses a material filter or explicit strict tolerance', () => {
  const {products} = JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json', import.meta.url), 'utf8'));
  const transparent = products.filter(p => p.type === 'Transparent');
  const filtered = matchCatalog('#000000', transparent, { limit: Infinity });
  assert.equal(filtered[0].product.id, '001140');
  assert.ok(filtered.every(match => match.product.type === 'Transparent' && match.product.id !== '000100'));
  const exact = matchCatalog('#000000', products, { tolerance: 0, limit: Infinity });
  assert.equal(exact[0].product.id, '000102');
  assert.ok(exact.every(match => match.deltaE === 0 && match.product.id !== '000100'));
});
