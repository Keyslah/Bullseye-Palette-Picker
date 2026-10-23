"""Purpose: test the separate Add Color window, exact cart variants and explicit Send.
Setup: npm run package; Playwright Chromium and Pillow. Downloaded public image fixtures.
Writes: disposable Chromium profile and test-results screenshots/report only.
Constraints: shopping is entirely mocked; no real account or live cart mutation.
"""
from pathlib import Path
from urllib.parse import urlparse
import io, json, os, tempfile, traceback
from PIL import Image
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]; EXT=ROOT/'extension'; OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[];failure=None;errors=[];writes=[];stored=[]
photos=json.loads((EXT/'data/cart-photos.json').read_text())
clear=json.loads((EXT/'data/clear-cart.json').read_text())['products']
formats=json.loads((EXT/'data/product-formats.json').read_text())
fixtures_path=ROOT/'tests/fixtures/cart-photos/index.json'
fixtures=json.loads(fixtures_path.read_text()) if fixtures_path.exists() else {}
blank=io.BytesIO();Image.new('RGB',(1200,1200),(245,242,232)).save(blank,format='PNG')
def done(text):checks.append(text);print('PASS:',text,flush=True)
def fulfill(route):
    request=route.request; url=request.url;path=urlparse(url).path
    if path.endswith(('.jpg','.jpeg','.png','.webp','.gif')) or '/cdn/shop/' in path or 'cdn.shopify.com' in url:
        fixture=fixtures.get(url)
        route.fulfill(status=200,content_type=fixture['mime'] if fixture else 'image/png',body=(ROOT/fixture['path']).read_bytes() if fixture else blank.getvalue());return
    if path.endswith('/cart.js'):
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':stored,'item_count':sum(v['quantity'] for v in stored),'currency':'USD'}));return
    if path.endswith('/cart/add.js') and request.method=='POST':
        writes.append(request.post_data_json)
        for item in request.post_data_json['items']:
            stored.append({'id':item['id'],'variant_id':item['id'],'quantity':item['quantity']})
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':stored}));return
    if path.endswith('/cart'):
        route.fulfill(status=200,content_type='text/html',body='<html><body><span class="account-actions__email">isolated@example.invalid</span></body></html>');return
    route.fulfill(status=404,content_type='application/json',body='{}')
def name_cart(page,name):
    page.locator('#save-cart-draft').click();page.locator('#cart-confirm-name').fill(name);page.locator('#confirm-cart-name').click()
    expect(page.locator('#saved-cart-draft-status')).to_have_text('Saved')
def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
def open_add(page):
    page.locator('#open-cart-add').click()
    expect(page.locator('#cart-add-dialog')).to_be_visible()
    expect(page.locator('#saved-cart-search')).to_be_focused()
def close_add(page,control='#done-cart-add'):
    if control=='Escape':page.keyboard.press('Escape')
    else:page.locator(control).click()
    expect(page.locator('#cart-add-dialog')).not_to_be_visible()
    expect(page.locator('#saved-cart-search-results')).not_to_be_visible()
    expect(page.locator('#open-cart-add')).to_be_focused()
def prominent_send(page):
    page.evaluate('window.scrollTo(0,0)')
    button=page.locator('#send-to-cart')
    expect(button).to_have_text('Send to Bullseye Website Cart')
    box=button.bounding_box();width=page.viewport_size['width']
    assert box['y']<24 and box['height']>=60 and box['width']>=width-32,box
    assert box['y']+box['height']<=page.locator('#cart-editor-dialog').bounding_box()['y'],box
def exact(page,pid,form,size):
    return page.evaluate('''async([pid,form,size])=>{
      const {productForForm}=await import('./lib/product-formats.js');
      const {exactCartVariant}=await import('./lib/cart-options.js');
      const cat=await (await fetch('./data/catalog.json')).json();
      const index=await (await fetch('./data/product-formats.json')).json();
      const extras=await (await fetch('./data/clear-cart.json')).json();
      const product=cat.products.some(p=>p.id===pid)?productForForm(cat.products.find(p=>p.id===pid),index,'medium'):extras.products.find(p=>p.id===pid);
      return exactCartVariant(product,form,size);
    }''',[pid,form,size])
def sheet_key(page,pid):
    return page.evaluate('''async pid=>{
      const {cartSizeKey}=await import('./lib/cart-options.js');
      const extra=await (await fetch('./data/clear-cart.json')).json();
      const index=await (await fetch('./data/product-formats.json')).json();
      const variants=index.products[pid]?.sheets.variants || extra.products.find(p=>p.id===pid).allVariants;
      const v=variants.find(v=>v.form==='sheets' && v.available && v.thicknessMm===3 && /10x10/.test(v.sourceTitle));
      return cartSizeKey(v);
    }''',pid)
def check_preview(page,row,variant,name):
    src=photos['products'][variant['handle']].get('variantImages',{}).get(str(variant['id'])) or photos['products'][variant['handle']]['images'][0]
    expect(row.locator('.cart-photo-button img')).to_have_attribute('src',src)
    row.locator('.cart-photo-button').click()
    expect(page.locator('#cart-photo-dialog')).to_be_visible()
    expect(page.locator('#cart-large-photo')).to_have_attribute('src',src)
    page.wait_for_function("document.getElementById('cart-large-photo').complete && document.getElementById('cart-large-photo').naturalWidth>0")
    assert page.locator('#cart-large-photo').bounding_box()['height']>350
    expect(page.locator('#cart-photo-subtitle')).to_contain_text(name)
    expect(page.locator('#cart-photo-dialog')).to_have_attribute('data-source-handle',variant['handle'])
    page.screenshot(path=str(OUT/f'cart-large-{name.replace(" ","-")}.png'),full_page=True)
    if page.locator('#cart-photo-next').is_visible():
        before=page.locator('#cart-photo-count').inner_text();page.locator('#cart-photo-next').click();assert page.locator('#cart-photo-count').inner_text()!=before
    page.locator('#close-cart-photo').click();expect(page.locator('#cart-photo-dialog')).not_to_be_visible()
    return src
try:
  with tempfile.TemporaryDirectory() as folder,sync_playwright() as pw:
    proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    context=pw.chromium.launch_persistent_context(folder,channel='chromium',headless=True,viewport={'width':1440,'height':900},proxy={'server':proxy} if proxy else None,ignore_https_errors=bool(proxy),args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
    context.route('https://shop.bullseyeglass.com/**',fulfill);context.route('https://cdn.shopify.com/**',fulfill)
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    worker.evaluate("()=>{globalThis.fetch=async()=>{throw new Error('No external worker requests in this isolated test.');};}")
    store=context.new_page();store.goto('https://shop.bullseyeglass.com/cart')
    page=context.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    page.goto(f'chrome-extension://{worker.url.split("/")[2]}/picker.html?workspace=1&cart=1&mode=selection')
    expect(page.locator('#open-cart-add')).to_be_visible()
    expect(page.locator('#cart-add-dialog')).not_to_be_visible()
    expect(page.locator('#saved-cart-search-results')).not_to_be_visible()
    expect(page.locator('.saved-cart-search-result:visible')).to_have_count(0)
    expect(page.locator('#cart-add-form')).not_to_be_visible()
    expect(page.locator('#send-to-cart')).to_be_disabled()
    prominent_send(page)
    page.screenshot(path=str(OUT/'cart-empty-1440.png'),full_page=True)
    open_add(page);close_add(page,'Escape')
    expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(0)
    done('Only cart colors appear on the main page; the large top Send is disabled for an empty cart, and Escape returns focus from Add Color')
    open_add(page)
    expect(page.locator('#cart-add-form')).to_be_visible();expect(page.locator('#cart-add-size')).to_be_visible()
    assert page.locator('#cart-add-form').evaluate("n=>n.closest('.cart-add-controls')!==null")
    expect(page.locator('#cart-include-clear')).to_be_visible()
    assert page.locator('#cart-add-form option').evaluate_all('(ns)=>ns.map(n=>n.value)')==['powder','fine','medium','coarse','sheets']
    done('Grade, Size, Clear and material filters are available inside the separate Add Color window')
    page.locator('#saved-cart-search').fill('French Vanilla');page.locator('#cart-add-form').select_option('fine');page.locator('#cart-add-size').select_option('1lb')
    fine=exact(page,'000137','fine','1lb');assert fine
    result=page.locator('#saved-cart-search-results [data-product-id="000137"]')
    expect(result).to_have_attribute('data-variant-id',str(fine['id']))
    fine_photo=check_preview(page,result,fine,'Fine frit')
    result.get_by_role('button',name='Add French Vanilla to saved cart',exact=True).click()
    expect(page.locator('#cart-add-dialog')).to_be_visible()
    expect(result.get_by_role('button',name='Add French Vanilla to saved cart',exact=True)).to_be_disabled()
    close_add(page)
    first=page.locator(f'#saved-cart-items [data-variant-id="{fine["id"]}"]');expect(first.locator('.cart-grade-select')).to_have_value('fine')
    first.locator('.quantity-field').fill('3');first.locator('.quantity-field').press('Tab')
    open_add(page)
    page.locator('#cart-add-form').select_option('coarse');page.locator('#cart-add-size').select_option('1lb')
    coarse=exact(page,'000137','coarse','1lb');assert coarse
    coarse_photo=check_preview(page,result,coarse,'Coarse frit');assert coarse_photo!=fine_photo
    result.get_by_role('button',name='Add French Vanilla to saved cart',exact=True).click()
    close_add(page,'#close-cart-add')
    expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
    first.locator('.cart-grade-select').select_option('medium');medium=exact(page,'000137','medium','1lb')
    expect(page.locator(f'#saved-cart-items [data-variant-id="{medium["id"]}"] .quantity-field')).to_have_value('3')
    expect(page.locator(f'#saved-cart-items [data-variant-id="{coarse["id"]}"] .cart-grade-select')).to_have_value('coarse')
    done('The cart holds different grades/sizes independently and row changes retain quantity')
    open_add(page)
    page.locator('#cart-add-size').select_option('5lb')
    if not exact(page,'000137','coarse','5lb'):expect(result.get_by_role('button',name='Add French Vanilla to saved cart',exact=True)).to_be_disabled()
    expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
    done('Unavailable requested packages do not silently add another size')
    page.locator('#cart-add-form').select_option('sheets');key=sheet_key(page,'000137');page.locator('#cart-add-size').select_option(key)
    sheet=exact(page,'000137','sheets',key);assert sheet
    check_preview(page,result,sheet,'Sheets')
    result.get_by_role('button',name='Add French Vanilla to saved cart',exact=True).click()
    close_add(page)
    sheetrow=page.locator(f'#saved-cart-items [data-variant-id="{sheet["id"]}"]')
    expect(sheetrow.locator('.cart-size-select')).to_have_value(str(sheet['id']))
    assert all('mm' in t for t in sheetrow.locator('.cart-size-select option').all_text_contents())
    done('Sheets expose real dimensions and millimeter thicknesses for both Add and existing rows')
    open_add(page)
    page.locator('#saved-cart-search').fill('clear');expect(page.locator('#saved-cart-search-results .saved-cart-search-result')).to_have_count(0)
    page.locator('#cart-include-clear').click();page.locator('#cart-include-transparent').click();page.locator('#cart-include-opalescent').click()
    expect(page.locator('#saved-cart-search-results .saved-cart-search-result')).to_have_count(3)
    key=sheet_key(page,'001100');page.locator('#cart-add-size').select_option(key);tekta=exact(page,'001100','sheets',key);assert tekta
    clearrow=page.locator('#saved-cart-search-results [data-product-id="001100"]')
    check_preview(page,clearrow,tekta,'Clear Transparent Tekta')
    clearrow.get_by_role('button',name='Add Clear Transparent Tekta to saved cart',exact=True).click()
    page.locator('#cart-add-form').select_option('fine');page.locator('#cart-add-size').select_option('1lb');clearfine=exact(page,'001101','fine','1lb');assert clearfine
    page.locator('#saved-cart-search-results [data-product-id="001101"]').get_by_role('button',name='Add Clear Transparent to saved cart',exact=True).click()
    close_add(page)
    expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(5)
    done('Clear frit and Tekta sheets can be added with exact requested variants without affecting photo matching')
    check_preview(page,page.locator(f'#saved-cart-items [data-variant-id="{clearfine["id"]}"]'),clearfine,'Clear Transparent')
    done('Cart item and Add-result pictures open a large preview for the chosen grade or sheet')
    name_cart(page,'Cart builder QA')
    record=page.evaluate("async()=> (await (await import('./lib/saved-carts.js')).listCarts()).find(c=>c.name==='Cart builder QA')")
    expected={(v['variantId'],v['quantity']) for v in record['items']};assert len(expected)==5
    page.locator('#open-saved-carts').click()
    preview=page.locator('#saved-carts-list .saved-cart-preview .cart-photo-button').first
    preview.click();expect(page.locator('#cart-photo-dialog')).to_be_visible();page.locator('#close-cart-photo').click()
    page.get_by_role('button',name='Edit cart Cart builder QA',exact=True).click()
    expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(5)
    done('Mixed clear/colored grades save and reopen exactly; saved-cart previews also enlarge')
    for width,height in [(1440,900),(800,900),(380,800)]:
        page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100);no_overflow(page)
        prominent_send(page)
        expect(page.locator('.saved-cart-search-result:visible')).to_have_count(0)
        page.screenshot(path=str(OUT/f'cart-builder-{width}.png'),full_page=True)
        open_add(page);no_overflow(page)
        bounds=page.locator('#cart-add-dialog').bounding_box()
        assert bounds['x']>=0 and bounds['y']>=0 and bounds['x']+bounds['width']<=width+1 and bounds['y']+bounds['height']<=height+1,bounds
        if width>=1400:assert abs(page.locator('#cart-add-form').bounding_box()['y']-page.locator('#cart-add-size').bounding_box()['y'])<3
        page.screenshot(path=str(OUT/f'cart-add-window-{width}.png'),full_page=True)
        close_add(page,'Escape')
    done('Main cart and separate Add Color window fit desktop and narrow panels; the full-width Send remains first')
    assert not writes,writes
    page.set_viewport_size({'width':1440,'height':900});page.locator('#send-to-cart').click();expect(page.locator('#send-to-cart')).to_contain_text('Added to cart')
    expect(page.locator('#send-to-cart')).to_be_disabled()
    assert len(writes)==1;assert {(v['id'],v['quantity']) for v in writes[0]['items']}==expected
    done('Explicit Send forwards exactly the selected clear and colored variants once in the isolated store')
    assert not errors,errors;context.close()
except Exception as error:
    failure=str(error);traceback.print_exc()
    try:page.screenshot(path=str(OUT/'cart-builder-failure.png'),full_page=True)
    except Exception:pass
    raise
finally:
    (OUT/'cart-builder-report.json').write_text(json.dumps({'passed':checks,'count':len(checks),'failure':failure,'browserErrors':errors,'storeMode':'Synthetic fixture only. No real account or cart accessed.'},indent=2))
