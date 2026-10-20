/**
 * Named cart list and editor. Drafts are independent copies of the photo palette.
 * Saved items retain exact jar sizes and quantities; new colors prefer 5 lb jars.
 * Only a Send button invokes sendItems. Saving, editing, and duplicating are local.
 */
import {listCarts, saveCart, loadCart, duplicateCart, deleteCart, copiedCartName, normalizeCartItems} from './saved-carts.js';
import {FORM_OPTIONS} from './product-formats.js';
import {includedGlass} from './material-filters.js';
import {sampleThickness} from './palette.js';
import {cartVariants, cartSizeLabel, cartSizeChoices, preferredCartSize, exactCartVariant, switchedCartVariant, cartPurchasable} from './cart-options.js';

const $ = id => document.getElementById(id);
const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);

export function initializeCartLibrary({getProducts, getSelection, getSelectionName, sendItems, getSendState, getAccount, getPreferredJarSize = ()=>'5lb', getFilters = ()=>({}), pageMode=false, openPage, readWebsiteCart, signIn, notify}) {
  let draft = null, records = [], saving = false, listRequest = 0, editorRequest = 0, filters = null, naming = false, addForm = null;
  const addSizes = new Map();
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
    if (!draft) {if(pageMode)$('send-to-cart').disabled=true;return;}
    $('saved-cart-name').disabled = saving;
    $('saved-cart-search').disabled = saving;
    for (const input of $('saved-cart-items').querySelectorAll('input')) input.disabled = saving;
    for (const select of $('saved-cart-items').querySelectorAll('select')) select.disabled = saving || select.dataset.unavailable === 'true';
    $('cart-add-form').disabled = saving;
    $('cart-add-size').disabled = saving || !$('cart-add-size').options.length;
    for (const button of $('saved-cart-items').querySelectorAll('button')) button.disabled = saving;
    $('saved-cart-summary').textContent = summary(draft.items);
    $('saved-cart-draft-status').textContent = draft.dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'New cart';
    $('save-cart-draft').disabled = saving || !draft.name.trim();
    $('save-cart-draft').textContent = saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save cart';
    $('duplicate-cart-draft').disabled = saving || !draft.name.trim();
    applySendState($('send-saved-cart'), draft.items);
    if(pageMode)applySendState($('send-to-cart'),draft.items);
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
          ['Duplicate', () => duplicateSaved(record)],
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
  async function openList() { if (saving) return; if(!pageMode && openPage){await openPage('list');return;} editorRequest++; message(); if(!listDialog.open)listDialog.showModal(); await renderList(); }
  function openEditor(record = null) {
    editorRequest++;
    draft = {id:record?.id || null, name:record?.name || 'My cart', items:hydrate(record?.items || []), dirty:false};
    listDialog.close(); $('cart-dialog').close();
    $('saved-cart-name').value = draft.name; $('saved-cart-search').value = ''; message(); renderEditor(); renderSearch();
    if (!editorDialog.open) {if(pageMode)editorDialog.show();else editorDialog.showModal();} $('saved-cart-name').focus();
  }
  async function captureSelection() {
    if(!pageMode && openPage){await openPage('selection');return;}
    const name = String(getSelectionName() || 'My cart').replace(/\.[a-z0-9]{2,5}$/i,'').slice(0,80);
    openEditor({name, items:getSelection()}); draft.dirty = true; refresh(); $('saved-cart-name').select();
  }
  async function editSaved(id) {
    if(!mayReplaceDraft())return;
    const request = ++editorRequest;
    try { const record = await loadCart(id); if (request !== editorRequest) return; if (!record) throw new Error('This saved cart no longer exists.'); openEditor(record); }
    catch (error) { if (request === editorRequest) message(error.message, true); }
  }
  async function saveDraft(event) {
    event.preventDefault(); if (!draft || saving || naming) return;
    const name=await requestName(draft.name,'Save cart');if(name===null)return;
    await storageAction(async () => {
      const saved = await saveCart(name, hydrate(draft.items), draft.id);
      draft = {...saved, dirty:false}; $('saved-cart-name').value = saved.name;
      renderEditor(); renderSearch(); notify(`Saved cart “${saved.name}”.`);
    });
  }
  async function duplicateDraft() {
    if (!draft || saving || naming) return;
    const name=await requestName(copiedCartName(draft.name || 'My cart',records.map(record=>record.name)),'Duplicate cart');if(name===null)return;
    await storageAction(async () => {
      const copy = await saveCart(name, hydrate(draft.items)); openEditor(copy); notify(`Created “${copy.name}”.`);
    });
  }
  async function duplicateSaved(record) {
    if(saving || naming)return;
    const name=await requestName(copiedCartName(record.name,records.map(value=>value.name)),'Duplicate cart');if(name===null)return;
    await storageAction(async()=>{const copy=await duplicateCart(record.id,name);await renderList();openEditor(copy);});
  }
  function requestName(value, title) {
    naming=true;
    return new Promise(resolve=>{
      const dialog=node('dialog','saved-dialog');dialog.id='cart-name-dialog';
      const shell=node('div','dialog-shell'),heading=node('h2','',title);
      heading.id='cart-name-title';dialog.setAttribute('aria-labelledby',heading.id);
      const form=node('form','save-palette-form'),label=node('label','','Cart name');label.htmlFor='cart-confirm-name';
      const line=node('div'),input=node('input');input.id='cart-confirm-name';input.value=value;input.required=true;input.maxLength=80;
      const save=node('button','button primary-button',title);save.type='submit';save.id='confirm-cart-name';
      const cancel=node('button','button secondary-button','Cancel');cancel.type='button';
      const finish=name=>{dialog.remove();naming=false;resolve(name);};
      form.addEventListener('submit',event=>{event.preventDefault();if(input.value.trim())finish(input.value.trim());});
      cancel.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
      line.append(input,save,cancel);form.append(label,line);shell.append(heading,form);dialog.append(shell);document.body.append(dialog);dialog.showModal();input.select();
    });
  }
  function mayReplaceDraft() {
    return !draft?.dirty || window.confirm('Discard the unsaved changes in this local cart?');
  }
  async function copyWebsiteCart() {
    if(saving || naming || !mayReplaceDraft())return;
    await storageAction(async()=>{
      message('Reading your signed-in Bullseye cart…');
      const result=await readWebsiteCart();
      if(result.currency && result.currency !== 'USD')throw new Error('Only USD carts are supported. Your local cart was not replaced.');
      const items=result.items.map(item=>{
        const product=getProducts().find(product=>variantFor(product,item.variantId));
        const variant=product && variantFor(product,item.variantId);
        return product && variant ? itemFor(product,variant,item.quantity)
          : {...item,productId:`website-${item.variantId}`,available:false};
      });
      const cleaned=normalizeCartItems(items);
      openEditor({name:'My Bullseye cart',items:cleaned});draft.dirty=true;
      const unsupported=cleaned.filter(item=>!productFor(item.productId)).length;
      message(`Copied ${result.itemCount ?? cleaned.reduce((sum,item)=>sum+item.quantity,0)} items. Your website cart was not changed. Save this copy under a name.${unsupported ? ` ${unsupported} items outside the glass catalog are kept in the copy but must be removed before sending from this tool.` : ''}`);
    });
  }
  function thicknessGuide(product) {
    const values=(product?.samples || []).map(sample=>sampleThickness(sample,product)).filter(Number.isFinite);
    if(!values.length)return 'Photo thickness guide unavailable';
    const low=Math.round(Math.min(...values)),high=Math.round(Math.max(...values));
    return `Photo guide: ${low === high ? high : `${low}–${high}`}% thickness`;
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

  function replaceDraftVariant(item, product, variant) {
    if (saving || naming || !cartPurchasable(variant)) return;
    try {
      draft.items = normalizeCartItems(draft.items.map(current => current === item ? itemFor(product,variant,item.quantity) : current));
      markChanged(); renderEditor(); renderSearch();
    } catch (error) { renderEditor(); message(error.message,true); }
  }
  function renderEditor() {
    const list = $('saved-cart-items'); list.replaceChildren();
    if (!draft.items.length) list.append(node('p','saved-empty','This cart is empty. Add glass below.'));
    for (const item of draft.items) {
      const product = productFor(item.productId), knownVariant = variantFor(product,item.variantId);
      const currentForm = knownVariant?.form || item.form || 'medium';
      const sizeOptions = cartVariants(product,currentForm);
      const row = node('article','saved-cart-item'); row.dataset.variantId = String(item.variantId);
      const body = node('div','saved-cart-item-body'); body.append(node('h3','',product?.name || item.name || item.productId),node('p','product-code',`${FORM_OPTIONS.find(option=>option.id===item.form)?.grain || 'Glass'} · ${item.sku || item.productId}`));
      const controls = node('div','saved-cart-item-controls');
      const grade = node('select','variant-select cart-grade-select'), size = node('select','variant-select cart-size-select');
      grade.setAttribute('aria-label',`Grade for saved ${item.name}`);
      for (const form of FORM_OPTIONS) {
        const available = cartVariants(product,form.id).some(cartPurchasable);
        const option = node('option','',`${form.grain}${available ? '' : ' · unavailable'}`);
        option.value=form.id; option.disabled=!available; grade.append(option);
      }
      grade.value=currentForm;
      grade.dataset.unavailable=String(!FORM_OPTIONS.some(form=>cartVariants(product,form.id).some(cartPurchasable)));
      grade.addEventListener('change',()=>replaceDraftVariant(item,product,switchedCartVariant(product,grade.value,knownVariant,getPreferredJarSize())));
      size.setAttribute('aria-label',`${currentForm === 'sheets' ? 'Sheet size and thickness' : 'Jar size'} for saved ${item.name}`);
      if (!knownVariant) { const missing = node('option','',`${item.title || 'Saved size'} · unavailable`); missing.value = String(item.variantId); size.append(missing); }
      for (const variant of sizeOptions) {
        const option = node('option','',`${cartSizeLabel(variant)}${cartPurchasable(variant) ? '' : ' · unavailable'}`);
        option.value=String(variant.id); option.disabled=!cartPurchasable(variant); size.append(option);
      }
      size.value=String(item.variantId); size.dataset.unavailable=String(!sizeOptions.some(cartPurchasable));
      size.addEventListener('change',()=>replaceDraftVariant(item,product,variantFor(product,size.value)));
      const quantity = node('input','quantity-field'); quantity.type = 'number'; quantity.min = '1'; quantity.max = '999'; quantity.step = '1'; quantity.value = item.quantity;
      quantity.setAttribute('aria-label',`Quantity of saved ${item.name}`);
      quantity.addEventListener('change', () => {
        item.quantity = Math.min(999,Math.max(1,Math.round(Number(quantity.value) || 1))); quantity.value = item.quantity;
        price.textContent = money(item.price * item.quantity); markChanged();
      });
      const price = node('span','cart-item-price',money(item.price * item.quantity)); controls.append(grade,size,quantity,price); body.append(controls);
      if(product)body.append(node('p','cart-thickness',thicknessGuide(product)));
      if (!knownVariant?.available) body.append(node('p','cart-unavailable',product?'Saved size is unavailable. Choose another size or remove it.':'Copied website item outside this glass catalog. Kept in this copy; remove it before sending with this tool.'));
      const remove = node('button','icon-button','×'); remove.type = 'button'; remove.setAttribute('aria-label',`Remove saved ${item.name}, ${item.title}`);
      remove.addEventListener('click', () => { draft.items = draft.items.filter(current => current !== item); markChanged(); renderEditor(); renderSearch(); });
      row.append(photo(item.productId,item.name),body,remove); list.append(row);
    }
    refresh();
  }
  function renderSearch() {
    const list = $('saved-cart-search-results'); list.replaceChildren(); if (!draft) return;
    const query = $('saved-cart-search').value.trim().toLowerCase();
    addForm ||= getProducts()[0]?.form || 'medium';
    $('cart-add-form').value=addForm;
    const sizes=cartSizeChoices(getProducts(),addForm);
    const sizeKey=preferredCartSize(sizes,addForm,addSizes.get(addForm) || getPreferredJarSize());
    addSizes.set(addForm,sizeKey);
    const sizeControl=$('cart-add-size'); sizeControl.replaceChildren();
    for (const choice of sizes) {
      const option=node('option','',`${choice.label}${choice.available ? '' : ' · unavailable'}`);
      option.value=choice.key; option.disabled=!choice.available; sizeControl.append(option);
    }
    sizeControl.value=sizeKey;
    $('cart-add-size-label').textContent=addForm==='sheets' ? 'Size / thickness' : 'Size';
    sizeControl.setAttribute('aria-label',addForm==='sheets'?'Sheet size and thickness to add':'Jar size to add');
    sizeControl.title=sizeControl.selectedOptions[0]?.textContent || '';
    const gradeLabel=FORM_OPTIONS.find(option=>option.id===addForm)?.grain || 'Glass';
    filters ||= structuredClone(getFilters());
    filters.glassTypes ||= {transparent:true,opalescent:true};
    for(const kind of ['transparent','opalescent'])$(`cart-include-${kind}`).setAttribute('aria-pressed',String(filters.glassTypes[kind] !== false));
    $('cart-include-tints').setAttribute('aria-pressed',String(filters.includeTints === true));
    const products = getProducts().filter(product => includedGlass(product,filters) && `${product.name} ${product.id} ${product.code}`.toLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
    for (const product of products) {
      const variant = exactCartVariant(product,addForm,sizeKey), already = variant && draft.items.some(item => String(item.variantId) === String(variant.id));
      const row = node('div','saved-cart-search-result'), label = node('div');
      row.dataset.productId=product.id; row.dataset.variantId=variant ? String(variant.id) : '';
      const requestedSize=sizes.find(choice=>choice.key===sizeKey)?.label || 'this size';
      label.append(node('strong','',product.name),node('span','',`${gradeLabel} · ${variant ? cartSizeLabel(variant) : `${requestedSize} · unavailable`}`));
      label.append(node('span','cart-thickness',thicknessGuide(product)));
      const add = node('button','button secondary-button',already ? 'Added' : 'Add'); add.type = 'button'; add.disabled = saving || !variant || already;
      add.setAttribute('aria-label',`Add ${product.name} to saved cart`);
      add.addEventListener('click', () => { if (saving || naming || !variant || draft.items.some(item => item.variantId === variant.id)) return; draft.items.push(itemFor(product,variant)); markChanged(); renderEditor(); renderSearch(); });
      row.append(photo(product.id,product.name),label,add); list.append(row);
    }
    if (!products.length) list.append(node('p','saved-empty','No glass by that name or code.'));
    refresh();
  }

  $('open-saved-carts').addEventListener('click',()=>openList().catch(error=>notify(error.message,true)));
  $('copy-website-cart').addEventListener('click',copyWebsiteCart);
  $('cart-add-form').addEventListener('change',()=>{addForm=$('cart-add-form').value;renderSearch();});
  $('cart-add-size').addEventListener('change',()=>{addSizes.set(addForm,$('cart-add-size').value);renderSearch();});
  for(const kind of ['transparent','opalescent','tints'])$(`cart-include-${kind}`).addEventListener('click',()=>{filters ||= structuredClone(getFilters());filters.glassTypes ||= {transparent:true,opalescent:true};if(kind==='tints')filters.includeTints=!filters.includeTints;else filters.glassTypes[kind]=filters.glassTypes[kind]===false;renderSearch();});
  $('close-saved-carts').addEventListener('click',() => { editorRequest++; listDialog.close(); });
  $('new-saved-cart').addEventListener('click',() => {if(mayReplaceDraft())openEditor();});
  $('close-cart-editor').addEventListener('click',() => {if(!mayReplaceDraft())return;editorRequest++;if(pageMode){if(draft)draft.dirty=false;location.href=new URL('picker.html?workspace=1',location.href).href;}else editorDialog.close();});
  $('back-to-saved-carts').addEventListener('click',() => { if(!pageMode)editorDialog.close();openList(); });
  for (const id of ['save-cart','save-cart-selection']) $(id).addEventListener('click',()=>captureSelection().catch(error=>notify(error.message,true)));
  $('saved-cart-form').addEventListener('submit',saveDraft);
  $('saved-cart-name').addEventListener('input',() => { if (draft) { draft.name = $('saved-cart-name').value; markChanged(); } });
  $('duplicate-cart-draft').addEventListener('click',duplicateDraft);
  $('send-saved-cart').addEventListener('click',() => { if (draft) runSend(draft.items); });
  $('saved-cart-search').addEventListener('input',renderSearch);
  for (const id of ['saved-carts-sign-in','saved-cart-sign-in']) $(id).addEventListener('click',signIn);
  for (const dialog of [listDialog,editorDialog]) dialog.addEventListener('cancel',event => { if (saving) event.preventDefault(); else editorRequest++; });
  refresh();
  if(pageMode)window.addEventListener('beforeunload',event=>{if(draft?.dirty){event.preventDefault();event.returnValue='';}});
  return {
    refresh,
    optionsChanged(){if(draft){addForm=getProducts()[0]?.form || 'medium';renderEditor();renderSearch();}},
    sendDraft(){if(draft && !saving)return runSend(draft.items);},
    async openPage(mode='selection'){
      if(mode==='list'){openEditor();await openList();}
      else await captureSelection();
    },
  };
}
