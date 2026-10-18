/**
 * Purpose: validate the packaged extension and complete reviewed medium-frit catalog.
 * Setup: run npm run check from the project root after building the catalog.
 * Destructive behavior: none; this script only reads and checks project files.
 * Constraints: network-free checks; store stock is rechecked by Bullseye at shopping time.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {rgbToHex, rgbToLab} from '../extension/lib/color.js';
import {MIN_VISIBLE_CHROMA, sampleDarkness, sampleThickness} from '../extension/lib/palette.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = path.join(root, 'extension');
const readJson = name => JSON.parse(fs.readFileSync(path.join(extension, name), 'utf8'));
const manifest = readJson('manifest.json');
assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Bullseye Palette Picker');
assert.ok(manifest.permissions.includes('contextMenus') && manifest.permissions.includes('sidePanel'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons)]) {
  assert.ok(fs.existsSync(path.join(extension, file)), `Missing extension file: ${file}`);
}

const catalog = readJson('data/catalog.json');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-seed.json'), 'utf8'));
assert.equal(catalog.version, manifest.version, 'The bundled catalog must match this release.');
assert.deepEqual(catalog.products.map(product => product.handle).sort(), seed.products.map(product => product.handle).sort(),
  'Every reviewed, in-scope product must be included exactly once.');
assert.equal(catalog.products.length + seed.discovery.excludedProducts.length, seed.discovery.mediumFritProductCount,
  'The discovery record must account for every medium-frit product.');
assert.equal(catalog.products.filter(product => product.type === 'Transparent').length, seed.discovery.transparentProductCount);
assert.equal(catalog.products.filter(product => product.type === 'Opalescent').length, seed.discovery.opalescentProductCount);
const excludedHandles = new Set(seed.discovery.excludedProducts.map(product => product.handle));
assert.ok(catalog.products.every(product => !excludedHandles.has(product.handle)), 'Excluded products must stay out of matching.');
assert.ok(catalog.products.some(p => p.colorFamily === 'neutral' && /black/i.test(p.name)), 'Real black frit is required.');
assert.ok(catalog.products.some(p => p.colorFamily === 'neutral' && /white/i.test(p.name)), 'Real opalescent white frit is required.');
assert.ok(catalog.products.filter(p => p.colorFamily === 'neutral' && /gr[ae]y/i.test(p.name) && p.type === 'Transparent').length >= 2, 'Include transparent grays.');
const ids = new Set(), variants = new Set();
let samples = 0;
for (const product of catalog.products) {
  assert.ok(!ids.has(product.id), `Duplicate glass ${product.id}`); ids.add(product.id);
  assert.ok(['Transparent', 'Opalescent', 'Opaque'].includes(product.type), `Unknown glass type for ${product.name}`);
  assert.ok(['chromatic', 'neutral'].includes(product.colorFamily));
  assert.equal(product.grain, 'Medium frit');
  assert.ok(!/\bclear\b|iridescent|dichroic|streaky|2.color.mix/i.test(product.fullName));
  assert.ok(product.code.endsWith('-0002-F'));
  assert.ok(product.productUrl.startsWith('https://shop.bullseyeglass.com/products/'));
  const photograph = path.join(extension, product.image);
  assert.ok(fs.existsSync(photograph));
  assert.equal(createHash('sha256').update(fs.readFileSync(photograph)).digest('hex'), product.source.bundledImageSha256,
    `Bundled photograph changed without review: ${product.name}`);
  assert.equal(product.source.visuallyReviewed, true, `Review the source photograph for ${product.name}`);
  const reviewedSeed = seed.products.find(candidate => candidate.handle === product.handle);
  assert.equal(product.source.sourceImageSha256, reviewedSeed.reviewedSourceImageSha256,
    `Source photograph differs from the reviewed image: ${product.name}`);
  assert.ok(product.source.imageKind && product.source.imageSelection && product.source.sampleRect?.length === 4);
  assert.ok(product.thicknessReference?.rgb, `Missing dense material reference for ${product.name}`);
  assert.ok(Math.abs(sampleThickness(product.thicknessReference, product) - 100) < 1e-9,
    `The dense reference must represent 100% for ${product.name}`);
  assert.ok(product.samples.length > 0, `No eligible measured material samples for ${product.name}`);
  assert.ok(product.variants.length > 0);
  for (const variant of product.variants) {
    assert.ok(Number.isSafeInteger(variant.id) && variant.id > 0);
    assert.ok(!variants.has(variant.id)); variants.add(variant.id);
    assert.ok(variant.sku.startsWith(product.code + '-'));
    assert.ok(Number.isInteger(variant.price) && variant.price >= 0);
  }
  for (const sample of product.samples) {
    samples++;
    assert.ok(sample.rgb.length === 3 && sample.rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255));
    assert.equal(sample.hex.toUpperCase(), rgbToHex(sample.rgb));
    assert.ok(sample.darkness >= 0 && sample.darkness <= 100);
    assert.ok(Math.abs(sample.darkness - sampleDarkness(sample)) < 0.02, `Stale darkness metadata for ${product.name}`);
    const thickness = sampleThickness(sample, product);
    assert.ok(Number.isFinite(thickness) && thickness >= 0 && thickness <= 100, `Invalid thickness guide for ${product.name}`);
    assert.ok(sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1);
    const lab = rgbToLab(sample.rgb);
    assert.ok(lab.every(Number.isFinite));
    // The Python source sampler uses standard rounded sRGB/D65 coefficients;
    // the browser uses the higher precision CSS Color 4 matrix. Allow that
    // small numeric difference while rejecting genuinely stale color values.
    assert.ok(sample.lab.every((value, index) => Math.abs(value - lab[index]) < 0.02), `Stale Lab values for ${product.name}`);
    const chroma = Math.hypot(lab[1], lab[2]);
    assert.ok(product.colorFamily === 'chromatic' ? chroma >= MIN_VISIBLE_CHROMA : chroma < MIN_VISIBLE_CHROMA,
      `Wrong match family or nearly colorless chromatic sample for ${product.name}: ${sample.hex}`);
  }
}

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
for (const file of walk(extension).filter(file => file.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `Missing import ${match[1]} in ${file}`);
  }
}
const html = fs.readFileSync(path.join(extension, 'picker.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  if (/^(?:https?:|data:|#)/.test(match[1])) continue;
  assert.ok(fs.existsSync(path.join(extension, match[1].split('?')[0])), `Missing HTML asset ${match[1]}`);
}
console.log(`Verified Manifest V3, module syntax/imports, ${ids.size} colored and neutral medium-frit glasses, ${samples} eligible full-color samples, and ${variants.size} real jar variants.`);
