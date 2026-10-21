/**
 * Purpose: share explicit material/tint filtering between picker and cart.
 * Setup: pass reviewed catalog products; tints remain bundled and purchasable.
 * Writes: none. Constraints: never classify a product by its sampled brightness.
 */
export function isTint(product) {
  return product?.isTint === true || /\btint\b/i.test(`${product?.name || ''} ${product?.fullName || ''}`);
}
export function includedGlass(product, {glassTypes = {}, includeTints = false} = {}) {
  if (!includeTints && isTint(product)) return false;
  // Keep regular Black available with Transparent without reclassifying its glass.
  if (product?.id === '000100' && glassTypes.transparent !== false) return true;
  const type = String(product?.type || '').toLowerCase();
  return type === 'transparent' ? glassTypes.transparent !== false
    : ['opalescent','opaque'].includes(type) && glassTypes.opalescent !== false;
}
