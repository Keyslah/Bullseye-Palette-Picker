/**
 * Purpose: preserve previously saved glass choices when per-form photo guides arrive.
 * Setup: pass the saved workspace, its normalized targets, and known catalog products.
 * Writes: none; returns a copied chosenMatches map. User photos, colors, quantities,
 *         carts, exclusions, and the source workspace are never mutated.
 * Constraints: migrate only older photo-guide records and explicit target bindings;
 *              never infer a match from unrelated cart items or product availability.
 */

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function preservedPhotoGuideMatches(saved, targets, products) {
  const explicit = record(saved?.chosenMatches);
  const entries = Object.entries(explicit);
  if (saved?.photoGuideVersion === 1) return Object.fromEntries(entries);
  const targetIds = new Set((Array.isArray(targets) ? targets : [])
    .map(target => target?.id).filter(id => typeof id === 'string' && id.length));
  const productIds = new Set((Array.isArray(products) ? products : [])
    .map(product => product?.id).filter(id => typeof id === 'string' && id.length));
  for (const [targetId, key] of Object.entries(record(saved?.selection?.targetKeys))) {
    if (!targetIds.has(targetId) || Object.hasOwn(explicit, targetId) || typeof key !== 'string') continue;
    const parts = key.split(':');
    if (parts.length !== 2 || !productIds.has(parts[0]) || !/^[1-9]\d*$/.test(parts[1])) continue;
    entries.push([targetId, parts[0]]);
  }
  return Object.fromEntries(entries);
}
