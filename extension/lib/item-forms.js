/**
 * Purpose: retain each color's explicit purchase form independently of defaults.
 * Setup: pass the workspace's saved map and the verified base-product catalog.
 * Destructive behavior: none; unknown products/forms are omitted from restored maps.
 * Constraints: this module does not invent variants, mutate inputs, or contact a shop.
 */
import {FORM_OPTIONS, normalizeForm} from './product-formats.js';

const supported = new Set(FORM_OPTIONS.map(option => option.id));

export function normalizeItemForms(value, products) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const known = new Set((products || []).map(product => String(product.id)));
  return Object.fromEntries(Object.entries(value).filter(([id, form]) => known.has(id) && supported.has(form)));
}

export function itemForm(product, selectedForms, defaultForm = 'medium') {
  const selected = selectedForms?.[product?.id];
  return supported.has(selected) ? selected : normalizeForm(defaultForm);
}
