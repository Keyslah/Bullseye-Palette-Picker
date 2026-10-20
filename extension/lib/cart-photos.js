/**
 * Purpose: enlarge cart photos and show the actual selected grade/sheet listing.
 * Setup: pass the separate bundled cart-photo metadata; original color guide is not changed.
 * Writes: dialog DOM only. Remote images are public Bullseye/Shopify assets, without referrers.
 * Constraints: use a variant-assigned image when present, otherwise identify the shared
 * product photo. Never claim a medium-frit fallback represents another frit grade.
 */
import {FORM_OPTIONS} from './product-formats.js';
import {cartSizeLabel} from './cart-options.js';

export function cartPhotoSpec(product, variant, index = {}) {
  const handle = variant?.handle || product?.handle;
  const entry = index.products?.[handle];
  const specific = entry?.variantImages?.[String(variant?.id)];
  const gallery = [...new Set([specific, ...(entry?.images || [])].filter(Boolean))];
  const fallback = product?.image || '';
  const form = variant?.form || product?.form || 'medium';
  const grade = FORM_OPTIONS.find(option => option.id === form)?.grain || 'Glass';
  const kind = specific ? 'variant' : gallery.length ? 'product' : 'reference';
  return {
    handle, form, grade, kind, images:gallery.length ? gallery : fallback ? [fallback] : [],
    label:`${product?.name || 'Glass'} · ${grade}${variant ? ` · ${cartSizeLabel(variant)}` : ''}`,
    url:variant?.productUrl || product?.productUrl || '',
    note:kind === 'variant' ? 'Bullseye photo assigned to this product variant.'
      : kind === 'product' ? 'Bullseye product photo. Package sizes can share the same image.'
      : product?.isClear ? 'Clear-glass reference photo. A grade-specific photo is unavailable.'
      : 'Medium-frit color reference. A photo for the selected grade is unavailable.',
  };
}

export function createCartPhotoViewer(getIndex = () => ({})) {
  const el=(tag,className='',text)=>{const n=document.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const dialog=el('dialog','cart-photo-dialog');dialog.id='cart-photo-dialog';dialog.setAttribute('aria-labelledby','cart-photo-title');
  const heading=el('div','dialog-heading'),title=el('h2','','Glass photo');title.id='cart-photo-title';
  const close=el('button','icon-button','×');close.id='close-cart-photo';close.type='button';close.setAttribute('aria-label','Close large cart photo');close.addEventListener('click',()=>dialog.close());
  heading.append(title,close);
  const detail=el('p','cart-photo-subtitle');detail.id='cart-photo-subtitle';
  const stage=el('div','cart-photo-stage'),image=el('img','cart-large-photo');image.id='cart-large-photo';image.referrerPolicy='no-referrer';
  const status=el('p','cart-photo-status');status.id='cart-photo-status';status.setAttribute('role','status');
  stage.append(image,status);
  const footer=el('div','cart-photo-footer'),previous=el('button','button secondary-button','Previous'),next=el('button','button secondary-button','Next'),count=el('span');
  previous.type=next.type='button';previous.id='cart-photo-previous';next.id='cart-photo-next';count.id='cart-photo-count';
  const note=el('p','cart-photo-note');note.id='cart-photo-note';
  const link=el('a','text-button','View product');link.target='_blank';link.rel='noopener noreferrer';link.id='cart-photo-product';
  footer.append(previous,count,next,link);dialog.append(heading,detail,stage,footer,note);document.body.append(dialog);
  let current=null,position=0;
  function render() {
    const source=current?.images[position];
    image.hidden=!source;status.textContent=source?'Loading photo…':'No product photo is available.';
    if(source){image.alt=current.label;image.src=source;}else image.removeAttribute('src');
    previous.hidden=next.hidden=count.hidden=(current?.images.length || 0)<2;
    count.textContent=`${position+1} / ${current?.images.length || 0}`;
  }
  image.addEventListener('load',()=>{status.textContent='';});
  image.addEventListener('error',()=>{image.hidden=true;status.textContent='The product photo could not load. Check your connection or open the product page.';});
  previous.addEventListener('click',()=>{position=(position-1+current.images.length)%current.images.length;render();});
  next.addEventListener('click',()=>{position=(position+1)%current.images.length;render();});
  function open(product,variant) {
    current=cartPhotoSpec(product,variant,getIndex());position=0;
    title.textContent=product?.name || 'Glass photo';detail.textContent=current.label;
    note.textContent=current.note;dialog.dataset.sourceKind=current.kind;dialog.dataset.sourceHandle=current.handle || '';
    link.hidden=!/^https:\/\/shop\.bullseyeglass\.com\/products\//.test(current.url);
    if(!link.hidden)link.href=current.url;
    render();if(!dialog.open)dialog.showModal();
  }
  return {
    open,
    thumbnail(product,variant) {
      const spec=cartPhotoSpec(product,variant,getIndex());
      const button=el('button','saved-cart-photo cart-photo-button');button.type='button';
      button.title=`Enlarge ${spec.label}`;button.setAttribute('aria-label',button.title);
      button.dataset.sourceKind=spec.kind;button.dataset.sourceHandle=spec.handle || '';
      if(spec.images.length){
        const thumbnail=el('img');thumbnail.alt=spec.label;thumbnail.loading='lazy';thumbnail.decoding='async';thumbnail.referrerPolicy='no-referrer';thumbnail.src=spec.images[0];
        thumbnail.addEventListener('error',()=>{thumbnail.hidden=true;button.classList.add('photo-unavailable');button.title=`Photo unavailable. Click for ${spec.label} details.`;},{once:true});
        button.append(thumbnail);
      }else button.classList.add('photo-unavailable');
      button.addEventListener('click',()=>open(product,variant));return button;
    },
  };
}
