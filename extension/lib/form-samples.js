/**
 * Purpose: attach measured colors and marker coordinates from the selected frit photo.
 * Setup: provide the bundled form-samples index and an existing catalog product.
 * Writes: none; returns a shallow product copy without changing its shared reference.
 * Constraints: coordinates belong to the exact image URL; no cross-form fallback.
 */

export const SAMPLED_FORMS = Object.freeze(['powder', 'fine', 'medium', 'coarse']);

export function samplesForForm(product, form, index = {}) {
  if (!SAMPLED_FORMS.includes(form)) return null;
  return index.products?.[product?.id]?.[form] || null;
}

export function productWithFormSamples(product, form, index = {}) {
  if (!product || !SAMPLED_FORMS.includes(form)) return product;
  const photo = samplesForForm(product, form, index);
  return {
    ...product,
    samples: photo?.samples || [],
    photoGuide: photo || null,
    referenceColorFamily: product.referenceColorFamily || product.colorFamily,
    colorFamily: photo?.colorFamily || product.colorFamily,
  };
}

/** Select only coordinates belonging to the currently displayed image. */
export function samplesForPhoto(product, imageUrl) {
  return product?.photoGuide?.imageUrl === imageUrl ? product.photoGuide.samples || [] : [];
}

/** Inspect a real measured glass sample near a normalized photo click. */
export function nearestPhotoSample(samples, x, y, maximumDistance = .18) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  let nearest = null, distance = maximumDistance ** 2;
  for (const sample of samples || []) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || sample.eligible === false || sample.background === true) continue;
    const next = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    if (next <= distance) { nearest = sample; distance = next; }
  }
  return nearest;
}
