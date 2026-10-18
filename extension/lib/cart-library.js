/**
 * Named cart list and editor. Drafts are independent copies of the photo palette.
 * Saved items retain exact jar sizes and quantities; new colors prefer 5 lb jars.
 * Only a Send button invokes sendItems. Saving, editing, and duplicating are local.
 */
import {listCarts, saveCart, loadCart, duplicateCart, deleteCart, copiedCartName, normalizeCartItems} from './saved-carts.js';
import {FORM_OPTIONS, defaultFormatVariant} from './product-formats.js';

const $ = id => document.getElementById(id);
const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);

export function initializeCartLibrary({getProducts, getSelection, getSelectionName, sendItems, getSendState, getAccount, getPreferredJarSize = ()=>'5lb', signIn, notify}) {
  let draft = null, records = [], saving = false, listRequest = 0, editorRequest = 0;
  const listDialog = $('saved-carts-dialog'), editorDialog = $('cart-editor-dialog');
  const productFor = id => getProducts().find(product => product.id === id);
  const variantFor = (product, id) => product?.variants?.find(variant => String(variant.id) === String(id)) || product?.allVariants?.find(variant=>String(variant.id)===String(id));
  const itemFor = (product, variant, quantity = 1) => ({
    key:`${product.id}:${variant.id}`, productId:product.id, variantId:variant.id, quantity,
    name:product.name, sku:variant.sku, title:variant.title, image:product.image,
    price:Number(variant.price) || 0, available:Boolean(variant.available),
    form:variant.form || product.form || 'medium',
  });
  const hydrate = items => normalizeCartItems(items).map(item => {
    const product = productFor(item.productId), variant = variantFor(product, item.variantId);
    return product && variant ? itemFor(product, variant, item.quantity) : {...item, available:false};
  });
  const units = items => items.some(item=>item.form==='sheets')?'items':'jars';
  const summary = items => `${new Set(items.map(item => item.productId)).size} colors · ${items.reduce((sum,item) => sum + item.quantity, 0)} ${units(items)} · ${money(items.reduce((sum,item) => sum + item.price * item.quantity, 0))}`;

  function message(text = '', error = false) {
    for (const id of ['saved-carts-message','saved-cart-message']) {
      $(id).textContent = text; $(id).hidden = !text; $(id).classList.toggle('is-error', error);
    }
  }
  function photo(productId, name) {
    const wrap = node('div', 'saved-cart-photo'), product = productFor(productId);
    if (product?.image) {
      const image = node('img'); image.src = product.image; image.alt = name; image.loading = 'lazy'; wrap.append(image);
    }
    return wrap;
  }
  function applySendState(button, items) {
    const status = getSendState(items);
    button.disabled = saving || !items.length || status.busy || status.sent || status.uncertain;
    button.textContent = status.sending ? 'Adding to cart…' : status.sent ? 'Added to cart ✓' : status.uncertain ? 'Check your cart' : 'Send to my cart';
  }
  function refresh() {
    for (const id of ['save-cart','save-cart-selection']) $(id).disabled = !getSelection().length || saving;
    $('open-saved-carts').disabled = saving;
    for (const button of $('saved-carts-list').querySelectorAll('[data-send-cart-id]')) {
      const cart = records.find(record => record.id === button.dataset.sendCartId);
      if (cart) applySendState(button, hydrate(cart.items));
    }
    for (const button of document.querySelectorAll('[data-cart-mutation]')) button.disabled = saving;
    const needsSignIn = getAccount()?.signedIn === false;
    $('saved-carts-sign-in').hidden = !needsSignIn; $('saved-cart-sign-in').hidden = !needsSignIn;
    if (!draft) return;
    $('saved-cart-name').disabled = saving;
    $('saved-cart-search').disabled = saving;
    for (const input of $('saved-cart-items').querySelectorAll('input')) input.disabled = saving;
    for (const button of $('saved-cart-items').querySelectorAll('button')) button.disabled = saving;
    $('saved-cart-summary').textContent = summary(draft.items);
    $('saved-cart-draft-status').textContent = draft.dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'New cart';
    $('save-cart-draft').disabled = saving || !draft.name.trim();
    $('save-cart-draft').textContent = saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save cart';
    $('duplicate-cart-draft').disabled = saving || !draft.name.trim();
    applySendState($('send-saved-cart'), draft.items);
  }
  function markChanged() { draft.dirty = true; message(); refresh(); }
  async function storageAction(action) {
    if (saving) return;
    const frozen = [...listDialog.querySelectorAll('button,input,select'), ...editorDialog.querySelectorAll('button,input,select')].map(control => [control,control.disabled]);
    for (const [control] of frozen) control.disabled = true;
    saving = true; message(); refresh();
    try { await action(); }
    catch (error) { message(error.message || 'This cart could not be saved.', true); }
    finally { saving = false; for (const [control,disabled] of frozen) if (control.isConnected) control.disabled = disabled; refresh(); }
  }

  async function renderList() {
    const request = ++listRequest;
    $('saved-carts-list').replaceChildren(node('p', 'saved-empty', 'Loading saved carts…'));
    try {
      const loaded = await listCarts(); if (request !== listRequest) return;
      records = loaded; const list = $('saved-carts-list'); list.replaceChildren();
      if (!records.length) list.append(node('p', 'saved-empty', 'No saved carts yet. Save your selected glass or create a new cart.'));
      for (const record of records) {
        const items = hydrate(record.items), card = node('article', 'saved-cart-card'); card.dataset.cartId = record.id;
        const preview = node('div', 'saved-cart-preview');
        for (const item of [...new Map(items.map(item => [item.productId,item])).values()].slice(0,5)) preview.append(photo(item.productId,item.name));
        const heading = node('div', 'saved-cart-card-heading'); heading.append(node('h3','',record.name),node('p','',summary(items)));
        const actions = node('div', 'saved-cart-card-actions');
        for (const [label, action] of [
          ['Edit', () => editSaved(record.id)],
          ['Duplicate', () => storageAction(async () => { const copy = await duplicateCart(record.id); await renderList(); openEditor(copy); })],
          ['Delete', () => storageAction(async () => { await deleteCart(record.id); if (draft?.id === record.id) draft = null; await renderList(); })],
        ]) {
          const button = node('button', label === 'Delete' ? 'text-button delete-saved-cart' : 'button secondary-button', label);
          button.type = 'button'; button.dataset.cartMutation = ''; button.setAttribute('aria-label', `${label} cart ${record.name}`);
          button.addEventListener('click', action); actions.append(button);
        }
        const send = node('button', 'button primary-button', 'Send to my cart'); send.type = 'button'; send.dataset.sendCartId = record.id;
        send.setAttribute('aria-label', `Send ${record.name} to my cart`); send.addEventListener('click', () => sendSaved(record.id)); actions.append(send);
        card.append(heading, preview, actions); list.append(card);
      }
      refresh();
    } catch (error) { if (request === listRequest) $('saved-carts-list').replaceChildren(node('p','saved-empty',error.message)); }
  }
  async function openList() { if (saving) return; editorRequest++; message(); listDialog.showModal(); await renderList(); }
  function openEditor(record = null) {
    editorRequest++;
    draft = {id:record?.id || null, name:record?.name || 'My cart', items:hydrate(record?.items || []), dirty:false};
    listDialog.close(); $('cart-dialog').close();
    $('saved-cart-name').value = draft.name; $('saved-cart-search').value = ''; message(); renderEditor(); renderSearch();
    if (!editorDialog.open) editorDialog.showModal(); $('saved-cart-name').focus();
  }
  function captureSelection() {
    const name = String(getSelectionName() || 'My cart').replace(/\.[a-z0-9]{2,5}$/i,'').slice(0,80);
    openEditor({name, items:getSelection()}); draft.dirty = true; refresh(); $('saved-cart-name').select();
  }
  async function editSaved(id) {
    const request = ++editorRequest;
    try { const record = await loadCart(id); if (request !== editorRequest) return; if (!record) throw new Error('This saved cart no longer exists.'); openEditor(record); }
    catch (error) { if (request === editorRequest) message(error.message, true); }
  }
  async function saveDraft(event) {
    event.preventDefault(); if (!draft) return;
    await storageAction(async () => {
      const saved = await saveCart(draft.name, hydrate(draft.items), draft.id);
      draft = {...saved, dirty:false}; $('saved-cart-name').value = saved.name;
      renderEditor(); renderSearch(); notify(`Saved cart “${saved.name}”.`);
    });
  }
  async function duplicateDraft() {
    if (!draft) return;
    await storageAction(async () => {
      const existing = await listCarts(), name = copiedCartName(draft.name, existing.map(record => record.name));
      const copy = await saveCart(name, hydrate(draft.items)); openEditor(copy); notify(`Created “${copy.name}”.`);
    });
  }
  async function runSend(items) {
    message();
    try {
      const result = await sendItems(hydrate(items));
      message(`${result.itemCount || items.reduce((sum,item) => sum + item.quantity,0)} ${units(items)} added to your Bullseye cart.`);
    } catch (error) { message(error.message || 'These jars could not be added to Bullseye.', true); }
    finally { refresh(); }
  }
  async function sendSaved(id) {
    try { const record = await loadCart(id); if (!record) throw new Error('This saved cart no longer exists.'); await runSend(record.items); }
    catch (error) { message(error.message, true); }
  }

  function renderEditor() {
    const list = $('saved-cart-items'); list.replaceChildren();
    if (!draft.items.length) list.append(node('p','saved-empty','This cart is empty. Add glass below.'));
    for (const item of draft.items) {
      const product = productFor(item.productId), knownVariant = variantFor(product,item.variantId);
      const sizeOptions=product?.allVariants || product?.variants || [];
      const row = node('article','saved-cart-item'); row.dataset.variantId = String(item.variantId);
      const body = node('div','saved-cart-item-body'); body.append(node('h3','',product?.name || item.name || item.productId),node('p','product-code',`${FORM_OPTIONS.find(option=>option.id===item.form)?.grain || 'Glass'} · ${item.sku || item.productId}`));
      const controls = node('div','saved-cart-item-controls'), size = node('select','variant-select');
      size.setAttribute('aria-label',`Jar size for saved ${item.name}`);
      if (!knownVariant) { const missing = node('option','',`${item.title || 'Saved size'} · unavailable`); missing.value = String(item.variantId); size.append(missing); }
      for (const variant of sizeOptions) {
        const option = node('option','',`${FORM_OPTIONS.find(option=>option.id===variant.form)?.label || 'Medium'} · ${variant.title}${variant.available ? '' : ' · unavailable'}`);
        option.value = String(variant.id); option.disabled = !variant.available; size.append(option);
      }
      size.value = String(item.variantId); size.disabled = !sizeOptions.some(variant => variant.available);
      size.addEventListener('change', () => {
        const variant = variantFor(product,size.value); if (!variant?.available) return;
        try { draft.items = normalizeCartItems(draft.items.map(current => current === item ? itemFor(product,variant,item.quantity) : current)); markChanged(); renderEditor(); renderSearch(); }
        catch (error) { size.value = String(item.variantId); message(error.message,true); }
      });
      const quantity = node('input','quantity-field'); quantity.type = 'number'; quantity.min = '1'; quantity.max = '999'; quantity.step = '1'; quantity.value = item.quantity;
      quantity.setAttribute('aria-label',`Quantity of saved ${item.name}`);
      quantity.addEventListener('change', () => {
        item.quantity = Math.min(999,Math.max(1,Math.round(Number(quantity.value) || 1))); quantity.value = item.quantity;
        price.textContent = money(item.price * item.quantity); markChanged();
      });
      const price = node('span','cart-item-price',money(item.price * item.quantity)); controls.append(size,quantity,price); body.append(controls);
      if (!knownVariant?.available) body.append(node('p','cart-unavailable','Saved size is unavailable. Choose another size or remove it.'));
      const remove = node('button','icon-button','×'); remove.type = 'button'; remove.setAttribute('aria-label',`Remove saved ${item.name}, ${item.title}`);
      remove.addEventListener('click', () => { draft.items = draft.items.filter(current => current !== item); markChanged(); renderEditor(); renderSearch(); });
      row.append(photo(item.productId,item.name),body,remove); list.append(row);
    }
    refresh();
  }
  function renderSearch() {
    const list = $('saved-cart-search-results'); list.replaceChildren(); if (!draft) return;
    const query = $('saved-cart-search').value.trim().toLowerCase();
    const products = getProducts().filter(product => `${product.name} ${product.id} ${product.code}`.toLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
    for (const product of products) {
      const variant = defaultFormatVariant(product,product.form,undefined,getPreferredJarSize()), already = variant && draft.items.some(item => String(item.variantId) === String(variant.id));
      const row = node('div','saved-cart-search-result'), label = node('div');
      label.append(node('strong','',product.name),node('span','',`${product.grain || 'Medium frit'} · ${variant?.title || 'Unavailable'}`));
      const add = node('button','button secondary-button',already ? 'Added' : 'Add'); add.type = 'button'; add.disabled = !variant || already;
      add.setAttribute('aria-label',`Add ${product.name} to saved cart`);
      add.addEventListener('click', () => { if (!variant || draft.items.some(item => item.variantId === variant.id)) return; draft.items.push(itemFor(product,variant)); markChanged(); renderEditor(); renderSearch(); });
      row.append(photo(product.id,product.name),label,add); list.append(row);
    }
    if (!products.length) list.append(node('p','saved-empty','No glass by that name or code.'));
  }

  $('open-saved-carts').addEventListener('click',openList);
  $('close-saved-carts').addEventListener('click',() => { editorRequest++; listDialog.close(); });
  $('new-saved-cart').addEventListener('click',() => openEditor());
  $('close-cart-editor').addEventListener('click',() => { editorRequest++; editorDialog.close(); });
  $('back-to-saved-carts').addEventListener('click',() => { editorDialog.close(); openList(); });
  for (const id of ['save-cart','save-cart-selection']) $(id).addEventListener('click',captureSelection);
  $('saved-cart-form').addEventListener('submit',saveDraft);
  $('saved-cart-name').addEventListener('input',() => { if (draft) { draft.name = $('saved-cart-name').value; markChanged(); } });
  $('duplicate-cart-draft').addEventListener('click',duplicateDraft);
  $('send-saved-cart').addEventListener('click',() => { if (draft) runSend(draft.items); });
  $('saved-cart-search').addEventListener('input',renderSearch);
  for (const id of ['saved-carts-sign-in','saved-cart-sign-in']) $(id).addEventListener('click',signIn);
  for (const dialog of [listDialog,editorDialog]) dialog.addEventListener('cancel',event => { if (saving) event.preventDefault(); else editorRequest++; });
  refresh();
  return {refresh};
}
