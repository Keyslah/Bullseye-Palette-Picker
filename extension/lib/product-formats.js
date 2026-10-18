/**
 * Keep the reviewed medium-frit color guide while choosing a real purchase form.
 * Variant IDs and SKUs always come from verified Bullseye product records.
 * This module does not fetch inventory, change color samples, or send a cart.
 */
export const FORM_OPTIONS = Object.freeze([
  {id:'sheets', label:'Sheets', grain:'Sheets'},
  {id:'powder', label:'Powder', grain:'Powder frit'},
  {id:'fine', label:'Fine', grain:'Fine frit'},
  {id:'medium', label:'Medium', grain:'Medium frit'},
  {id:'coarse', label:'Coarse', grain:'Coarse frit'},
].map(option => Object.freeze(option)));

export function normalizeForm(value) {
  const form = String(value || '').trim().toLowerCase();
  if (form === 'sheet') return 'sheets';
  return FORM_OPTIONS.some(option => option.id === form) ? form : 'medium';
}

function baseCode(product) {
  return String(typeof product === 'string' ? product : product?.id || product?.code || '').match(/^\d{6}/)?.[0] || '';
}

export function getProductFormat(baseProduct, index, form = 'medium') {
  const normalized = normalizeForm(form), code = baseCode(baseProduct);
  const entry = index?.products?.[code]?.[normalized];
  if (entry) return entry;
  const option = FORM_OPTIONS.find(option => option.id === normalized);
  // The existing guide itself is a verified medium-frit purchase snapshot.
  // Other formats must have their own records and can never borrow its SKU.
  if (normalized === 'medium' && Array.isArray(baseProduct?.variants) && (!baseProduct.form || baseProduct.form === 'medium')) {
    return {form:normalized, ...option, missing:false, handle:baseProduct.handle, productUrl:baseProduct.productUrl,
      fullName:baseProduct.fullName, variants:baseProduct.variants, available:baseProduct.variants.some(variant => variant.available && variant.sku && variant.id)};
  }
  return {form:normalized, ...option, missing:true, available:false, handle:null, productUrl:null,
    shopifyProductId:null, variants:[], reason:`No verified ${option.label.toLowerCase()} listing for ${code || 'this color'}.`};
}

function annotateVariants(entry, form) {
  return (entry.variants || []).map(variant => ({...variant, form,
    handle:variant.handle || entry.handle || null,
    productUrl:variant.productUrl || entry.productUrl || null,
    shopifyProductId:variant.shopifyProductId || entry.shopifyProductId || null,
  }));
}

export function productForForm(baseProduct, index, form = 'medium') {
  const normalized = normalizeForm(form), entry = getProductFormat(baseProduct,index,normalized);
  const variants = annotateVariants(entry,normalized);
  const allVariants = FORM_OPTIONS.flatMap(option => annotateVariants(getProductFormat(baseProduct,index,option.id),option.id));
  return {
    ...baseProduct,
    form:normalized, colorGuideGrain:'Medium frit', grain:entry.grain,
    code:variants[0]?.sku?.split('-').slice(0,3).join('-') || baseCode(baseProduct),
    fullName:entry.fullName || `${baseProduct.name} · ${entry.label}`,
    handle:entry.handle || null, productUrl:entry.productUrl || null,
    shopifyProductId:entry.shopifyProductId || null,
    variants, allVariants,
    formatMissing:Boolean(entry.missing), formatUnavailable:!entry.available,
    formatReason:entry.reason || '', formatSources:entry.sources || [],
  };
}

function purchasable(variant) {
  return Boolean(variant?.available && variant?.sku && variant?.id);
}

export function defaultFormatVariant(product, form = product?.form || 'medium', preferredId, preferredJarSize = '5lb') {
  const normalized = normalizeForm(form);
  const variants = (product?.variants || []).filter(variant => (!variant.form || normalizeForm(variant.form) === normalized) && purchasable(variant));
  if (product?.form && normalizeForm(product.form) !== normalized) return null;
  const preferred = variants.find(variant => String(variant.id) === String(preferredId));
  if (preferred) return preferred;
  if (normalized === 'sheets') {
    return variants.find(variant => Number(variant.thicknessMm) === 3 || /\b3(?:\.0)?\s*mm\b/i.test(variant.title)) || variants[0] || null;
  }
  const size = String(preferredJarSize || '').toLowerCase().replace(/[\s.]/g,'');
  const expression = size === '1lb' ? /(?:^|\s)1\s*(?:lb|pound)s?\b/i
    : size === '5oz' ? /(?:^|\s)5\s*(?:oz|ounce)s?\b/i
    : /(?:^|\s)5\s*(?:lb|pound)s?\b/i;
  return variants.find(variant => expression.test(variant.title)) || variants[0] || null;
}
