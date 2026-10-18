/**
 * Purpose: Turn an imported or right-clicked image into an editable palette and
 * match its full colors to photographed Bullseye transparent medium-frit samples.
 * Setup: Load picker.html in the extension or its local web preview. Catalog,
 * color engine, and browser/storage bridge are supplied by adjacent modules.
 * Behavior: Stores this workspace locally; users explicitly choose glass, jar
 * sizes, and quantities. The shopping action opens Bullseye's native Quick Add
 * page for review. It never checks out, clears a shop cart, or uploads images.
 * Constraints: Darkness is relative to each glass photograph's lightest and
 * darkest sampled colors. Matching compares the full sampled color.
 */
import { rgbToLab, rgbToHex } from './lib/color.js';
import { extractPalette, matchCatalog } from './lib/palette.js';
import {
  getPendingImage, subscribePendingImage, openWorkspace, captureVisibleImage,
  openQuickAdd, fetchProductVariants, loadState, saveState, requestImageAccess, cancelPendingImage,
} from './lib/extension.js';

const $ = (id) => document.getElementById(id);
const MAX_TARGETS = 20;
const state = {
  products: [], sourceDataUrl: '', sourceName: '', sourceUrl: '', imageData: null,
  paletteCount: 6, targets: [], activeTargetId: null, tolerance: 12,
  view: 'library', query: '', selectedVariants: {}, cart: [], showNearest: false,
  lastPendingImageAt: 0,
};
const sourceCanvas = $('source-canvas');
const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
const freshProducts = new Map();
let detailProduct = null;
let detailSample = null;
let pendingAccessUrl = '';
let saveTimer;
let toastTimer;
let saveWarningShown = false;
let imageLoadId = 0;
let cancellingImageId = 0;
let manualTargetId = 0;
let captureBase = null;
let captureSelection = null;
let captureStart = null;
let emptyAction = null;
let pendingReceivedThisSession = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(kind) {
  const paths = {
    plus: ['M12 5v14M5 12h14'], check: ['m5 12 4 4L19 6'],
    close: ['m6 6 12 12M18 6 6 18'], expand: ['M14 4h6v6M20 4l-8 8M10 4H4v16h16v-6'],
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths[kind] || paths.plus) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function notify(message, error = false, duration = 5000) {
  const toast = $('status-message');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}
function colorHex(rgb) { return rgbToHex(rgb).toUpperCase(); }
function activeTarget() { return state.targets.find((target) => target.id === state.activeTargetId) || null; }
function sampleDarkness(sample) {
  const value = Number(sample?.darkness);
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}
function sampleLabel(product, sample) {
  const darkness = sampleDarkness(sample);
  return darkness === null ? product.name : `${product.name} · at ${darkness}% darkness`;
}
function variantKey(product, variant) { return `${product.id}:${String(variant.id || variant.sku)}`; }
function getProduct(id) { return state.products.find((product) => product.id === id); }
function getVariant(product, id) { return product?.variants?.find((variant) => String(variant.id) === String(id)); }
function currentVariant(product) {
  const preferred = getVariant(product, state.selectedVariants[product.id]);
  if (preferred) return preferred;
  const variants = product.variants || [];
  return variants.find((variant) => variant.available && /5\s*oz/i.test(variant.title))
    || variants.find((variant) => variant.available)
    || variants[0] || null;
}
function selectedItem(product, variant) {
  return variant && state.cart.find((item) => variantKey(product, variant) === item.key);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}

async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const snapshot = {
    version: 1, sourceDataUrl: state.sourceDataUrl, sourceName: state.sourceName,
    sourceUrl: state.sourceUrl, paletteCount: state.paletteCount,
    targets: state.targets, activeTargetId: state.activeTargetId,
    tolerance: state.tolerance, view: state.view,
    selectedVariants: state.selectedVariants, cart: state.cart,
    lastPendingImageAt: state.lastPendingImageAt,
  };
  try { await saveState(snapshot); }
  catch (error) {
    console.warn('Could not save palette workspace:', error);
    if (!saveWarningShown) {
      notify('Your palette works in this tab, but this browser could not save the workspace.', true);
      saveWarningShown = true;
    }
  }
}

function normalizeTarget(target, index = 0) {
  if (!Array.isArray(target?.rgb) || target.rgb.length !== 3) return null;
  const rgb = target.rgb.map((value) => clamp(Math.round(Number(value) || 0), 0, 255));
  return {
    id: String(target.id || `color-${index}`), rgb, hex: colorHex(rgb), lab: rgbToLab(rgb),
    weight: Number(target.weight) || 0, manual: Boolean(target.manual),
  };
}

function restoreWorkspace(saved) {
  if (!saved || typeof saved !== 'object') return;
  state.paletteCount = clamp(Math.round(Number(saved.paletteCount) || 6), 2, 12);
  state.tolerance = clamp(Number(saved.tolerance) || 12, 2, 35);
  state.selectedVariants = saved.selectedVariants && typeof saved.selectedVariants === 'object' ? saved.selectedVariants : {};
  state.targets = Array.isArray(saved.targets) ? saved.targets.map(normalizeTarget).filter(Boolean).slice(0, MAX_TARGETS) : [];
  state.activeTargetId = saved.activeTargetId;
  if (!activeTarget()) state.activeTargetId = state.targets[0]?.id || null;
  state.view = saved.view === 'matches' ? 'matches' : 'library';
  state.lastPendingImageAt = Number(saved.lastPendingImageAt) || 0;
  state.cart = [];
  for (const previous of Array.isArray(saved.cart) ? saved.cart : []) {
    const product = getProduct(previous.productId);
    const variant = getVariant(product, previous.variantId);
    if (product && variant) {
      const item = makeCartItem(product, variant, previous.quantity);
      const existing = state.cart.find((entry) => entry.key === item.key);
      if (existing) existing.quantity = clamp(existing.quantity + item.quantity, 1, 999);
      else state.cart.push(item);
    }
  }
}

function renderPalette() {
  const hasPalette = Boolean(state.imageData || state.targets.length);
  $('palette-panel').hidden = !hasPalette;
  $('target-count').textContent = state.targets.length ? String(state.targets.length) : '';
  $('palette-count').value = state.paletteCount;
  $('palette-count').disabled = !state.imageData;
  $('palette-fewer').disabled = !state.imageData || state.paletteCount <= 2;
  $('palette-more').disabled = !state.imageData || state.paletteCount >= 12;
  const chips = $('palette-chips');
  chips.replaceChildren();
  for (const [index, target] of state.targets.entries()) {
    const wrap = element('div', 'palette-chip-wrap');
    const button = element('button', `palette-chip${target.id === state.activeTargetId ? ' is-active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `Select palette color ${index + 1}, ${target.hex}`);
    button.setAttribute('aria-pressed', String(target.id === state.activeTargetId));
    const color = element('span', 'palette-chip-color');
    color.style.backgroundColor = target.hex;
    button.append(color, element('span', 'palette-chip-hex', target.hex));
    button.addEventListener('click', () => selectTarget(target.id));
    const remove = element('button', 'palette-chip-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove palette color ${target.hex}`);
    remove.title = 'Remove this color';
    remove.addEventListener('click', () => removeTarget(target.id));
    wrap.append(button, remove);
    chips.append(wrap);
  }
  const target = activeTarget();
  $('target-editor').hidden = !target;
  if (target) {
    $('target-color').value = target.hex.toLowerCase();
    if (document.activeElement !== $('target-hex')) $('target-hex').value = target.hex;
    $('target-hex').removeAttribute('aria-invalid');
  }
  $('add-custom-color').disabled = state.targets.length >= MAX_TARGETS;
}

function matchingProducts() {
  const target = activeTarget();
  if (!target) return [];
  return matchCatalog(target, state.products, {
    tolerance: state.showNearest ? Infinity : state.tolerance,
    limit: state.showNearest ? 6 : state.products.length,
  });
}

function renderResults() {
  const focusedKey = document.activeElement?.dataset?.focusKey;
  const isMatches = state.view === 'matches';
  const target = activeTarget();
  for (const view of ['library', 'matches']) {
    const tab = $(`${view}-tab`);
    tab.classList.toggle('is-active', state.view === view);
    tab.setAttribute('aria-selected', String(state.view === view));
    tab.tabIndex = state.view === view ? 0 : -1;
  }
  $('glass-results').setAttribute('aria-labelledby', `${state.view}-tab`);
  $('match-controls').hidden = !isMatches || !target;
  $('match-range').value = state.tolerance;
  $('range-label').textContent = state.tolerance <= 6 ? 'Very close' : state.tolerance <= 15 ? 'Balanced' : state.tolerance <= 25 ? 'Open-minded' : 'Broad range';
  $('match-range').setAttribute('aria-valuetext', `${state.tolerance}, ${$('range-label').textContent.toLowerCase()}`);
  if (target) {
    $('matching-swatch').style.backgroundColor = target.hex;
    $('matching-hex').textContent = target.hex;
  }
  $('results-eyebrow').textContent = isMatches ? (state.showNearest ? 'Nearby possibilities' : '03 / Find your glass') : 'Explore the collection';
  $('results-title').textContent = isMatches ? (target ? 'Glass that shares your color.' : 'Let a color lead the way.') : 'A color for every idea.';
  $('results-description').textContent = isMatches
    ? (state.showNearest ? 'These are the nearest photographed colors. They may sit outside your chosen match range.' : 'Matches compare the full color. Each marker shows the matching point in the actual glass photo.')
    : 'Explore colored transparent medium frit. Choose the colors you want to work with.';
  let entries = isMatches ? matchingProducts() : state.products.map((product) => ({ product, sample: null }));
  if (target && isMatches) {
    const inRangeCount = state.showNearest
      ? matchCatalog(target, state.products, { tolerance: state.tolerance, limit: state.products.length }).length
      : entries.length;
    $('match-count').textContent = `${inRangeCount} ${inRangeCount === 1 ? 'match' : 'matches'}`;
  }
  const query = state.query.trim().toLowerCase();
  if (query) entries = entries.filter(({ product }) => `${product.name} ${product.code} ${product.id}`.toLowerCase().includes(query));
  $('product-grid').replaceChildren();
  $('empty-state').hidden = entries.length > 0;
  $('glass-results').hidden = entries.length === 0;
  $('empty-action').hidden = true;
  emptyAction = null;
  if (!entries.length) {
    if (query) {
      setEmpty('No glass by that name.', 'Try another color name or a Bullseye glass code.', 'Clear search', () => {
        state.query = ''; $('glass-search').value = ''; renderResults();
      });
    } else if (isMatches && !target) {
      setEmpty('Start with a color you love.', 'Add an image for a starting palette, or choose a color yourself.', 'Choose a color', createCustomTarget);
    } else if (isMatches) {
      setEmpty('A little outside this collection.', 'Loosen the match range to explore more colors, or take a look at the nearest options.', 'Show nearest colors', () => {
        state.showNearest = true; renderResults();
      });
    } else {
      setEmpty('The glass library is unavailable.', 'Reload the extension to try loading the local catalog again.', 'Reload', () => window.location.reload());
    }
  }
  for (const entry of entries) $('product-grid').append(renderProduct(entry, isMatches));
  if (focusedKey) {
    for (const node of document.querySelectorAll('[data-focus-key]')) {
      if (node.dataset.focusKey === focusedKey) { node.focus({ preventScroll: true }); break; }
    }
  }
}

function setEmpty(title, copy, actionText, action) {
  $('empty-title').textContent = title;
  $('empty-copy').textContent = copy;
  $('empty-action').textContent = actionText;
  $('empty-action').hidden = !action;
  emptyAction = action;
}

function photoElement(product, sample, eager = true) {
  const wrapper = element('div', 'glass-photo');
  const img = element('img');
  img.src = product.image;
  img.alt = `${product.name}, actual Bullseye medium-frit color photograph`;
  img.loading = eager ? 'eager' : 'lazy';
  // Reserve the bundled square photograph's space while it decodes.
  img.width = 600; img.height = 600;
  img.decoding = 'async';
  wrapper.append(img);
  if (sample && Number.isFinite(sample.x) && Number.isFinite(sample.y)) {
    const marker = element('span', 'sample-marker');
    marker.style.left = `${clamp(sample.x, 0, 1) * 100}%`;
    marker.style.top = `${clamp(sample.y, 0, 1) * 100}%`;
    marker.setAttribute('aria-hidden', 'true');
    wrapper.append(marker);
  }
  return wrapper;
}

function renderProduct(entry, isMatch) {
  const { product, sample } = entry;
  const variant = currentVariant(product);
  const card = element('article', `product-card${selectedItem(product, variant) ? ' is-selected' : ''}`);
  card.dataset.productId = product.id;
  const photo = element('button', 'photo-button');
  photo.type = 'button';
  photo.setAttribute('aria-label', `Inspect ${product.name} color photograph`);
  photo.append(photoElement(product, isMatch ? sample : null));
  const expand = element('span', 'photo-action');
  expand.append(icon('expand'));
  photo.append(expand);
  photo.addEventListener('click', () => openDetail(product, sample));
  const content = element('div', 'product-card-content');
  content.append(element('p', 'product-code', product.id), element('h3', 'product-name', isMatch ? sampleLabel(product, sample) : product.name));
  content.append(element('p', 'product-sample-caption', 'Transparent · Medium frit'));
  if (isMatch) {
    const outside = Number(entry.deltaE) > state.tolerance;
    const quality = element('p', `match-quality${outside ? ' nearby' : ''}`, outside ? 'Nearby color · outside range' : Number(entry.deltaE) <= 5 ? 'Very close color match' : 'Within your match range');
    quality.title = `Full-color difference: ${Number(entry.deltaE).toFixed(1)} ΔE00`;
    content.append(quality);
  } else {
    const strip = element('div', 'sample-strip');
    strip.setAttribute('aria-label', `Photographed color samples for ${product.name}`);
    for (const photographed of product.samples || []) {
      const swatch = element('span');
      swatch.style.backgroundColor = photographed.hex || colorHex(photographed.rgb);
      swatch.title = sampleLabel(product, photographed);
      strip.append(swatch);
    }
    content.append(strip);
  }
  card.append(photo, content, purchaseControls(product));
  return card;
}

function variantSelect(product, chosen, onChange, focusKey) {
  const select = element('select', 'variant-select');
  select.setAttribute('aria-label', `Jar size for ${product.name}`);
  if (focusKey) select.dataset.focusKey = focusKey;
  for (const variant of product.variants || []) {
    const option = element('option', '', `${variant.title}${variant.available ? '' : ' · unavailable'}`);
    option.value = String(variant.id);
    option.disabled = !variant.available;
    option.selected = String(variant.id) === String(chosen?.id);
    select.append(option);
  }
  if (!product.variants?.length) select.append(element('option', '', 'See Bullseye for sizes'));
  select.disabled = !product.variants?.some((variant) => variant.available);
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function purchaseControls(product, inDetail = false) {
  const controls = element('div', 'product-purchase');
  const variant = currentVariant(product);
  const selected = selectedItem(product, variant);
  const select = variantSelect(product, variant, (value) => {
    state.selectedVariants[product.id] = value;
    renderResults();
    if (detailProduct?.id === product.id) renderDetailPurchase();
    persist();
  }, `${inDetail ? 'detail-' : ''}variant-${product.id}`);
  const row = element('div', 'select-row');
  row.append(element('span', 'product-price', variant ? money(variant.price) : 'View item'));
  const button = element('button', 'select-glass');
  button.type = 'button';
  button.dataset.focusKey = `${inDetail ? 'detail-' : ''}toggle-${product.id}`;
  button.setAttribute('aria-pressed', String(Boolean(selected)));
  button.setAttribute('aria-label', `${selected ? 'Remove' : 'Select'} ${product.name}, ${variant?.title || 'glass'}`);
  button.append(icon(selected ? 'check' : 'plus'), element('span', '', selected ? 'Selected' : 'Select'));
  button.disabled = !selected && (!variant || !variant.available || !variant.sku);
  if (!variant?.sku) button.title = 'Open the product page for current purchasing options.';
  button.addEventListener('click', () => toggleGlass(product, variant));
  row.append(button);
  controls.append(select, row);
  return controls;
}

function makeCartItem(product, variant, quantity = 1) {
  return {
    key: variantKey(product, variant), productId: product.id, variantId: variant.id,
    sku: variant.sku, name: product.name, image: product.image, title: variant.title,
    price: Number(variant.price) || 0, available: Boolean(variant.available),
    quantity: clamp(Math.round(Number(quantity) || 1), 1, 999),
  };
}

function toggleGlass(product, variant) {
  if (!variant) return;
  const key = variantKey(product, variant);
  const existing = state.cart.findIndex((item) => item.key === key);
  if (existing !== -1) {
    state.cart.splice(existing, 1);
    notify(`${product.name} removed from your selection.`, false, 2500);
  } else {
    state.cart.push(makeCartItem(product, variant));
    notify(`${product.name} added to your glass selection.`, false, 2500);
  }
  renderResults();
  renderCart();
  if (detailProduct) renderDetailPurchase();
  persist();
}

function removeCartItem(key) {
  state.cart = state.cart.filter((item) => item.key !== key);
  renderResults(); renderCart();
  if (detailProduct) renderDetailPurchase();
  persist();
}

function changeQuantity(key, quantity) {
  const item = state.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.quantity = clamp(Math.round(Number(quantity) || 1), 1, 999);
  renderCart(); persist();
}

function changeCartVariant(key, variantId) {
  const index = state.cart.findIndex((item) => item.key === key);
  if (index < 0) return;
  const current = state.cart[index];
  const product = getProduct(current.productId);
  const variant = getVariant(product, variantId);
  if (!variant) return;
  const updated = makeCartItem(product, variant, current.quantity);
  const existing = state.cart.find((item) => item.key === updated.key && item.key !== key);
  if (existing) {
    existing.quantity = clamp(existing.quantity + updated.quantity, 1, 999);
    state.cart.splice(index, 1);
  } else state.cart[index] = updated;
  state.selectedVariants[product.id] = variantId;
  renderResults(); renderCart();
  if (detailProduct) renderDetailPurchase();
  persist();
}

function renderCart() {
  const distinctColors = new Set(state.cart.map((item) => item.productId)).size;
  const jars = state.cart.reduce((total, item) => total + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  $('cart-count').textContent = distinctColors;
  $('open-cart').setAttribute('aria-label', `Open selected glass, ${distinctColors} colors, ${jars} jars`);
  $('selection-bar').hidden = !state.cart.length;
  $('selection-summary').textContent = `${distinctColors} glass ${distinctColors === 1 ? 'color' : 'colors'} selected`;
  $('selection-total').textContent = `${jars} ${jars === 1 ? 'jar' : 'jars'} · ${money(total)} estimated`;
  $('cart-total').textContent = money(total);
  $('cart-empty').hidden = Boolean(state.cart.length);
  $('cart-bottom').hidden = !state.cart.length;
  const container = $('cart-items');
  container.replaceChildren();
  for (const item of state.cart) {
    const product = getProduct(item.productId);
    const variant = getVariant(product, item.variantId);
    if (!product || !variant) continue;
    const row = element('div', 'cart-item');
    const image = element('div', 'cart-item-image');
    const img = element('img'); img.src = product.image; img.alt = product.name;
    image.append(img);
    const body = element('div');
    body.append(element('h3', 'cart-item-name', product.name), element('p', 'cart-item-code', item.sku));
    body.append(variantSelect(product, variant, (value) => changeCartVariant(item.key, value)));
    if (!variant.available) body.append(element('p', 'section-note', 'This jar is unavailable. Choose another size.'));
    const bottom = element('div', 'cart-item-bottom');
    const stepper = element('div', 'stepper');
    const minus = element('button', '', '−'); minus.type = 'button';
    minus.setAttribute('aria-label', `One fewer jar of ${product.name}`);
    minus.disabled = item.quantity <= 1;
    minus.addEventListener('click', () => changeQuantity(item.key, item.quantity - 1));
    const input = element('input'); input.type = 'number'; input.min = '1'; input.max = '999'; input.value = item.quantity;
    input.setAttribute('aria-label', `Quantity of ${product.name}, ${variant.title}`);
    input.addEventListener('change', () => changeQuantity(item.key, input.value));
    const plus = element('button', '', '+'); plus.type = 'button';
    plus.setAttribute('aria-label', `One more jar of ${product.name}`);
    plus.disabled = item.quantity >= 999;
    plus.addEventListener('click', () => changeQuantity(item.key, item.quantity + 1));
    stepper.append(minus, input, plus);
    bottom.append(stepper, element('span', 'cart-item-price', money(item.price * item.quantity)));
    body.append(bottom);
    const remove = element('button', 'icon-button cart-item-remove'); remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${product.name}, ${variant.title} from selection`);
    remove.append(icon('close'));
    remove.addEventListener('click', () => removeCartItem(item.key));
    row.append(image, body, remove); container.append(row);
  }
}

function renderAll() { renderPalette(); renderResults(); renderCart(); }

function setView(view) {
  state.view = view;
  state.showNearest = false;
  renderResults(); persist();
}

function selectTarget(id) {
  state.activeTargetId = id;
  state.view = 'matches'; state.showNearest = false;
  renderPalette(); renderResults(); persist();
}

function removeTarget(id) {
  const index = state.targets.findIndex((target) => target.id === id);
  state.targets = state.targets.filter((target) => target.id !== id);
  if (!activeTarget()) state.activeTargetId = state.targets[Math.max(0, index - 1)]?.id || null;
  state.showNearest = false;
  renderPalette(); renderResults(); persist();
}

function addTarget(rgb) {
  const hex = colorHex(rgb);
  const existing = state.targets.find((target) => target.hex === hex);
  if (existing) { selectTarget(existing.id); return existing; }
  if (state.targets.length >= MAX_TARGETS) {
    notify(`You have ${MAX_TARGETS} palette colors. Remove one before adding another.`, true);
    return null;
  }
  const target = normalizeTarget({ id: `manual-${Date.now()}-${++manualTargetId}`, rgb, manual: true });
  state.targets.push(target);
  selectTarget(target.id);
  return target;
}

function createCustomTarget() {
  const target = addTarget([83, 121, 103]);
  if (target) {
    $('palette-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('target-color').click();
  }
}

function editTarget(hex, allowInvalid = false) {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    if (!allowInvalid) $('target-hex').setAttribute('aria-invalid', 'true');
    return false;
  }
  const target = activeTarget();
  if (!target) return false;
  target.rgb = [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  target.hex = normalized.toUpperCase(); target.lab = rgbToLab(target.rgb); target.manual = true;
  target.weight = 0;
  state.showNearest = false;
  renderPalette(); renderResults(); persist();
  return true;
}

function extractStartingColors(preserveManual = true) {
  if (!state.imageData) return;
  const manual = preserveManual ? state.targets.filter((target) => target.manual) : [];
  const extracted = extractPalette(state.imageData, { count: state.paletteCount });
  const manualHexes = new Set(manual.map((target) => target.hex));
  const automatic = extracted.map((target, index) => normalizeTarget({ ...target, id: `auto-${index}-${colorHex(target.rgb)}`, manual: false }))
    .filter((target) => !manualHexes.has(target.hex));
  state.targets = [...automatic.slice(0, MAX_TARGETS - manual.length), ...manual];
  if (!activeTarget()) state.activeTargetId = state.targets[0]?.id || null;
  state.showNearest = false;
  renderPalette(); renderResults(); persist();
}

function changePaletteCount(value) {
  state.paletteCount = clamp(Math.round(Number(value) || 6), 2, 12);
  extractStartingColors(true);
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened. Try saving it as PNG, JPEG, or WebP.'));
    image.src = url;
  });
}

async function loadImage(dataUrl, options = {}) {
  const requestId = options.requestId ?? ++imageLoadId;
  if (requestId !== imageLoadId) return;
  try {
    const image = await decodeImage(dataUrl);
    if (requestId !== imageLoadId) return;
    const scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
    sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    state.imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    state.sourceDataUrl = sourceCanvas.toDataURL('image/png');
    state.sourceName = options.name || 'Your inspiration';
    state.sourceUrl = options.sourceUrl || '';
    $('source-name').textContent = state.sourceName;
    $('source-name').title = state.sourceName;
    $('drop-zone').hidden = true;
    $('image-loaded').hidden = false;
    $('replace-image').hidden = false;
    $('image-pick-marker').hidden = true;
    $('image-access-note').hidden = true;
    pendingAccessUrl = '';
    if (!options.restore || !state.targets.length) {
      state.targets = []; state.activeTargetId = null;
      state.view = 'matches'; state.showNearest = false;
      extractStartingColors(false);
      notify(`Found ${state.targets.length} starting colors. Click the photo to add your own.`, false, 4000);
    } else renderAll();
    persist();
  } catch (error) {
    if (requestId !== imageLoadId) return;
    notify(error.message || 'This image could not be opened.', true);
    console.warn('Image import failed:', error);
  }
}

async function beginManualImage() {
  // Reserve this choice before awaiting the worker or reading a file. A later
  // choice can then supersede any earlier FileReader or image decode.
  const requestId = ++imageLoadId;
  cancellingImageId = requestId;
  pendingReceivedThisSession = true;
  pendingAccessUrl = '';
  $('image-access-note').hidden = true;
  try { await cancelPendingImage(); }
  catch (error) { console.info('Could not cancel the previous browser image:', error); }
  finally { if (cancellingImageId === requestId) cancellingImageId = 0; }
  if (requestId !== imageLoadId) return null;
  return requestId;
}

async function readFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    notify('Choose an image file such as PNG, JPEG, or WebP.', true); return;
  }
  const requestId = await beginManualImage();
  if (requestId === null) return;
  const reader = new FileReader();
  reader.onload = () => loadImage(String(reader.result), { name: file.name || 'Pasted image', requestId });
  reader.onerror = () => { if (requestId === imageLoadId) notify('The image file could not be read.', true); };
  reader.readAsDataURL(file);
}

async function clearImage() {
  const requestId = await beginManualImage();
  if (requestId === null) return;
  state.imageData = null; state.sourceDataUrl = ''; state.sourceName = ''; state.sourceUrl = '';
  state.targets = []; state.activeTargetId = null; state.view = 'library'; state.showNearest = false;
  sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  $('drop-zone').hidden = false; $('image-loaded').hidden = true; $('replace-image').hidden = true;
  $('image-pick-marker').hidden = true; $('image-access-note').hidden = true;
  renderAll(); persist();
}

function pickSourceColor(event) {
  if (!state.imageData) return;
  const bounds = sourceCanvas.getBoundingClientRect();
  const nx = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  const ny = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
  const x = clamp(Math.floor(nx * sourceCanvas.width), 0, sourceCanvas.width - 1);
  const y = clamp(Math.floor(ny * sourceCanvas.height), 0, sourceCanvas.height - 1);
  const rgb = [0, 0, 0]; let count = 0;
  for (let py = Math.max(0, y - 1); py <= Math.min(sourceCanvas.height - 1, y + 1); py += 1) {
    for (let px = Math.max(0, x - 1); px <= Math.min(sourceCanvas.width - 1, x + 1); px += 1) {
      const offset = (py * sourceCanvas.width + px) * 4;
      const alpha = state.imageData.data[offset + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) rgb[channel] += state.imageData.data[offset + channel] * alpha;
      count += alpha;
    }
  }
  if (!count) { notify('That part of the image is transparent. Pick a visible color.'); return; }
  const color = rgb.map((channel) => Math.round(channel / count));
  const target = addTarget(color);
  if (!target) return;
  const marker = $('image-pick-marker');
  marker.style.left = `${nx * 100}%`; marker.style.top = `${ny * 100}%`; marker.hidden = false;
  notify(`${target.hex} selected. You can edit or remove it from your palette.`, false, 2500);
}

async function handlePendingImage(pending) {
  if (!pending || cancellingImageId) return;
  const updatedAt = Number(pending.updatedAt) || 0;
  if (updatedAt && updatedAt <= state.lastPendingImageAt) return;
  if (pending.dataUrl) {
    pendingReceivedThisSession = true;
    if (updatedAt) state.lastPendingImageAt = updatedAt;
    await loadImage(pending.dataUrl, { name: pending.name || 'Image from the web', sourceUrl: pending.sourceUrl });
    return;
  }
  if (pending.needsPermission && pending.sourceUrl) {
    pendingAccessUrl = pending.sourceUrl;
    $('image-access-copy').textContent = 'This photo is hosted on another site. Allow access to read its colors, or capture the visible image.';
    $('allow-image-access').hidden = false;
    $('image-access-note').hidden = false;
  } else if (pending.error) {
    $('image-access-copy').textContent = `${pending.error} You can also capture a region or drop in a saved image.`;
    $('allow-image-access').hidden = true;
    $('image-access-note').hidden = false;
  }
}

async function pasteImage() {
  if (!navigator.clipboard?.read) { notify('Press Ctrl+V with an image copied, or choose an image file.'); return; }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((entry) => entry.startsWith('image/'));
      if (type) { await readFile(new File([await item.getType(type)], 'Pasted image', { type })); return; }
    }
    notify('Copy an image first, then paste it here.');
  } catch {
    notify('Press Ctrl+V with an image copied, or choose an image file.');
  }
}

function orderLines() {
  const quantities = new Map();
  for (const item of state.cart) if (item.sku) quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.quantity);
  return Array.from(quantities, ([sku, quantity]) => `${sku} ${quantity}`).join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const field = element('textarea'); field.value = text;
    field.style.position = 'fixed'; field.style.left = '-9999px';
    const parent = $('cart-dialog').open ? $('cart-dialog') : document.body;
    parent.append(field); field.select();
    const result = document.execCommand('copy'); field.remove();
    return result;
  }
}

async function copyOrder() {
  const lines = orderLines();
  if (!lines) return;
  const copied = await copyText(lines);
  notify(copied ? 'SKU list copied. Paste it into Bullseye’s Quick Add field.' : 'The browser could not copy the list. Try Send to Bullseye cart.', !copied);
}

async function sendToCart() {
  const lines = orderLines();
  if (!lines) return;
  const invalid = state.cart.find((item) => !item.sku || !getVariant(getProduct(item.productId), item.variantId)?.available);
  if (invalid) { notify(`Choose an available jar size for ${invalid.name} before sending the list.`, true); return; }
  const button = $('send-to-cart'); button.disabled = true;
  try {
    // Start both actions during this click: clipboard access and preview-tab
    // opening can require the browser's original user gesture.
    const [copyResult, handoffResult] = await Promise.allSettled([copyText(lines), openQuickAdd(lines)]);
    if (handoffResult.status !== 'fulfilled') throw handoffResult.reason;
    const copied = copyResult.status === 'fulfilled' && copyResult.value;
    if (handoffResult.value?.manualPaste) {
      notify(copied
        ? 'Bullseye’s Quick Add page is open. Paste the copied SKU list, review it, then choose Add to Cart.'
        : 'Bullseye’s Quick Add page is open. Use Copy SKU list, then paste your list into Quick Add.', false, 7500);
    } else {
      notify('Your list is ready on Bullseye’s Quick Add page. Review it, then choose Add to Cart.');
    }
  } catch (error) {
    console.warn('Could not open Bullseye Quick Add:', error);
    notify('The handoff could not finish. Use Copy SKU list and open Bullseye’s Quick Add page.', true);
  } finally { button.disabled = false; }
}

function openDetail(product, sample) {
  detailProduct = product;
  detailSample = sample || [...(product.samples || [])].sort((a, b) => sampleDarkness(b) - sampleDarkness(a))[0] || null;
  $('detail-code').textContent = `${product.code} · Transparent medium frit`;
  $('detail-title').textContent = product.name;
  $('detail-product-link').href = product.productUrl;
  renderDetailSample(); renderDetailPurchase();
  $('detail-dialog').showModal();
  refreshProduct(product);
}

function renderDetailSample() {
  if (!detailProduct) return;
  $('detail-photo').replaceChildren(photoElement(detailProduct, detailSample, true));
  $('detail-sample-label').textContent = sampleLabel(detailProduct, detailSample);
  $('detail-samples').replaceChildren();
  for (const sample of detailProduct.samples || []) {
    const button = element('button', `detail-sample${sample === detailSample ? ' is-active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `Show ${sampleLabel(detailProduct, sample)}`);
    button.setAttribute('aria-pressed', String(sample === detailSample));
    const swatch = element('span'); swatch.style.backgroundColor = sample.hex || colorHex(sample.rgb);
    button.title = sampleLabel(detailProduct, sample);
    button.append(swatch, element('small', '', `${sampleDarkness(sample)}%`));
    button.addEventListener('click', () => { detailSample = sample; renderDetailSample(); });
    $('detail-samples').append(button);
  }
}

function renderDetailPurchase() {
  if (!detailProduct) return;
  $('detail-purchase').replaceChildren(purchaseControls(detailProduct, true));
}

async function refreshProduct(product) {
  if (Date.now() - (freshProducts.get(product.id) || 0) < 300000) return;
  freshProducts.set(product.id, Date.now());
  try {
    const updated = await fetchProductVariants(product.handle);
    if (!Array.isArray(updated?.variants) || !updated.variants.length) return;
    product.variants = updated.variants.map((variant) => ({ ...variant, price: Number(variant.price) || 0 }));
    for (const item of state.cart.filter((entry) => entry.productId === product.id)) {
      const variant = getVariant(product, item.variantId);
      if (variant) Object.assign(item, makeCartItem(product, variant, item.quantity));
    }
    renderResults(); renderCart();
    if (detailProduct?.id === product.id) renderDetailPurchase();
    persist();
  } catch (error) { console.info('Using bundled glass product information:', error); }
}

async function beginCapture() {
  const button = $('capture-image'); button.disabled = true;
  try {
    const result = await captureVisibleImage();
    if (!result?.dataUrl) throw new Error(result?.error || 'Open this extension from the page you want to capture.');
    const image = await decodeImage(result.dataUrl);
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    captureBase = document.createElement('canvas');
    captureBase.width = Math.round(image.naturalWidth * scale);
    captureBase.height = Math.round(image.naturalHeight * scale);
    captureBase.getContext('2d').drawImage(image, 0, 0, captureBase.width, captureBase.height);
    $('capture-canvas').width = captureBase.width; $('capture-canvas').height = captureBase.height;
    captureSelection = null; captureStart = null;
    $('use-capture-region').disabled = true;
    renderCapture(); $('capture-dialog').showModal();
  } catch (error) { notify(error.message || 'The visible image could not be captured.', true); }
  finally { button.disabled = false; }
}

function capturePoint(event) {
  const canvas = $('capture-canvas'); const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width * canvas.width, 0, canvas.width),
    y: clamp((event.clientY - bounds.top) / bounds.height * canvas.height, 0, canvas.height),
  };
}

function renderCapture() {
  if (!captureBase) return;
  const canvas = $('capture-canvas'); const context = canvas.getContext('2d');
  context.drawImage(captureBase, 0, 0);
  if (!captureSelection) return;
  const { x, y, width, height } = captureSelection;
  context.fillStyle = '#163f3055'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (width > 0 && height > 0) context.drawImage(captureBase, x, y, width, height, x, y, width, height);
  context.strokeStyle = '#fff'; context.lineWidth = Math.max(2, canvas.width / canvas.getBoundingClientRect().width * 2);
  context.strokeRect(x, y, width, height);
}

async function useCapture(region = false) {
  if (!captureBase) return;
  let image = captureBase;
  if (region && captureSelection) {
    const { x, y, width, height } = captureSelection;
    if (width < 4 || height < 4) return;
    image = document.createElement('canvas'); image.width = Math.round(width); image.height = Math.round(height);
    image.getContext('2d').drawImage(captureBase, x, y, width, height, 0, 0, image.width, image.height);
  }
  $('capture-dialog').close();
  const requestId = await beginManualImage();
  if (requestId === null) return;
  await loadImage(image.toDataURL('image/png'), { name: region ? 'Captured image region' : 'Captured browser view', requestId });
}

function bindEvents() {
  window.addEventListener('pagehide', flushSave);
  $('drop-zone').addEventListener('click', () => $('image-file').click());
  $('drop-zone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('image-file').click(); }
  });
  $('replace-image').addEventListener('click', () => $('image-file').click());
  $('image-file').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; if (file) readFile(file); });
  $('clear-image').addEventListener('click', clearImage);
  $('paste-image').addEventListener('click', pasteImage);
  sourceCanvas.addEventListener('click', pickSourceColor);
  $('palette-fewer').addEventListener('click', () => changePaletteCount(state.paletteCount - 1));
  $('palette-more').addEventListener('click', () => changePaletteCount(state.paletteCount + 1));
  $('palette-count').addEventListener('change', (event) => changePaletteCount(event.target.value));
  $('target-color').addEventListener('input', (event) => { editTarget(event.target.value); $('target-hex').value = activeTarget()?.hex || ''; });
  $('target-hex').addEventListener('change', (event) => {
    if (editTarget(event.target.value.trim())) event.target.value = activeTarget().hex;
    else notify('Use a six-digit hex color, such as #537967.', true);
  });
  $('target-hex').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } });
  $('remove-target').addEventListener('click', () => { if (state.activeTargetId) removeTarget(state.activeTargetId); });
  $('add-custom-color').addEventListener('click', createCustomTarget);
  for (const view of ['library', 'matches']) {
    $(`${view}-tab`).addEventListener('click', () => setView(view));
    $(`${view}-tab`).addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 'library' : event.key === 'End' ? 'matches' : view === 'library' ? 'matches' : 'library';
        setView(next); $(`${next}-tab`).focus();
      }
    });
  }
  $('match-range').addEventListener('input', (event) => {
    state.tolerance = Number(event.target.value); state.showNearest = false; renderResults(); persist();
  });
  $('glass-search').addEventListener('input', (event) => { state.query = event.target.value; renderResults(); });
  $('empty-action').addEventListener('click', () => emptyAction?.());
  $('open-workspace').addEventListener('click', () => {
    try { Promise.resolve(openWorkspace()).catch((error) => notify(error.message || 'Could not open a larger workspace.', true)); }
    catch (error) { notify(error.message || 'Could not open a larger workspace.', true); }
  });
  for (const id of ['open-cart', 'review-selection']) $(id).addEventListener('click', () => { renderCart(); $('cart-dialog').showModal(); });
  for (const id of ['close-cart', 'back-to-glass']) $(id).addEventListener('click', () => $('cart-dialog').close());
  $('close-detail').addEventListener('click', () => $('detail-dialog').close());
  $('detail-photo').addEventListener('click', (event) => {
    const photo = $('detail-photo').querySelector('.glass-photo');
    if (!photo || !detailProduct?.samples?.length) return;
    const bounds = photo.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    detailSample = detailProduct.samples.reduce((nearest, sample) => (
      (sample.x - x) ** 2 + (sample.y - y) ** 2 < (nearest.x - x) ** 2 + (nearest.y - y) ** 2 ? sample : nearest
    ));
    renderDetailSample();
  });
  $('detail-dialog').addEventListener('close', () => { detailProduct = null; detailSample = null; });
  $('copy-order').addEventListener('click', copyOrder);
  $('send-to-cart').addEventListener('click', sendToCart);
  $('allow-image-access').addEventListener('click', async () => {
    if (!pendingAccessUrl) return;
    const button = $('allow-image-access'); button.disabled = true;
    try {
      // The worker publishes the result to session storage. That subscription
      // is the single image handoff, including when another image arrives.
      await requestImageAccess(pendingAccessUrl);
    } catch (error) { notify(error.message || 'Image access was not granted. Try capturing a region.', true); }
    finally { button.disabled = false; }
  });
  document.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
    if (item) { event.preventDefault(); readFile(item.getAsFile()); }
  });
  let dragDepth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault(); dragDepth += 1; document.body.classList.add('is-dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('dragleave', () => { dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('is-dragging'); } });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault(); dragDepth = 0; document.body.classList.remove('is-dragging');
    const file = [...event.dataTransfer.files].find((entry) => entry.type.startsWith('image/'));
    readFile(file);
  });
  $('capture-image').addEventListener('click', beginCapture);
  $('close-capture').addEventListener('click', () => $('capture-dialog').close());
  $('use-full-capture').addEventListener('click', () => useCapture(false));
  $('use-capture-region').addEventListener('click', () => useCapture(true));
  $('capture-canvas').addEventListener('pointerdown', (event) => {
    if (!captureBase) return;
    captureStart = capturePoint(event); captureSelection = null;
    $('capture-canvas').setPointerCapture(event.pointerId);
  });
  $('capture-canvas').addEventListener('pointermove', (event) => {
    if (!captureStart) return;
    const point = capturePoint(event);
    captureSelection = { x: Math.min(point.x, captureStart.x), y: Math.min(point.y, captureStart.y), width: Math.abs(point.x - captureStart.x), height: Math.abs(point.y - captureStart.y) };
    $('use-capture-region').disabled = captureSelection.width < 4 || captureSelection.height < 4;
    renderCapture();
  });
  $('capture-canvas').addEventListener('pointerup', () => { captureStart = null; });
  $('capture-canvas').addEventListener('pointercancel', () => { captureStart = null; });
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

async function initialize() {
  bindEvents();
  try {
    const [catalogResult, savedResult] = await Promise.allSettled([
      fetch('./data/catalog.json').then((response) => {
        if (!response.ok) throw new Error(`Catalog could not be loaded (${response.status}).`);
        return response.json();
      }),
      loadState(),
    ]);
    if (catalogResult.status !== 'fulfilled') throw catalogResult.reason;
    const catalog = catalogResult.value;
    state.products = Array.isArray(catalog.products) ? catalog.products : [];
    $('catalog-scope').textContent = `${state.products.length} colored transparents · Medium frit`;
    $('library-count').textContent = String(state.products.length);
    const saved = savedResult.status === 'fulfilled' ? savedResult.value : null;
    restoreWorkspace(saved);
    renderAll();
    subscribePendingImage((image) => handlePendingImage(image));
    let pending = null;
    try { pending = await getPendingImage(); }
    catch (error) { console.info('No pending browser image:', error); }
    if (pending?.dataUrl && (!pending.updatedAt || pending.updatedAt > state.lastPendingImageAt)) await handlePendingImage(pending);
    else {
      if (saved?.sourceDataUrl && !pendingReceivedThisSession) await loadImage(saved.sourceDataUrl, { name: saved.sourceName, sourceUrl: saved.sourceUrl, restore: true });
      if (pending) await handlePendingImage(pending);
    }
  } catch (error) {
    console.error('Palette Picker could not start:', error);
    $('product-grid').replaceChildren();
    $('glass-results').hidden = true; $('empty-state').hidden = false;
    setEmpty('The glass library could not open.', 'Reload the extension, or open this page through its local web server.', 'Reload', () => window.location.reload());
    notify(error.message || 'The glass library could not be loaded.', true);
  }
}

initialize();
