"""Purpose: full-page local cart editor using the existing saved-cart implementation.
Setup: apply after 03-cart-read.py. The picker opens a normal cart workspace tab.
Writes: local carts only after named saves; website copying changes only the draft.
Constraints: existing send validation is unchanged; unsupported website items stay visible.
"""
from pathlib import Path

def change(path, old, new):
    file=Path(path);text=file.read_text()
    assert old in text, f'Missing anchor in {path}: {old[:100]}'
    file.write_text(text.replace(old,new,1))

file='extension/lib/cart-library.js'
change(file, "import {FORM_OPTIONS, defaultFormatVariant} from './product-formats.js';", "import {FORM_OPTIONS, defaultFormatVariant} from './product-formats.js';\nimport {includedGlass} from './material-filters.js';\nimport {sampleThickness} from './palette.js';")
change(file, "getPreferredJarSize = ()=>'5lb', signIn, notify})", "getPreferredJarSize = ()=>'5lb', getFilters = ()=>({}), pageMode=false, openPage, readWebsiteCart, signIn, notify})")
change(file, "let draft = null, records = [], saving = false, listRequest = 0, editorRequest = 0;", "let draft = null, records = [], saving = false, listRequest = 0, editorRequest = 0, filters = null, naming = false;")
change(file, "    if (!draft) return;", "    if (!draft) {if(pageMode)$('send-to-cart').disabled=true;return;}")
change(file, "    applySendState($('send-saved-cart'), draft.items);", "    applySendState($('send-saved-cart'), draft.items);\n    if(pageMode)applySendState($('send-to-cart'),draft.items);")
change(file, "['Duplicate', () => storageAction(async () => { const copy = await duplicateCart(record.id); await renderList(); openEditor(copy); })]", "['Duplicate', () => duplicateSaved(record)]")
change(file, "  async function openList() { if (saving) return; editorRequest++; message(); listDialog.showModal(); await renderList(); }", "  async function openList() { if (saving) return; if(!pageMode && openPage){await openPage('list');return;} editorRequest++; message(); if(!listDialog.open)listDialog.showModal(); await renderList(); }")
change(file, "    if (!editorDialog.open) editorDialog.showModal(); $('saved-cart-name').focus();", "    if (!editorDialog.open) {if(pageMode)editorDialog.show();else editorDialog.showModal();} $('saved-cart-name').focus();")
change(file, "  function captureSelection() {", "  async function captureSelection() {\n    if(!pageMode && openPage){await openPage('selection');return;}")
change(file, "    event.preventDefault(); if (!draft) return;\n    await storageAction(async () => {\n      const saved = await saveCart(draft.name, hydrate(draft.items), draft.id);", "    event.preventDefault(); if (!draft || saving || naming) return;\n    const name=await requestName(draft.name,'Save cart');if(name===null)return;\n    await storageAction(async () => {\n      const saved = await saveCart(name, hydrate(draft.items), draft.id);")
change(file, "  async function duplicateDraft() {\n    if (!draft) return;\n    await storageAction(async () => {\n      const existing = await listCarts(), name = copiedCartName(draft.name, existing.map(record => record.name));", "  async function duplicateDraft() {\n    if (!draft || saving || naming) return;\n    const name=await requestName(copiedCartName(draft.name || 'My cart',records.map(record=>record.name)),'Duplicate cart');if(name===null)return;\n    await storageAction(async () => {")
change(file, "  async function runSend(items) {", '''  async function duplicateSaved(record) {
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
  async function runSend(items) {''')
change(file, "      if (!knownVariant?.available) body.append(node('p','cart-unavailable','Saved size is unavailable. Choose another size or remove it.'));", "      if(product)body.append(node('p','cart-thickness',thicknessGuide(product)));\n      if (!knownVariant?.available) body.append(node('p','cart-unavailable',product?'Saved size is unavailable. Choose another size or remove it.':'Copied website item outside this glass catalog. Kept in this copy; remove it before sending with this tool.'));")
change(file, "    const products = getProducts().filter(product => `${product.name} ${product.id} ${product.code}`.toLowerCase().includes(query)).sort", "    filters ||= structuredClone(getFilters());\n    filters.glassTypes ||= {transparent:true,opalescent:true};\n    for(const kind of ['transparent','opalescent'])$(`cart-include-${kind}`).setAttribute('aria-pressed',String(filters.glassTypes[kind] !== false));\n    $('cart-include-tints').setAttribute('aria-pressed',String(filters.includeTints === true));\n    const products = getProducts().filter(product => includedGlass(product,filters) && `${product.name} ${product.id} ${product.code}`.toLowerCase().includes(query)).sort")
change(file, "      const add = node('button','button secondary-button',already ? 'Added' : 'Add');", "      label.append(node('span','cart-thickness',thicknessGuide(product)));\n      const add = node('button','button secondary-button',already ? 'Added' : 'Add');")
change(file, "  $('open-saved-carts').addEventListener('click',openList);", "  $('open-saved-carts').addEventListener('click',()=>openList().catch(error=>notify(error.message,true)));\n  $('copy-website-cart').addEventListener('click',copyWebsiteCart);\n  for(const kind of ['transparent','opalescent','tints'])$(`cart-include-${kind}`).addEventListener('click',()=>{filters ||= structuredClone(getFilters());filters.glassTypes ||= {transparent:true,opalescent:true};if(kind==='tints')filters.includeTints=!filters.includeTints;else filters.glassTypes[kind]=filters.glassTypes[kind]===false;renderSearch();});")
change(file, "$('new-saved-cart').addEventListener('click',() => openEditor());", "$('new-saved-cart').addEventListener('click',() => {if(mayReplaceDraft())openEditor();});")
change(file, "$('close-cart-editor').addEventListener('click',() => { editorRequest++; editorDialog.close(); });", "$('close-cart-editor').addEventListener('click',() => {if(!mayReplaceDraft())return;editorRequest++;if(pageMode){if(draft)draft.dirty=false;location.href=new URL('picker.html?workspace=1',location.href).href;}else editorDialog.close();});")
change(file, "$('back-to-saved-carts').addEventListener('click',() => { editorDialog.close(); openList(); });", "$('back-to-saved-carts').addEventListener('click',() => { if(!pageMode)editorDialog.close();openList(); });")
change(file, "$(id).addEventListener('click',captureSelection);", "$(id).addEventListener('click',()=>captureSelection().catch(error=>notify(error.message,true)));")
change(file, "  async function editSaved(id) {\n    const request", "  async function editSaved(id) {\n    if(!mayReplaceDraft())return;\n    const request")
change(file, "  return {refresh};", '''  if(pageMode)window.addEventListener('beforeunload',event=>{if(draft?.dirty){event.preventDefault();event.returnValue='';}});
  return {
    refresh,
    optionsChanged(){if(draft){renderEditor();renderSearch();}},
    sendDraft(){if(draft && !saving)return runSend(draft.items);},
    async openPage(mode='selection'){
      if(mode==='list'){openEditor();await openList();}
      else await captureSelection();
    },
  };''')

file='extension/picker.js'
change(file, "getSendState:cartSendState,getAccount:()=>state.account,getPreferredJarSize:()=>state.preferredJarSize,signIn,notify});", "getSendState:cartSendState,getAccount:()=>state.account,getPreferredJarSize:()=>state.preferredJarSize,getFilters:()=>({glassTypes:{...state.glassTypes},includeTints:state.includeTints}),pageMode:isCartPage,openPage:async mode=>{await flushSave();await bridge.openCartPage(mode);},readWebsiteCart:()=>bridge.readBullseyeCart(),signIn,notify});")
change(file, "reconcilePaletteSelection();renderAll();persist();\n    if(skipped.length)", "reconcilePaletteSelection();renderAll();cartLibrary?.optionsChanged();persist();\n    if(skipped.length)")
change(file, "for (const id of ['open-cart']) $(id).addEventListener('click', () => { renderCart(); $('cart-dialog').showModal(); });", "for (const id of ['open-cart']) $(id).addEventListener('click', async () => {try{await flushSave();await bridge.openCartPage('selection');}catch(error){notify(error.message,true);}});")
change(file, "for (const id of ['send-to-cart', 'send-cart-dialog']) $(id).addEventListener('click', sendSelection);", "for (const id of ['send-to-cart', 'send-cart-dialog']) $(id).addEventListener('click', () => isCartPage ? cartLibrary.sendDraft() : sendSelection());")
change(file, "    checkAccount(true);\n    bridge.subscribePendingImage", "    checkAccount(true);\n    if(isCartPage){document.title='Carts | Bullseye Palette Picker';await cartLibrary.openPage(new URLSearchParams(location.search).get('mode'));return;}\n    bridge.subscribePendingImage")

file='extension/picker.html'
change(file, '<div class="dialog-heading"><h2 id="saved-cart-editor-title">Edit cart</h2>', '<div class="dialog-heading"><h2 id="saved-cart-editor-title">Cart workspace</h2>')
change(file, 'aria-label="Close cart editor">×</button>', 'aria-label="Return to palette">← Palette</button>')
change(file, '<form id="saved-cart-form"', '<div class="cart-copy-tools"><button class="button secondary-button" id="copy-website-cart" type="button">Copy my Bullseye cart</button><span>Copying and local edits do not change your website cart.</span></div>\n        <form id="saved-cart-form"')
change(file, '<label for="saved-cart-search">Add a color</label>', '<label for="saved-cart-search">Add a color</label><div class="glass-type-filters" role="group" aria-label="Cart glass types"><button class="type-filter" id="cart-include-transparent" type="button" aria-pressed="true">Transparent</button><button class="type-filter" id="cart-include-opalescent" type="button" aria-pressed="true">Opalescent</button><button class="type-filter" id="cart-include-tints" type="button" aria-pressed="false">Tints</button></div>')
change(file, '<div class="saved-cart-footer">', '<p class="cart-send-note">Send adds these quantities to the existing Bullseye cart. It does not replace quantities already there.</p><div class="saved-cart-footer">')
with Path('extension/picker-v5.css').open('a') as css:
    css.write('''
.cart-copy-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0 12px}.cart-copy-tools span,.cart-send-note{font-size:11px;color:var(--muted)}
.cart-thickness{font-size:11px;color:var(--green);margin-top:4px}
#cart-confirm-name{flex:1;min-width:0;height:34px;padding:5px 8px;border:1px solid #c4d0c7}
#close-cart-editor{width:auto;font-size:12px;padding:5px 9px}
.cart-page .app-main{display:none}
.cart-page .app-header .brand-heading h1{font-size:17px}
.cart-page #open-workspace,.cart-page #refresh-settings,.cart-page #save-settings,.cart-page #load-settings,.cart-page #settings-status{display:none}
.cart-page #cart-editor-dialog[open]{display:block;position:static;margin:0 auto;width:100%;max-width:none;max-height:none;border:0;border-radius:0;background:transparent;overflow:visible;color:inherit}
.cart-page .saved-cart-editor-shell{max-height:none;padding:16px 20px}
.cart-page .saved-cart-editor-scroll{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:26px;overflow:visible;align-items:start}
.cart-page .saved-cart-add{margin:0;padding:0;border-top:0}
.cart-page .saved-cart-search-results{max-height:calc(100vh - 325px);min-height:240px;overflow:auto}
.cart-page .saved-cart-search-result{grid-template-columns:60px minmax(0,1fr) auto;padding:8px 0}
.cart-page .saved-cart-search-result>.saved-cart-photo{width:56px;height:56px}
.cart-page .saved-cart-search-result strong{font-size:13px}.cart-page .saved-cart-search-result span{font-size:11px}
.cart-page .saved-cart-search-result .button{min-height:32px}
.cart-page .saved-cart-footer{position:sticky;bottom:0;background:#f5f7f5;padding:10px 0}
.cart-page .saved-cart-draft-heading{font-size:13px}
.cart-page .saved-cart-item-controls{grid-template-columns:minmax(100px,1fr) 55px 72px}
.cart-page .saved-cart-item-controls .quantity-field{width:55px}
@media(max-width:850px){.cart-page .saved-cart-editor-scroll{display:block}.cart-page .saved-cart-add{margin-top:20px}.cart-page .saved-cart-search-results{max-height:340px}.cart-page .saved-cart-editor-shell{padding:12px}.cart-page .saved-cart-item-controls{grid-template-columns:minmax(80px,1fr) 48px}.cart-page .saved-cart-item-controls .quantity-field{width:48px}}
''')
print('Full cart tab, explicit name prompts, copy action and material-filtered color browser written.')
