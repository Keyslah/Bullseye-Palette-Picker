"""Purpose: implement the requested cart Grade and Size controls.
Setup: run once from the v0.6.1 repository root; all patch anchors are checked.
Writes: cart UI, markup and styling only. No photo, catalog or account changes.
Constraints: Add uses exact selected sizes; saved items keep independent choices.
"""
from pathlib import Path
p=Path('extension/lib/cart-library.js');s=p.read_text()
def change(old,new):
    global s
    assert old in s,old[:100]
    s=s.replace(old,new,1)
change("import {sampleThickness} from './palette.js';", "import {sampleThickness} from './palette.js';\nimport {cartVariants, cartSizeLabel, cartSizeChoices, preferredCartSize, exactCartVariant, switchedCartVariant, cartPurchasable} from './cart-options.js';")
change('filters = null, naming = false;', 'filters = null, naming = false, addForm = null;\n  const addSizes = new Map();')
change("    for (const input of $('saved-cart-items').querySelectorAll('input')) input.disabled = saving;", "    for (const input of $('saved-cart-items').querySelectorAll('input')) input.disabled = saving;\n    for (const select of $('saved-cart-items').querySelectorAll('select')) select.disabled = saving || select.dataset.unavailable === 'true';\n    $('cart-add-form').disabled = saving;\n    $('cart-add-size').disabled = saving || !$('cart-add-size').options.length;")
change('  function renderEditor() {', '''  function replaceDraftVariant(item, product, variant) {
    if (saving || naming || !cartPurchasable(variant)) return;
    try {
      draft.items = normalizeCartItems(draft.items.map(current => current === item ? itemFor(product,variant,item.quantity) : current));
      markChanged(); renderEditor(); renderSearch();
    } catch (error) { renderEditor(); message(error.message,true); }
  }
  function renderEditor() {''')
change('      const sizeOptions=product?.allVariants || product?.variants || [];', "      const currentForm = knownVariant?.form || item.form || 'medium';\n      const sizeOptions = cartVariants(product,currentForm);")
start=s.index("      const controls = node('div','saved-cart-item-controls')")
end=s.index("      const quantity = node('input','quantity-field')",start)
s=s[:start]+'''      const controls = node('div','saved-cart-item-controls');
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
'''+s[end:]
change('controls.append(size,quantity,price); body.append(controls);', 'controls.append(grade,size,quantity,price); body.append(controls);')
change("    const query = $('saved-cart-search').value.trim().toLowerCase();", '''    const query = $('saved-cart-search').value.trim().toLowerCase();
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
    const gradeLabel=FORM_OPTIONS.find(option=>option.id===addForm)?.grain || 'Glass';''')
change('const variant = defaultFormatVariant(product,product.form,undefined,getPreferredJarSize()), already', 'const variant = exactCartVariant(product,addForm,sizeKey), already')
change("const row = node('div','saved-cart-search-result'), label = node('div');", "const row = node('div','saved-cart-search-result'), label = node('div');\n      row.dataset.productId=product.id; row.dataset.variantId=variant ? String(variant.id) : '';\n      const requestedSize=sizes.find(choice=>choice.key===sizeKey)?.label || 'this size';")
change("`${product.grain || 'Medium frit'} · ${variant?.title || 'Unavailable'}`", "`${gradeLabel} · ${variant ? cartSizeLabel(variant) : `${requestedSize} · unavailable`}`")
change('add.disabled = !variant || already;', 'add.disabled = saving || !variant || already;')
change('if (!variant || draft.items.some(item => item.variantId === variant.id)) return;', 'if (saving || naming || !variant || draft.items.some(item => item.variantId === variant.id)) return;')
change("    if (!products.length) list.append(node('p','saved-empty','No glass by that name or code.'));", "    if (!products.length) list.append(node('p','saved-empty','No glass by that name or code.'));\n    refresh();")
change("  $('copy-website-cart').addEventListener('click',copyWebsiteCart);", "  $('copy-website-cart').addEventListener('click',copyWebsiteCart);\n  $('cart-add-form').addEventListener('change',()=>{addForm=$('cart-add-form').value;renderSearch();});\n  $('cart-add-size').addEventListener('change',()=>{addSizes.set(addForm,$('cart-add-size').value);renderSearch();});")
change('optionsChanged(){if(draft){renderEditor();renderSearch();}},', "optionsChanged(){if(draft){addForm=getProducts()[0]?.form || 'medium';renderEditor();renderSearch();}},")
change("import {FORM_OPTIONS, defaultFormatVariant} from './product-formats.js';", "import {FORM_OPTIONS} from './product-formats.js';")
p.write_text(s)
p=Path('extension/picker.html');s=p.read_text()
start=s.index('<section class="saved-cart-add"');end=s.index('<input id="saved-cart-search"',start)
old=s[start:end];assert old.endswith('</div>')
controls=old.replace('<label for="saved-cart-search">Add a color</label>','<div class="cart-add-controls"><label for="saved-cart-search">Add a color</label>')
controls+='''<label class="cart-option">Grade <select id="cart-add-form" aria-label="Grade to add"><option value="powder">Powder</option><option value="fine">Fine</option><option value="medium" selected>Medium</option><option value="coarse">Coarse</option><option value="sheets">Sheets</option></select></label><label class="cart-option cart-size-option"><span id="cart-add-size-label">Size</span><select id="cart-add-size" aria-label="Jar size to add"></select></label></div>'''
s=s[:start]+controls+s[end:];p.write_text(s)
with Path('extension/picker-v6.css').open('a') as f:f.write('''
/* Cart controls: independent add defaults and per-item grade/package selection. */
.cart-add-controls{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:6px;min-width:0}
.cart-add-controls>label:first-child{font-size:12px;font-weight:650}
.cart-add-controls .glass-type-filters{gap:3px;margin:0;flex-wrap:wrap}
.cart-add-controls .type-filter{font-size:11px;padding:4px 5px;min-height:28px}
.cart-option{display:flex;align-items:center;gap:4px;font-size:11px;min-width:0;max-width:100%}
.cart-option select{height:28px;font-size:11px;padding:3px 5px;border:1px solid #bdcac0;background:white;max-width:100%;min-width:0}
#cart-add-form{width:91px}#cart-add-size{width:clamp(120px,18vw,270px);flex:1;min-width:0}
.cart-size-option{flex:0 1 auto}.cart-size-option>span{white-space:nowrap}
#cart-editor-dialog .saved-cart-item-controls{display:grid;grid-template-columns:minmax(82px,.7fr) minmax(100px,1.3fr) 48px 65px;gap:5px}
#cart-editor-dialog .saved-cart-item-controls .variant-select{font-size:11px;min-width:0;width:100%;height:30px}
#cart-editor-dialog .saved-cart-item-controls .quantity-field{width:48px;height:30px}
@media(max-width:1100px){#cart-editor-dialog .saved-cart-item-controls{grid-template-columns:minmax(75px,.8fr) minmax(100px,1.2fr)}#cart-editor-dialog .saved-cart-item-controls>.cart-item-price{grid-column:2;text-align:right}}
@media(max-width:540px){.cart-size-option{width:100%}#cart-add-size{width:auto}.cart-add-controls{gap:4px}#cart-editor-dialog .saved-cart-item-controls{grid-template-columns:minmax(70px,.8fr) minmax(85px,1.2fr)}}
''')
print('Cart grade/size controls added alongside filters and on every cart row.')
