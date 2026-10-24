/**
 * Purpose: editable image points, full-color glass matching, named palettes, and
 * direct addition of chosen Bullseye jar variants to the signed-in shop cart.
 * Setup: picker.html in the extension or a local preview; adjacent catalog,
 * color engine, browser bridge, and IndexedDB palette storage modules.
 * Destructive behavior: only an explicit Delete palette removes a saved palette.
 * The Send button adds chosen jars; it never clears a shop cart or checks out.
 * Constraints: images remain local. Thickness is an estimated photo reference.
 * The matching engine compares hue, saturation, and lightness independently.
 */
import {rgbToLab, rgbToHex} from './lib/color.js';
import {extractPalette, matchCatalog, sampleThickness as measureSampleThickness} from './lib/palette.js';
import * as bridge from './lib/extension.js';
import {listPalettes, savePalette, loadPalette, deletePalette} from './lib/saved-palettes.js';
import {availableVariant, emptySelection, restoreSelection, reconcileSelection, setItemSelected, changeSelectedVariant} from './lib/selection.js';
import {initializeCartLibrary} from './lib/cart-library.js';
import {productPhotoSpec} from './lib/cart-photos.js';
import {productWithFormSamples, samplesForPhoto, nearestPhotoSample} from './lib/form-samples.js';
import {containedImageBounds, imagePointFromClient} from './lib/photo-geometry.js';
import {preservedPhotoGuideMatches} from './lib/photo-guide-workspace.js';
import {normalizeCartItems} from './lib/saved-carts.js';
import {FORM_OPTIONS, normalizeForm, productForForm, defaultFormatVariant} from './lib/product-formats.js';
import {cartSizeLabel, switchedCartVariant} from './lib/cart-options.js';
import {itemForm, normalizeItemForms} from './lib/item-forms.js';
import {loadSettings, normalizeSettings, DEFAULT_SETTINGS} from './lib/settings.js';
import {includedGlass} from './lib/material-filters.js';
import {preferredAutomaticMatch} from './lib/match-preference.js';
import {initializeSettingsDialog} from './lib/settings-dialog.js';
import {createPersonalDataBackup, normalizePersonalDataBackup, restorePersonalDataBackup} from './lib/personal-data.js';
import {initPersonalDataSession, runPersonalDataRestore} from './lib/personal-data-session.js';

const $ = id => document.getElementById(id);
const MAX_TARGETS = 20;
const state = {
  products: [], baseProducts: [], formatIndex: null, format:'medium', preferredJarSize:'5lb',
  sourceDataUrl: '', sourceName: '', sourceUrl: '', sourceThumbnail: '', imageData: null,
  paletteCount: 6, targets: [], activeTargetId: null,
  glassTypes: {transparent: true, opalescent: true}, includeTints:false, imageSize: 'larger',
  view: 'palette', query: '', selectedForms: {}, selectedVariants: {}, quantities: {}, chosenMatches: {}, cart: [], selection: emptySelection(),
  lastPendingImageAt: 0, savedPaletteId: null, savedPaletteName: '',
  account: {signedIn: null, status: 'checking'}, sending: false, clearing: false,
  sentCartFingerprint: '', cartUnconfirmed: '',
};
const sourceCanvas = $('source-canvas');
const sourceContext = sourceCanvas.getContext('2d', {willReadFrequently: true});
const freshProducts = new Map();
const matchCache = new Map();
let detailProduct = null, detailSample = null, detailTargetId = null, pendingAccessUrl = '';
let saveTimer, toastTimer, saveWarningShown = false;
let imageLoadId = 0, cancellingImageId = 0, manualTargetId = 0;
let captureBase = null, captureSelection = null, captureStart = null;
let emptyAction = null, pendingReceivedThisSession = false;
let draggingPoint = null, pointRenderFrame = 0, accountCheck = null, lastAccountCheck = 0;
let cartLibrary = null, sendingFingerprint = '', alternativesTargetId = null;
let alternativesFilters = {glassTypes:{transparent:true,opalescent:true},includeTints:false};
let clearCartProducts = [], cartPhotoIndex = {}, formSampleIndex = {};
let savedSettingsFingerprint = '', settingsSaving = false, settingsDialog = null;
let workspaceReady = false, personalDataBusy = false;
const isCartPage = new URLSearchParams(location.search).get('cart') === '1';
document.body.classList.toggle('cart-page',isCartPage);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notify(message, error = false, duration = 5000) {
  const toast = $('status-message'); clearTimeout(toastTimer);
  toast.textContent = message; toast.classList.toggle('is-error', error); toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function money(cents) { return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format((Number(cents) || 0) / 100); }
function colorHex(rgb) { return rgbToHex(rgb).toUpperCase(); }
function activeTarget() { return state.targets.find(target => target.id === state.activeTargetId) || null; }
function targetNumber(target) { return state.targets.findIndex(entry => entry.id === target?.id) + 1; }
function sampleThickness(sample, product) { if(!sample)return null;const value = measureSampleThickness(sample, product); return Number.isFinite(value) ? Math.round(value) : null; }
function sampleLabel(product, sample) { const thickness = sampleThickness(sample, product); return thickness === null ? `${product.name} · Thickness unavailable` : `${product.name} at ${thickness}% thickness`; }
function variantKey(product, variant) { return `${product.id}:${String(variant.id || variant.sku)}`; }
function getProduct(id) { return state.products.find(product => product.id === id) || clearCartProducts.find(product=>product.id===id); }
function getVariant(product, id) { return product?.variants?.find(variant => String(variant.id) === String(id)) || product?.allVariants?.find(variant => String(variant.id) === String(id)); }
function currentVariant(product) {
  return defaultFormatVariant(product,product.form || state.format,state.selectedVariants[product.id],state.preferredJarSize)
    || product.variants?.find(variant=>String(variant.id)===String(state.selectedVariants[product.id])) || product.variants?.[0] || null;
}
function purchaseCode(product, variant = currentVariant(product)) { return variant?.sku?.split('-').slice(0,3).join('-') || product.code; }
function cartUnits(items) { return items.some(item=>item.form==='sheets')?'items':'jars'; }
function selectedItem(product, variant) { return variant && state.cart.find(item => variantKey(product, variant) === item.key); }
function cartFingerprint(items = state.cart) { return JSON.stringify(items.map(item => [String(item.variantId), item.quantity]).sort((a,b) => a[0].localeCompare(b[0]))); }
function cartSendState(items) {
  const fingerprint = cartFingerprint(items);
  return {busy:state.sending || state.clearing, sending:state.sending && sendingFingerprint === fingerprint,
    sent:Boolean(items.length && state.sentCartFingerprint === fingerprint),
    uncertain:Boolean(items.length && state.cartUnconfirmed === fingerprint)};
}
function currentSettings() { return normalizeSettings({format:state.format,preferredJarSize:state.preferredJarSize,glassTypes:state.glassTypes,includeTints:state.includeTints,showFullPalette:state.view!=='alternatives',paletteCount:state.paletteCount,imageSize:state.imageSize}); }
function renderSettings() {
  for (const option of FORM_OPTIONS) {
    const button=$(`form-${option.id}`);button.setAttribute('aria-pressed',String(state.format===option.id));button.disabled=!state.products.length;
  }
  $('preferred-jar-size').value=state.preferredJarSize;
  $('preferred-jar-size').disabled=!state.products.length||state.format==='sheets';
  $('save-settings').disabled=!state.products.length||settingsSaving;
  $('save-settings').textContent=settingsSaving?'Saving…':'Save settings';
  const unchanged=savedSettingsFingerprint===JSON.stringify(currentSettings());
  $('settings-status').textContent=savedSettingsFingerprint?(unchanged?'Settings saved':'Settings changed'):'';
}
function productForCurrentForm(product, fallback=state.format, selectedForms=state.selectedForms) {
  const form=itemForm(product,selectedForms,fallback);
  return productWithFormSamples(productForForm(product,state.formatIndex,form),form,formSampleIndex);
}
function rebuildProducts() {
  state.products=state.baseProducts.map(product=>productForCurrentForm(product));
  matchCache.clear();
}
function changePurchaseOptions(form, preferredJarSize=state.preferredJarSize, forceSize=false) {
  if(state.sending){notify('Wait for the current cart addition to finish.');return;}
  const nextForm=normalizeForm(form),products=state.baseProducts.map(product=>productForCurrentForm(product,nextForm));
  const selectedVariants={...state.selectedVariants};
  if(forceSize)for(const product of products)if(!state.selectedForms[product.id])delete selectedVariants[product.id];
  const items=[],skipped=[];let selection=state.selection;
  try {
    for(const item of state.cart){
      const product=products.find(product=>product.id===item.productId);
      const variant=defaultFormatVariant(product,product?.form || nextForm,selectedVariants[product?.id],preferredJarSize);
      if(!variant){skipped.push(item.name);selection={...selection,manualKeys:selection.manualKeys.filter(key=>key!==item.key)};continue;}
      const updated=makeCartItem(product,variant,item.quantity);items.push(updated);
      selection=changeSelectedVariant(selection,item.key,updated.key);selectedVariants[product.id]=String(variant.id);
    }
    const cart=normalizeCartItems(items);
    state.format=nextForm;state.preferredJarSize=preferredJarSize;state.products=products;
    state.selectedVariants=selectedVariants;state.selection=selection;state.cart=cart;matchCache.clear();
    for(const item of cart)state.quantities[item.key]=item.quantity;
    if(detailProduct){detailProduct=products.find(p=>p.id===detailProduct.id)||null;if(detailProduct)renderDetailSample();else $('detail-dialog').close();}
    reconcilePaletteSelection();renderAll();cartLibrary?.optionsChanged();persist();
    if(skipped.length)notify(`No available ${FORM_OPTIONS.find(option=>option.id===nextForm).grain.toLowerCase()} size for ${[...new Set(skipped)].join(', ')}. Those sizes are not selected.`,false,7500);
  } catch(error){notify(error.message||'The purchase options could not change.',true);}
}
function changeProductForm(productId, form) {
  if(state.sending){notify('Wait for the current cart addition to finish.');return;}
  const base=state.baseProducts.find(product=>product.id===productId),current=getProduct(productId);
  if(!base || !current)return;
  const selectedForms={...state.selectedForms,[productId]:normalizeForm(form)};
  const product=productForCurrentForm(base,state.format,selectedForms),previous=currentVariant(current);
  const variant=switchedCartVariant(product,product.form,previous,state.preferredJarSize);
  if(!variant){notify(`No available ${FORM_OPTIONS.find(option=>option.id===product.form).label.toLowerCase()} package for ${product.name}.`);return;}
  const old=selectedItem(current,previous),quantity=old?.quantity || state.quantities[variantKey(current,previous || {})] || 1;
  // Retain all visible color choices while this one product's sample range changes.
  // Full-color matching still finds its closest sample within the newly selected form.
  for(const target of state.targets)if(!Object.hasOwn(state.chosenMatches,target.id)){const match=primaryMatch(target);if(match)state.chosenMatches[target.id]=match.product.id;}
  state.selectedForms=selectedForms;state.selectedVariants[productId]=String(variant.id);
  state.products=state.products.map(entry=>entry.id===productId?product:entry);matchCache.clear();
  state.quantities[variantKey(product,variant)]=quantity;
  if(old){
    const updated=makeCartItem(product,variant,quantity),existing=state.cart.find(item=>item.key===updated.key && item.key!==old.key);
    if(existing){existing.quantity=clamp(existing.quantity+quantity,1,999);state.cart=state.cart.filter(item=>item.key!==old.key);state.quantities[updated.key]=existing.quantity;}
    else state.cart=state.cart.map(item=>item.key===old.key?updated:item);
    state.selection=changeSelectedVariant(state.selection,old.key,updated.key);
  }
  if(detailProduct?.id===productId){
    const target=state.targets.find(entry=>entry.id===detailTargetId) || detailSample;
    detailProduct=product;detailSample=target?matchCatalog(target,[product],{includeOtherFamilies:true})[0]?.sample || null:product.samples?.[0] || null;
    renderDetailSample();
  }
  reconcilePaletteSelection();renderResults();persist();
}
function saveCurrentSettings() { settingsDialog.open(true); }
function applyWorkingSettings(value) {
  if(state.sending)throw new Error('Wait for the current cart addition to finish.');
  const settings=normalizeSettings(value);
  state.glassTypes={...settings.glassTypes};state.includeTints=settings.includeTints;
  state.paletteCount=settings.paletteCount;state.imageSize=settings.imageSize;
  state.query='';$('glass-search').value='';
  state.view=settings.showFullPalette || !activeTarget()?'palette':'alternatives';
  changePurchaseOptions(settings.format,settings.preferredJarSize,true);
  renderAll();persist();
}
function refreshWorkingSettings() {
  try{applyWorkingSettings(DEFAULT_SETTINGS);notify('Settings reset. Your photo, colors and dot positions were kept.');}
  catch(error){notify(error.message,true);}
}
function remixPalette() {
  if(!state.imageData || state.sending)return;
  const seed=crypto.getRandomValues(new Uint32Array(1))[0];
  state.targets=[];state.activeTargetId=null;state.chosenMatches={};state.view='palette';
  state.savedPaletteId=null;state.savedPaletteName='';
  extractStartingColors(false,seed);notify('Remixed a new palette from the same image.');
}
function workspaceSnapshot() {
  return {
    version:6, photoGuideVersion:1, includeTints:state.includeTints, format:state.format, preferredJarSize:state.preferredJarSize,
    sourceDataUrl:state.sourceDataUrl, sourceName:state.sourceName, sourceUrl:state.sourceUrl,
    thumbnailDataUrl:state.sourceThumbnail, glassTypes:state.glassTypes, imageSize:state.imageSize, imageLayout:'auto',
    paletteCount:state.paletteCount, targets:state.targets, activeTargetId:state.activeTargetId,
    view:state.view, selectedForms:state.selectedForms, selectedVariants:state.selectedVariants,
    quantities:state.quantities, chosenMatches:state.chosenMatches, cart:state.cart, selection:state.selection,
    lastPendingImageAt:state.lastPendingImageAt, savedPaletteId:state.savedPaletteId,
    savedPaletteName:state.savedPaletteName, sentCartFingerprint:state.sentCartFingerprint,
    cartUnconfirmed:state.cartUnconfirmed,
  };
}
function persist() { renderSettings(); if(isCartPage || !workspaceReady || personalDataBusy)return; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 250); }
async function flushSave({propagate=false}={}) {
  if (!saveTimer || !workspaceReady || personalDataBusy) return; clearTimeout(saveTimer); saveTimer = undefined;
  try { await bridge.saveState(workspaceSnapshot()); }
  catch (error) {
    console.warn('Could not save palette workspace:', error);
    if (!saveWarningShown) { notify('This browser could not save the current workspace. Try Save palette.', true); saveWarningShown = true; }
    if(propagate)throw error;
  }
}
function normalizeTarget(target, index = 0) {
  if (!Array.isArray(target?.rgb) || target.rgb.length !== 3) return null;
  const rgb = target.rgb.map(value => clamp(Math.round(Number(value) || 0), 0, 255));
  const point = Number.isFinite(target.x) && Number.isFinite(target.y) ? {x:clamp(target.x,0,1), y:clamp(target.y,0,1)} : {};
  return {id:String(target.id || `color-${index}`), rgb, hex:colorHex(rgb), lab:rgbToLab(rgb), weight:Number(target.weight)||0, manual:Boolean(target.manual), custom:Boolean(target.custom), ...point};
}
function restoreWorkspace(saved) {
  if (!saved || typeof saved !== 'object') return;
  state.includeTints = saved.includeTints === true;
  state.format = normalizeForm(saved.format || 'medium');
  state.selectedForms = normalizeItemForms(saved.selectedForms,state.baseProducts);
  if (['5lb','1lb','5oz'].includes(saved.preferredJarSize)) state.preferredJarSize=saved.preferredJarSize;
  rebuildProducts();
  state.paletteCount = clamp(Math.round(Number(saved.paletteCount) || 6), 2, 12);
  state.glassTypes = {
    transparent: saved.glassTypes?.transparent !== false,
    opalescent: saved.glassTypes?.opalescent !== false,
  };
  state.imageSize = ['fit','larger','full'].includes(saved.imageSize) ? saved.imageSize : 'larger';
  state.sourceThumbnail = typeof saved.thumbnailDataUrl === 'string' ? saved.thumbnailDataUrl : '';
  state.selectedVariants = saved.selectedVariants && typeof saved.selectedVariants === 'object' ? saved.selectedVariants : {};
  state.quantities = saved.quantities && typeof saved.quantities === 'object' ? saved.quantities : {};
  state.targets = Array.isArray(saved.targets) ? saved.targets.map(normalizeTarget).filter(Boolean).slice(0,MAX_TARGETS) : [];
  state.chosenMatches = preservedPhotoGuideMatches(saved,state.targets,state.baseProducts);
  state.activeTargetId = saved.activeTargetId;
  if (!activeTarget()) state.activeTargetId = state.targets[0]?.id || null;
  state.view = ['library','alternatives'].includes(saved.view) ? saved.view : 'palette';
  state.lastPendingImageAt = Math.max(state.lastPendingImageAt, Number(saved.lastPendingImageAt) || 0);
  state.savedPaletteId = saved.savedPaletteId || null; state.savedPaletteName = saved.savedPaletteName || '';
  // The worker's durable request journal guards uncertain operations across reloads.
  // A previous successful send must never lock this cart out of a new explicit send.
  state.sentCartFingerprint = ''; state.cartUnconfirmed = '';
  state.cart = [];
  for (const previous of Array.isArray(saved.cart) ? saved.cart : []) {
    const product = getProduct(previous.productId), variant = getVariant(product, previous.variantId);
    if (!product || !variant) continue;
    if (!state.selectedVariants[product.id]) state.selectedVariants[product.id] = String(variant.id);
    const item = makeCartItem(product, variant, previous.quantity), existing = state.cart.find(entry => entry.key === item.key);
    if (existing) existing.quantity = clamp(existing.quantity + item.quantity,1,999); else state.cart.push(item);
  }
  state.selection = restoreSelection(saved.selection, selectionSuggestions(), state.cart);
  reconcilePaletteSelection();
}

function renderPalette() {
  $('palette-panel').hidden = false;
  $('target-count').textContent = state.targets.length;
  $('palette-count').value = state.paletteCount; $('palette-count').disabled = !state.imageData;
  $('palette-fewer').disabled = !state.imageData || state.paletteCount <= 2;
  $('palette-more').disabled = !state.imageData || state.paletteCount >= 12;
  const chips = $('palette-chips'); chips.replaceChildren();
  for (const [index,target] of state.targets.entries()) {
    const button = element('button', `palette-chip${target.id === state.activeTargetId ? ' is-active' : ''}`);
    button.type = 'button'; button.dataset.targetId = target.id;
    button.setAttribute('aria-label', `Select palette color ${index+1}, ${target.hex}`);
    button.setAttribute('aria-pressed', String(target.id === state.activeTargetId));
    const color = element('span','palette-chip-color',index+1); color.style.backgroundColor = target.hex;
    button.append(color);
    button.addEventListener('click', () => selectTarget(target.id)); chips.append(button);
    button.title = `Color ${index+1}: ${target.hex}. Select, then Edit color for details.`;
  }
  const target = activeTarget(); $('target-editor').hidden = !target; $('show-alternatives').hidden = !target;
  if (target) {
    $('editing-target').textContent = `Color ${targetNumber(target)}${target.custom ? ' · edited' : ''}`;
    $('target-color').value = target.hex.toLowerCase();
    if (document.activeElement !== $('target-hex')) $('target-hex').value = target.hex;
    $('target-hex').removeAttribute('aria-invalid');
    $('show-alternatives').textContent = 'Alternatives';
    $('show-alternatives').title = `Alternatives for color ${targetNumber(target)}`;
  }
  $('open-color-editor').disabled = !target;
  $('add-custom-color').disabled = state.targets.length >= MAX_TARGETS;
  $('save-palette').disabled = !state.targets.length;
  $('remix-palette').disabled = !state.imageData || state.sending;
  renderPoints();
}

function renderImageLayout() {
  const main = document.querySelector('.app-main');
  const ratio = state.imageData ? sourceCanvas.width/sourceCanvas.height : 1;
  const beside = Boolean(state.imageData && ratio <= 1.12);
  main.classList.toggle('has-portrait',beside);
  main.classList.toggle('image-beside',beside);
  main.classList.toggle('image-landscape',Boolean(state.imageData && !beside));
  main.classList.toggle('has-image',Boolean(state.imageData));
  main.dataset.imageSize = state.imageSize;
  main.dataset.view = state.view;
  for (const size of ['fit','larger','full']) $(`image-${size}`).setAttribute('aria-pressed',String(state.imageSize===size));
  const grid=$('product-grid');
  const count=grid.children.length || 1,maximum=Math.max(1,Math.floor((grid.clientWidth+6)/126));
  const columns=Math.ceil(count/Math.ceil(count/maximum));
  main.style.setProperty('--match-columns',String(columns));
  if (!state.imageData || $('image-loaded').hidden) return;
  const stage=$('image-stage');
  // Actual usable space, not a desktop-only 900px breakpoint or a 360px photo cap.
  const availableWidth=Math.max(1,stage.clientWidth);
  const top=document.querySelector('.app-header').offsetHeight+$('palette-panel').offsetHeight+12;
  const remaining=Math.max(240,window.innerHeight-top);
  const horizontalRail=beside?0:document.querySelector('.workspace-results').getBoundingClientRect().height+8;
  const fitHeight=Math.max(140,remaining-horizontalRail);
  // Larger portraits use the entire source column rather than leaving a wide gutter.
  const limit=beside && state.imageSize!=='fit'?Infinity:state.imageSize==='full'?Infinity:fitHeight;
  const scale=Math.min(availableWidth/sourceCanvas.width,limit/sourceCanvas.height);
  const width=sourceCanvas.width*scale,height=sourceCanvas.height*scale;
  const wrap=sourceCanvas.parentElement;
  wrap.style.width=`${width}px`;wrap.style.height=`${height}px`;
  stage.style.height=`${height}px`;
  main.style.setProperty('--source-height',`${height}px`);
}

function setImageSize(size) {
  state.imageSize = size; renderImageLayout(); persist();
}

function imageThumbnail() {
  if (!state.imageData) return '';
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 160 / Math.max(sourceCanvas.width, sourceCanvas.height));
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  canvas.getContext('2d').drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function renderPoints() {
  const layer = $('image-points');
  const positioned = state.imageData ? state.targets.filter(target => Number.isFinite(target.x) && Number.isFinite(target.y)) : [];
  for (const node of [...layer.children]) if (!positioned.some(target => target.id === node.dataset.targetId)) node.remove();
  for (const target of positioned) {
    let button = [...layer.children].find(node => node.dataset.targetId === target.id);
    if (!button) {
      button = element('button','source-point'); button.type = 'button'; button.dataset.targetId = target.id;
      button.addEventListener('pointerdown', startPointDrag);
      button.addEventListener('pointermove', movePointDrag);
      button.addEventListener('pointerup', finishPointDrag);
      button.addEventListener('pointercancel', finishPointDrag);
      button.addEventListener('click', event => { event.stopPropagation(); selectTarget(target.id); });
      button.addEventListener('keydown', event => nudgePoint(event,target.id));
      layer.append(button);
    }
    button.style.left = `${target.x*100}%`; button.style.top = `${target.y*100}%`; button.style.backgroundColor = target.hex;
    button.textContent = targetNumber(target); button.classList.toggle('is-active',target.id === state.activeTargetId);
    button.setAttribute('aria-label', `Move color ${targetNumber(target)}, ${target.hex}${target.custom ? ', edited color' : ''}`);
    button.title = `Color ${targetNumber(target)} · ${target.hex}${target.custom ? ' · edited; drag to sample the image' : ' · drag to resample'}`;
  }
}
function pointerPoint(event, clampOutside = false) {
  const bounds = sourceCanvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const x = (event.clientX-bounds.left)/bounds.width, y = (event.clientY-bounds.top)/bounds.height;
  if (!clampOutside && (x<0 || y<0 || x>1 || y>1)) return null;
  return {x:clamp(x,0,1),y:clamp(y,0,1)};
}
function sampleImagePoint(point) {
  if (!state.imageData || !point) return null;
  const x = clamp(Math.floor(point.x*sourceCanvas.width),0,sourceCanvas.width-1), y = clamp(Math.floor(point.y*sourceCanvas.height),0,sourceCanvas.height-1);
  const rgb = [0,0,0]; let weight = 0;
  for (let py=Math.max(0,y-1);py<=Math.min(sourceCanvas.height-1,y+1);py++) {
    for (let px=Math.max(0,x-1);px<=Math.min(sourceCanvas.width-1,x+1);px++) {
      const offset = (py*sourceCanvas.width+px)*4, alpha = state.imageData.data[offset+3]/255;
      for (let channel=0;channel<3;channel++) rgb[channel] += state.imageData.data[offset+channel]*alpha;
      weight += alpha;
    }
  }
  return weight ? rgb.map(channel => Math.round(channel/weight)) : null;
}
function setPointColor(target, point) {
  const rgb = sampleImagePoint(point); if (!rgb) return false;
  Object.assign(target,{...point,rgb,hex:colorHex(rgb),lab:rgbToLab(rgb),manual:true,custom:false,weight:0});
  delete state.chosenMatches[target.id]; return true;
}
function startPointDrag(event) {
  if (event.button !== 0 || !state.imageData) return;
  event.preventDefault(); event.stopPropagation();
  const button = event.currentTarget; selectTarget(button.dataset.targetId);
  draggingPoint = {id:button.dataset.targetId, pointerId:event.pointerId, moved:false, startX:event.clientX,startY:event.clientY};
  button.classList.add('is-dragging'); button.setPointerCapture(event.pointerId);
}
function movePointDrag(event) {
  if (!draggingPoint || event.pointerId !== draggingPoint.pointerId) return;
  if (!draggingPoint.moved && Math.hypot(event.clientX-draggingPoint.startX,event.clientY-draggingPoint.startY)<2) return;
  draggingPoint.moved = true;
  const target = state.targets.find(entry => entry.id === draggingPoint.id);
  if (!target || !setPointColor(target,pointerPoint(event,true))) return;
  renderPoints();
  if (!pointRenderFrame) pointRenderFrame = requestAnimationFrame(() => { pointRenderFrame=0; reconcilePaletteSelection(); renderPalette(); renderResults(); });
}
function finishPointDrag(event) {
  if (!draggingPoint || event.pointerId !== draggingPoint.pointerId) return;
  event.currentTarget.classList.remove('is-dragging');
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  draggingPoint = null; reconcilePaletteSelection(); renderPalette(); renderResults(); persist();
}
function nudgePoint(event,id) {
  const target = state.targets.find(entry=>entry.id===id);
  if (!target || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Backspace'].includes(event.key)) return;
  event.preventDefault(); state.activeTargetId = id;
  if (['Delete','Backspace'].includes(event.key)) { removeTarget(id); return; }
  const step = (event.shiftKey ? 10 : 1), point = {x:target.x,y:target.y};
  if (event.key==='ArrowLeft') point.x -= step/sourceCanvas.width;
  if (event.key==='ArrowRight') point.x += step/sourceCanvas.width;
  if (event.key==='ArrowUp') point.y -= step/sourceCanvas.height;
  if (event.key==='ArrowDown') point.y += step/sourceCanvas.height;
  point.x=clamp(point.x,0,1);point.y=clamp(point.y,0,1);
  if (setPointColor(target,point)) {reconcilePaletteSelection();renderPalette();renderResults();persist();}
}
function nearestSourcePoint(rgb) {
  if (!state.imageData) return null;
  const {data,width,height}=state.imageData; let distance=Infinity,best=-1;
  const step=Math.max(1,Math.floor(width*height/100000));
  for (let pixel=0;pixel<width*height;pixel+=step) {
    const offset=pixel*4; if (data[offset+3]<200) continue;
    const difference=(data[offset]-rgb[0])**2+(data[offset+1]-rgb[1])**2+(data[offset+2]-rgb[2])**2;
    if (difference<distance) {distance=difference;best=pixel;if (!difference)break;}
  }
  return best<0 ? null : {x:((best%width)+.5)/width,y:(Math.floor(best/width)+.5)/height};
}

function includedProducts(filters = state) { return state.products.filter(product=>includedGlass(product,filters)); }
function matchesFor(target, alternatives = false, filters = state) {
  if (!target) return [];
  const key = `${target.hex}:${filters.glassTypes.transparent}:${filters.glassTypes.opalescent}:${filters.includeTints}:${alternatives}`;
  if (!matchCache.has(key)) {
    if (matchCache.size >= 128) matchCache.delete(matchCache.keys().next().value);
    const products = includedProducts(filters);
    matchCache.set(key, matchCatalog(target, products, {tolerance:Infinity, limit:products.length, includeOtherFamilies:alternatives}));
  }
  return matchCache.get(key);
}
function primaryMatch(target) {
  const matches=matchesFor(target), chosen=state.chosenMatches[target.id];
  // A deliberate per-color choice may use a different material from the main
  // automatic-match filters. Keep that choice without changing those filters.
  return (chosen ? matchesFor(target,true,{glassTypes:{transparent:true,opalescent:true},includeTints:true}).find(entry=>entry.product.id===chosen) : null)
    || preferredAutomaticMatch(matches,entry=>Boolean(currentVariant(entry.product)?.available),target);
}
function selectionSuggestions() {
  return state.targets.map(target => {
    const product=primaryMatch(target)?.product, variant=product&&currentVariant(product);
    return {targetId:target.id, item:variant?makeCartItem(product,variant,state.quantities[variantKey(product,variant)]||1):null};
  });
}
function reconcilePaletteSelection() {
  const result=reconcileSelection(state.selection,selectionSuggestions(),state.cart,{freeze:!state.glassTypes.transparent&&!state.glassTypes.opalescent});
  state.selection=result.selection;state.cart=result.cart;
  renderCart();if(detailProduct)renderDetailPurchase();
}
function renderResults() {
  const focusedKey=document.activeElement?.dataset?.focusKey;
  const openedPurchase=document.querySelector('.purchase-popover:popover-open')?.dataset.purchaseKey;
  for (const view of ['palette','library']) {
    const active=state.view===view || (view==='palette' && state.view==='alternatives');
    $(`${view}-tab`).classList.toggle('is-active',active); $(`${view}-tab`).setAttribute('aria-selected',String(active));
    $(`${view}-tab`).tabIndex=active?0:-1;
  }
  $('glass-results').setAttribute('aria-labelledby',state.view==='library'?'library-tab':'palette-tab');
  $('show-full-palette').checked=state.view==='palette';
  $('show-full-palette').disabled=!state.targets.length;
  $('show-full-palette').closest('label').hidden=!state.targets.length;
  for (const type of ['transparent','opalescent']) {
    $(`include-${type}`).classList.toggle('is-active',state.glassTypes[type]);
    $(`include-${type}`).setAttribute('aria-pressed',String(state.glassTypes[type]));
  }
  $('include-tints').setAttribute('aria-pressed',String(state.includeTints));
  const products=includedProducts();
  $('library-count').textContent=String(products.length);
  $('catalog-scope').textContent=`${products.length} colors · ${FORM_OPTIONS.find(option=>option.id===state.format).grain}`;
  $('results-title').textContent=state.view==='library'?'All Bullseye colors':'Bullseye colors for your palette';
  $('alternatives-heading').hidden=state.view!=='alternatives';
  const target=activeTarget();
  if (state.view==='alternatives') $('alternatives-label').textContent=`Color ${targetNumber(target)} · ${target?.hex || ''}`;
  let entries;
  if (state.view==='library') entries=products.map(product=>({product,sample:null}));
  else if (state.view==='alternatives') entries=target?[{...primaryMatch(target),target}]:[];
  else entries=state.targets.map(target=>({...primaryMatch(target),target}));
  if (!state.glassTypes.transparent && !state.glassTypes.opalescent) entries=[];
  const query=state.query.trim().toLowerCase();
  if (query) entries=entries.filter(entry=>entry.product && `${entry.product.name} ${entry.product.code} ${entry.product.id}`.toLowerCase().includes(query));
  const list=$('product-grid');list.replaceChildren(); $('glass-results').hidden=!entries.length;$('empty-state').hidden=!!entries.length;
  $('empty-action').hidden=true;emptyAction=null;
  if (!entries.length) {
    if (!state.glassTypes.transparent && !state.glassTypes.opalescent) setEmpty('Choose a glass type.','Turn on Transparent, Opalescent, or both above. Your selected jars are kept.','',null);
    else if (query) setEmpty('No glass by that name.','Search by a color name or Bullseye code.','Clear search',()=>{state.query='';$('glass-search').value='';renderResults();});
    else if (!state.targets.length && state.view!=='library') setEmpty('Add an image or a color.','Your Bullseye matches will appear here.','Choose image',()=>$('image-file').click());
    else if (state.view==='alternatives') setEmpty('No glass in the included types for this color.','Try including the other glass type.','Show full palette',()=>setView('palette'));
    else setEmpty('The glass catalog could not load.','Reload the picker.','Reload',()=>location.reload());
  }
  for (const entry of entries) list.append(entry.product?renderProduct(entry):renderNoMatch(entry.target));
  if($('alternatives-dialog').open)renderAlternatives();
  if(openedPurchase)for(const panel of document.querySelectorAll('.purchase-popover'))if(panel.dataset.purchaseKey===openedPurchase)showPurchasePopover(panel,panel.parentElement.querySelector('button'));
  renderImageLayout();
  if (focusedKey) for (const node of document.querySelectorAll('[data-focus-key]')) if (node.dataset.focusKey===focusedKey) {node.focus({preventScroll:true});break;}
}
function setEmpty(title,copy,actionText,action) {$('empty-title').textContent=title;$('empty-copy').textContent=copy;$('empty-action').textContent=actionText;$('empty-action').hidden=!action;emptyAction=action;}
function photoElement(product,sample,eager=true,variant=currentVariant(product)) {
  const spec=productPhotoSpec(product,variant,cartPhotoIndex);
  const wrapper=element('div','glass-photo'),img=element('img');
  // The photo, samples, and marker share one immutable form record. Load callbacks
  // own only this image node, so detached older requests cannot change a new form.
  wrapper.dataset.photoForm=spec.form;wrapper.dataset.photoHandle=spec.handle || '';
  wrapper.dataset.photoKind=spec.kind;
  img.alt=spec.kind==='reference'?spec.note:spec.label;img.title=img.alt;
  img.loading=eager?'eager':'lazy';img.width=600;img.height=600;img.decoding='async';img.referrerPolicy='no-referrer';
  const samples=samplesForPhoto(product,spec.images[0]),guide=samples.length?product.photoGuide:null;
  let plane=null;
  if(guide){
    plane=element('div','photo-sample-plane');plane.hidden=true;
    plane.dataset.imageUrl=guide.imageUrl;
    if(sample && (samples.includes(sample) || guide.inspectionSamples?.includes(sample))){
      const marker=element('span','sample-marker');
      marker.style.left=`${sample.x*100}%`;marker.style.top=`${sample.y*100}%`;
      marker.dataset.sampleId=sample.id || '';marker.dataset.x=sample.x;marker.dataset.y=sample.y;marker.dataset.hex=sample.hex || colorHex(sample.rgb);
      marker.setAttribute('aria-hidden','true');plane.append(marker);
    }
    img.addEventListener('load',()=>{
      const bounds=containedImageBounds(img.naturalWidth,img.naturalHeight);
      if(!bounds)return;
      for(const key of ['left','top','width','height'])plane.style[key]=`${bounds[key]*100}%`;
      plane.hidden=false;
    });
    img.addEventListener('error',()=>{plane.hidden=true;});
  }
  if(spec.kind!=='reference' && spec.images[0])img.src=spec.images[0];
  wrapper.append(img);if(plane)wrapper.append(plane);return wrapper;
}
function renderNoMatch(target) {
  const row=element('article','product-card no-match-card');row.dataset.targetId=target.id;
  const swatch=element('span','no-match-swatch',targetNumber(target));swatch.style.backgroundColor=target.hex;
  const body=element('div');body.append(element('h3','product-name',`Color ${targetNumber(target)} · ${target.hex}`),element('p','','No matching glass in the included types.'));
  const edit=element('button','row-alternatives','Edit color');edit.type='button';edit.addEventListener('click',()=>{selectTarget(target.id);$('color-editor-dialog').showModal();$('target-hex').focus();});body.append(edit);row.append(swatch,body);return row;
}
function purchaseGrade(product,variant=currentVariant(product)) {
  return FORM_OPTIONS.find(option=>option.id===(variant?.form || product.form))?.grain || product.grain || 'Medium frit';
}
function purchaseSummary(product) {
  const variant=currentVariant(product),item=variant&&selectedItem(product,variant);
  const size=variant?.title?.replace(/ jar$/i,'') || 'Unavailable';
  return `${purchaseGrade(product,variant)} · ${size} · ${item?.quantity || state.quantities[variantKey(product,variant || {})] || 1}`;
}
function showPurchasePopover(panel,button) {
  if(!panel.matches(':popover-open'))panel.showPopover();
  const rect=button.getBoundingClientRect(),bounds=panel.getBoundingClientRect();
  panel.style.left=`${Math.max(6,Math.min(rect.left,innerWidth-bounds.width-6))}px`;
  panel.style.top=`${Math.max(6,Math.min(rect.bottom+3,innerHeight-bounds.height-6))}px`;
}
function compactPurchase(product,targetId,scope='row') {
  const wrap=element('div','compact-purchase'),button=element('button','purchase-toggle',purchaseSummary(product));
  button.type='button';button.dataset.productId=product.id;
  button.setAttribute('aria-label',`Purchase options for ${product.name}`);button.setAttribute('aria-haspopup','dialog');
  const panel=element('div','purchase-popover');panel.popover='auto';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Purchase ${product.name}`);
  panel.dataset.purchaseKey=`${scope}:${targetId||'library'}:${product.id}`;
  const heading=element('div','dialog-heading');heading.append(element('strong','',product.name));
  const close=element('button','icon-button','×');close.type='button';close.setAttribute('aria-label','Close purchase options');close.addEventListener('click',()=>panel.hidePopover());heading.append(close);
  panel.append(heading,element('p','purchase-grade',purchaseGrade(product)),purchaseControls(product,false,targetId,scope));
  button.addEventListener('click',()=>{if(panel.matches(':popover-open'))panel.hidePopover();else showPurchasePopover(panel,button);});
  wrap.append(button,panel);return wrap;
}
function renderProduct(entry,alternative=false) {
  const {product,sample,target}=entry,variant=currentVariant(product);
  const row=element('article',`product-card compact-card${alternative?' alternative-card':''}${selectedItem(product,variant)?' is-selected':''}`);
  row.dataset.productId=product.id;if(target)row.dataset.targetId=target.id;
  const scope=alternative?'alternative':'row';
  const body=element('div','product-card-content'),heading=element('div','glass-name-row');
  heading.append(element('h3','product-name',product.name),selectionCheckbox(product,variant,`${scope}-${target?.id || ''}-${product.id}-selected`));
  body.append(heading);
  if(sample){
    const label=element('p','match-label'),swatch=element('span','small-swatch'),thickness=sampleThickness(sample,product);
    swatch.style.backgroundColor=sample.hex||colorHex(sample.rgb);
    label.append(swatch,element('span','',thickness===null?'Photo guide unavailable':`${thickness}% thickness`));
    label.title=`${target?`Color ${targetNumber(target)} · `:''}${product.photoGuide?`Sampled from this ${purchaseGrade(product).toLowerCase()} photograph on the shared color reference scale.`:'Estimate from the medium-frit color reference.'} Approximate photo guide, not measured depth.`;
    body.append(label);
  }else{
    const strip=element('div','sample-strip');
    for(const sample of product.samples||[]){const swatch=element('span');swatch.style.backgroundColor=sample.hex||colorHex(sample.rgb);strip.append(swatch);}body.append(strip);
  }
  const actions=element('div','compact-card-actions');actions.append(compactPurchase(product,target?.id,scope));
  if(target){
    const action=element('button','row-alternatives',alternative?'Use color':'Alternatives');action.type='button';
    action.addEventListener('click',()=>{if(alternative)chooseAlternative(target.id,product.id);else showAlternatives(target.id);});actions.append(action);
  }
  body.append(actions);
  const photo=element('button','photo-button');photo.type='button';photo.setAttribute('aria-label',`Inspect ${product.name} color photograph`);
  photo.append(photoElement(product,sample));photo.addEventListener('click',()=>openDetail(product,sample,target));
  if(target){const badge=element('span','glass-target-badge',targetNumber(target));badge.style.backgroundColor=target.hex;photo.append(badge);}
  // Text/purchase controls stay to the left; glass photograph meets the source image.
  row.append(body,photo);return row;
}

function variantSelect(product,chosen,onChange,focusKey) {
  const select=element('select','variant-select');select.setAttribute('aria-label',`${product.form==='sheets'?'Sheet size':'Jar size'} for ${product.name}`);if(focusKey)select.dataset.focusKey=focusKey;
  for(const variant of product.variants||[]){const option=element('option','',`${cartSizeLabel(variant)}${variant.available?'':' · unavailable'}`);option.value=String(variant.id);option.disabled=!variant.available;option.selected=String(variant.id)===String(chosen?.id);select.append(option);}
  if(!product.variants?.length)select.append(element('option','','Unavailable in this form'));select.disabled=!product.variants?.some(variant=>variant.available);
  select.addEventListener('change',()=>onChange(select.value));return select;
}
function selectionCheckbox(product,variant,focusKey) {
  const input=element('input','glass-checkbox'),selected=selectedItem(product,variant);
  input.type='checkbox';input.checked=Boolean(selected);input.dataset.focusKey=focusKey;
  input.setAttribute('aria-label',`${selected?'Remove':'Select'} ${product.name}, ${variant?.title || 'glass'}`);
  input.disabled=!selected && (!variant?.available || !variant?.sku);
  input.addEventListener('change',()=>toggleGlass(product,variant));
  return input;
}
function purchaseControls(product,inDetail=false,targetId='',scope='row') {
  const controls=element('div','product-purchase'),variant=currentVariant(product),selected=selectedItem(product,variant);
  const focusPrefix=`${inDetail?'detail':scope}-${targetId}-${product.id}`;
  const form=element('select','product-form-select');form.setAttribute('aria-label',`Form for ${product.name}`);form.dataset.focusKey=`${focusPrefix}-form`;
  for(const id of ['powder','fine','medium','coarse','sheets']){
    const label=FORM_OPTIONS.find(option=>option.id===id).label;
    const available=(product.allVariants || []).some(candidate=>candidate.form===id && candidate.available && candidate.id && candidate.sku);
    const option=element('option','',`${label}${available?'':' · unavailable'}`);option.value=id;option.selected=product.form===id;option.disabled=!available;form.append(option);
  }
  form.addEventListener('change',()=>changeProductForm(product.id,form.value));
  const select=variantSelect(product,variant,value=>{
    const old=selectedItem(product,currentVariant(product));
    const quantity=old?.quantity || state.quantities[variantKey(product,currentVariant(product) || {})] || 1;
    state.selectedVariants[product.id]=value;
    const next=getVariant(product,value);if(next)state.quantities[variantKey(product,next)]=quantity;
    if(old)changeCartVariant(old.key,value);else{reconcilePaletteSelection();renderResults();if(detailProduct?.id===product.id)renderDetailPurchase();persist();}
  },`${focusPrefix}-variant`);
  const quantity=element('input','quantity-field');quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.value=selected?.quantity||state.quantities[variantKey(product,variant||{})]||1;quantity.title='Quantity';quantity.dataset.quantityKey=variantKey(product,variant||{});quantity.dataset.focusKey=`${focusPrefix}-quantity`;quantity.setAttribute('aria-label',`Quantity of ${product.name}`);quantity.disabled=!variant?.available;
  quantity.addEventListener('change',()=>{const amount=clamp(Math.round(Number(quantity.value)||1),1,999);state.quantities[variantKey(product,variant||{})]=amount;if(selected)changeQuantity(selected.key,amount);else{syncQuantityControls(variantKey(product,variant||{}),amount);persist();}});
  const row=element('div','select-row');
  row.append(element('span','product-price',variant?money(variant.price):'View item'));
  if(inDetail)row.append(selectionCheckbox(product,variant,`${focusPrefix}-selected`));
  const field=(label,input,className='')=>{const wrap=element('label',`purchase-field ${className}`.trim());wrap.append(element('span','',label),input);return wrap;};
  controls.append(field('Form',form,'purchase-form-field'),field('Package size',select),field('Quantity',quantity),row);return controls;
}
function makeCartItem(product,variant,quantity=1) {return {key:variantKey(product,variant),productId:product.id,variantId:variant.id,form:variant.form||product.form||'medium',sku:variant.sku,name:product.name,image:product.image,title:variant.title,price:Number(variant.price)||0,available:Boolean(variant.available),quantity:clamp(Math.round(Number(quantity)||1),1,999)};}
function toggleGlass(product,variant) {
  if(!variant)return;const key=variantKey(product,variant),index=state.cart.findIndex(item=>item.key===key);
  if(index!==-1){removeCartItem(key);return;}
  if(!availableVariant({variants:[variant]}))return;
  state.cart.push(makeCartItem(product,variant,state.quantities[key]||1));
  state.selection=setItemSelected(state.selection,key,true);
  reconcilePaletteSelection();renderResults();persist();
}
function removeCartItem(key) {state.selection=setItemSelected(state.selection,key,false);state.cart=state.cart.filter(item=>item.key!==key);reconcilePaletteSelection();renderResults();persist();}
function syncQuantityControls(key, amount) {
  for (const input of document.querySelectorAll('[data-quantity-key]')) {
    if (input.dataset.quantityKey === key) input.value = amount;
  }
  const item = state.cart.find(entry => entry.key === key);
  if (item) for (const price of document.querySelectorAll('[data-cart-price-key]')) {
    if (price.dataset.cartPriceKey === key) price.textContent = money(item.price * item.quantity);
  }
}
function changeQuantity(key, quantity) {
  const item = state.cart.find(entry => entry.key === key); if (!item) return;
  item.quantity = clamp(Math.round(Number(quantity) || 1), 1, 999);
  state.quantities[key] = item.quantity;
  // Keep focused inputs and the next checkbox click intact while sharing jar quantities.
  syncQuantityControls(key, item.quantity); renderCartSummary(); persist();
}
function changeCartVariant(key,variantId) {
  const index=state.cart.findIndex(item=>item.key===key);if(index<0)return;const current=state.cart[index],product=getProduct(current.productId),variant=getVariant(product,variantId);if(!availableVariant({variants:[variant]}))return;
  const updated=makeCartItem(product,variant,current.quantity),existing=state.cart.find(item=>item.key===updated.key&&item.key!==key);
  if(existing){existing.quantity=clamp(existing.quantity+updated.quantity,1,999);state.cart.splice(index,1);}else state.cart[index]=updated;
  state.selection=changeSelectedVariant(state.selection,key,updated.key);
  state.selectedVariants[product.id]=variantId;state.quantities[updated.key]=existing?.quantity||updated.quantity;reconcilePaletteSelection();renderResults();persist();
}
function renderCartSummary() {
  const count=new Set(state.cart.map(item=>item.productId)).size,jars=state.cart.reduce((sum,item)=>sum+item.quantity,0),total=state.cart.reduce((sum,item)=>sum+item.quantity*item.price,0);
  $('selection-total').textContent=count?` · ${money(total)}`:'';$('cart-total').textContent=money(total);$('cart-empty').hidden=!!state.cart.length;$('cart-bottom').hidden=!state.cart.length;
  for(const button of document.querySelectorAll('.purchase-toggle')){const product=getProduct(button.dataset.productId);if(product)button.textContent=purchaseSummary(product);}
  renderSendButtons();
}
function renderCart() {
  renderCartSummary();
  $('cart-items').replaceChildren();
  for(const item of state.cart){const product=getProduct(item.productId),variant=getVariant(product,item.variantId);if(!product||!variant)continue;const row=element('div','cart-item'),photo=element('div','cart-item-image'),img=element('img');const spec=productPhotoSpec(product,variant,cartPhotoIndex);if(spec.kind!=='reference' && spec.images[0])img.src=spec.images[0];img.alt=spec.label;img.referrerPolicy='no-referrer';photo.append(img);const body=element('div');body.append(element('h3','cart-item-name',product.name),element('p','cart-item-code',item.sku),variantSelect(product,variant,value=>changeCartVariant(item.key,value)));const bottom=element('div','cart-item-bottom'),quantity=element('input','quantity-field');quantity.type='number';quantity.min='1';quantity.max='999';quantity.value=item.quantity;quantity.dataset.quantityKey=item.key;quantity.setAttribute('aria-label',`Quantity of selected ${product.name}`);quantity.addEventListener('change',()=>changeQuantity(item.key,quantity.value));const price=element('span','cart-item-price',money(item.price*item.quantity));price.dataset.cartPriceKey=item.key;bottom.append(quantity,price);body.append(bottom);if(!variant.available)body.append(element('p','section-note','Unavailable. Choose another jar size.'));const remove=element('button','icon-button cart-item-remove','×');remove.type='button';remove.setAttribute('aria-label',`Remove ${product.name}, ${variant.title} from selection`);remove.addEventListener('click',()=>removeCartItem(item.key));row.append(photo,body,remove);$('cart-items').append(row);}
  renderSendButtons();
}
function renderSendButtons() {
  const fingerprint=cartFingerprint();
  const sent=state.cart.length&&state.sentCartFingerprint===fingerprint;
  const uncertain=state.cartUnconfirmed===fingerprint;
  $('view-bullseye-cart').hidden=!sent&&!uncertain;
  $('empty-bullseye-cart').textContent=state.clearing?'Emptying Bullseye cart…':'Empty Bullseye cart';
  cartLibrary?.refresh();
}
function renderAccount() {
  const account=state.account,status=$('account-status');status.classList.toggle('is-signed-in',account.signedIn===true);status.classList.toggle('is-error',account.signedIn===false);
  $('account-menu').querySelector('summary').textContent='Account';
  status.textContent=account.signedIn===true?'Signed in to Bullseye':account.signedIn===false?'Sign in to Bullseye before sending your glass.':account.status==='checking'?'Checking Bullseye sign-in…':account.status==='preview'?'Cart sending is available in the installed extension.':'Bullseye sign-in will be checked before adding glass.';
  $('sign-in').hidden=account.signedIn===true||account.status==='checking'||account.status==='preview';$('check-account').hidden=account.signedIn===true||account.status==='checking'||account.status==='preview';renderSendButtons();
}
async function checkAccount(force=false) {
  if(accountCheck)return accountCheck;if(!force&&Date.now()-lastAccountCheck<1500)return;lastAccountCheck=Date.now();
  accountCheck=(async()=>{try{state.account=await bridge.getBullseyeAccount();}catch(error){state.account={signedIn:null,status:'unknown',message:error.message};}finally{renderAccount();accountCheck=null;}})();return accountCheck;
}
async function signIn() {try{await bridge.signInToBullseye();notify('Sign in on Bullseye, then return here to send your glass.');}catch(error){notify(error.message||'Bullseye sign-in could not open.',true);}}
async function sendCartItems(selection) {
  if(state.sending || state.clearing)throw new Error('A Bullseye cart action is already in progress.');
  const jars=normalizeCartItems(selection);
  if(!jars.length)throw new Error('Add at least one jar to this cart.');
  const fingerprint=cartFingerprint(jars);
  if(state.cartUnconfirmed===fingerprint)throw new Error('Check your Bullseye cart before sending these jars again.');
  const invalid=jars.find(item=>!getVariant(getProduct(item.productId),item.variantId)?.available);
  if(invalid)throw new Error(`Choose an available jar size for ${invalid.name || invalid.productId}.`);
  const items=jars.map(item=>({variantId:Number(item.variantId),quantity:item.quantity}));
  state.sending=true;sendingFingerprint=fingerprint;renderSendButtons();
  try{
    const result=await bridge.sendToCart(items);
    if(!result?.added)throw new Error('Bullseye did not confirm the cart addition.');
    state.sentCartFingerprint=fingerprint;state.account={signedIn:true,status:'signed_in'};persist();return result;
  }catch(error){
    if(error.authRequired)state.account=error.account||{signedIn:error.code==='SIGN_IN_REQUIRED'?false:null,status:error.code==='SIGN_IN_REQUIRED'?'signed_out':'unknown'};
    if(error.uncertain){state.cartUnconfirmed=fingerprint;persist();}
    throw error;
  }finally{state.sending=false;sendingFingerprint='';renderAccount();}
}
async function emptyWebsiteCart() {
  if(state.sending || state.clearing)throw new Error('A Bullseye cart action is already in progress.');
  state.clearing=true;renderSendButtons();
  try {
    const result=await bridge.emptyBullseyeCart();
    state.sentCartFingerprint='';state.cartUnconfirmed='';state.account={signedIn:true,status:'signed_in'};
    persist();return result;
  } catch(error) {
    if(error.authRequired)state.account=error.account||{signedIn:error.code==='SIGN_IN_REQUIRED'?false:null,status:error.code==='SIGN_IN_REQUIRED'?'signed_out':'unknown'};
    throw error;
  } finally {state.clearing=false;renderAccount();}
}

async function exportPersonalData() {
  if(personalDataBusy)return;
  try {
    await flushSave({propagate:true});await cartLibrary.flush();
    const backup=await createPersonalDataBackup();
    if(!isCartPage && workspaceReady)backup.local.bullseyeProjectV1=workspaceSnapshot();
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`Bullseye-personal-data-${new Date().toISOString().slice(0,10)}.json`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notify('Backup downloaded with your settings, palettes, photos and carts.');
  } catch(error) {notify(error.message || 'Your data could not be backed up.',true);}
}
async function importPersonalData(file) {
  if(!file || personalDataBusy)return;
  try {
    const backup=normalizePersonalDataBackup(await file.text());
    if(!window.confirm('Restore the settings, palettes and carts in this backup? Your current workspace will be replaced, other named items will be kept, and open picker/cart tabs will reload.'))return;
    await flushSave({propagate:true});await cartLibrary.flush();personalDataBusy=true;
    await runPersonalDataRestore(()=>restorePersonalDataBackup(backup));
    location.reload();
  } catch(error) {
    notify(error.message || 'Your backup could not be restored. Reload before trying again.',true,12000);
    if(personalDataBusy){clearTimeout(saveTimer);saveTimer=undefined;}
  }
}
function orderLines(){const quantities=new Map();for(const item of state.cart)if(item.sku)quantities.set(item.sku,(quantities.get(item.sku)||0)+item.quantity);return Array.from(quantities,([sku,quantity])=>`${sku} ${quantity}`).join('\n');}
async function copyOrder(){try{await navigator.clipboard.writeText(orderLines());notify('SKU list copied.');}catch{notify('This browser could not copy the list.',true);}}

function renderAll(){renderSettings();renderImageLayout();renderPalette();renderResults();renderCart();renderAccount();}
function setView(view){state.view=view;if(view==='palette'){state.query='';$('glass-search').value='';}renderResults();persist();}
function selectTarget(id){state.activeTargetId=id;if(state.view==='library')state.view='palette';renderPalette();renderResults();persist();}
function showAlternatives(id) {
  const target=state.targets.find(value=>value.id===id);if(!target)return;
  alternativesTargetId=id;state.activeTargetId=id;
  alternativesFilters={glassTypes:{...state.glassTypes},includeTints:state.includeTints};
  $('alternatives-search').value='';closeToolbarMenus();renderPalette();renderAlternatives();
  const dialog=$('alternatives-dialog');if(!dialog.open)dialog.showModal();
  $('alternatives-search').focus({preventScroll:true});persist();
}
function renderAlternatives() {
  const target=state.targets.find(value=>value.id===alternativesTargetId);
  if(!target){$('alternatives-dialog').close();return;}
  $('alternatives-title').textContent=`Alternatives for color ${targetNumber(target)}`;
  $('alternatives-target').style.backgroundColor=target.hex;
  $('alternatives-target').title=target.hex;
  const query=$('alternatives-search').value.trim().toLowerCase();
  const list=$('alternatives-grid'),scroll=list.scrollTop;
  const matches=matchesFor(target,true,alternativesFilters).filter(entry=>`${entry.product.name} ${entry.product.code} ${entry.product.id}`.toLowerCase().includes(query));
  list.replaceChildren(...matches.map(entry=>renderProduct({...entry,target},true)));
  $('alternatives-empty').hidden=Boolean(matches.length);
  list.scrollTop=scroll;
  for(const type of ['transparent','opalescent'])$(`alternatives-${type}`).setAttribute('aria-pressed',String(alternativesFilters.glassTypes[type]));
  $('alternatives-tints').setAttribute('aria-pressed',String(alternativesFilters.includeTints));
}
function chooseAlternative(targetId,productId) {
  if(!state.targets.some(target=>target.id===targetId))return;
  state.chosenMatches[targetId]=productId;
  if($('alternatives-dialog').open)$('alternatives-dialog').close();
  reconcilePaletteSelection();renderPalette();renderResults();persist();
}
function removeTarget(id){const index=state.targets.findIndex(target=>target.id===id);state.targets=state.targets.filter(target=>target.id!==id);delete state.chosenMatches[id];if(!activeTarget())state.activeTargetId=state.targets[Math.max(0,index-1)]?.id||null;reconcilePaletteSelection();renderPalette();renderResults();persist();}
function addTarget(rgb,point=null){if(state.targets.length>=MAX_TARGETS){notify(`Remove a color before adding more than ${MAX_TARGETS}.`,true);return null;}const target=normalizeTarget({id:`manual-${Date.now()}-${++manualTargetId}`,rgb,manual:true,...point});state.targets.push(target);state.activeTargetId=target.id;state.view='palette';reconcilePaletteSelection();renderPalette();renderResults();persist();return target;}
function createCustomTarget(){const rgb=activeTarget()?.rgb||[83,121,103],target=addTarget(rgb,nearestSourcePoint(rgb));if(target){target.custom=true;renderPalette();$('color-editor-dialog').showModal();$('target-hex').select();}}
function editTarget(hex){const normalized=hex.startsWith('#')?hex:`#${hex}`;if(!/^#[0-9a-f]{6}$/i.test(normalized)){$('target-hex').setAttribute('aria-invalid','true');return false;}const target=activeTarget();if(!target)return false;target.rgb=[1,3,5].map(index=>parseInt(normalized.slice(index,index+2),16));target.hex=normalized.toUpperCase();target.lab=rgbToLab(target.rgb);target.manual=true;target.custom=true;target.weight=0;delete state.chosenMatches[target.id];reconcilePaletteSelection();renderPalette();renderResults();persist();return true;}
function extractStartingColors(preserveManual=true,seed=undefined){if(!state.imageData)return;const manual=preserveManual?state.targets.filter(target=>target.manual):[],manualHexes=new Set(manual.map(target=>target.hex));const extracted=extractPalette(state.imageData,{count:state.paletteCount,seed}).map((target,index)=>normalizeTarget({...target,id:`auto-${index}-${colorHex(target.rgb)}`,manual:false})).filter(target=>!manualHexes.has(target.hex));state.targets=[...extracted.slice(0,MAX_TARGETS-manual.length),...manual];if(!activeTarget())state.activeTargetId=state.targets[0]?.id||null;reconcilePaletteSelection();renderPalette();renderResults();persist();}
function changePaletteCount(value){state.paletteCount=clamp(Math.round(Number(value)||6),2,12);extractStartingColors(true);}
function pickSourceColor(event){const point=pointerPoint(event);if(!point)return;const rgb=sampleImagePoint(point);if(!rgb){notify('That area is transparent. Pick a visible color.');return;}addTarget(rgb,point);}

function decodeImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not open. Try PNG, JPEG, or WebP.'));image.src=url;});}
async function loadImage(dataUrl,options={}){
  const requestId=options.requestId??++imageLoadId;if(requestId!==imageLoadId)return;
  try{
    const image=options.decodedImage||await decodeImage(dataUrl);if(requestId!==imageLoadId)return;
    const scale=Math.min(1,1100/Math.max(image.naturalWidth,image.naturalHeight));
    sourceCanvas.width=Math.max(1,Math.round(image.naturalWidth*scale));sourceCanvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    sourceContext.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);sourceContext.drawImage(image,0,0,sourceCanvas.width,sourceCanvas.height);
    state.imageData=sourceContext.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);state.sourceDataUrl=sourceCanvas.toDataURL('image/png');
    state.sourceThumbnail=imageThumbnail();
    state.sourceName=options.name||'Your image';state.sourceUrl=options.sourceUrl||'';
    $('source-name').textContent=state.sourceName;$('source-name').title=state.sourceName;
    $('drop-zone').hidden=true;$('image-loaded').hidden=false;$('clear-image').hidden=false;$('replace-image').textContent='Replace';$('image-access-note').hidden=true;pendingAccessUrl='';
    renderImageLayout();
    if(!options.restore||!state.targets.length){state.selection=emptySelection(state.selection.manualKeys);state.targets=[];state.activeTargetId=null;state.view='palette';state.chosenMatches={};state.savedPaletteId=null;state.savedPaletteName='';extractStartingColors(false);}
    else{for(const target of state.targets)if(!Number.isFinite(target.x)||!Number.isFinite(target.y))Object.assign(target,nearestSourcePoint(target.rgb)||{});renderAll();}
    persist();
  }catch(error){if(requestId!==imageLoadId)return;notify(error.message||'This image could not open.',true);console.warn('Image import failed:',error);}
}
async function beginManualImage(){
  // Reserve the user's latest image choice before any asynchronous work.
  const requestId=++imageLoadId;cancellingImageId=requestId;pendingReceivedThisSession=true;pendingAccessUrl='';$('image-access-note').hidden=true;
  try{await bridge.cancelPendingImage();}catch(error){console.info('Could not cancel the previous browser image:',error);}finally{if(cancellingImageId===requestId)cancellingImageId=0;}
  return requestId===imageLoadId?requestId:null;
}
async function readFile(file){if(!file||!file.type.startsWith('image/')){notify('Choose a PNG, JPEG, WebP, or other image file.',true);return;}const requestId=await beginManualImage();if(requestId===null)return;const reader=new FileReader();reader.onload=()=>loadImage(String(reader.result),{name:file.name||'Pasted image',requestId});reader.onerror=()=>{if(requestId===imageLoadId)notify('The image file could not be read.',true);};reader.readAsDataURL(file);}
async function clearImage(){const requestId=await beginManualImage();if(requestId===null)return;state.imageData=null;state.sourceDataUrl='';state.sourceName='';state.sourceUrl='';state.sourceThumbnail='';state.targets=[];state.activeTargetId=null;state.view='library';state.chosenMatches={};state.savedPaletteId=null;state.savedPaletteName='';state.selection=emptySelection(state.selection.manualKeys);reconcilePaletteSelection();sourceContext.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);$('drop-zone').hidden=false;$('image-loaded').hidden=true;$('clear-image').hidden=true;$('replace-image').textContent='Choose image';$('source-name').textContent='Your image';$('image-access-note').hidden=true;renderAll();persist();}
async function handlePendingImage(pending){if(!pending||cancellingImageId)return;const updatedAt=Number(pending.updatedAt)||0;if(updatedAt&&updatedAt<=state.lastPendingImageAt)return;if(pending.dataUrl){pendingReceivedThisSession=true;if(updatedAt)state.lastPendingImageAt=updatedAt;await loadImage(pending.dataUrl,{name:pending.name||'Image from the web',sourceUrl:pending.sourceUrl});return;}if(pending.needsPermission&&pending.sourceUrl){pendingAccessUrl=pending.sourceUrl;$('image-access-copy').textContent='Allow access to read this photo, or use Capture.';$('allow-image-access').hidden=false;$('image-access-note').hidden=false;}else if(pending.error){$('image-access-copy').textContent=`${pending.error} Use Capture or choose a saved image.`;$('allow-image-access').hidden=true;$('image-access-note').hidden=false;}}
async function pasteImage(){if(!navigator.clipboard?.read){notify('Press Ctrl+V with an image copied, or choose an image file.');return;}try{const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(entry=>entry.startsWith('image/'));if(type){await readFile(new File([await item.getType(type)],'Pasted image',{type}));return;}}notify('Copy an image, then paste it here.');}catch{notify('Press Ctrl+V with an image copied, or choose an image file.');}}

async function openSaved(saveCurrent=false){$('save-palette-form').hidden=!state.targets.length;$('palette-name').value=state.savedPaletteName||(state.sourceName||'My palette').replace(/\.[a-z0-9]{2,5}$/i,'').slice(0,80);updateSaveLabel();$('saved-dialog').showModal();await renderSavedList();if(saveCurrent)$('palette-name').select();}
function updateSaveLabel(){$('confirm-save-palette').textContent=state.savedPaletteId&&$('palette-name').value.trim()===state.savedPaletteName?'Update':'Save';}
async function renderSavedList(){
  const list=$('saved-list');list.replaceChildren(element('p','saved-empty','Loading saved palettes…'));
  try{
    const palettes=await listPalettes();list.replaceChildren();if(!palettes.length)list.append(element('p','saved-empty','No saved palettes yet.'));
    for(const palette of palettes){
      const row=element('div','saved-row'),body=element('div'),preview=element('button','saved-preview');preview.type='button';preview.setAttribute('aria-label',`Open saved photo and palette ${palette.name}`);preview.addEventListener('click',()=>restoreSavedPalette(palette.id));
      if(palette.thumbnailDataUrl){const image=element('img');image.src=palette.thumbnailDataUrl;image.alt=`Saved photo for ${palette.name}`;preview.append(image);}else{const colors=element('div','saved-color-preview');for(const color of palette.colors||[]){const swatch=element('span');swatch.style.backgroundColor=color;colors.append(swatch);}if(!colors.children.length)colors.textContent='Palette';preview.append(colors);}
      body.append(element('strong','',palette.name),element('p','',`${palette.colorCount} colors · ${palette.glassCount} glass selected`),element('p','',`${palette.hasImage?'Photo saved · ':''}${new Date(palette.updatedAt).toLocaleDateString()}`));
      const load=element('button','button secondary-button','Load');load.type='button';load.setAttribute('aria-label',`Load palette ${palette.name}`);load.addEventListener('click',()=>restoreSavedPalette(palette.id));
      const remove=element('button','text-button delete-palette','Delete');remove.type='button';remove.setAttribute('aria-label',`Delete palette ${palette.name}`);
      remove.addEventListener('click',async()=>{remove.disabled=true;try{await deletePalette(palette.id);if(state.savedPaletteId===palette.id){state.savedPaletteId=null;state.savedPaletteName='';persist();}await renderSavedList();}catch(error){notify(error.message,true);remove.disabled=false;}});
      row.append(preview,body,load,remove);list.append(row);
    }
  }catch(error){list.replaceChildren(element('p','saved-empty',error.message||'Saved palettes could not open.'));}
}
async function saveCurrentPalette(event){event.preventDefault();const button=$('confirm-save-palette');button.disabled=true;try{const name=$('palette-name').value.trim(),id=state.savedPaletteId&&name===state.savedPaletteName?state.savedPaletteId:null;const result=await savePalette(name,workspaceSnapshot(),id);state.savedPaletteId=result.id;state.savedPaletteName=result.name;persist();$('saved-dialog').close();notify(`Saved “${result.name}”.`);}catch(error){notify(error.message||'This palette could not be saved.',true);}finally{button.disabled=false;}}
async function restoreSavedPalette(id){
  const requestId=await beginManualImage();if(requestId===null)return;
  try{
    const palette=await loadPalette(id);if(requestId!==imageLoadId)return;if(!palette)throw new Error('This saved palette no longer exists.');
    // Decode before changing selections so an unreadable saved photo cannot
    // leave another photo under this palette's dots or report a false load.
    const decodedImage=palette.workspace.sourceDataUrl?await decodeImage(palette.workspace.sourceDataUrl):null;
    if(requestId!==imageLoadId)return;
    restoreWorkspace({...palette.workspace,savedPaletteId:palette.id,savedPaletteName:palette.name,sentCartFingerprint:'',cartUnconfirmed:false});state.query='';$('glass-search').value='';
    if(palette.workspace.sourceDataUrl)await loadImage(palette.workspace.sourceDataUrl,{name:palette.workspace.sourceName,sourceUrl:palette.workspace.sourceUrl,restore:true,requestId,decodedImage});
    else{state.imageData=null;state.sourceDataUrl='';state.sourceName='';state.sourceUrl='';state.sourceThumbnail='';$('drop-zone').hidden=false;$('image-loaded').hidden=true;$('clear-image').hidden=true;$('replace-image').textContent='Choose image';$('source-name').textContent='Your image';renderAll();}
    if(requestId!==imageLoadId)return;$('saved-dialog').close();renderAll();persist();notify(`Loaded “${palette.name}”.`);
  }catch(error){if(requestId===imageLoadId)notify(error.message||'This palette could not be loaded.',true);}
}

function openDetail(product,sample,target=null){detailTargetId=target?.id || state.activeTargetId;detailProduct=product;detailSample=sample||[...(product.samples||[])].sort((a,b)=>sampleThickness(b,product)-sampleThickness(a,product))[0]||null;$('detail-title').textContent=product.name;renderDetailPurchase();const targetInfo=state.targets.find(t=>t.id===detailTargetId);$('detail-match-info').textContent=targetInfo?`Palette color ${targetNumber(targetInfo)} · ${targetInfo.hex}`:'';$('detail-alternatives').hidden=!targetInfo;$('detail-choose').hidden=!targetInfo;closeToolbarMenus();$('detail-dialog').showModal();refreshProduct(product);}
function synchronizeDetailSample(){
  if(!detailProduct)return;
  detailProduct=getProduct(detailProduct.id) || detailProduct;
  const samples=detailProduct.samples || [],inspection=detailProduct.photoGuide?.inspectionSamples || [];
  if(samples.includes(detailSample) || inspection.includes(detailSample))return;
  const target=state.targets.find(entry=>entry.id===detailTargetId) || detailSample;
  detailSample=(target?matchCatalog(target,[detailProduct],{includeOtherFamilies:true})[0]?.sample:null) || samples[0] || null;
}
function renderDetailSample(){
  if(!detailProduct)return;
  synchronizeDetailSample();
  const photo=productPhotoSpec(detailProduct,currentVariant(detailProduct),cartPhotoIndex);
  const samples=samplesForPhoto(detailProduct,photo.images[0]),guide=samples.length?detailProduct.photoGuide:null;
  $('detail-photo').replaceChildren(photoElement(detailProduct,detailSample,true));
  $('detail-photo-grade').textContent=`${photo.grade} · ${guide?.kind || 'Bullseye photograph'}`;
  $('detail-sample-label').textContent=guide?sampleLabel(detailProduct,detailSample):'No sampled color guide for this photograph.';
  const percentages=samples.map(sample=>sampleThickness(sample,detailProduct)).filter(Number.isFinite);
  $('detail-range').textContent=percentages.length?`Photo range: ${Math.min(...percentages)}–${Math.max(...percentages)}% · shared color reference`:'';
  $('detail-range').hidden=!percentages.length;
  $('detail-sampling-note').hidden=!guide;
  $('detail-samples').replaceChildren();
  for(const sample of samples){
    const button=element('button',`detail-sample${sample===detailSample?' is-active':''}`),thickness=sampleThickness(sample,detailProduct);
    button.type='button';button.setAttribute('aria-label',`Show ${sampleLabel(detailProduct,sample)}`);
    button.setAttribute('aria-pressed',String(sample===detailSample));button.title=sampleLabel(detailProduct,sample);
    button.dataset.sampleId=sample.id || '';button.dataset.x=sample.x;button.dataset.y=sample.y;button.dataset.hex=sample.hex || colorHex(sample.rgb);
    const swatch=element('span');swatch.style.backgroundColor=sample.hex||colorHex(sample.rgb);
    button.append(swatch,element('small','',thickness===null?'—':`${thickness}%`));
    button.addEventListener('click',()=>{detailSample=sample;renderDetailSample();});$('detail-samples').append(button);
  }
}
function renderDetailPurchase(){
  if(!detailProduct)return;
  renderDetailSample();
  $('detail-purchase').replaceChildren(purchaseControls(detailProduct,true));
  const variant=currentVariant(detailProduct),url=variant?.productUrl||detailProduct.productUrl;
  $('detail-code').textContent=`${purchaseCode(detailProduct,variant)} · ${detailProduct.type||'Glass'} · ${detailProduct.grain}`;
  $('detail-product-link').hidden=!url;if(url)$('detail-product-link').href=url;
}
async function refreshProduct(product){
  const handle=currentVariant(product)?.handle||product.handle,key=`${product.id}:${handle}`;
  if(!handle||Date.now()-(freshProducts.get(key)||0)<300000)return;freshProducts.set(key,Date.now());
  try{
    const updated=await bridge.fetchProductVariants(handle);
    if(!Array.isArray(updated?.variants)||!updated.variants.length)return;
    const stock=new Map(updated.variants.map(variant=>[String(variant.id),variant]));
    // Sheet forms combine several real product handles. Update only the
    // requested source, retaining each variant's thickness, size, and form.
    const merge=variants=>(variants||[]).map(variant=>{
      if(variant.handle!==handle)return variant;
      const fresh=stock.get(String(variant.id));
      return fresh?{...variant,available:Boolean(fresh.available),price:Number(fresh.price)||0}:{...variant,available:false};
    });
    const entry=state.formatIndex?.products?.[product.id]?.[product.form];
    if(entry){entry.variants=merge(entry.variants);entry.available=entry.variants.some(variant=>variant.available);}
    const current=getProduct(product.id);if(!current)return;
    current.variants=merge(current.variants);current.allVariants=merge(current.allVariants);
    for(const item of state.cart.filter(entry=>entry.productId===product.id)){const variant=getVariant(current,item.variantId);if(variant)Object.assign(item,makeCartItem(current,variant,item.quantity));}
    reconcilePaletteSelection();renderResults();persist();
  }catch(error){console.info('Using bundled glass product information:',error);}
}

async function beginCapture() {
  const button = $('capture-image'); button.disabled = true;
  try {
    const result = await bridge.captureVisibleImage();
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

function closeToolbarMenus() {for(const menu of document.querySelectorAll('.toolbar-menu'))menu.open=false;}
function bindEvents() {
  for(const menu of document.querySelectorAll('.toolbar-menu'))menu.addEventListener('toggle',()=>{
    if(!menu.open)return;
    for(const other of document.querySelectorAll('.toolbar-menu'))if(other!==menu)other.open=false;
    const panel=menu.querySelector('.menu-content'),rect=menu.querySelector('summary').getBoundingClientRect();
    const width=panel.offsetWidth;
    panel.style.left=`${Math.max(6,Math.min(rect.left,innerWidth-width-6))}px`;
    panel.style.top=`${Math.min(rect.bottom+4,innerHeight-panel.offsetHeight-6)}px`;
  });
  document.addEventListener('click',event=>{if(!event.target.closest('.toolbar-menu'))closeToolbarMenus();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeToolbarMenus();});
  $('open-color-editor').addEventListener('click',()=>{$('color-editor-dialog').showModal();$('target-hex').select();});
  $('close-color-editor').addEventListener('click',()=>$('color-editor-dialog').close());
  $('close-alternatives').addEventListener('click',()=>$('alternatives-dialog').close());
  $('alternatives-search').addEventListener('input',renderAlternatives);
  for(const type of ['transparent','opalescent','tints'])$(`alternatives-${type}`).addEventListener('click',()=>{if(type==='tints')alternativesFilters.includeTints=!alternativesFilters.includeTints;else alternativesFilters.glassTypes[type]=!alternativesFilters.glassTypes[type];renderAlternatives();});
  settingsDialog=initializeSettingsDialog({getSettings:currentSettings,applySettings:applyWorkingSettings,onSaved:settings=>{savedSettingsFingerprint=JSON.stringify(settings);renderSettings();},notify});
  $('load-settings').addEventListener('click',()=>settingsDialog.open(false));
  $('export-personal-data').addEventListener('click',exportPersonalData);
  $('import-personal-data').addEventListener('click',()=>$('personal-data-file').click());
  $('personal-data-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void importPersonalData(file);});
  $('refresh-settings').addEventListener('click',refreshWorkingSettings);
  $('remix-palette').addEventListener('click',remixPalette);
  $('include-tints').addEventListener('click',()=>{state.includeTints=!state.includeTints;reconcilePaletteSelection();renderResults();persist();});
  cartLibrary=initializeCartLibrary({getProducts:()=>[...state.products,...clearCartProducts],getPhotoIndex:()=>cartPhotoIndex,getSelection:()=>state.cart,
    getSelectionName:()=>state.savedPaletteName||state.sourceName||'My cart',sendItems:sendCartItems,emptyWebsiteCart,
    getSendState:cartSendState,getAccount:()=>state.account,getPreferredJarSize:()=>state.preferredJarSize,getFilters:()=>({glassTypes:{...state.glassTypes},includeTints:state.includeTints}),pageMode:isCartPage,openPage:async mode=>{await flushSave();await bridge.openCartPage(mode);},readWebsiteCart:()=>bridge.readBullseyeCart(),signIn,notify});
  for(const option of FORM_OPTIONS)$(`form-${option.id}`).addEventListener('click',()=>{if(state.format!==option.id)changePurchaseOptions(option.id);});
  $('preferred-jar-size').addEventListener('change',event=>changePurchaseOptions(state.format,event.target.value,true));
  $('save-settings').addEventListener('click',saveCurrentSettings);
  window.addEventListener('pagehide', flushSave);
  $('show-alternatives').addEventListener('click', () => { if (state.activeTargetId) showAlternatives(state.activeTargetId); });
  $('back-to-palette').addEventListener('click', () => setView('palette'));
  $('show-full-palette').addEventListener('change', (event) => { if(event.target.checked)setView('palette');else if(state.activeTargetId)setView('alternatives'); });
  $('save-palette').addEventListener('click', () => openSaved(true));
  $('open-saved').addEventListener('click', () => openSaved(false));
  $('close-saved').addEventListener('click', () => $('saved-dialog').close());
  $('save-palette-form').addEventListener('submit', saveCurrentPalette);
  $('palette-name').addEventListener('input', updateSaveLabel);
  $('sign-in').addEventListener('click', signIn);
  $('check-account').addEventListener('click', () => checkAccount(true));
  window.addEventListener('focus', () => checkAccount());

  $('drop-zone').addEventListener('click', () => $('image-file').click());
  $('drop-zone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('image-file').click(); }
  });
  $('replace-image').addEventListener('click', () => $('image-file').click());
  $('image-file').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; if (file) readFile(file); });
  $('clear-image').addEventListener('click', clearImage);
  $('paste-image').addEventListener('click', pasteImage);
  for (const size of ['fit','larger','full']) $(`image-${size}`).addEventListener('click', () => setImageSize(size));
  window.addEventListener('resize', renderImageLayout);
  let lastStageWidth = 0;
  new ResizeObserver(([entry]) => {
    if (Math.abs(entry.contentRect.width - lastStageWidth) < .5) return;
    lastStageWidth = entry.contentRect.width; renderImageLayout();
  }).observe($('image-stage'));
  new ResizeObserver(()=>requestAnimationFrame(renderImageLayout)).observe($('palette-panel'));
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
  $('remove-target').addEventListener('click', () => { if (state.activeTargetId) removeTarget(state.activeTargetId);$('color-editor-dialog').close(); });
  $('add-custom-color').addEventListener('click', createCustomTarget);
  for (const view of ['palette', 'library']) {
    $(`${view}-tab`).addEventListener('click', () => setView(view));
    $(`${view}-tab`).addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 'palette' : event.key === 'End' ? 'library' : view === 'library' ? 'palette' : 'library';
        setView(next); $(`${next}-tab`).focus();
      }
    });
  }
  for (const type of ['transparent','opalescent']) $(`include-${type}`).addEventListener('click', () => {
    state.glassTypes[type] = !state.glassTypes[type]; reconcilePaletteSelection(); renderResults(); persist();
  });
  $('glass-search').addEventListener('input', (event) => { state.query = event.target.value; if(state.query.trim() && state.view==='palette' && activeTarget())state.view='alternatives'; renderResults(); persist(); });
  $('empty-action').addEventListener('click', () => emptyAction?.());
  $('open-workspace').addEventListener('click', () => {
    try { flushSave().then(()=>bridge.openWorkspace()).catch((error) => notify(error.message || 'Could not open a larger workspace.', true)); }
    catch (error) { notify(error.message || 'Could not open a larger workspace.', true); }
  });
  for (const id of ['close-cart', 'back-to-glass']) $(id).addEventListener('click', () => $('cart-dialog').close());
  $('close-detail').addEventListener('click', () => $('detail-dialog').close());
  $('detail-alternatives').addEventListener('click',()=>{const id=detailTargetId;$('detail-dialog').close();if(id)showAlternatives(id);});
  $('detail-choose').addEventListener('click',()=>{const id=detailTargetId,product=detailProduct;if(id && product){$('detail-dialog').close();chooseAlternative(id,product.id);}});
  $('detail-photo').addEventListener('click', (event) => {
    const plane=$('detail-photo').querySelector('.photo-sample-plane');
    const photo=productPhotoSpec(detailProduct,currentVariant(detailProduct),cartPhotoIndex);
    const samples=samplesForPhoto(detailProduct,photo.images[0]);
    if(!plane || plane.hidden || !samples.length)return;
    const point=imagePointFromClient(event.clientX,event.clientY,plane.getBoundingClientRect());
    if(!point)return;
    const sample=nearestPhotoSample([...samples,...(detailProduct.photoGuide.inspectionSamples || [])],point.x,point.y);
    if(!sample)return;
    detailSample=sample;
    renderDetailSample();
  });
  $('detail-dialog').addEventListener('close', () => { detailProduct = null; detailSample = null; detailTargetId=null; });
  $('copy-order').addEventListener('click', copyOrder);
  $('allow-image-access').addEventListener('click', async () => {
    if (!pendingAccessUrl) return;
    const button = $('allow-image-access'); button.disabled = true;
    try {
      // The worker publishes the result to session storage. That subscription
      // is the single image handoff, including when another image arrives.
      await bridge.requestImageAccess(pendingAccessUrl);
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
  try {
    await initPersonalDataSession({
      onPause:()=>{personalDataBusy=true;clearTimeout(saveTimer);saveTimer=undefined;document.body.inert=true;},
      onComplete:()=>location.reload(),
      onError:error=>notify(error.message,true,12000),
    });
    bindEvents();
    const [catalogResult, savedResult, formatsResult, settingsResult, clearResult, photosResult, samplesResult] = await Promise.allSettled([
      fetch('./data/catalog.json').then((response) => {
        if (!response.ok) throw new Error(`Catalog could not be loaded (${response.status}).`);
        return response.json();
      }),
      bridge.loadState(),
      fetch('./data/product-formats.json').then(response=>{if(!response.ok)throw new Error('Product form options could not load.');return response.json();}),
      loadSettings(),
      fetch('./data/clear-cart.json').then(response=>{if(!response.ok)throw new Error('Clear glass catalog could not load.');return response.json();}),
      fetch('./data/cart-photos.json').then(response=>{if(!response.ok)throw new Error('Cart product photos could not load.');return response.json();}),
      fetch('./data/form-samples.json').then(response=>{if(!response.ok)throw new Error('Frit photo samples could not load.');return response.json();}),
    ]);
    if (catalogResult.status !== 'fulfilled') throw catalogResult.reason;
    if (savedResult.status !== 'fulfilled') throw new Error(`Your saved workspace could not be read. Reload before making changes. ${savedResult.reason?.message || ''}`);
    await cartLibrary.ready;
    const catalog = catalogResult.value;
    state.baseProducts = Array.isArray(catalog.products) ? catalog.products : [];
    clearCartProducts = clearResult.status==='fulfilled' && Array.isArray(clearResult.value.products)?clearResult.value.products:[];
    cartPhotoIndex = photosResult.status==='fulfilled'?photosResult.value:{};
    formSampleIndex = samplesResult.status==='fulfilled'?samplesResult.value:{};
    state.formatIndex = formatsResult.status==='fulfilled'?formatsResult.value:null;
    const preferences=settingsResult.status==='fulfilled'?settingsResult.value:null;
    if(preferences){Object.assign(state,preferences);savedSettingsFingerprint=JSON.stringify(preferences);}
    rebuildProducts();
    $('catalog-scope').textContent = `${state.products.length} colors · Medium frit`;
    $('library-count').textContent = String(state.products.length);
    const saved = savedResult.status === 'fulfilled' ? savedResult.value : null;
    restoreWorkspace(saved);
    workspaceReady=true;
    renderAll();
    if(formatsResult.status==='rejected')notify('Product form options could not load. Medium frit is available; reload to use the other forms.',true);
    if(settingsResult.status==='rejected')notify('Saved defaults could not be read. Your current workspace is still available.',true);
    if(clearResult.status==='rejected')notify('Clear glass options could not load. Reload the extension to restore them.',true);
    if(photosResult.status==='rejected')notify('Cart product photos could not load. Reference photos are used where available.',true);
    if(samplesResult.status==='rejected')notify('Frit photo samples could not load. Reload the extension to restore photo matching.',true);
    checkAccount(true);
    if(isCartPage){document.title='Carts | Bullseye Palette Picker';await cartLibrary.openPage(new URLSearchParams(location.search).get('mode'));return;}
    bridge.subscribePendingImage((image) => handlePendingImage(image));
    let pending = null;
    try { pending = await bridge.getPendingImage(); }
    catch (error) { console.info('No pending browser image:', error); }
    if (pending?.dataUrl && (!pending.updatedAt || pending.updatedAt > state.lastPendingImageAt)) await handlePendingImage(pending);
    else {
      if (saved?.sourceDataUrl && !pendingReceivedThisSession) await loadImage(saved.sourceDataUrl, { name: saved.sourceName, sourceUrl: saved.sourceUrl, restore: true });
      if (pending) await handlePendingImage(pending);
    }
    if(!saved && preferences?.showFullPalette===false && activeTarget()){state.view='alternatives';renderResults();}
    persist();
  } catch (error) {
    console.error('Palette Picker could not start:', error);
    $('product-grid').replaceChildren();
    $('glass-results').hidden = true; $('empty-state').hidden = false;
    setEmpty('The picker could not load.', 'Your saved data has been kept. Reload the extension and reopen this page.', 'Reload', () => window.location.reload());
    notify(error.message || 'The glass catalog could not load.', true);
  }
}

initialize();
