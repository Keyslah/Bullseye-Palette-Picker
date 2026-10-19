"""Purpose: implement the user-requested Copy my Bullseye cart read operation.
Setup: apply after core/picker patches to the existing signed-in store bridge.
Writes: source files only. At runtime this operation performs GET requests only.
Constraints: no new permissions, no credentials returned, no cart-add changes.
"""
from pathlib import Path

def change(path, old, new):
    file=Path(path);text=file.read_text()
    assert old in text, f'Missing anchor: {path}: {old[:80]}'
    file.write_text(text.replace(old,new,1))

path='extension/lib/commerce.js'
change(path,"if (!['account', 'add'].includes(request?.kind))","if (!['account', 'add', 'read-cart'].includes(request?.kind))")
change(path,"if (request.kind === 'add' && (typeof location","if (['add','read-cart'].includes(request.kind) && (typeof location")
change(path,'  const items = request.items;', '''  // Explicit read/copy: return only product information, never cart tokens,
  // customer identity, credentials, addresses, notes or checkout information.
  if (request.kind === 'read-cart') {
    try {
      const {response, data} = await jsonFetch(cartApi);
      if (!response.ok) throw new Error('The website cart is unavailable.');
      cartTotals(data);
      const items = data.items.map(item => {
        const variantId = Number(item.variant_id ?? item.id);
        if (variantId < 1 || item.quantity < 1 || item.quantity > 999) {
          throw new Error('A website cart quantity is outside the supported 1 to 999 range.');
        }
        if (item.selling_plan_allocation || (item.properties && Object.keys(item.properties).length)) {
          throw new Error('This cart has custom or subscription items that cannot be copied faithfully. Your local cart was not replaced.');
        }
        return {variantId, quantity:item.quantity,
          name:plainText(item.product_title || item.title), sku:plainText(item.sku),
          title:plainText(item.variant_title || item.title),
          price:Number.isSafeInteger(item.final_price) && item.final_price >= 0 ? item.final_price
            : Number.isSafeInteger(item.price) && item.price >= 0 ? item.price : 0};
      });
      return {read:true, items, account, mutationStarted:false,
        itemCount:items.reduce((sum,item)=>sum+item.quantity,0), currency:plainText(data.currency || 'USD')};
    } catch (error) {
      return fail(plainText(error.message || 'The website cart could not be read.'), 'CART_READ_FAILED', {account, mutationStarted:false});
    }
  }
  const items = request.items;''')
change('extension/service-worker.js', '    BULLSEYE_ACCOUNT: bullseyeAccount,', "    BULLSEYE_ACCOUNT: bullseyeAccount,\n    BULLSEYE_READ_CART: async () => inStore(await storeTab(true), {kind:'read-cart'}),")
change('extension/lib/extension.js', 'export async function loadState() {', '''/** User-clicked copy only. This operation never adds or removes website items. */
export async function readBullseyeCart() {
  if (!hasExtension()) throw new Error('Install the extension and sign in to Bullseye to copy your website cart.');
  const result = await message('BULLSEYE_READ_CART');
  if (result?.error) throw bridgeError(result);
  if (result?.read !== true || !Array.isArray(result.items)) throw new Error('Bullseye did not return a readable cart.');
  return result;
}
export async function openCartPage(mode = 'selection') {
  const destination = `picker.html?workspace=1&cart=1&mode=${mode === 'list' ? 'list' : 'selection'}`;
  if (hasExtension()) return chrome.tabs.create({url:chrome.runtime.getURL(destination)});
  window.open(new URL(destination, location.href).href,'_blank','noopener');
}
export async function loadState() {''')
print('Read-only website cart operation added; existing add/send logic unchanged.')
