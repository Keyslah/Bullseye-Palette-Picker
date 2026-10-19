/**
 * Purpose: Extract representative full colors from an image and find matching glass.
 * Setup: Import this ES module; supply ImageData-like RGBA pixels and catalog products.
 * Destructive behavior: None; no input mutation, image uploads, account access, or I/O.
 * Constraints: RGB and D65 Lab stay intact. Photo thickness estimates are display-only.
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
function deterministicRandom(seed = 0x72a31f49) {
  let state = (Number(seed) >>> 0) || 0x72a31f49;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function sampledColors(data, maxSamples, width, height, seed) {
  const random = deterministicRandom(seed);
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
        pixelIndex: offset / 4,
      };
    }
  }

  const byRgb = new Map();
  for (const sample of reservoir) {
    const key = rgbToHex(sample.rgb);
    const existing = byRgb.get(key);
    if (existing) {
      existing.weight += sample.weight;
      existing.pixels.push(sample);
    } else byRgb.set(key, { ...sample, hex: key, lab: rgbToLab(sample.rgb), pixels: [sample] });
  }
  return [...byRgb.values()].map(point => {
    if (width && height) {
      // Place a dot inside its actual color region, close to that color's centroid.
      // The centroid alone can fall in a different color between disjoint regions.
      const centerX = point.pixels.reduce((sum, pixel) => sum + (pixel.pixelIndex % width) * pixel.weight, 0) / point.weight;
      const centerY = point.pixels.reduce((sum, pixel) => sum + Math.floor(pixel.pixelIndex / width) * pixel.weight, 0) / point.weight;
      let closest = point.pixels[0], distance = Infinity;
      for (const pixel of point.pixels) {
        const next = (pixel.pixelIndex % width - centerX) ** 2 + (Math.floor(pixel.pixelIndex / width) - centerY) ** 2;
        if (next < distance) { closest = pixel; distance = next; }
      }
      point.x = ((closest.pixelIndex % width) + 0.5) / width;
      point.y = (Math.floor(closest.pixelIndex / width) + 0.5) / height;
    }
    delete point.pixels;
    delete point.pixelIndex;
    return point;
  });
}

function initialCenters(points, count, random = null) {
  let mostCommon = points[0];
  for (const point of points) {
    if (point.weight > mostCommon.weight) mostCommon = point;
  }
  const pickWeighted = scores => {
    let remaining = random() * scores.reduce((sum, score) => sum + score, 0);
    for (let i = 0; i < scores.length; i++) { remaining -= scores[i]; if (remaining < 0) return i; }
    return scores.length - 1;
  };
  if (random) mostCommon = points[pickWeighted(points.map(point => point.weight))];
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
    if (random) next = pickWeighted(points.map((point, index) => distances[index] * point.weight));
    const center = points[next].lab.slice();
    centers.push(center);
    for (let index = 0; index < points.length; index += 1) {
      distances[index] = Math.min(distances[index], distanceSquared(points[index].lab, center));
    }
  }
  return centers;
}

/**
 * Return [{id,rgb,hex,lab,weight,x,y}], ordered by descending area weight.
 * Weighted k-means uses all three Lab axes; output swatches are actual image colors,
 * chosen closest to each cluster's center. Empty or fully transparent images return [].
 * With valid width/height, normalized x/y identify an actual representative pixel.
 */
export function extractPalette(imageData, { count = 8, maxSamples = 12000, seed } = {}) {
  const data = imageData?.data;
  if (!data || !Number.isInteger(data.length) || data.length % 4 !== 0) {
    throw new TypeError('Provide ImageData-like RGBA pixels in a data array.');
  }
  const desiredCount = boundedInteger(count, 8, 2, 12);
  const sampleLimit = boundedInteger(maxSamples, 12000, 1, 100000);
  const width = Number.isInteger(imageData.width) && imageData.width > 0 ? imageData.width : null;
  const height = Number.isInteger(imageData.height) && imageData.height > 0 ? imageData.height : null;
  const dimensionsValid = width && height && width * height * 4 === data.length;
  const points = sampledColors(data, sampleLimit, dimensionsValid && width, dimensionsValid && height, seed);
  if (points.length === 0) return [];
  const centers = initialCenters(points, Math.min(desiredCount, points.length), seed === undefined ? null : deterministicRandom(seed));

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
        ...(point.x === undefined ? {} : { x: point.x, y: point.y }),
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
 * Describe an actual sample on one shared darkness scale: 100 - CIELAB L*.
 * Pure black is 100 and pure white is 0. A product's lightest black sample must
 * still look dark, so legacy per-product sample.darkness values are ignored.
 * Accepts the same color forms as matchCatalog; invalid colors throw rather
 * than fabricating a label. Callers can round the finite 0..100 result for UI.
 */
export function sampleDarkness(sample) {
  const [lightness] = colorLab(sample);
  return Math.max(0, Math.min(100, 100 - lightness));
}

/**
 * Estimate photo color strength relative to this product's dense reference.
 * This is a thickness guide, not a measurement of millimeters from a photograph.
 * Transparent color strength is white-anchored: sample darkness / reference
 * darkness. It does not reset the lightest retained glass sample to zero.
 * Chromatic opals also compare photographed color strength. Neutral opaque
 * glass retains its 100% full-color reference. Neither is physical calibration.
 * Returns null when reference data is unusable.
 * Matching remains entirely independent of this display estimate.
 */
export function sampleThickness(sample, product) {
  const darkness = sampleDarkness(sample);
  const type = String(product?.type ?? '').trim().toLowerCase();
  // Neutral opaque black/white use their full-color reference. Chromatic opals
  // use the same photo-strength comparison as transparent glass, not a constant.
  if ((type === 'opalescent' || type === 'opaque')
    && (product?.colorFamily || getColorFamily(sample)) === 'neutral') return 100;

  const samples = Array.isArray(product?.samples) ? product.samples : [];
  const family = product?.colorFamily === 'neutral' || product?.colorFamily === 'chromatic'
    ? product.colorFamily
    : samples.length ? productColorFamily({ samples }) : null;
  const eligibleDarkness = candidate => {
    if (!candidate || candidate.eligible === false || candidate.background === true) return null;
    try {
      if (family && getColorFamily(candidate) !== family) return null;
      const value = sampleDarkness(candidate);
      return value > 1e-9 ? value : null;
    } catch {
      return null;
    }
  };

  // The builder records an actual material sample from the reviewed dense area.
  // Older catalogs fall back to the darkest valid sample, regardless of order.
  let reference = eligibleDarkness(product?.thicknessReference);
  if (reference === null) {
    for (const candidate of samples) {
      const value = eligibleDarkness(candidate);
      if (value !== null && (reference === null || value > reference)) reference = value;
    }
  }
  if (reference === null) return null;
  return Math.max(0, Math.min(100, 100 * darkness / reference));
}

// Product policy, not a claim that C*=10 is a universal visual threshold. The
// glass library intentionally excludes nearly colorless bands of colored frit.
export const MIN_VISIBLE_CHROMA = 10;

export function getColorFamily(color) {
  const lab = colorLab(color);
  return Math.hypot(lab[1], lab[2]) < MIN_VISIBLE_CHROMA ? 'neutral' : 'chromatic';
}

function productColorFamily(product) {
  if (product.colorFamily === 'neutral' || product.colorFamily === 'chromatic') return product.colorFamily;
  // Backward compatibility for imported catalogs: a chromatic product cannot
  // turn into a neutral merely because one photograph sample is nearly white.
  return product.samples.some(sample => {
    try { return getColorFamily(sample) === 'chromatic'; } catch { return false; }
  }) ? 'chromatic' : 'neutral';
}

/**
 * Return one closest actual sample per product, ranked by full-color CIEDE2000.
 * Target accepts {rgb,lab,hex}, an RGB triplet, a hex string, or {lab}.
 * The default automatically returns the nearest eligible glass without a cutoff.
 * An explicitly supplied finite tolerance remains strict; limit: Infinity returns
 * every eligible item. Neutral/chromatic eligibility applies at every tolerance.
 * White gaps in a colored frit photo are never evidence for matching gray or white.
 * For near-black neutral targets, regular Black wins a near-tie within 0.25 ΔE00;
 * its actual score remains unchanged, and strict cutoffs still apply first.
 * Returned sample/product are original objects; inputs and darkness labels are untouched.
 */
export function matchCatalog(target, products, { tolerance = Infinity, limit = 12 } = {}) {
  const lab = colorLab(target);
  const family = getColorFamily({ lab });
  if (!Array.isArray(products)) throw new TypeError('Catalog products must be an array.');
  const numericTolerance = Number(tolerance);
  const threshold = numericTolerance === Infinity
    ? Infinity
    : Number.isFinite(numericTolerance) ? Math.max(0, numericTolerance) : Infinity;
  const resultLimit = Number(limit) === Infinity
    ? Infinity
    : boundedInteger(limit, 12, 0, Number.MAX_SAFE_INTEGER);
  if (resultLimit === 0) return [];

  const matches = [];
  for (const product of products) {
    if (!Array.isArray(product?.samples)) continue;
    if (product.colorFamily === 'clear' || product.isClear || /\bclear\b/i.test(product.name ?? '')) continue;
    if (productColorFamily(product) !== family) continue;
    let closest = null;
    for (const sample of product.samples) {
      let sampleLab;
      try {
        sampleLab = colorLab(sample);
      } catch {
        continue; // One incomplete catalog sample must not hide other valid products.
      }
      if (sample.eligible === false || sample.background === true) continue;
      if (getColorFamily({ lab: sampleLab }) !== family) continue;
      const deltaE = deltaE2000(lab, sampleLab);
      if (!closest || deltaE < closest.deltaE) closest = { product, sample, deltaE, withinTolerance: deltaE <= threshold };
    }
    if (closest?.withinTolerance) matches.push(closest);
  }
  matches.sort((first, second) => first.deltaE - second.deltaE
    || compareText(String(first.product.id ?? first.product.name ?? ''), String(second.product.id ?? second.product.name ?? '')));
  if (family === 'neutral' && lab[0] <= 20 && matches.length > 1) {
    // Prefer the requested ordinary Black over specialty blacks only when their
    // actual photo colors are almost tied. No excluded product is reintroduced.
    const regularBlack = matches.findIndex(match => String(match.product.id) === '000100');
    if (regularBlack > 0 && matches[regularBlack].deltaE - matches[0].deltaE <= 0.25) {
      matches.unshift(...matches.splice(regularBlack, 1));
    }
  }
  return matches.slice(0, resultLimit);
}
