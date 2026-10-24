/**
 * Local palette selection only. Palette targets own their suggested jars;
 * explicit extra jars and unchecked colors survive recomputing the matches.
 * Nothing in this module contacts Bullseye or submits a cart.
 */
const uniqueStrings = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string'))];
const productFromKey = key => String(key).slice(0, String(key).lastIndexOf(':'));
const eligible = variant => Boolean(variant?.available && variant?.sku && variant?.id);
const selectable = variant => Boolean(variant?.sku && variant?.id);

export function availableVariant(product, preferredId) {
  const variants = product?.variants || [];
  return variants.find(variant => String(variant.id) === String(preferredId) && eligible(variant))
    || variants.find(variant => eligible(variant) && /(?:^|\s)5\s*(?:lb|pound)s?\b/i.test(variant.title))
    || variants.find(eligible) || null;
}

export function emptySelection(manualKeys = []) {
  return {version:1, targetKeys:{}, excludedTargetIds:[], excludedProductIds:[], manualKeys:uniqueStrings(manualKeys)};
}

function normalizeSelection(value) {
  return {
    ...emptySelection(),
    targetKeys:Object.fromEntries(Object.entries(value?.targetKeys || {}).filter(([,key]) => typeof key === 'string' && key.includes(':'))),
    excludedTargetIds:uniqueStrings(value?.excludedTargetIds),
    excludedProductIds:uniqueStrings(value?.excludedProductIds),
    manualKeys:uniqueStrings(value?.manualKeys),
  };
}

export function restoreSelection(saved, suggestions, cart) {
  const complete = saved?.version === 1 && saved.targetKeys && typeof saved.targetKeys === 'object' && !Array.isArray(saved.targetKeys)
    && Array.isArray(saved.excludedTargetIds) && Array.isArray(saved.excludedProductIds) && Array.isArray(saved.manualKeys);
  if (complete) {
    const selection = normalizeSelection(saved);
    const known = new Set([...Object.values(selection.targetKeys), ...selection.manualKeys]);
    // Recover explicitly saved jars if older/incomplete metadata missed them.
    selection.manualKeys = uniqueStrings([...selection.manualKeys, ...cart.filter(item => !known.has(item.key)).map(item => item.key)]);
    return selection;
  }
  const selection = emptySelection();
  const keys = new Set(cart.map(item => item.key));
  for (const {targetId, item} of suggestions) {
    if (item) selection.targetKeys[targetId] = item.key;
    if ((cart.length || saved?.version === 1) && (!item || !keys.has(item.key))) {
      selection.excludedTargetIds.push(targetId);
      if (item) selection.excludedProductIds.push(String(item.productId));
    }
  }
  const owned = new Set(Object.values(selection.targetKeys));
  selection.manualKeys = cart.filter(item => !owned.has(item.key) || !eligible({id:item.variantId, available:item.available, sku:item.sku})).map(item => item.key);
  selection.excludedProductIds = uniqueStrings(selection.excludedProductIds);
  return selection;
}

export function reconcileSelection(previous, suggestions, cart, {freeze = false} = {}) {
  const selection = normalizeSelection(previous);
  const itemsByKey = new Map(cart.map(item => [item.key, item]));
  const excludedTargets = new Set(selection.excludedTargetIds);
  const excludedProducts = new Set(selection.excludedProductIds);
  const nextKeys = {}, desired = new Map();
  const liveTargets = new Set(suggestions.map(suggestion => suggestion.targetId));
  const manualKeys = new Set(selection.manualKeys.filter(key => itemsByKey.has(key)));
  for (const key of manualKeys) desired.set(key, itemsByKey.get(key));
  for (const {targetId, item:suggestion} of suggestions) {
    const priorKey = selection.targetKeys[targetId];
    const item = freeze ? itemsByKey.get(priorKey) : suggestion;
    const key = freeze ? priorKey : item?.key;
    if (key) nextKeys[targetId] = key;
    if (!item || excludedTargets.has(targetId) || excludedProducts.has(String(item.productId))) continue;
    // Stock affects sending to the store, not keeping a palette selection.
    if (!freeze && !selectable({id:item.variantId, sku:item.sku})) continue;
    const existing = itemsByKey.get(item.key);
    const priorItem = itemsByKey.get(priorKey);
    const quantity = existing?.quantity ?? (priorItem?.productId === item.productId ? priorItem.quantity : item.quantity);
    desired.set(item.key, {...item, quantity});
  }
  selection.targetKeys = nextKeys;
  selection.excludedTargetIds = selection.excludedTargetIds.filter(id => liveTargets.has(id));
  selection.manualKeys = [...manualKeys];
  // Preserve order and quantities for existing choices; append new suggestions.
  const nextCart = cart.filter(item => desired.has(item.key)).map(item => {
    const next = desired.get(item.key); desired.delete(item.key); return next;
  });
  nextCart.push(...desired.values());
  return {selection, cart:nextCart};
}

export function setItemSelected(previous, key, selected) {
  const selection = normalizeSelection(previous);
  const productId = productFromKey(key);
  const relatedTargets = Object.entries(selection.targetKeys).filter(([,ownedKey]) => productFromKey(ownedKey) === productId).map(([id]) => id);
  if (selected) {
    selection.excludedProductIds = selection.excludedProductIds.filter(id => id !== productId);
    selection.excludedTargetIds = selection.excludedTargetIds.filter(id => !relatedTargets.includes(id));
    if (!Object.values(selection.targetKeys).includes(key)) selection.manualKeys = uniqueStrings([...selection.manualKeys, key]);
  } else {
    selection.manualKeys = selection.manualKeys.filter(manualKey => manualKey !== key);
    selection.excludedTargetIds = uniqueStrings([...selection.excludedTargetIds, ...relatedTargets]);
    selection.excludedProductIds = uniqueStrings([...selection.excludedProductIds, productId]);
  }
  return selection;
}

export function changeSelectedVariant(previous, oldKey, newKey) {
  const selection = normalizeSelection(previous);
  selection.targetKeys = Object.fromEntries(Object.entries(selection.targetKeys).map(([id,key]) => [id,key === oldKey ? newKey : key]));
  selection.manualKeys = uniqueStrings(selection.manualKeys.map(key => key === oldKey ? newKey : key));
  return selection;
}
