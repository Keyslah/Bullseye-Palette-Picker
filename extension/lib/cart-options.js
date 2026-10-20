/**
 * Purpose: resolve cart grade and package choices to real, exact catalog variants.
 * Setup: accepts products with allVariants from product-formats.js; no network.
 * Writes: none. Constraints: no invented sheet combinations or size substitution
 * when adding a color; availability and duplicate merging remain explicit.
 */
import {normalizeForm} from './product-formats.js';

export const cartPurchasable = variant => Boolean(variant?.available && variant?.sku && Number.isSafeInteger(variant.id) && variant.id > 0);

export function cartVariants(product, form) {
  const options = product?.allVariants?.length ? product.allVariants : product?.variants || [];
  return [...new Map(options.filter(variant => normalizeForm(variant.form || product?.form) === normalizeForm(form))
    .map(variant => [variant.id, variant])).values()];
}

export function cartSizeLabel(variant) {
  if (variant?.form !== 'sheets' || !Number.isFinite(variant.thicknessMm) || !variant.sourceTitle) return variant?.title || 'Unknown size';
  const parts = variant.sourceTitle.split(' / ');
  const dimensions = parts.every(part => part === parts[0]) ? parts[0] : variant.sourceTitle;
  return `${variant.thicknessMm} mm · ${dimensions}${variant.finish ? ` · ${variant.finish}` : ''}`;
}

export function cartSizeKey(variant) {
  if (variant?.form !== 'sheets') {
    const size = String(variant?.title || '').match(/\b(\d+)\s*(lb|oz)\b/i);
    if (size) return `${size[1]}${size[2].toLowerCase()}`;
  }
  return cartSizeLabel(variant).toLowerCase();
}

export function cartSizeChoices(products, form) {
  const choices = new Map();
  for (const product of products) for (const variant of cartVariants(product, form)) {
    const key = cartSizeKey(variant), previous = choices.get(key);
    choices.set(key, {key, label:cartSizeLabel(variant), available:Boolean(previous?.available || cartPurchasable(variant))});
  }
  const jarOrder = ['5oz','1lb','5lb','40lb'];
  return [...choices.values()].sort((a,b) => normalizeForm(form) === 'sheets'
    ? a.label.localeCompare(b.label, 'en', {numeric:true})
    : jarOrder.indexOf(a.key) - jarOrder.indexOf(b.key) || a.label.localeCompare(b.label, 'en', {numeric:true}));
}

export function preferredCartSize(choices, form, requested = '5lb') {
  // Retain an explicit remembered choice even when no current product has stock.
  if (choices.some(choice => choice.key === requested)) return requested;
  const usable = choices.filter(choice => choice.available);
  return (normalizeForm(form) === 'sheets' ? usable.find(choice => /^3 mm · 10x10 in\./.test(choice.label)) : null)?.key
    || usable[0]?.key || choices[0]?.key || '';
}

export function exactCartVariant(product, form, sizeKey) {
  return cartVariants(product, form).find(variant => cartSizeKey(variant) === sizeKey && cartPurchasable(variant)) || null;
}

export function switchedCartVariant(product, form, previousVariant, preferredJarSize = '5lb') {
  const options = cartVariants(product, form).filter(cartPurchasable);
  const exact = options.find(variant => cartSizeKey(variant) === cartSizeKey(previousVariant));
  if (exact) return exact;
  const size = preferredCartSize(cartSizeChoices([product],form).filter(choice=>choice.available), form, preferredJarSize);
  return options.find(variant => cartSizeKey(variant) === size) || options[0] || null;
}
