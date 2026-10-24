/**
 * Purpose: Extract representative full colors from an image and find matching glass.
 * Setup: Import this ES module; supply ImageData-like RGBA pixels and catalog products.
 * Destructive behavior: None; no input mutation, image uploads, account access, or I/O.
 * Constraints: RGB and D65 Lab stay intact. Photo thickness estimates are display-only.
 * Palette weights approximate eligible image area; transparency contributes by opacity.
 * Automatic extraction can exclude black and favor the image's prominent color theme.
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

function isBlackPixel(rgb, cache) {
  // Every sRGB channel at least 49 is already lighter than L*=20. Most bright
  // pixels need no Lab conversion before reservoir sampling.
  if (Math.min(...rgb) >= 49) return false;
  const key = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
  if (!cache.has(key)) {
    const [lightness, a, b] = rgbToLab(rgb);
    // Keep the pre-sampling scan bounded even for photos with millions of
    // distinct shades. Repeated solid surrounds still use the small cache.
    if (cache.size >= 4096) cache.clear();
    cache.set(key, lightness <= 20 && Math.hypot(a, b) < MIN_VISIBLE_CHROMA);
  }
  return cache.get(key);
}

function sampledColors(data, maxSamples, width, height, seed, excludeBlack) {
  const random = deterministicRandom(seed);
  const reservoir = [];
  const blackPixels = new Map();
  let visible = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha <= 0) continue;
    const rgb = [data[offset], data[offset + 1], data[offset + 2]];
    // Filter before sampling: a large black surround must not crowd the actual
    // image colors out of the bounded reservoir. Dark chromatic colors remain.
    if (excludeBlack && isBlackPixel(rgb, blackPixels)) continue;
    visible += 1;
    const destination = reservoir.length < maxSamples
      ? reservoir.length
      : Math.floor(random() * visible);
    if (destination < maxSamples) {
      reservoir[destination] = {
        rgb,
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

function prominentColors(points) {
  // Measure support across nearby shades, rather than exact RGB frequency.
  // A textured blue region can be prominent even when every pixel differs.
  // These deliberately soft area thresholds are picker policy, not a claim
  // that color prominence or foreground/background can be inferred perfectly.
  const cellSize = 12;
  const cells = new Map();
  const keyFor = coordinates => coordinates.join(',');
  let totalWeight = 0;
  for (const point of points) {
    const coordinates = point.lab.map(value => Math.floor(value / cellSize));
    const key = keyFor(coordinates);
    if (!cells.has(key)) cells.set(key, { coordinates, weight: 0, support: 0 });
    cells.get(key).weight += point.weight;
    totalWeight += point.weight;
  }
  let strongestSupport = 0;
  for (const cell of cells.values()) {
    for (let l = -1; l <= 1; l += 1) {
      for (let a = -1; a <= 1; a += 1) {
        for (let b = -1; b <= 1; b += 1) {
          const [cl, ca, cb] = cell.coordinates;
          cell.support += cells.get(keyFor([cl + l, ca + a, cb + b]))?.weight || 0;
        }
      }
    }
    strongestSupport = Math.max(strongestSupport, cell.support);
  }
  // Suppress isolated accents/gaps below 2.5% of visible eligible area, but
  // lower the bar for images whose theme spans many different colors.
  const minimumSupport = Math.min(totalWeight * 0.025, strongestSupport * 0.1);
  return points.filter(point => {
    const key = keyFor(point.lab.map(value => Math.floor(value / cellSize)));
    return cells.get(key).support >= minimumSupport;
  });
}

function weightedIndex(scores, random) {
  let remaining = random() * scores.reduce((sum, score) => sum + score, 0);
  for (let index = 0; index < scores.length; index += 1) {
    remaining -= scores[index];
    if (remaining < 0) return index;
  }
  return scores.length - 1;
}

function initialCenters(points, count, random = null) {
  let mostCommon = points[0];
  for (const point of points) {
    if (point.weight > mostCommon.weight) mostCommon = point;
  }
  if (random) mostCommon = points[weightedIndex(points.map(point => point.weight), random)];
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
    if (random) next = weightedIndex(points.map((point, index) => distances[index] * point.weight), random);
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
 * chosen near each cluster's center. Empty/transparent/only-black images return [].
 * With valid width/height, normalized x/y identify an actual representative pixel.
 * excludeBlack removes only neutral L*<=20, C*<10 pixels; opt out for legacy tools.
 * prominence favors supported color regions over isolated accents or background
 * gaps. An explicit seed varies real nearby shades within that theme for Remix;
 * omitting it stays repeatable. Images with few eligible colors return fewer dots.
 * distinctKey optionally maps a source candidate to its best matching glass ID.
 * That mode considers a larger bounded pool, then avoids repeated glass and
 * near-identical source colors. Excluded manual keys/colors remain untouched.
 * variationValue optionally supplies that match's measured thickness percent;
 * if distinct glass runs out, clearly different source shades/thicknesses may
 * share a glass color. No source color or thickness value is manufactured.
 * Distinct selection accepts zero/one remaining slots beside manual colors;
 * ordinary extraction keeps its existing 2..12 requested-color bounds.
 */
export function extractPalette(imageData, {
  count = 8, maxSamples = 12000, seed, prominence = false, excludeBlack = true,
  distinctKey, variationValue, excludedKeys = [], excludedColors = [],
} = {}) {
  const data = imageData?.data;
  if (!data || !Number.isInteger(data.length) || data.length % 4 !== 0) {
    throw new TypeError('Provide ImageData-like RGBA pixels in a data array.');
  }
  if (distinctKey !== undefined && typeof distinctKey !== 'function') {
    throw new TypeError('distinctKey must return the matching glass ID for a color.');
  }
  if (variationValue !== undefined && typeof variationValue !== 'function') {
    throw new TypeError('variationValue must return the measured thickness for a color.');
  }
  const desiredCount = boundedInteger(count, 8, distinctKey ? 0 : 2, 12);
  if (desiredCount === 0) return [];
  const candidateCount = distinctKey ? Math.min(36, desiredCount * 3) : desiredCount;
  const sampleLimit = boundedInteger(maxSamples, 12000, 1, 100000);
  const width = Number.isInteger(imageData.width) && imageData.width > 0 ? imageData.width : null;
  const height = Number.isInteger(imageData.height) && imageData.height > 0 ? imageData.height : null;
  const dimensionsValid = width && height && width * height * 4 === data.length;
  let points = sampledColors(data, sampleLimit, dimensionsValid && width, dimensionsValid && height, seed, excludeBlack);
  if (points.length === 0) return [];
  if (prominence) points = prominentColors(points);
  const random = seed === undefined ? null : deterministicRandom(seed);
  const centers = initialCenters(points, Math.min(candidateCount, points.length), random);

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

  const clusters = centers.map(() => ({ weight: 0, representative: null, distance: Infinity, points: [] }));
  let totalWeight = 0;
  for (const point of points) {
    const index = nearestIndex(point.lab, centers);
    const cluster = clusters[index];
    const distance = distanceSquared(point.lab, centers[index]);
    cluster.weight += point.weight;
    if (prominence && random) cluster.points.push({ point, distance });
    totalWeight += point.weight;
    if (distance < cluster.distance) {
      cluster.representative = point;
      cluster.distance = distance;
    }
  }
  const palette = clusters
    .filter((cluster) => cluster.representative && cluster.weight > 0)
    .map((cluster) => {
      let point = cluster.representative;
      if (prominence && random) {
        // Remix changes actual nearby shades as well as cluster boundaries.
        // Weight by visible area and proximity so a single unusual pixel does
        // not take over a large color region merely for variety.
        const candidates = cluster.points.filter(candidate => candidate.distance <= cluster.distance + 144);
        const index = weightedIndex(candidates.map(candidate => candidate.point.weight / (1 + candidate.distance / 144)), random);
        point = candidates[index].point;
      }
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
  return distinctKey
    ? selectDistinctPalette(palette, { count:desiredCount, keyFor:distinctKey, variationFor:variationValue, excludedKeys, excludedColors, seed })
    : palette;
}

/**
 * Prefer distinct matched-glass IDs and avoid almost identical RGB appearances.
 * This is automatic selection only: pass manual choices as excludedKeys/colors
 * and keep those choices unchanged. If fewer distinct glasses are supported,
 * variationFor can permit clearly different measured thicknesses of a glass.
 * Null/undefined keys use the source color, allowing palettes with no catalog
 * matches. A small CIEDE2000 gap (5 by default) avoids almost identical swatches;
 * it is a picker preference, not a universal visibility threshold. Return fewer
 * colors when the candidates cannot support more, never invent another match.
 */
export function selectDistinctPalette(candidates, {
  count = 8, keyFor = color => color.hex, variationFor,
  excludedKeys = [], excludedColors = [], minDistance = 5, minVariation = 10, seed,
} = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('Palette candidates must be an array.');
  if (typeof keyFor !== 'function') throw new TypeError('keyFor must identify a candidate color.');
  if (variationFor !== undefined && typeof variationFor !== 'function') throw new TypeError('variationFor must identify a measured thickness.');
  if (!Number.isFinite(minDistance) || minDistance < 0) throw new TypeError('Color separation must be a nonnegative number.');
  if (!Number.isFinite(minVariation) || minVariation <= 0) throw new TypeError('Thickness separation must be a positive number.');
  const limit = boundedInteger(count, 8, 0, 12);
  if (!limit || !candidates.length) return [];
  const hasKey = key => key !== null && key !== undefined && key !== '';
  const excluded = new Set([...excludedKeys].filter(hasKey).map(String));
  const avoided = excludedColors.map(color => colorLab(color));
  const random = seed === undefined ? null : deterministicRandom((Number(seed) >>> 0) ^ 0x6c8e9cf5);
  const groups = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const color = candidates[index], key = keyFor(color);
    if (hasKey(key) && excluded.has(String(key))) continue;
    const hex = rgbToHex(color.rgb), lab = rgbToLab(color.rgb);
    const groupKey = hasKey(key) ? `match:${String(key)}` : `color:${hex}`;
    const weight = Number.isFinite(color.weight) && color.weight > 0 ? color.weight : 0;
    const measured = variationFor?.(color);
    const variation = Number.isFinite(measured) && measured >= 0 && measured <= 100 ? measured : null;
    if (!groups.has(groupKey)) groups.set(groupKey, { weight:0, index, candidates:[] });
    const group = groups.get(groupKey);
    group.weight += weight;
    group.candidates.push({ color, hex, lab, weight, variation });
  }
  // Combine the area of duplicate matches before ranking: textured important
  // colors must not lose priority merely because they occupied several clusters.
  const ranked = [...groups.values()].map(group => ({
    ...group, priority:group.weight * (random ? 0.75 + random() * 0.5 : 1),
  })).sort((a, b) => b.priority - a.priority || a.index - b.index);
  const selected = [], selectedHexes = new Set();
  const distinctAppearance = candidate => !selectedHexes.has(candidate.hex)
    && avoided.every(lab => {
      const distance = deltaE2000(lab, candidate.lab);
      return distance > 1e-9 && distance >= minDistance;
    });
  const retain = (candidate, group) => {
    selected.push({ candidate, group, weight:0 });
    selectedHexes.add(candidate.hex);
    avoided.push(candidate.lab);
  };
  for (const group of ranked) {
    const choices = group.candidates.filter(distinctAppearance);
    if (!choices.length) continue;
    let representative;
    if (random) {
      const scores = choices.map(candidate => candidate.weight);
      representative = choices[weightedIndex(scores.some(Boolean) ? scores : scores.map(() => 1), random)];
    } else {
      representative = choices.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best);
    }
    retain(representative, group);
    if (selected.length >= limit) break;
  }
  if (variationFor && selected.length < limit) {
    // Distinct glass always gets the first pass. Reuse one only when both the
    // actual source shade and the measured photo thickness add real variation.
    const alternatives = ranked.flatMap(group => group.candidates.map(candidate => ({
      candidate, group, priority:candidate.weight * (random ? 0.75 + random() * 0.5 : 1),
    }))).sort((a, b) => b.priority - a.priority);
    for (const { candidate, group } of alternatives) {
      const sameGlass = selected.filter(entry => entry.group === group);
      if (!sameGlass.length || candidate.variation === null || !distinctAppearance(candidate)) continue;
      if (sameGlass.some(entry => entry.candidate.variation === null
        || Math.abs(entry.candidate.variation - candidate.variation) < minVariation)) continue;
      retain(candidate, group);
      if (selected.length >= limit) break;
    }
  }
  // Split a repeated glass's area between its retained source shades instead of
  // counting the group's full area again for every thickness variation.
  for (const group of ranked) {
    const representatives = selected.filter(entry => entry.group === group);
    if (!representatives.length) continue;
    for (const candidate of group.candidates) {
      const index = nearestIndex(candidate.lab, representatives.map(entry => entry.candidate.lab));
      representatives[index].weight += candidate.weight;
    }
  }
  const totalWeight = selected.reduce((sum, entry) => sum + entry.weight, 0);
  return selected.map(({ candidate, weight }) => ({
    ...candidate.color, rgb:candidate.color.rgb.slice(), lab:candidate.lab.slice(), hex:candidate.hex,
    weight:totalWeight ? weight / totalWeight : 1 / selected.length,
  })).sort((a, b) => b.weight - a.weight || compareText(a.hex, b.hex));
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
  // A form's actual photographed appearance can be neutral even when the
  // original shared reference is chromatic. Keep that reference's identity.
  const referenceFamily = ['neutral', 'chromatic'].includes(product?.referenceColorFamily)
    ? product.referenceColorFamily : null;
  // Neutral opaque black/white use their full-color reference. Chromatic opals
  // use the same photo-strength comparison as transparent glass, not a constant.
  if ((type === 'opalescent' || type === 'opaque')
    && (referenceFamily || product?.colorFamily || getColorFamily(sample)) === 'neutral') return 100;

  const samples = Array.isArray(product?.samples) ? product.samples : [];
  const family = product?.colorFamily === 'neutral' || product?.colorFamily === 'chromatic'
    ? product.colorFamily
    : samples.length ? productColorFamily({ samples }) : null;
  const eligibleDarkness = (candidate, candidateFamily = family) => {
    if (!candidate || candidate.eligible === false || candidate.background === true) return null;
    try {
      if (candidateFamily && getColorFamily(candidate) !== candidateFamily) return null;
      const value = sampleDarkness(candidate);
      return value > 1e-9 ? value : null;
    } catch {
      return null;
    }
  };

  // The builder records an actual material sample from the reviewed dense area.
  // Older catalogs fall back to the darkest valid sample, regardless of order.
  let reference = eligibleDarkness(product?.thicknessReference, referenceFamily || family);
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
 * includeOtherFamilies is for explicit alternatives only: cross the target-family
 * boundary, but still reject background/near-colorless samples of colored glass.
 * Returned sample/product are original objects; inputs and darkness labels are untouched.
 */
export function matchCatalog(target, products, { tolerance = Infinity, limit = 12, includeOtherFamilies = false } = {}) {
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
    const materialFamily = productColorFamily(product);
    if (!includeOtherFamilies && materialFamily !== family) continue;
    let closest = null;
    for (const sample of product.samples) {
      let sampleLab;
      try {
        sampleLab = colorLab(sample);
      } catch {
        continue; // One incomplete catalog sample must not hide other valid products.
      }
      if (sample.eligible === false || sample.background === true) continue;
      if (getColorFamily({ lab: sampleLab }) !== materialFamily) continue;
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
