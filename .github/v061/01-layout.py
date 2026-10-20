"""Purpose: apply only the requested v0.6.1 layout, selection and alternatives changes.
Setup: run from the verified v0.6.0 repository root. Each anchor is checked.
Writes: targeted extension source and version metadata; no catalog or user-data edits.
Constraints: preserve photo sampling, cart validation, storage keys and explicit choices.
"""
from pathlib import Path

def change(path, old, new):
    file=Path(path);text=file.read_text()
    assert old in text,(path,old[:100])
    file.write_text(text.replace(old,new,1))

for path in ['package.json','extension/manifest.json']:
    change(path,'"version": "0.6.0"','"version": "0.6.1"')

Path('extension/lib/match-preference.js').write_text('''/**
 * Purpose: apply the requested Light Orange Striker preference over Carnelian.
 * Setup: receives eligible, color-ranked matches and the active-form stock check.
 * Writes: none. Constraints: never changes scores, removes alternatives or overrides
 * an explicit user choice. Only a would-be automatic Carnelian choice is replaced.
 */
export function preferredAutomaticMatch(matches, isAvailable = () => true) {
  const automatic = matches.find(isAvailable) || matches[0] || null;
  if (automatic?.product.id !== '001321') return automatic;
  return matches.find(match => match.product.id === '001025' && isAvailable(match)) || automatic;
}
''')

file='extension/picker.js'
change(file,"import {includedGlass} from './lib/material-filters.js';","import {includedGlass} from './lib/material-filters.js';\nimport {preferredAutomaticMatch} from './lib/match-preference.js';")
change(file,"let cartLibrary = null, sendingFingerprint = '';","let cartLibrary = null, sendingFingerprint = '', alternativesTargetId = null;")
change(file,"    || matches.find(entry=>defaultFormatVariant(entry.product,state.format,state.selectedVariants[entry.product.id],state.preferredJarSize)) || matches[0] || null;","    || preferredAutomaticMatch(matches,entry=>Boolean(defaultFormatVariant(entry.product,state.format,state.selectedVariants[entry.product.id],state.preferredJarSize)));")
change(file,"  if (!state.imageData || $('image-loaded').hidden) return;\n  const stage=$('image-stage');","  const grid=$('product-grid');\n  const columns=Math.max(1,Math.min(grid.children.length || 1,Math.floor((grid.clientWidth+6)/136)));\n  main.style.setProperty('--match-columns',String(columns));\n  if (!state.imageData || $('image-loaded').hidden) return;\n  const stage=$('image-stage');")
change(file,"  const horizontalRail=beside?0:Math.min(160,remaining*.25);\n  const fitHeight=Math.max(220,remaining-horizontalRail);","  const horizontalRail=beside?0:document.querySelector('.workspace-results').getBoundingClientRect().height+8;\n  const fitHeight=Math.max(140,remaining-horizontalRail);")
change(file,"  const limit=beside && state.imageSize!=='fit'?Infinity:state.imageSize==='fit'?fitHeight:state.imageSize==='larger'?fitHeight*1.25:Infinity;","  const limit=beside && state.imageSize!=='fit'?Infinity:state.imageSize==='full'?Infinity:fitHeight;")
change(file,"const openedPurchase=$('product-grid').querySelector('.purchase-popover:popover-open')?.dataset.purchaseKey;","const openedPurchase=document.querySelector('.purchase-popover:popover-open')?.dataset.purchaseKey;")
change(file,"else if (state.view==='alternatives') entries=matchesFor(target,true).map(entry=>({...entry,target}));","else if (state.view==='alternatives') entries=target?[{...primaryMatch(target),target}]:[];")
change(file,"  if(openedPurchase)for(const panel of list.querySelectorAll('.purchase-popover'))", "  if($('alternatives-dialog').open)renderAlternatives();\n  if(openedPurchase)for(const panel of document.querySelectorAll('.purchase-popover'))")
change(file,"function purchaseSummary(product) {", "function purchaseGrade(product,variant=currentVariant(product)) {\n  return FORM_OPTIONS.find(option=>option.id===(variant?.form || product.form))?.grain || product.grain || 'Medium frit';\n}\nfunction purchaseSummary(product) {")
change(file,"  return `${item?'✓ ':''}${size} · ${item?.quantity || 1}`;","  return `${purchaseGrade(product,variant)} · ${size} · ${item?.quantity || state.quantities[variantKey(product,variant || {})] || 1}`;")
change(file,"function compactPurchase(product,targetId) {","function compactPurchase(product,targetId,scope='row') {")
change(file,"panel.dataset.purchaseKey=`${targetId||'library'}:${product.id}`;","panel.dataset.purchaseKey=`${scope}:${targetId||'library'}:${product.id}`;")
change(file,"panel.append(heading,purchaseControls(product,false,targetId));","panel.append(heading,element('p','purchase-grade',purchaseGrade(product)),purchaseControls(product,false,targetId,scope));")
change(file,"function renderProduct(entry) {", "function renderProduct(entry,alternative=false) {")
change(file,"const row=element('article',`product-card compact-card${selectedItem(product,variant)?' is-selected':''}`);", "const row=element('article',`product-card compact-card${alternative?' alternative-card':''}${selectedItem(product,variant)?' is-selected':''}`);")
change(file,"  const body=element('div','product-card-content');body.append(element('h3','product-name',product.name));", "  const scope=alternative?'alternative':'row';\n  const body=element('div','product-card-content'),heading=element('div','glass-name-row');\n  heading.append(element('h3','product-name',product.name),selectionCheckbox(product,variant,`${scope}-${target?.id || ''}-${product.id}-selected`));\n  body.append(heading);")
change(file,"actions.append(compactPurchase(product,target?.id));", "actions.append(compactPurchase(product,target?.id,scope));")
change(file,"state.view==='alternatives'?'Use color':'Alternatives'","alternative?'Use color':'Alternatives'")
change(file,"    action.addEventListener('click',()=>{if(state.view==='alternatives'){state.chosenMatches[target.id]=product.id;reconcilePaletteSelection();setView('palette');}else showAlternatives(target.id);});actions.append(action);", "    action.addEventListener('click',()=>{if(alternative)chooseAlternative(target.id,product.id);else showAlternatives(target.id);});actions.append(action);")
change(file,"`${variant.title}${variant.available?'':' · unavailable'}`", "`${purchaseGrade(product,variant)} · ${variant.title}${variant.available?'':' · unavailable'}`")
change(file,"function purchaseControls(product,inDetail=false,targetId='') {", '''function selectionCheckbox(product,variant,focusKey) {
  const input=element('input','glass-checkbox'),selected=selectedItem(product,variant);
  input.type='checkbox';input.checked=Boolean(selected);input.dataset.focusKey=focusKey;
  input.setAttribute('aria-label',`${selected?'Remove':'Select'} ${product.name}, ${variant?.title || 'glass'}`);
  input.disabled=!selected && (!variant?.available || !variant?.sku);
  input.addEventListener('change',()=>toggleGlass(product,variant));
  return input;
}
function purchaseControls(product,inDetail=false,targetId='',scope='row') {''')
change(file,"const focusPrefix=`${inDetail?'detail':'row'}-${targetId}-${product.id}`;", "const focusPrefix=`${inDetail?'detail':scope}-${targetId}-${product.id}`;")
old="""  const row=element('div','select-row'),label=element('label','select-glass'),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=!!selected;checkbox.dataset.focusKey=`${focusPrefix}-selected`;checkbox.setAttribute('aria-label',`${selected?'Remove':'Select'} ${product.name}, ${variant?.title||'glass'}`);checkbox.disabled=!selected&&(!variant?.available||!variant?.sku);
  checkbox.addEventListener('change',()=>toggleGlass(product,variant));label.append(checkbox,element('span','',selected?'Selected':'Select'));
  row.append(element('span','product-price',variant?money(variant.price):'View item'),label);controls.append(select,quantity,row);return controls;"""
new="""  const row=element('div','select-row');
  row.append(element('span','product-price',variant?money(variant.price):'View item'));
  if(inDetail)row.append(selectionCheckbox(product,variant,`${focusPrefix}-selected`));
  controls.append(select,quantity,row);return controls;"""
change(file,old,new)
change(file,"function showAlternatives(id){state.query='';$('glass-search').value='';state.activeTargetId=id;state.view='alternatives';renderPalette();renderResults();persist();}", '''function showAlternatives(id) {
  const target=state.targets.find(value=>value.id===id);if(!target)return;
  alternativesTargetId=id;state.activeTargetId=id;
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
  const matches=matchesFor(target,true).filter(entry=>`${entry.product.name} ${entry.product.code} ${entry.product.id}`.toLowerCase().includes(query));
  list.replaceChildren(...matches.map(entry=>renderProduct({...entry,target},true)));
  $('alternatives-empty').hidden=Boolean(matches.length);
  list.scrollTop=scroll;
  for(const type of ['transparent','opalescent'])$(`alternatives-${type}`).setAttribute('aria-pressed',String(state.glassTypes[type]));
  $('alternatives-tints').setAttribute('aria-pressed',String(state.includeTints));
}
function chooseAlternative(targetId,productId) {
  if(!state.targets.some(target=>target.id===targetId))return;
  state.chosenMatches[targetId]=productId;
  if($('alternatives-dialog').open)$('alternatives-dialog').close();
  reconcilePaletteSelection();renderPalette();renderResults();persist();
}''')
change(file,"else if(state.activeTargetId)showAlternatives(state.activeTargetId);", "else if(state.activeTargetId)setView('alternatives');")
change(file,"  $('close-color-editor').addEventListener('click',()=>$('color-editor-dialog').close());", "  $('close-color-editor').addEventListener('click',()=>$('color-editor-dialog').close());\n  $('close-alternatives').addEventListener('click',()=>$('alternatives-dialog').close());\n  $('alternatives-search').addEventListener('input',renderAlternatives);\n  for(const type of ['transparent','opalescent','tints'])$(`alternatives-${type}`).addEventListener('click',()=>{if(type==='tints')state.includeTints=!state.includeTints;else state.glassTypes[type]=!state.glassTypes[type];reconcilePaletteSelection();renderResults();persist();});")
change(file,"$('detail-choose').addEventListener('click',()=>{const id=detailTargetId,product=detailProduct;if(id && product){state.chosenMatches[id]=product.id;$('detail-dialog').close();reconcilePaletteSelection();setView('palette');}});", "$('detail-choose').addEventListener('click',()=>{const id=detailTargetId,product=detailProduct;if(id && product){$('detail-dialog').close();chooseAlternative(id,product.id);}});")

css='extension/picker-v6.css'
change(css,'.image-landscape .product-list{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(190px,1fr);grid-template-columns:none;gap:4px;overflow-x:auto;padding-bottom:4px}', '.image-landscape .product-list{display:grid;grid-auto-flow:row;grid-template-columns:repeat(var(--match-columns,6),minmax(0,1fr));gap:6px;overflow:visible;padding-bottom:4px}')
path=Path(css);text=path.read_text().replace('#product-grid>.compact-card',':is(#product-grid,#alternatives-grid)>.compact-card')
text+='''
/* Landscape comparisons wrap inside the screen; card details sit below photos. */
.image-landscape .image-stage{justify-content:center}
.image-landscape #product-grid>.compact-card,#alternatives-grid>.compact-card{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;gap:6px;padding:7px;align-items:start;min-width:0}
.image-landscape #product-grid>.compact-card>.photo-button,#alternatives-grid>.compact-card>.photo-button{grid-column:1;grid-row:1;width:100%;max-width:110px;justify-self:center}
.image-landscape #product-grid>.compact-card>.product-card-content,#alternatives-grid>.compact-card>.product-card-content{grid-column:1;grid-row:2}
.glass-name-row{display:flex;align-items:flex-start;gap:5px;min-width:0}
.glass-name-row .product-name{flex:1;min-width:0}
.glass-checkbox{appearance:auto;accent-color:var(--green);width:16px;height:16px;margin:0;flex:none;cursor:pointer}
.purchase-grade{font-size:12px;font-weight:650;margin:0 0 8px}
#alternatives-dialog{width:min(720px,calc(100vw - 20px));max-height:84vh;padding:12px;overflow:hidden}
#alternatives-dialog[open]{display:flex;flex-direction:column;gap:8px}
#alternatives-dialog>.dialog-heading{margin:0;flex:none}
.alternatives-tools{display:flex;flex-wrap:wrap;gap:5px;align-items:center;flex:none}
#alternatives-search{flex:1;min-width:140px;max-width:100%;padding:6px 8px;border:1px solid #bdcac0;height:31px}
#alternatives-target{width:23px;height:23px;flex:none;border:1px solid #bdcac0;border-radius:4px}
#alternatives-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:6px;overflow:auto;min-height:0;align-items:start;overscroll-behavior:contain}
#alternatives-grid>.compact-card>.photo-button{max-width:90px}
#alternatives-empty{padding:12px;font-size:12px}
@media(max-width:560px){.image-landscape #product-grid>.compact-card{padding:5px;min-height:0}.image-landscape #product-grid>.compact-card>.photo-button{max-width:85px}}
'''
path.write_text(text)
change('extension/picker.html','    <dialog id="color-editor-dialog"', '''    <dialog id="alternatives-dialog" aria-labelledby="alternatives-title">
      <div class="dialog-heading"><h2 id="alternatives-title">Alternatives</h2><button id="close-alternatives" class="icon-button" type="button" aria-label="Close alternatives">×</button></div>
      <div class="alternatives-tools"><span id="alternatives-target" aria-hidden="true"></span><input id="alternatives-search" type="search" placeholder="Glass name or code" aria-label="Search alternatives"><button id="alternatives-transparent" class="type-filter" type="button" aria-pressed="true">Transparent</button><button id="alternatives-opalescent" class="type-filter" type="button" aria-pressed="true">Opalescent</button><button id="alternatives-tints" class="type-filter" type="button" aria-pressed="false">Tints</button></div>
      <div id="alternatives-grid" aria-label="Alternative glass colors"></div><p id="alternatives-empty" hidden>No alternatives match these filters.</p>
    </dialog>
    <dialog id="color-editor-dialog"''')
print('v0.6.1 implementation applied. Catalog, image sampling and store/cart modules unchanged.')
