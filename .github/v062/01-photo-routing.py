"""Purpose: use selected-grade Bullseye photos in every picker/cart view.
Setup: apply once to main c320ec9; the v062 workflow checkpoints before testing.
Writes: only photo routing, its sampling-reference separation, and release version.
Constraints: no color re-sampling, source photo/dot edits, cart mutations or catalog changes.
"""
from pathlib import Path

def change(path, old, new):
    file=Path(path); text=file.read_text()
    assert old in text, f'Missing patch anchor: {path}: {old[:90]}'
    file.write_text(text.replace(old,new,1))

for path in ['extension/manifest.json','package.json']:
    change(path,'"version": "0.6.1"','"version": "0.6.2"')

path='extension/lib/cart-photos.js'
change(path,'export function cartPhotoSpec(product, variant, index = {}) {','export function productPhotoSpec(product, variant, index = {}) {')
change(path,'export function createCartPhotoViewer', '// Keep the cart API compatible; both picker and cart use this exact selector.\nexport const cartPhotoSpec = productPhotoSpec;\n\nexport function createCartPhotoViewer')
change(path,'Purpose: enlarge cart photos and show the actual selected grade/sheet listing.','Purpose: share the selected-grade photo selector across picker, alternatives and cart.')

path='extension/picker.js'
change(path,"import {initializeCartLibrary} from './lib/cart-library.js';", "import {initializeCartLibrary} from './lib/cart-library.js';\nimport {productPhotoSpec} from './lib/cart-photos.js';")
change(path,'function photoElement(product,sample,eager=true) {','''function photoElement(product,sample,eager=true,variant=currentVariant(product)) {
  const spec=productPhotoSpec(product,variant,cartPhotoIndex);
  const wrapper=element('div','glass-photo'),img=element('img');
  // The selected grade is resolved synchronously from verified listing records.
  // Each render owns its image node; an older download cannot replace a new grade.
  wrapper.dataset.photoForm=spec.form;wrapper.dataset.photoHandle=spec.handle || '';
  wrapper.dataset.photoKind=spec.kind;
  img.alt=spec.kind==='reference'?spec.note:spec.label;img.title=img.alt;
  img.loading=eager?'eager':'lazy';img.width=600;img.height=600;img.decoding='async';img.referrerPolicy='no-referrer';
  if(spec.kind!=='reference' && spec.images[0])img.src=spec.images[0];
  wrapper.append(img);return wrapper;
}
function referencePhotoElement(product,sample,eager=true) {''')
change(path,"    if(detailProduct)$('detail-dialog').close();", "    if(detailProduct){detailProduct=products.find(p=>p.id===detailProduct.id)||null;if(detailProduct)renderDetailSample();else $('detail-dialog').close();}")
change(path,"  $('detail-purchase').replaceChildren(purchaseControls(detailProduct,true));", "  $('detail-photo').replaceChildren(photoElement(detailProduct,null,true));\n  const photo=productPhotoSpec(detailProduct,currentVariant(detailProduct),cartPhotoIndex);\n  $('detail-photo-grade').textContent=`${photo.grade} · Bullseye photograph`;\n  $('detail-purchase').replaceChildren(purchaseControls(detailProduct,true));")
change(path,"$('detail-title').textContent=product.name;renderDetailSample();", "$('detail-title').textContent=product.name;$('detail-reference').open=false;renderDetailSample();")
change(path,"  $('detail-photo').replaceChildren(photoElement(detailProduct,detailSample));", "  $('detail-reference-photo').replaceChildren(referencePhotoElement(detailProduct,detailSample));")
change(path,"  $('detail-sample-label').textContent=sampleLabel(detailProduct,detailSample);", "  $('detail-sample-label').textContent=`${sampleLabel(detailProduct,detailSample)} · medium-frit sampling reference`;")
change(path,"  $('detail-photo').addEventListener('click', (event) => {\n    const photo = $('detail-photo').querySelector('.glass-photo');", "  $('detail-reference-photo').addEventListener('click', (event) => {\n    const photo = $('detail-reference-photo').querySelector('.glass-photo');")
change(path,'img.src=product.image;img.alt=product.name;photo.append(img);', "const spec=productPhotoSpec(product,variant,cartPhotoIndex);if(spec.kind!=='reference' && spec.images[0])img.src=spec.images[0];img.alt=spec.label;img.referrerPolicy='no-referrer';photo.append(img);")
change(path,'Photo estimate, not measured depth. Click the photograph for codes and details.', 'Estimate from the medium-frit color reference, not measured depth. The photograph shows the selected purchase grade.')

path='extension/picker.html'
text=Path(path).read_text()
old='<div class="detail-photo" id="detail-photo"></div><p class="detail-sample-label"'
assert old in text
text=text.replace(old,'<div class="detail-photo" id="detail-photo"></div><p class="detail-photo-grade" id="detail-photo-grade"></p><details id="detail-reference"><summary>Thickness color reference · Medium frit</summary><div class="detail-photo" id="detail-reference-photo"></div><p class="detail-sample-label"',1)
old='<p class="section-note">Click a swatch or the photograph to inspect a sampled color.</p>'
assert old in text
text=text.replace(old,'<p class="section-note">These swatches and this marker belong to the original medium-frit color reference. They are separate from the selected-grade product photograph above.</p></details>',1)
Path(path).write_text(text)

with Path('extension/picker-v6.css').open('a') as f:
    f.write('''\n/* Selected-grade photographs are separate from medium-reference sampling coordinates. */
.detail-photo-grade{text-align:center;font-weight:650;margin:6px 0 12px}
#detail-reference{border-top:1px solid var(--line);padding:8px 0;margin:6px 0}
#detail-reference>summary{cursor:pointer;color:var(--green);font-size:12px;font-weight:600}
#detail-reference[open]>summary{margin-bottom:8px}
#detail-reference-photo{max-width:240px;max-height:none;margin:0 auto 8px}
#detail-reference-photo .glass-photo{width:100%;max-height:none}
#detail-reference-photo img{width:100%;height:auto;object-fit:contain}
''')
print('Selected frit/sheet photos now feed picker, details, alternatives and cart; sampling reference stays separate.')
