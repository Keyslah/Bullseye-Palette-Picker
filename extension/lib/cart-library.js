/**
 * Named cart list and editor. Drafts are independent copies of the photo palette.
 * Saved items retain exact jar sizes and quantities; new colors prefer 5 lb jars.
 * Only a Send button invokes sendItems. Saving, editing, and duplicating are local.
 */
import {listCarts, saveCart, loadCart, duplicateCart, deleteCart, copiedCartName, normalizeCartItems} from './saved-carts.js';
import {FORM_OPTIONS} from './product-formats.js';
import {includedGlass} from './material-filters.js';
import {createCartPhotoViewer} from './cart-photos.js';
import {sampleThickness} from './palette.js';
import {cartVariants, cartSizeLabel, cartSizeKey, cartSizeChoices, preferredCartSize, exactCartVariant, switchedCartVariant, cartPurchasable} from './cart-options.js';
import {loadWorkingCart, saveWorkingCart, addWorkingCartItems, patchWorkingCart, subscribeWorkingCart} from './working-cart.js';

const $ = id => document.getElementById(id);
const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);

export function initializeCartLibrary({getProducts, getPhotoIndex=()=>({}), getSelection, getSelectionName, sendItems, emptyWebsiteCart, getSendState, getAccount, getPreferredJarSize = ()=>'5lb', getFilters = ()=>({}), pageMode=false, openPage, readWebsiteCart, signIn, notify}) {
  let draft = null, records = [], saving = false, listRequest = 0, editorRequest = 0, filters = null, naming = false, addForm = null;
  let workingCart = null, draftBaseline = null, workingReady = false, pendingWrites = 0, workingSaveError = null;
  let draftWrites = Promise.resolve();
  const addSizes = new Map();
  const photoViewer = createCartPhotoViewer(getPhotoIndex);
  const includedInCart = product => product.isClear ? filters?.includeClear===true : includedGlass(product,filters);
  const listDialog = $('saved-carts-dialog'), editorDialog = $('cart-editor-dialog'), addDialog = $('cart-add-dialog');
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

  function updateCount() {
    const count = (workingCart?.items || []).reduce((sum,item) => sum + item.quantity,0);
    $('cart-count').textContent = count;
    $('open-cart').setAttribute('aria-label',`Cart, ${count} items`);
  }
  function receiveWorkingCart(value) {
    workingCart = value; updateCount();
    if (draft && !pendingWrites && !saving && !workingSaveError && value) {
      draft = {...structuredClone(value),items:hydrate(value.items)};
      draftBaseline = {saved:structuredClone(draft),replace:false};
      $('saved-cart-name').value = draft.name; renderEditor(); renderSearch();
    }
  }
  function queueWorkingSave(action) {
    pendingWrites++; workingSaveError = null;
    draftWrites = draftWrites.then(action).then(value => {workingSaveError=null;workingCart=value;updateCount();})
      .catch(error => {workingSaveError=error;message(`Your cart could not be saved: ${error.message}`,true);})
      .finally(() => {
        pendingWrites--;
        if (!pendingWrites && !workingSaveError) receiveWorkingCart(workingCart);
        refresh();
      });
    return draftWrites;
  }
  async function flushWorking() {
    await draftWrites;
    if (workingSaveError) throw workingSaveError;
  }
  const ready = loadWorkingCart().then(value => {workingReady=true;receiveWorkingCart(value);refresh();});
  // initialize() awaits ready and reports storage failures without overwriting the cart.
  ready.catch(() => {});
  subscribeWorkingCart(receiveWorkingCart);

  function message(text = '', error = false) {
    for (const id of ['saved-carts-message','saved-cart-message']) {
      $(id).textContent = text; $(id).hidden = !text; $(id).classList.toggle('is-error', error);
    }
  }
  function photo(productId, name, variant=null) {
    return photoViewer.thumbnail(productFor(productId) || {id:productId,name},variant);
  }
  function applySendState(button, items) {
    const status = getSendState(items);
    button.disabled = saving || !items.length || status.busy || status.uncertain;
    button.textContent = status.sending ? 'Sending cart…' : status.uncertain ? 'Check your cart' : 'Send cart to Bullseye';
  }
  function refresh() {
    for (const id of ['save-cart','save-cart-selection']) $(id).disabled = !workingReady || !getSelection().length || saving;
    $('open-saved-carts').disabled = saving;
    $('empty-bullseye-cart').disabled = saving || getSendState([]).busy;
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
    for (const select of $('saved-cart-items').querySelectorAll('select')) select.disabled = saving || select.dataset.unavailable === 'true';
    $('cart-add-form').disabled = saving;
    $('cart-add-size').disabled = saving || !$('cart-add-size').options.length;
    for (const button of $('saved-cart-items').querySelectorAll('button')) button.disabled = saving;
    $('saved-cart-summary').textContent = summary(draft.items);
    $('saved-cart-draft-status').textContent = workingSaveError ? 'Save failed' : pendingWrites ? 'Saving cart…' : draft.id && !draft.dirty ? 'Saved' : 'Cart kept automatically';
    $('save-cart-draft').disabled = saving || !draft.name.trim();
    $('save-cart-draft').textContent = saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save cart';
    $('duplicate-cart-draft').disabled = saving || !draft.name.trim();
    applySendState($('send-saved-cart'), draft.items);
  }
  function markChanged() {
    const baseline = draftBaseline || {saved:structuredClone(draft),replace:false};
    draft.dirty = true; const after = structuredClone(draft);
    queueWorkingSave(async () => {
      const saved = baseline.replace ? await saveWorkingCart(after) : await patchWorkingCart(baseline.saved,after);
      baseline.saved=after;baseline.replace=false;return saved;
    });
    message(); refresh();
  }
  async function storageAction(action) {
    if (saving) return;
    const frozen = [...listDialog.querySelectorAll('button,input,select'), ...editorDialog.querySelectorAll('button,input,select'), ...addDialog.querySelectorAll('button,input,select')].map(control => [control,control.disabled]);
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
        for (const item of [...new Map(items.map(item => [item.productId,item])).values()].slice(0,5)) preview.append(photo(item.productId,item.name,variantFor(productFor(item.productId),item.variantId)));
        const heading = node('div', 'saved-cart-card-heading'); heading.append(node('h3','',record.name),node('p','',summary(items)));
        const actions = node('div', 'saved-cart-card-actions');
        for (const [label, action] of [
          ['Edit', () => editSaved(record.id)],
          ['Duplicate', () => duplicateSaved(record)],
          ['Delete', () => deleteSaved(record.id)],
        ]) {
          const button = node('button', label === 'Delete' ? 'text-button delete-saved-cart' : 'button secondary-button', label);
          button.type = 'button'; button.dataset.cartMutation = ''; button.setAttribute('aria-label', `${label} cart ${record.name}`);
          button.addEventListener('click', action); actions.append(button);
        }
        const send = node('button', 'button primary-button', 'Send cart to Bullseye'); send.type = 'button'; send.dataset.sendCartId = record.id;
        send.setAttribute('aria-label', `Send ${record.name} cart to Bullseye`); send.addEventListener('click', () => sendSaved(record.id)); actions.append(send);
        card.append(heading, preview, actions); list.append(card);
      }
      refresh();
    } catch (error) { if (request === listRequest) $('saved-carts-list').replaceChildren(node('p','saved-empty',error.message)); }
  }
  async function openList() { if (saving) return; if(!pageMode && openPage){await openPage('list');return;} editorRequest++; message(); if(!listDialog.open)listDialog.showModal(); await renderList(); }
  async function deleteSaved(id) {
    await storageAction(async () => {
      await flushWorking();await deleteCart(id);
      if (workingCart?.id === id || draft?.id === id) {
        const detached = {...structuredClone(draft || workingCart),id:null,dirty:true};
        draft=detached;draftBaseline={saved:structuredClone(detached),replace:false};
        await queueWorkingSave(() => saveWorkingCart(detached));await flushWorking();
        renderEditor();
      }
      await renderList();
    });
  }
  function openEditor(record = null, store = true) {
    editorRequest++;
    draft = {...record,id:record?.id || null, name:record?.name || 'My cart', items:hydrate(record?.items || []), dirty:record?.dirty === true};
    if (store) draft.instanceId=crypto.randomUUID();
    draftBaseline = {saved:structuredClone(draft),replace:store};
    if (store) {
      const snapshot=structuredClone(draft),baseline=draftBaseline;
      queueWorkingSave(async () => {const saved=await saveWorkingCart(snapshot);baseline.replace=false;return saved;});
    }
    addDialog.close(); listDialog.close(); $('cart-dialog').close();
    $('saved-cart-name').value = draft.name; $('saved-cart-search').value = ''; message(); renderEditor(); renderSearch();
    if (!editorDialog.open) {if(pageMode)editorDialog.show();else editorDialog.showModal();} $('saved-cart-name').focus();
  }
  async function captureSelection() {
    if (saving) return;
    await ready; await flushWorking();
    const items = normalizeCartItems(getSelection());
    if (!items.length) return;
    const name = String(getSelectionName() || 'My cart').replace(/\.[a-z0-9]{2,5}$/i,'').slice(0,80);
    saving = true; refresh();
    try {
      receiveWorkingCart(await addWorkingCartItems(items,name));
      $('cart-dialog').close();
      notify(`${items.reduce((sum,item)=>sum+item.quantity,0)} items added to your cart.`);
    } finally {saving=false;refresh();}
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
      draft = {...saved, dirty:false,instanceId:draft.instanceId}; $('saved-cart-name').value = saved.name;
      draftBaseline={saved:structuredClone(draft),replace:false};const snapshot=structuredClone(draft);
      await queueWorkingSave(() => saveWorkingCart(snapshot));await flushWorking();
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
    return !draft?.items.length || !draft?.dirty || window.confirm('Replace this working cart? Save it as a named cart first if you want to keep a separate copy.');
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
      openEditor({name:'My Bullseye cart',items:cleaned,dirty:true});
      const unsupported=cleaned.filter(item=>!productFor(item.productId)).length;
      message(`Copied ${result.itemCount ?? cleaned.reduce((sum,item)=>sum+item.quantity,0)} items. Your website cart was not changed. Save this copy under a name.${unsupported ? ` ${unsupported} items outside the glass catalog are kept in the copy but must be removed before sending from this tool.` : ''}`);
    });
  }
  function thicknessGuide(product) {
    if(product?.isClear)return 'Clear glass';
    const values=(product?.samples || []).map(sample=>sampleThickness(sample,product)).filter(Number.isFinite);
    if(!values.length)return 'Photo thickness guide unavailable';
    const low=Math.round(Math.min(...values)),high=Math.round(Math.max(...values));
    return `Photo guide: ${low === high ? high : `${low}–${high}`}% thickness`;
  }
  async function runSend(items) {
    message();
    try {
      await flushWorking();
      const result = await sendItems(hydrate(items));
      message(`${result.itemCount || items.reduce((sum,item) => sum + item.quantity,0)} ${units(items)} added to your Bullseye cart.`);
    } catch (error) { message(error.message || 'These jars could not be added to Bullseye.', true); }
    finally { refresh(); }
  }
  async function emptyBullseye() {
    if (saving || getSendState([]).busy) return;
    if (!window.confirm('Empty your cart on the Bullseye website? Your local cart and saved carts will stay here.')) return;
    try {
      message('Emptying your Bullseye cart…');
      await emptyWebsiteCart();
      message('Bullseye cart emptied. Your local cart is ready to send whenever you want.');
    } catch (error) {message(error.message || 'Your Bullseye cart could not be emptied.',true);}
    finally {refresh();}
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
    if (!draft.items.length) list.append(node('p','saved-empty','This cart is empty. Use Add Colors or add your selected glass from the palette.'));
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
      row.append(photo(item.productId,item.name,knownVariant),body,remove); list.append(row);
    }
    refresh();
  }
  function renderSearch() {
    if (!draft || !addDialog.open) return;
    const list = $('saved-cart-search-results'); list.replaceChildren();
    const query = $('saved-cart-search').value.trim().toLowerCase();
    addForm ||= getProducts()[0]?.form || 'medium';
    $('cart-add-form').value=addForm;
    filters ||= structuredClone(getFilters());
    filters.glassTypes ||= {transparent:true,opalescent:true};
    const sizes=cartSizeChoices(getProducts().filter(includedInCart),addForm);
    const sizeKey=preferredCartSize(sizes,addForm,addSizes.get(addForm) || getPreferredJarSize());
    addSizes.set(addForm,sizeKey);
    const sizeControl=$('cart-add-size'); sizeControl.replaceChildren();
    for (const choice of sizes) {
      const option=node('option','',`${choice.label}${choice.available ? '' : ' · unavailable'}`);
      option.value=choice.key; option.disabled=!choice.available; sizeControl.append(option);
    }
    sizeControl.value=sizeKey;
    $('cart-add-size-label').textContent=addForm==='sheets' ? 'Size / thickness' : 'Size';
    sizeControl.closest('.cart-size-option').classList.toggle('sheet-sizes',addForm==='sheets');
    sizeControl.setAttribute('aria-label',addForm==='sheets'?'Sheet size and thickness to add':'Jar size to add');
    sizeControl.title=sizeControl.selectedOptions[0]?.textContent || '';
    const gradeLabel=FORM_OPTIONS.find(option=>option.id===addForm)?.grain || 'Glass';
    filters ||= structuredClone(getFilters());
    filters.glassTypes ||= {transparent:true,opalescent:true};
    for(const kind of ['transparent','opalescent'])$(`cart-include-${kind}`).setAttribute('aria-pressed',String(filters.glassTypes[kind] !== false));
    $('cart-include-tints').setAttribute('aria-pressed',String(filters.includeTints === true));
    $('cart-include-clear').setAttribute('aria-pressed',String(filters.includeClear === true));
    const products = getProducts().filter(product => includedInCart(product) && `${product.name} ${product.id} ${product.code}`.toLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
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
      row.append(photo(product.id,product.name,variant || cartVariants(product,addForm).find(option=>cartSizeKey(option)===sizeKey) || {form:addForm,title:requestedSize}),label,add); list.append(row);
    }
    if (!products.length) list.append(node('p','saved-empty','No glass by that name or code.'));
    refresh();
  }

  $('open-saved-carts').addEventListener('click',()=>openList().catch(error=>notify(error.message,true)));
  $('open-cart-add').addEventListener('click',()=>{
    if (!draft || saving || naming) return;
    if (!addDialog.open) addDialog.showModal();
    renderSearch(); $('saved-cart-search').focus({preventScroll:true});
  });
  for (const id of ['close-cart-add','done-cart-add']) $(id).addEventListener('click',()=>{if(!saving)addDialog.close();});
  addDialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  addDialog.addEventListener('close',()=>{if(editorDialog.open)$('open-cart-add').focus({preventScroll:true});});
  $('copy-website-cart').addEventListener('click',copyWebsiteCart);
  $('empty-bullseye-cart').addEventListener('click',emptyBullseye);
  $('open-cart').addEventListener('click',async()=>{try{await ready;await flushWorking();await openPage('working');}catch(error){notify(error.message,true);}});
  $('cart-include-clear').addEventListener('click',()=>{filters ||= structuredClone(getFilters());filters.includeClear=!filters.includeClear;renderSearch();});
  $('cart-add-form').addEventListener('change',()=>{addForm=$('cart-add-form').value;renderSearch();});
  $('cart-add-size').addEventListener('change',()=>{addSizes.set(addForm,$('cart-add-size').value);renderSearch();});
  for(const kind of ['transparent','opalescent','tints'])$(`cart-include-${kind}`).addEventListener('click',()=>{filters ||= structuredClone(getFilters());filters.glassTypes ||= {transparent:true,opalescent:true};if(kind==='tints')filters.includeTints=!filters.includeTints;else filters.glassTypes[kind]=filters.glassTypes[kind]===false;renderSearch();});
  $('close-saved-carts').addEventListener('click',() => { editorRequest++; listDialog.close(); });
  $('new-saved-cart').addEventListener('click',() => {if(mayReplaceDraft())openEditor();});
  $('close-cart-editor').addEventListener('click',async() => {try{await flushWorking();editorRequest++;if(pageMode)location.href=new URL('picker.html?workspace=1',location.href).href;else editorDialog.close();}catch(error){message(error.message,true);}});
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
  if(pageMode)window.addEventListener('beforeunload',event=>{if(pendingWrites || workingSaveError){event.preventDefault();event.returnValue='';}});
  return {
    refresh, ready, flush:flushWorking,
    optionsChanged(){if(draft){addForm=getProducts()[0]?.form || 'medium';renderEditor();renderSearch();}},
    sendDraft(){if(draft && !saving)return runSend(draft.items);},
    async openPage(mode='working'){
      await ready; await flushWorking(); openEditor(workingCart,false);
      if(mode==='list')await openList();
    },
  };
}
