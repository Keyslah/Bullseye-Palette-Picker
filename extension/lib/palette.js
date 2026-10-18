/**
 * Purpose: Extract representative full colors from an image and find matching glass.
 * Setup: Import this ES module; supply ImageData-like RGBA pixels and catalog products.
 * Destructive behavior: None; no input mutation, image uploads, account access, or I/O.
 * Constraints: RGB and D65 Lab are kept intact. Darkness is descriptive metadata only.
 * Palette weights approximate visible image area; transparency contributes by opacity.
 */

import { deltaE2000, hexToRgb, rgbToHex, rgbToLab } from './color.js';

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(minimum, Math.min(maximum, Math.floor(numeric)))
    : fallback;
}

function distanceSquared(first, second) {
  return (first[0] - second[0]) ** 2
    + (first[1] - second[1]) ** 2
    + (first[2] - second[2]) ** 2;
}

function nearestIndex(lab, centers) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const distance = distanceSquared(lab, centers[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

// A fixed generator makes reservoir sampling repeatable without periodic stride bias.
function deterministicRandom() {
  let state = 0x72a31f49;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function sampledColors(data, maxSamples) {
  const random = deterministicRandom();
  const reservoir = [];
  let visible = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha <= 0) continue;
    visible += 1;
    const destination = reservoir.length < maxSamples
      ? reservoir.length
      : Math.floor(random() * visible);
    if (destination < maxSamples) {
      reservoir[destination] = {
        rgb: [data[offset], data[offset + 1], data[offset + 2]],
        weight: Math.min(alpha, 255) / 255,
      };
    }
  }

  const byRgb = new Map();
  for (const sample of reservoir) {
    const key = rgbToHex(sample.rgb);
    const existing = byRgb.get(key);
    if (existing) existing.weight += sample.weight;
    else byRgb.set(key, { ...sample, hex: key, lab: rgbToLab(sample.rgb) });
  }
  return [...byRgb.values()];
}

function initialCenters(points, count) {
  let mostCommon = points[0];
  for (const point of points) {
    if (point.weight > mostCommon.weight) mostCommon = point;
  }
  const centers = [mostCommon.lab.slice()];
  const distances = points.map((point) => distanceSquared(point.lab, centers[0]));
  while (centers.length < count) {
    let next = -1;
    let bestScore = 0;
    for (let index = 0; index < points.length; index += 1) {
      const score = distances[index] * points[index].weight;
      if (score > bestScore) {
        bestScore = score;
        next = index;
      }
    }
    if (next < 0) break;
    const center = points[next].lab.slice();
    centers.push(center);
    for (let index = 0; index < points.length; index += 1) {
      distances[index] = Math.min(distances[index], distanceSquared(points[index].lab, center));
    }
  }
  return centers;
}

/**
 * Return [{id,rgb,hex,lab,weight}], ordered by descending area weight.
 * Weighted k-means uses all three Lab axes; output swatches are actual image colors,
 * chosen closest to each cluster's center. Empty or fully transparent images return [].
 */
export function extractPalette(imageData, { count = 8, maxSamples = 12000 } = {}) {
  const data = imageData?.data;
  if (!data || !Number.isInteger(data.length) || data.length % 4 !== 0) {
    throw new TypeError('Provide ImageData-like RGBA pixels in a data array.');
  }
  const desiredCount = boundedInteger(count, 8, 2, 12);
  const sampleLimit = boundedInteger(maxSamples, 12000, 1, 100000);
  const points = sampledColors(data, sampleLimit);
  if (points.length === 0) return [];
  const centers = initialCenters(points, Math.min(desiredCount, points.length));

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const totals = centers.map(() => ({ lab: [0, 0, 0], weight: 0 }));
    for (const point of points) {
      const total = totals[nearestIndex(point.lab, centers)];
      total.weight += point.weight;
      for (let channel = 0; channel < 3; channel += 1) {
        total.lab[channel] += point.lab[channel] * point.weight;
      }
    }
    let largestShift = 0;
    for (let index = 0; index < centers.length; index += 1) {
      if (totals[index].weight === 0) continue;
      const next = totals[index].lab.map((value) => value / totals[index].weight);
      largestShift = Math.max(largestShift, distanceSquared(centers[index], next));
      centers[index] = next;
    }
    if (largestShift < 1e-6) break;
  }

  const clusters = centers.map(() => ({ weight: 0, representative: null, distance: Infinity }));
  let totalWeight = 0;
  for (const point of points) {
    const index = nearestIndex(point.lab, centers);
    const cluster = clusters[index];
    const distance = distanceSquared(point.lab, centers[index]);
    cluster.weight += point.weight;
    totalWeight += point.weight;
    if (distance < cluster.distance) {
      cluster.representative = point;
      cluster.distance = distance;
    }
  }
  return clusters
    .filter((cluster) => cluster.representative && cluster.weight > 0)
    .map((cluster) => {
      const point = cluster.representative;
      return {
        id: 'color-' + point.hex.slice(1).toLowerCase(),
        rgb: point.rgb.slice(),
        hex: point.hex,
        lab: point.lab.slice(),
        weight: cluster.weight / totalWeight,
      };
    })
    .sort((first, second) => second.weight - first.weight || compareText(first.hex, second.hex));
}

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function colorLab(color) {
  if (typeof color === 'string') return rgbToLab(hexToRgb(color));
  if (Array.isArray(color) || ArrayBuffer.isView(color)) return rgbToLab(color);
  // RGB is the source of truth, including when a catalog carries old Lab values.
  if (color?.rgb) return rgbToLab(color.rgb);
  if (typeof color?.hex === 'string') return rgbToLab(hexToRgb(color.hex));
  if (color?.lab) {
    deltaE2000(color.lab, color.lab); // Validate a Lab-only target or sample.
    return Array.from(color.lab);
  }
  throw new TypeError('A color needs RGB, an RGB hex string, or a D65 Lab triplet.');
}

/**
 * Return one closest actual sample per product, ranked by full-color CIEDE2000.
 * Target accepts {rgb,lab,hex}, an RGB triplet, a hex string, or {lab}.
 * Strict tolerance: no result is returned outside the range. Pass tolerance: Infinity
 * explicitly for nearest alternatives, and limit: Infinity to return every eligible item.
 * Returned sample/product are original objects; inputs and darkness labels are untouched.
 */
export function matchCatalog(target, products, { tolerance = 12, limit = 12 } = {}) {
  const lab = colorLab(target);
  if (!Array.isArray(products)) throw new TypeError('Catalog products must be an array.');
  const numericTolerance = Number(tolerance);
  const threshold = numericTolerance === Infinity
    ? Infinity
    : Number.isFinite(numericTolerance) ? Math.max(0, numericTolerance) : 12;
  const resultLimit = Number(limit) === Infinity
    ? Infinity
    : boundedInteger(limit, 12, 0, Number.MAX_SAFE_INTEGER);
  if (resultLimit === 0) return [];

  const matches = [];
  for (const product of products) {
    if (!Array.isArray(product?.samples)) continue;
    let closest = null;
    for (const sample of product.samples) {
      let sampleLab;
      try {
        sampleLab = colorLab(sample);
      } catch {
        continue; // One incomplete catalog sample must not hide other valid products.
      }
      const deltaE = deltaE2000(lab, sampleLab);
      if (!closest || deltaE < closest.deltaE) closest = { product, sample, deltaE, withinTolerance: deltaE <= threshold };
    }
    if (closest?.withinTolerance) matches.push(closest);
  }
  return matches
    .sort((first, second) => first.deltaE - second.deltaE
      || compareText(String(first.product.id ?? first.product.name ?? ''), String(second.product.id ?? second.product.name ?? '')))
    .slice(0, resultLimit);
}
