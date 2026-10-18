/**
 * Purpose: editable image points, full-color glass matching, named palettes, and
 * direct addition of chosen Bullseye jar variants to the signed-in shop cart.
 * Setup: picker.html in the extension or a local preview; adjacent catalog,
 * color engine, browser bridge, and IndexedDB palette storage modules.
 * Destructive behavior: only an explicit Delete palette removes a saved palette.
 * The Send button adds chosen jars; it never clears a shop cart or checks out.
 * Constraints: images remain local. Darkness describes the sampled appearance
 * of one glass color. The matching engine compares hue, saturation, and lightness.
 */
import {rgbToLab, rgbToHex} from './lib/color.js';
import {extractPalette, matchCatalog} from './lib/palette.js';
import * as bridge from './lib/extension.js';
import {listPalettes, savePalette, loadPalette, deletePalette} from './lib/saved-palettes.js';

const $ = id => document.getElementById(id);
const MAX_TARGETS = 20;
const state = {
  products: [], sourceDataUrl: '', sourceName: '', sourceUrl: '', imageData: null,
  paletteCount: 6, targets: [], activeTargetId: null, tolerance: 12,
  view: 'palette', query: '', selectedVariants: {}, quantities: {}, chosenMatches: {}, cart: [],
  lastPendingImageAt: 0, savedPaletteId: null, savedPaletteName: '',
  account: {signedIn: null, status: 'checking'}, sending: false,
  sentCartFingerprint: '', cartUnconfirmed: '',
};
const sourceCanvas = $('source-canvas');
const sourceContext = sourceCanvas.getContext('2d', {willReadFrequently: true});
const freshProducts = new Map();
let detailProduct = null, detailSample = null, pendingAccessUrl = '';
let saveTimer, toastTimer, saveWarningShown = false;
let imageLoadId = 0, cancellingImageId = 0, manualTargetId = 0;
let captureBase = null, captureSelection = null, captureStart = null;
let emptyAction = null, pendingReceivedThisSession = false;
let draggingPoint = null, pointRenderFrame = 0, accountCheck = null, lastAccountCheck = 0;

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
function sampleDarkness(sample) { const value = Number(sample?.darkness); return Number.isFinite(value) ? Math.round(value) : null; }
function sampleLabel(product, sample) { const darkness = sampleDarkness(sample); return darkness === null ? product.name : `${product.name} at ${darkness}% darkness`; }
function variantKey(product, variant) { return `${product.id}:${String(variant.id || variant.sku)}`; }
function getProduct(id) { return state.products.find(product => product.id === id); }
function getVariant(product, id) { return product?.variants?.find(variant => String(variant.id) === String(id)); }
function currentVariant(product) {
  return getVariant(product, state.selectedVariants[product.id])
    || product.variants?.find(variant => variant.available && /5\s*oz/i.test(variant.title))
    || product.variants?.find(variant => variant.available) || product.variants?.[0] || null;
}
function selectedItem(product, variant) { return variant && state.cart.find(item => variantKey(product, variant) === item.key); }
function cartFingerprint() { return JSON.stringify(state.cart.map(item => [String(item.variantId), item.quantity]).sort((a,b) => a[0].localeCompare(b[0]))); }
function workspaceSnapshot() {
  return {
    version:2, sourceDataUrl:state.sourceDataUrl, sourceName:state.sourceName, sourceUrl:state.sourceUrl,
    paletteCount:state.paletteCount, targets:state.targets, activeTargetId:state.activeTargetId,
    tolerance:state.tolerance, view:state.view, selectedVariants:state.selectedVariants,
    quantities:state.quantities, chosenMatches:state.chosenMatches, cart:state.cart,
    lastPendingImageAt:state.lastPendingImageAt, savedPaletteId:state.savedPaletteId,
    savedPaletteName:state.savedPaletteName, sentCartFingerprint:state.sentCartFingerprint,
    cartUnconfirmed:state.cartUnconfirmed,
  };
}
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 250); }
async function flushSave() {
  if (!saveTimer) return; clearTimeout(saveTimer); saveTimer = undefined;
  try { await bridge.saveState(workspaceSnapshot()); }
  catch (error) {
    console.warn('Could not save palette workspace:', error);
    if (!saveWarningShown) { notify('This browser could not save the current workspace. Try Save palette.', true); saveWarningShown = true; }
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
  state.paletteCount = clamp(Math.round(Number(saved.paletteCount) || 6), 2, 12);
  state.tolerance = [6,12,20,30].reduce((best, value) => Math.abs(value-(Number(saved.tolerance)||12)) < Math.abs(best-(Number(saved.tolerance)||12)) ? value : best, 12);
  state.selectedVariants = saved.selectedVariants && typeof saved.selectedVariants === 'object' ? saved.selectedVariants : {};
  state.quantities = saved.quantities && typeof saved.quantities === 'object' ? saved.quantities : {};
  state.chosenMatches = saved.chosenMatches && typeof saved.chosenMatches === 'object' ? saved.chosenMatches : {};
  state.targets = Array.isArray(saved.targets) ? saved.targets.map(normalizeTarget).filter(Boolean).slice(0,MAX_TARGETS) : [];
  state.activeTargetId = saved.activeTargetId;
  if (!activeTarget()) state.activeTargetId = state.targets[0]?.id || null;
  state.view = saved.view === 'library' ? 'library' : 'palette';
  state.lastPendingImageAt = Math.max(state.lastPendingImageAt, Number(saved.lastPendingImageAt) || 0);
  state.savedPaletteId = saved.savedPaletteId || null; state.savedPaletteName = saved.savedPaletteName || '';
  state.sentCartFingerprint = saved.sentCartFingerprint || ''; state.cartUnconfirmed = typeof saved.cartUnconfirmed === 'string' ? saved.cartUnconfirmed : '';
  state.cart = [];
  for (const previous of Array.isArray(saved.cart) ? saved.cart : []) {
    const product = getProduct(previous.productId), variant = getVariant(product, previous.variantId);
    if (!product || !variant) continue;
    const item = makeCartItem(product, variant, previous.quantity), existing = state.cart.find(entry => entry.key === item.key);
    if (existing) existing.quantity = clamp(existing.quantity + item.quantity,1,999); else state.cart.push(item);
  }
}

function renderPalette() {
  $('palette-panel').hidden = !state.imageData && !state.targets.length;
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
    button.append(color, element('span','palette-chip-hex',target.hex));
    button.addEventListener('click', () => selectTarget(target.id)); chips.append(button);
  }
  const target = activeTarget(); $('target-editor').hidden = !target; $('show-alternatives').hidden = !target;
  if (target) {
    $('editing-target').textContent = `Color ${targetNumber(target)}${target.custom ? ' · edited' : ''}`;
    $('target-color').value = target.hex.toLowerCase();
    if (document.activeElement !== $('target-hex')) $('target-hex').value = target.hex;
    $('target-hex').removeAttribute('aria-invalid');
    $('show-alternatives').textContent = `Alternatives for color ${targetNumber(target)}`;
  }
  $('add-custom-color').disabled = state.targets.length >= MAX_TARGETS;
  $('save-palette').disabled = !state.targets.length;
  renderPoints();
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
  if (!pointRenderFrame) pointRenderFrame = requestAnimationFrame(() => { pointRenderFrame=0; renderPalette(); renderResults(); });
}
function finishPointDrag(event) {
  if (!draggingPoint || event.pointerId !== draggingPoint.pointerId) return;
  event.currentTarget.classList.remove('is-dragging');
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  draggingPoint = null; renderPalette(); renderResults(); persist();
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
  if (setPointColor(target,point)) {renderPalette();renderResults();persist();}
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

function matchesFor(target) { return target ? matchCatalog(target,state.products,{tolerance:state.tolerance,limit:state.products.length}) : []; }
function primaryMatch(target) {
  const matches=matchesFor(target), chosen=state.chosenMatches[target.id];
  return matches.find(entry=>entry.product.id===chosen) || matches[0] || null;
}
function renderResults() {
  const focusedKey=document.activeElement?.dataset?.focusKey;
  for (const view of ['palette','library']) {
    const active=state.view===view || (view==='palette' && state.view==='alternatives');
    $(`${view}-tab`).classList.toggle('is-active',active); $(`${view}-tab`).setAttribute('aria-selected',String(active));
    $(`${view}-tab`).tabIndex=active?0:-1;
  }
  $('glass-results').setAttribute('aria-labelledby',state.view==='library'?'library-tab':'palette-tab');
  $('match-range').value=state.tolerance;
  $('results-title').textContent=state.view==='library'?'All Bullseye colors':'Bullseye colors for your palette';
  $('alternatives-heading').hidden=state.view!=='alternatives';
  const target=activeTarget();
  if (state.view==='alternatives') $('alternatives-label').textContent=`Color ${targetNumber(target)} · ${target?.hex || ''}`;
  let entries;
  if (state.view==='library') entries=state.products.map(product=>({product,sample:null}));
  else if (state.view==='alternatives') entries=matchesFor(target).map(entry=>({...entry,target}));
  else entries=state.targets.map(target=>({...primaryMatch(target),target}));
  const query=state.query.trim().toLowerCase();
  if (query) entries=entries.filter(entry=>entry.product && `${entry.product.name} ${entry.product.code} ${entry.product.id}`.toLowerCase().includes(query));
  const list=$('product-grid');list.replaceChildren(); $('glass-results').hidden=!entries.length;$('empty-state').hidden=!!entries.length;
  $('empty-action').hidden=true;emptyAction=null;
  if (!entries.length) {
    if (query) setEmpty('No glass by that name.','Search by a color name or Bullseye code.','Clear search',()=>{state.query='';$('glass-search').value='';renderResults();});
    else if (!state.targets.length && state.view!=='library') setEmpty('Add an image or a color.','Your Bullseye matches will appear here.','Choose image',()=>$('image-file').click());
    else if (state.view==='alternatives') setEmpty('No close glass match.','Edit this color or widen the match range.','All palette colors',()=>setView('palette'));
    else setEmpty('The glass catalog could not load.','Reload the picker.','Reload',()=>location.reload());
  }
  for (const entry of entries) list.append(entry.product?renderProduct(entry):renderNoMatch(entry.target));
  if (focusedKey) for (const node of document.querySelectorAll('[data-focus-key]')) if (node.dataset.focusKey===focusedKey) {node.focus({preventScroll:true});break;}
}
function setEmpty(title,copy,actionText,action) {$('empty-title').textContent=title;$('empty-copy').textContent=copy;$('empty-action').textContent=actionText;$('empty-action').hidden=!action;emptyAction=action;}
function photoElement(product,sample,eager=true) {
  const wrapper=element('div','glass-photo'),img=element('img');img.src=product.image;img.alt=`${product.name}, actual Bullseye medium-frit photograph`;img.loading=eager?'eager':'lazy';img.width=600;img.height=600;img.decoding='async';wrapper.append(img);
  if (sample && Number.isFinite(sample.x) && Number.isFinite(sample.y)) {const marker=element('span','sample-marker');marker.style.left=`${clamp(sample.x,0,1)*100}%`;marker.style.top=`${clamp(sample.y,0,1)*100}%`;marker.setAttribute('aria-hidden','true');wrapper.append(marker);}
  return wrapper;
}
function renderNoMatch(target) {
  const row=element('article','product-card no-match-card');row.dataset.targetId=target.id;
  const swatch=element('span','no-match-swatch',targetNumber(target));swatch.style.backgroundColor=target.hex;
  const body=element('div');body.append(element('h3','product-name',`Color ${targetNumber(target)} · ${target.hex}`),element('p','','No close glass match.'));
  const edit=element('button','row-alternatives','Edit color');edit.type='button';edit.addEventListener('click',()=>{selectTarget(target.id);$('target-hex').focus();});body.append(edit);row.append(swatch,body);return row;
}
function renderProduct(entry) {
  const {product,sample,target}=entry,variant=currentVariant(product);
  const row=element('article',`product-card${selectedItem(product,variant)?' is-selected':''}`);row.dataset.productId=product.id;if(target)row.dataset.targetId=target.id;
  const photo=element('button','photo-button');photo.type='button';photo.setAttribute('aria-label',`Inspect ${product.name} color photograph`);photo.append(photoElement(product,sample));photo.addEventListener('click',()=>openDetail(product,sample));
  const body=element('div','product-card-content');body.append(element('h3','product-name',product.name),element('p','product-code',product.code));
  if (sample) {
    const label=element('p','match-label'),swatch=element('span','small-swatch');swatch.style.backgroundColor=sample.hex||colorHex(sample.rgb);
    if(target)label.append(element('span','target-tag',`Color ${targetNumber(target)}`));
    label.append(swatch,element('span','',`${sampleDarkness(sample)}% darkness`));body.append(label);
    const quality=element('p','match-quality',entry.deltaE<=5?'Very close match':'Within match range');quality.title=`Full-color difference: ${Number(entry.deltaE).toFixed(1)} ΔE00`;
    if (target && state.view==='palette') {const alternatives=element('button','row-alternatives','Alternatives');alternatives.type='button';alternatives.addEventListener('click',()=>showAlternatives(target.id));quality.append(alternatives);}
    else if(target && state.view==='alternatives') {const choose=element('button','row-alternatives','Use for this color');choose.type='button';choose.addEventListener('click',()=>{state.chosenMatches[target.id]=product.id;setView('palette');});quality.append(choose);}
    body.append(quality);
  } else {
    const strip=element('div','sample-strip');strip.setAttribute('aria-label',`Sampled colors for ${product.name}`);
    for(const photographed of product.samples||[]){const swatch=element('span');swatch.style.backgroundColor=photographed.hex||colorHex(photographed.rgb);swatch.title=sampleLabel(product,photographed);strip.append(swatch);}body.append(strip);
  }
  body.append(element('p','product-sample-caption',`${product.type || 'Glass'} · ${product.grain || 'Medium frit'}`));
  row.append(photo,body,purchaseControls(product,false,target?.id));return row;
}

function variantSelect(product,chosen,onChange,focusKey) {
  const select=element('select','variant-select');select.setAttribute('aria-label',`Jar size for ${product.name}`);if(focusKey)select.dataset.focusKey=focusKey;
  for(const variant of product.variants||[]){const option=element('option','',`${variant.title}${variant.available?'':' · unavailable'}`);option.value=String(variant.id);option.disabled=!variant.available;option.selected=String(variant.id)===String(chosen?.id);select.append(option);}
  if(!product.variants?.length)select.append(element('option','','See Bullseye for sizes'));select.disabled=!product.variants?.some(variant=>variant.available);
  select.addEventListener('change',()=>onChange(select.value));return select;
}
function purchaseControls(product,inDetail=false,targetId='') {
  const controls=element('div','product-purchase'),variant=currentVariant(product),selected=selectedItem(product,variant);
  const focusPrefix=`${inDetail?'detail':'row'}-${targetId}-${product.id}`;
  const select=variantSelect(product,variant,value=>{
    const old=selectedItem(product,currentVariant(product));
    state.selectedVariants[product.id]=value;
    if(old)changeCartVariant(old.key,value);else{renderResults();if(detailProduct?.id===product.id)renderDetailPurchase();persist();}
  },`${focusPrefix}-variant`);
  const quantity=element('input','quantity-field');quantity.type='number';quantity.min='1';quantity.max='999';quantity.step='1';quantity.value=selected?.quantity||state.quantities[variantKey(product,variant||{})]||1;quantity.title='Quantity';quantity.dataset.quantityKey=variantKey(product,variant||{});quantity.dataset.focusKey=`${focusPrefix}-quantity`;quantity.setAttribute('aria-label',`Quantity of ${product.name}`);quantity.disabled=!variant?.available;
  quantity.addEventListener('change',()=>{const amount=clamp(Math.round(Number(quantity.value)||1),1,999);state.quantities[variantKey(product,variant||{})]=amount;if(selected)changeQuantity(selected.key,amount);else{syncQuantityControls(variantKey(product,variant||{}),amount);persist();}});
  const row=element('div','select-row'),label=element('label','select-glass'),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=!!selected;checkbox.dataset.focusKey=`${focusPrefix}-selected`;checkbox.setAttribute('aria-label',`${selected?'Remove':'Select'} ${product.name}, ${variant?.title||'glass'}`);checkbox.disabled=!selected&&(!variant?.available||!variant?.sku);
  checkbox.addEventListener('change',()=>toggleGlass(product,variant));label.append(checkbox,element('span','',selected?'Selected':'Select'));
  row.append(element('span','product-price',variant?money(variant.price):'View item'),label);controls.append(select,quantity,row);return controls;
}
function makeCartItem(product,variant,quantity=1) {return {key:variantKey(product,variant),productId:product.id,variantId:variant.id,sku:variant.sku,name:product.name,image:product.image,title:variant.title,price:Number(variant.price)||0,available:Boolean(variant.available),quantity:clamp(Math.round(Number(quantity)||1),1,999)};}
function toggleGlass(product,variant) {
  if(!variant)return;const key=variantKey(product,variant),index=state.cart.findIndex(item=>item.key===key);
  if(index!==-1)state.cart.splice(index,1);else state.cart.push(makeCartItem(product,variant,state.quantities[key]||1));
  renderResults();renderCart();if(detailProduct)renderDetailPurchase();persist();
}
function removeCartItem(key) {state.cart=state.cart.filter(item=>item.key!==key);renderResults();renderCart();if(detailProduct)renderDetailPurchase();persist();}
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
  const index=state.cart.findIndex(item=>item.key===key);if(index<0)return;const current=state.cart[index],product=getProduct(current.productId),variant=getVariant(product,variantId);if(!variant)return;
  const updated=makeCartItem(product,variant,current.quantity),existing=state.cart.find(item=>item.key===updated.key&&item.key!==key);
  if(existing){existing.quantity=clamp(existing.quantity+updated.quantity,1,999);state.cart.splice(index,1);}else state.cart[index]=updated;
  state.selectedVariants[product.id]=variantId;state.quantities[updated.key]=updated.quantity;renderResults();renderCart();if(detailProduct)renderDetailPurchase();persist();
}
function renderCartSummary() {
  const count=new Set(state.cart.map(item=>item.productId)).size,jars=state.cart.reduce((sum,item)=>sum+item.quantity,0),total=state.cart.reduce((sum,item)=>sum+item.quantity*item.price,0);
  $('cart-count').textContent=count;$('open-cart').setAttribute('aria-label',`Review selected glass, ${count} colors and ${jars} jars`);$('selection-total').textContent=count?` · ${money(total)}`:'';$('cart-total').textContent=money(total);$('cart-empty').hidden=!!state.cart.length;$('cart-bottom').hidden=!state.cart.length;
  renderSendButtons();
}
function renderCart() {
  renderCartSummary();
  $('cart-items').replaceChildren();
  for(const item of state.cart){const product=getProduct(item.productId),variant=getVariant(product,item.variantId);if(!product||!variant)continue;const row=element('div','cart-item'),photo=element('div','cart-item-image'),img=element('img');img.src=product.image;img.alt=product.name;photo.append(img);const body=element('div');body.append(element('h3','cart-item-name',product.name),element('p','cart-item-code',item.sku),variantSelect(product,variant,value=>changeCartVariant(item.key,value)));const bottom=element('div','cart-item-bottom'),quantity=element('input','quantity-field');quantity.type='number';quantity.min='1';quantity.max='999';quantity.value=item.quantity;quantity.dataset.quantityKey=item.key;quantity.setAttribute('aria-label',`Quantity of selected ${product.name}`);quantity.addEventListener('change',()=>changeQuantity(item.key,quantity.value));const price=element('span','cart-item-price',money(item.price*item.quantity));price.dataset.cartPriceKey=item.key;bottom.append(quantity,price);body.append(bottom);if(!variant.available)body.append(element('p','section-note','Unavailable. Choose another jar size.'));const remove=element('button','icon-button cart-item-remove','×');remove.type='button';remove.setAttribute('aria-label',`Remove ${product.name}, ${variant.title} from selection`);remove.addEventListener('click',()=>removeCartItem(item.key));row.append(photo,body,remove);$('cart-items').append(row);}
  renderSendButtons();
}
function renderSendButtons() {
  const fingerprint=cartFingerprint();
  const sent=state.cart.length&&state.sentCartFingerprint===fingerprint;
  const uncertain=state.cartUnconfirmed===fingerprint;
  $('view-bullseye-cart').hidden=!sent&&!uncertain;
  for(const id of ['send-to-cart','send-cart-dialog']){$(id).disabled=!state.cart.length||state.sending||!!sent||uncertain;$(id).textContent=state.sending?'Adding to cart…':sent?'Added to cart ✓':uncertain?'Check your cart':'Send to my cart';}
}
function renderAccount() {
  const account=state.account,status=$('account-status');status.classList.toggle('is-signed-in',account.signedIn===true);status.classList.toggle('is-error',account.signedIn===false);
  status.textContent=account.signedIn===true?'Signed in to Bullseye':account.signedIn===false?'Sign in to Bullseye before sending your glass.':account.status==='checking'?'Checking Bullseye sign-in…':account.status==='preview'?'Cart sending is available in the installed extension.':'Bullseye sign-in will be checked before adding glass.';
  $('sign-in').hidden=account.signedIn===true||account.status==='checking'||account.status==='preview';$('check-account').hidden=account.signedIn===true||account.status==='checking'||account.status==='preview';renderSendButtons();
}
async function checkAccount(force=false) {
  if(accountCheck)return accountCheck;if(!force&&Date.now()-lastAccountCheck<1500)return;lastAccountCheck=Date.now();
  accountCheck=(async()=>{try{state.account=await bridge.getBullseyeAccount();}catch(error){state.account={signedIn:null,status:'unknown',message:error.message};}finally{renderAccount();accountCheck=null;}})();return accountCheck;
}
async function signIn() {try{await bridge.signInToBullseye();notify('Sign in on Bullseye, then return here to send your glass.');}catch(error){notify(error.message||'Bullseye sign-in could not open.',true);}}
async function sendSelection() {
  if(state.sending||!state.cart.length||state.cartUnconfirmed===cartFingerprint()||state.sentCartFingerprint===cartFingerprint())return;
  const invalid=state.cart.find(item=>!getVariant(getProduct(item.productId),item.variantId)?.available);if(invalid){notify(`Choose an available jar size for ${invalid.name}.`,true);return;}
  const fingerprint=cartFingerprint(),items=state.cart.map(item=>({variantId:Number(item.variantId),quantity:item.quantity}));
  state.sending=true;renderSendButtons();
  try{const result=await bridge.sendToCart(items);if(!result?.added)throw new Error('Bullseye did not confirm the cart addition.');state.sentCartFingerprint=fingerprint;state.account={signedIn:true,status:'signed_in'};$('cart-dialog').close();notify(`${result.itemCount||items.reduce((sum,item)=>sum+item.quantity,0)} jars added to your Bullseye cart.`,false,7000);persist();}
  catch(error){if(error.authRequired){state.account=error.account||{signedIn:error.code==='SIGN_IN_REQUIRED'?false:null,status:error.code==='SIGN_IN_REQUIRED'?'signed_out':'unknown'};$('cart-dialog').close();}if(error.uncertain){state.cartUnconfirmed=fingerprint;$('cart-dialog').close();persist();}notify(error.message||'Your glass could not be added to Bullseye.',true,9000);}
  finally{state.sending=false;renderAccount();}
}
function orderLines(){const quantities=new Map();for(const item of state.cart)if(item.sku)quantities.set(item.sku,(quantities.get(item.sku)||0)+item.quantity);return Array.from(quantities,([sku,quantity])=>`${sku} ${quantity}`).join('\n');}
async function copyOrder(){try{await navigator.clipboard.writeText(orderLines());notify('SKU list copied.');}catch{notify('This browser could not copy the list.',true);}}

function renderAll(){renderPalette();renderResults();renderCart();renderAccount();}
function setView(view){state.view=view;renderResults();persist();}
function selectTarget(id){state.activeTargetId=id;if(state.view==='library')state.view='palette';renderPalette();renderResults();persist();}
function showAlternatives(id){state.activeTargetId=id;state.view='alternatives';renderPalette();renderResults();persist();}
function removeTarget(id){const index=state.targets.findIndex(target=>target.id===id);state.targets=state.targets.filter(target=>target.id!==id);delete state.chosenMatches[id];if(!activeTarget())state.activeTargetId=state.targets[Math.max(0,index-1)]?.id||null;renderPalette();renderResults();persist();}
function addTarget(rgb,point=null){if(state.targets.length>=MAX_TARGETS){notify(`Remove a color before adding more than ${MAX_TARGETS}.`,true);return null;}const target=normalizeTarget({id:`manual-${Date.now()}-${++manualTargetId}`,rgb,manual:true,...point});state.targets.push(target);state.activeTargetId=target.id;state.view='palette';renderPalette();renderResults();persist();return target;}
function createCustomTarget(){const rgb=activeTarget()?.rgb||[83,121,103],target=addTarget(rgb,nearestSourcePoint(rgb));if(target){target.custom=true;renderPalette();$('target-color').click();}}
function editTarget(hex){const normalized=hex.startsWith('#')?hex:`#${hex}`;if(!/^#[0-9a-f]{6}$/i.test(normalized)){$('target-hex').setAttribute('aria-invalid','true');return false;}const target=activeTarget();if(!target)return false;target.rgb=[1,3,5].map(index=>parseInt(normalized.slice(index,index+2),16));target.hex=normalized.toUpperCase();target.lab=rgbToLab(target.rgb);target.manual=true;target.custom=true;target.weight=0;delete state.chosenMatches[target.id];renderPalette();renderResults();persist();return true;}
function extractStartingColors(preserveManual=true){if(!state.imageData)return;const manual=preserveManual?state.targets.filter(target=>target.manual):[],manualHexes=new Set(manual.map(target=>target.hex));const extracted=extractPalette(state.imageData,{count:state.paletteCount}).map((target,index)=>normalizeTarget({...target,id:`auto-${index}-${colorHex(target.rgb)}`,manual:false})).filter(target=>!manualHexes.has(target.hex));state.targets=[...extracted.slice(0,MAX_TARGETS-manual.length),...manual];if(!activeTarget())state.activeTargetId=state.targets[0]?.id||null;renderPalette();renderResults();persist();}
function changePaletteCount(value){state.paletteCount=clamp(Math.round(Number(value)||6),2,12);extractStartingColors(true);}
function pickSourceColor(event){const point=pointerPoint(event);if(!point)return;const rgb=sampleImagePoint(point);if(!rgb){notify('That area is transparent. Pick a visible color.');return;}addTarget(rgb,point);}

function decodeImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not open. Try PNG, JPEG, or WebP.'));image.src=url;});}
async function loadImage(dataUrl,options={}){
  const requestId=options.requestId??++imageLoadId;if(requestId!==imageLoadId)return;
  try{
    const image=await decodeImage(dataUrl);if(requestId!==imageLoadId)return;
    const scale=Math.min(1,1100/Math.max(image.naturalWidth,image.naturalHeight));
    sourceCanvas.width=Math.max(1,Math.round(image.naturalWidth*scale));sourceCanvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    sourceContext.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);sourceContext.drawImage(image,0,0,sourceCanvas.width,sourceCanvas.height);
    state.imageData=sourceContext.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);state.sourceDataUrl=sourceCanvas.toDataURL('image/png');
    state.sourceName=options.name||'Your image';state.sourceUrl=options.sourceUrl||'';
    $('source-name').textContent=state.sourceName;$('source-name').title=state.sourceName;
    $('drop-zone').hidden=true;$('image-loaded').hidden=false;$('clear-image').hidden=false;$('replace-image').textContent='Replace';$('image-access-note').hidden=true;pendingAccessUrl='';
    if(!options.restore||!state.targets.length){state.targets=[];state.activeTargetId=null;state.view='palette';state.chosenMatches={};state.savedPaletteId=null;state.savedPaletteName='';extractStartingColors(false);}
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
async function clearImage(){const requestId=await beginManualImage();if(requestId===null)return;state.imageData=null;state.sourceDataUrl='';state.sourceName='';state.sourceUrl='';state.targets=[];state.activeTargetId=null;state.view='library';state.chosenMatches={};state.savedPaletteId=null;state.savedPaletteName='';sourceContext.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);$('drop-zone').hidden=false;$('image-loaded').hidden=true;$('clear-image').hidden=true;$('replace-image').textContent='Choose image';$('source-name').textContent='Your image';$('image-access-note').hidden=true;renderAll();persist();}
async function handlePendingImage(pending){if(!pending||cancellingImageId)return;const updatedAt=Number(pending.updatedAt)||0;if(updatedAt&&updatedAt<=state.lastPendingImageAt)return;if(pending.dataUrl){pendingReceivedThisSession=true;if(updatedAt)state.lastPendingImageAt=updatedAt;await loadImage(pending.dataUrl,{name:pending.name||'Image from the web',sourceUrl:pending.sourceUrl});return;}if(pending.needsPermission&&pending.sourceUrl){pendingAccessUrl=pending.sourceUrl;$('image-access-copy').textContent='Allow access to read this photo, or use Capture.';$('allow-image-access').hidden=false;$('image-access-note').hidden=false;}else if(pending.error){$('image-access-copy').textContent=`${pending.error} Use Capture or choose a saved image.`;$('allow-image-access').hidden=true;$('image-access-note').hidden=false;}}
async function pasteImage(){if(!navigator.clipboard?.read){notify('Press Ctrl+V with an image copied, or choose an image file.');return;}try{const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(entry=>entry.startsWith('image/'));if(type){await readFile(new File([await item.getType(type)],'Pasted image',{type}));return;}}notify('Copy an image, then paste it here.');}catch{notify('Press Ctrl+V with an image copied, or choose an image file.');}}

async function openSaved(saveCurrent=false){$('save-palette-form').hidden=!state.targets.length;$('palette-name').value=state.savedPaletteName||(state.sourceName||'My palette').replace(/\.[a-z0-9]{2,5}$/i,'').slice(0,80);updateSaveLabel();$('saved-dialog').showModal();await renderSavedList();if(saveCurrent)$('palette-name').select();}
function updateSaveLabel(){$('confirm-save-palette').textContent=state.savedPaletteId&&$('palette-name').value.trim()===state.savedPaletteName?'Update':'Save';}
async function renderSavedList(){
  const list=$('saved-list');list.replaceChildren(element('p','saved-empty','Loading saved palettes…'));
  try{
    const palettes=await listPalettes();list.replaceChildren();if(!palettes.length)list.append(element('p','saved-empty','No saved palettes yet.'));
    for(const palette of palettes){
      const row=element('div','saved-row'),body=element('div');body.append(element('strong','',palette.name),element('p','',`${palette.colorCount} colors · ${palette.glassCount} glass selected · ${new Date(palette.updatedAt).toLocaleDateString()}`));
      const load=element('button','button secondary-button','Load');load.type='button';load.setAttribute('aria-label',`Load palette ${palette.name}`);load.addEventListener('click',()=>restoreSavedPalette(palette.id));
      const remove=element('button','text-button delete-palette','Delete');remove.type='button';remove.setAttribute('aria-label',`Delete palette ${palette.name}`);
      remove.addEventListener('click',async()=>{remove.disabled=true;try{await deletePalette(palette.id);if(state.savedPaletteId===palette.id){state.savedPaletteId=null;state.savedPaletteName='';persist();}await renderSavedList();}catch(error){notify(error.message,true);remove.disabled=false;}});
      row.append(body,load,remove);list.append(row);
    }
  }catch(error){list.replaceChildren(element('p','saved-empty',error.message||'Saved palettes could not open.'));}
}
async function saveCurrentPalette(event){event.preventDefault();const button=$('confirm-save-palette');button.disabled=true;try{const name=$('palette-name').value.trim(),id=state.savedPaletteId&&name===state.savedPaletteName?state.savedPaletteId:null;const result=await savePalette(name,workspaceSnapshot(),id);state.savedPaletteId=result.id;state.savedPaletteName=result.name;persist();$('saved-dialog').close();notify(`Saved “${result.name}”.`);}catch(error){notify(error.message||'This palette could not be saved.',true);}finally{button.disabled=false;}}
async function restoreSavedPalette(id){
  const requestId=await beginManualImage();if(requestId===null)return;
  try{
    const palette=await loadPalette(id);if(requestId!==imageLoadId)return;if(!palette)throw new Error('This saved palette no longer exists.');
    restoreWorkspace({...palette.workspace,savedPaletteId:palette.id,savedPaletteName:palette.name,sentCartFingerprint:'',cartUnconfirmed:false});state.query='';$('glass-search').value='';
    if(palette.workspace.sourceDataUrl)await loadImage(palette.workspace.sourceDataUrl,{name:palette.workspace.sourceName,sourceUrl:palette.workspace.sourceUrl,restore:true,requestId});
    else{state.imageData=null;state.sourceDataUrl='';state.sourceName='';state.sourceUrl='';$('drop-zone').hidden=false;$('image-loaded').hidden=true;$('clear-image').hidden=true;$('replace-image').textContent='Choose image';$('source-name').textContent='Your image';renderAll();}
    if(requestId!==imageLoadId)return;$('saved-dialog').close();renderAll();persist();notify(`Loaded “${palette.name}”.`);
  }catch(error){if(requestId===imageLoadId)notify(error.message||'This palette could not be loaded.',true);}
}

function openDetail(product,sample){detailProduct=product;detailSample=sample||[...(product.samples||[])].sort((a,b)=>sampleDarkness(b)-sampleDarkness(a))[0]||null;$('detail-code').textContent=`${product.code} · ${product.type||'Glass'} medium frit`;$('detail-title').textContent=product.name;$('detail-product-link').href=product.productUrl;renderDetailSample();renderDetailPurchase();$('detail-dialog').showModal();refreshProduct(product);}
function renderDetailSample(){if(!detailProduct)return;$('detail-photo').replaceChildren(photoElement(detailProduct,detailSample));$('detail-sample-label').textContent=sampleLabel(detailProduct,detailSample);$('detail-samples').replaceChildren();for(const sample of detailProduct.samples||[]){const button=element('button',`detail-sample${sample===detailSample?' is-active':''}`);button.type='button';button.setAttribute('aria-label',`Show ${sampleLabel(detailProduct,sample)}`);button.setAttribute('aria-pressed',String(sample===detailSample));button.title=sampleLabel(detailProduct,sample);const swatch=element('span');swatch.style.backgroundColor=sample.hex||colorHex(sample.rgb);button.append(swatch,element('small','',`${sampleDarkness(sample)}%`));button.addEventListener('click',()=>{detailSample=sample;renderDetailSample();});$('detail-samples').append(button);}}
function renderDetailPurchase(){if(detailProduct)$('detail-purchase').replaceChildren(purchaseControls(detailProduct,true));}
async function refreshProduct(product){if(Date.now()-(freshProducts.get(product.id)||0)<300000)return;freshProducts.set(product.id,Date.now());try{const updated=await bridge.fetchProductVariants(product.handle);if(!Array.isArray(updated?.variants)||!updated.variants.length)return;product.variants=updated.variants.map(variant=>({...variant,price:Number(variant.price)||0}));for(const item of state.cart.filter(entry=>entry.productId===product.id)){const variant=getVariant(product,item.variantId);if(variant)Object.assign(item,makeCartItem(product,variant,item.quantity));}renderResults();renderCart();if(detailProduct?.id===product.id)renderDetailPurchase();persist();}catch(error){console.info('Using bundled glass product information:',error);}}

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

function bindEvents() {
  window.addEventListener('pagehide', flushSave);
  $('show-alternatives').addEventListener('click', () => { if (state.activeTargetId) showAlternatives(state.activeTargetId); });
  $('back-to-palette').addEventListener('click', () => setView('palette'));
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
  $('match-range').addEventListener('input', (event) => {
    state.tolerance = Number(event.target.value); renderResults(); persist();
  });
  $('glass-search').addEventListener('input', (event) => { state.query = event.target.value; renderResults(); });
  $('empty-action').addEventListener('click', () => emptyAction?.());
  $('open-workspace').addEventListener('click', () => {
    try { Promise.resolve(bridge.openWorkspace()).catch((error) => notify(error.message || 'Could not open a larger workspace.', true)); }
    catch (error) { notify(error.message || 'Could not open a larger workspace.', true); }
  });
  for (const id of ['open-cart']) $(id).addEventListener('click', () => { renderCart(); $('cart-dialog').showModal(); });
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
  for (const id of ['send-to-cart', 'send-cart-dialog']) $(id).addEventListener('click', sendSelection);
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
  bindEvents();
  try {
    const [catalogResult, savedResult] = await Promise.allSettled([
      fetch('./data/catalog.json').then((response) => {
        if (!response.ok) throw new Error(`Catalog could not be loaded (${response.status}).`);
        return response.json();
      }),
      bridge.loadState(),
    ]);
    if (catalogResult.status !== 'fulfilled') throw catalogResult.reason;
    const catalog = catalogResult.value;
    state.products = Array.isArray(catalog.products) ? catalog.products : [];
    $('catalog-scope').textContent = `${state.products.length} colors · Medium frit`;
    $('library-count').textContent = String(state.products.length);
    const saved = savedResult.status === 'fulfilled' ? savedResult.value : null;
    restoreWorkspace(saved);
    renderAll();
    checkAccount(true);
    bridge.subscribePendingImage((image) => handlePendingImage(image));
    let pending = null;
    try { pending = await bridge.getPendingImage(); }
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
    setEmpty('The glass catalog could not load.', 'Reload the extension, or open this page through its local web server.', 'Reload', () => window.location.reload());
    notify(error.message || 'The glass catalog could not load.', true);
  }
}

initialize();
