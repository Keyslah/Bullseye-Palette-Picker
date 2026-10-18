/**
 * Purpose: Validate sRGB/Lab conversion and CIEDE2000 against published reference data.
 * Setup: Run node --test from the project root; no browser or dependencies are needed.
 * Destructive behavior: None; tests perform no file, network, or account writes.
 * Constraints: RGB conversion uses D65. Reference pairs test hue-wrap and achromatic cases.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, hexToRgb, labToRgb, rgbToHex, rgbToLab } from '../extension/lib/color.js';

// Numerical reference data from Sharma, Wu, and Dalal (2005), not their program code:
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
const referencePairs = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
  [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0000],
  [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0000],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0010], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
  [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.0010, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
  [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.1350], [0.9033, -0.0636, -0.5514], 0.9082],
];

test('CIEDE2000 matches 20 published pairs, including hue discontinuities', () => {
  for (const [first, second, expected] of referencePairs) {
    const actual = deltaE2000(first, second);
    assert.ok(Math.abs(actual - expected) < 0.000051, JSON.stringify({ first, second, expected, actual }));
    assert.ok(Math.abs(actual - deltaE2000(second, first)) < 1e-10, 'Distance must be symmetric.');
  }
});

test('identical full colors have zero distance', () => {
  for (const rgb of [[255, 0, 0], [0, 180, 40], [25, 55, 205], [0, 0, 0], [255, 255, 255]]) {
    const lab = rgbToLab(rgb);
    assert.equal(deltaE2000(lab, lab), 0);
  }
});

test('D65 sRGB endpoints and primary colors retain color channels', () => {
  const black = rgbToLab([0, 0, 0]);
  const white = rgbToLab([255, 255, 255]);
  assert.deepEqual(black, [0, 0, 0]);
  assert.ok(Math.abs(white[0] - 100) < 1e-9);
  assert.ok(Math.abs(white[1]) < 1e-9 && Math.abs(white[2]) < 1e-9);
  const red = rgbToLab([255, 0, 0]);
  assert.ok(red[1] > 70 && red[2] > 60, 'Red chroma must not be replaced by grayscale.');
});

test('RGB→Lab→RGB round trips ordinary colors and dark values', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [3, 8, 15], [42, 110, 186], [244, 128, 199]]) {
    assert.deepEqual(labToRgb(rgbToLab(rgb)), rgb);
  }
});

test('hex parsing, display rounding, and malformed inputs are explicit', () => {
  assert.deepEqual(hexToRgb('#aB3'), [170, 187, 51]);
  assert.deepEqual(hexToRgb(' 00ff7E '), [0, 255, 126]);
  assert.equal(rgbToHex([12.6, -5, 270]), '#0D00FF');
  for (const invalid of ['#GGGGGG', '#1234', 'red', '#12', null]) {
    assert.throws(() => hexToRgb(invalid), TypeError);
  }
  assert.throws(() => rgbToLab([20, NaN, 30]), TypeError);
  assert.throws(() => deltaE2000([50, 20], [50, 20, 10]), TypeError);
});
