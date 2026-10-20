"""Purpose: connect cart-only clear products and grade-specific enlarged photo previews.
Setup: apply once after cart grade/size controls and public metadata generation.
Writes: focused cart/picker markup, modules, styles, privacy and release notes only.
Constraints: original color-matching data, shopping validation and saved keys are retained.
"""
from pathlib import Path

def change(path, old, new):
    p=Path(path);s=p.read_text();assert old in s,(path,old[:100]);p.write_text(s.replace(old,new,1))

p='extension/picker.js'
change(p,"let cartLibrary = null, sendingFingerprint = '', alternativesTargetId = null;", "let cartLibrary = null, sendingFingerprint = '', alternativesTargetId = null;\nlet clearCartProducts = [], cartPhotoIndex = {};")
change(p,"function getProduct(id) { return state.products.find(product => product.id === id); }", "function getProduct(id) { return state.products.find(product => product.id === id) || clearCartProducts.find(product=>product.id===id); }")
change(p,"initializeCartLibrary({getProducts:()=>state.products,getSelection", "initializeCartLibrary({getProducts:()=>[...state.products,...clearCartProducts],getPhotoIndex:()=>cartPhotoIndex,getSelection")
change(p,"const [catalogResult, savedResult, formatsResult, settingsResult] = await Promise.allSettled([", "const [catalogResult, savedResult, formatsResult, settingsResult, clearResult, photosResult] = await Promise.allSettled([")
change(p,"      loadSettings(),\n    ]);", "      loadSettings(),\n      fetch('./data/clear-cart.json').then(response=>{if(!response.ok)throw new Error('Clear glass catalog could not load.');return response.json();}),\n      fetch('./data/cart-photos.json').then(response=>{if(!response.ok)throw new Error('Cart product photos could not load.');return response.json();}),\n    ]);")
change(p,"    state.baseProducts = Array.isArray(catalog.products) ? catalog.products : [];", "    state.baseProducts = Array.isArray(catalog.products) ? catalog.products : [];\n    clearCartProducts = clearResult.status==='fulfilled' && Array.isArray(clearResult.value.products)?clearResult.value.products:[];\n    cartPhotoIndex = photosResult.status==='fulfilled'?photosResult.value:{};")
change(p,"    checkAccount(true);\n    if(isCartPage)", "    if(clearResult.status==='rejected')notify('Clear glass options could not load. Reload the extension to restore them.',true);\n    if(photosResult.status==='rejected')notify('Cart product photos could not load. Reference photos are used where available.',true);\n    checkAccount(true);\n    if(isCartPage)")

p='extension/lib/cart-library.js'
change(p,"import {includedGlass} from './material-filters.js';", "import {includedGlass} from './material-filters.js';\nimport {createCartPhotoViewer} from './cart-photos.js';")
change(p,"initializeCartLibrary({getProducts, getSelection", "initializeCartLibrary({getProducts, getPhotoIndex=()=>({}), getSelection")
change(p,"  const addSizes = new Map();", "  const addSizes = new Map();\n  const photoViewer = createCartPhotoViewer(getPhotoIndex);\n  const includedInCart = product => product.isClear ? filters?.includeClear===true : includedGlass(product,filters);")
pth=Path(p);s=pth.read_text();start=s.index('  function photo(productId, name) {');end=s.index('  function applySendState',start)
s=s[:start]+'''  function photo(productId, name, variant=null) {
    return photoViewer.thumbnail(productFor(productId) || {id:productId,name},variant);
  }
'''+s[end:];pth.write_text(s)
change(p,"preview.append(photo(item.productId,item.name))", "preview.append(photo(item.productId,item.name,variantFor(productFor(item.productId),item.variantId)))")
change(p,"row.append(photo(item.productId,item.name),body,remove)", "row.append(photo(item.productId,item.name,knownVariant),body,remove)")
change(p,"row.append(photo(product.id,product.name),label,add)", "row.append(photo(product.id,product.name,variant || cartVariants(product,addForm)[0]),label,add)")
change(p,"  function thicknessGuide(product) {", "  function thicknessGuide(product) {\n    if(product?.isClear)return 'Clear glass';")
change(p,"    const sizes=cartSizeChoices(getProducts(),addForm);", "    filters ||= structuredClone(getFilters());\n    filters.glassTypes ||= {transparent:true,opalescent:true};\n    const sizes=cartSizeChoices(getProducts().filter(includedInCart),addForm);")
change(p,"    $('cart-include-tints').setAttribute('aria-pressed',String(filters.includeTints === true));", "    $('cart-include-tints').setAttribute('aria-pressed',String(filters.includeTints === true));\n    $('cart-include-clear').setAttribute('aria-pressed',String(filters.includeClear === true));")
change(p,"getProducts().filter(product => includedGlass(product,filters) &&", "getProducts().filter(product => includedInCart(product) &&")
change(p,"  $('copy-website-cart').addEventListener('click',copyWebsiteCart);", "  $('copy-website-cart').addEventListener('click',copyWebsiteCart);\n  $('cart-include-clear').addEventListener('click',()=>{filters ||= structuredClone(getFilters());filters.includeClear=!filters.includeClear;renderSearch();});")
p='extension/picker.html'
change(p,'id="cart-include-tints" type="button" aria-pressed="false">Tints</button>', 'id="cart-include-tints" type="button" aria-pressed="false">Tints</button><button class="type-filter" id="cart-include-clear" type="button" aria-pressed="false">Clear</button>')
with Path('extension/picker-v6.css').open('a') as css:css.write('''
/* Large cart-photo preview is separate from the palette sampling dialog. */
.cart-photo-button{padding:0;border:1px solid var(--line);background:white;cursor:zoom-in;flex:none}
.cart-photo-button img{object-fit:contain!important;width:100%;height:100%;display:block}
.cart-photo-button.photo-unavailable::after{content:'View';font-size:10px;color:var(--muted)}
#cart-photo-dialog{width:min(1000px,calc(100vw - 24px));max-height:90vh;padding:14px;border:1px solid #bdcac0;border-radius:8px;overflow:auto}
#cart-photo-dialog[open]{display:flex;flex-direction:column;gap:7px}
#cart-photo-dialog .dialog-heading{margin:0;gap:8px;flex:none}
#cart-photo-title{font-size:17px;overflow-wrap:anywhere}
.cart-photo-subtitle{font-size:12px;overflow-wrap:anywhere}
.cart-photo-stage{min-height:150px;display:flex;align-items:center;justify-content:center;position:relative;background:white}
.cart-large-photo{width:100%;height:62vh;object-fit:contain;display:block}
.cart-photo-status{position:absolute;max-width:90%;text-align:center;font-size:12px;background:#fffe;padding:4px}
.cart-photo-status:empty{display:none}
.cart-photo-footer{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}
.cart-photo-note{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
@media(max-width:540px){#cart-photo-dialog{padding:10px}.cart-large-photo{height:55vh}.cart-add-controls .type-filter{font-size:10px}}
''')
text='''\n## Cart builder additions\n\nBeside Add a color, Grade and Size select the exact frit grade/package or sheet dimensions and thickness for new additions. Each existing row also has its own grade and size controls. Unavailable combinations remain unavailable instead of silently changing your requested size.\n\nClear is a separate cart filter for Clear Transparent, Clear Transparent Tekta, and Crystal Clear Transparent. These are cart-only products and do not dilute the photo-matching palette.\n\nClick any photo in the cart editor, Add a color results or saved-cart preview for a large image. The image follows the selected frit grade or sheet product. Variant-assigned photos take priority when provided; otherwise the photo is shared by that product's package sizes. More images from that listing can be browsed in the preview. Remote photos require an internet connection. No photo-sampling data is changed.\n'''
with Path('docs/release-v0.6.1.md').open('a') as f:f.write(text)
with Path('README.md').open('a') as f:f.write(text)
with Path('PRIVACY.md').open('a') as f:f.write('''\n## Cart product photographs\n\nCart thumbnails and enlarged previews request public product photographs from shop.bullseyeglass.com or cdn.shopify.com, with referrer information omitted. These requests show the selected frit grade or sheet listing and carry no photo-palette image or customer information. The source catalog is bundled separately in cart-photos.json; clear-cart.json contains public clear-glass variants for the cart builder only. Those products are excluded from automatic photo-color matching.\n''')
print('Clear cart option and large grade-specific product-photo viewer connected.')
