"""Purpose: retain exact unavailable glass through main selection, working and named carts.
Setup: native Playwright Chromium; seeds a neutral document before picker startup.
Writes: disposable browser profile plus test-results screenshots and report.
Constraints: store pages are synthetic and all remote requests mocked; no real cart.
"""
import copy
import io
import json
import os
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'extension'
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
catalog=json.loads((EXT/'data/catalog.json').read_text())['products']
formats=json.loads((EXT/'data/product-formats.json').read_text())['products']
product=next(value for value in catalog if value['id']=='000113')
fine=next(value for value in formats[product['id']]['fine']['variants'] if value['title']=='1 lb. jar')
fine_large=next(value for value in formats[product['id']]['fine']['variants'] if value['title']=='5 lb. jar')
medium=next(value for value in formats[product['id']]['medium']['variants'] if value['title']=='1 lb. jar')
assert not fine['available'] and not fine_large['available'] and not medium['available']
checks,errors,requests=[],[],[]
failure=None
page=None
blank=io.BytesIO()
Image.new('RGB',(300,300),(242,242,232)).save(blank,format='PNG')


def passed(name):
    checks.append(name)
    print('PASS:',name,flush=True)


def watch(current):
    current.set_default_timeout(15000)
    current.on('pageerror',lambda error:errors.append(str(error)))
    current.on('dialog',lambda dialog:dialog.accept())


def fixture(route):
    request=route.request
    path=urlparse(request.url).path
    requests.append({'method':request.method,'path':path})
    if request.method=='GET' and path.endswith('/cart'):
        route.fulfill(status=200,content_type='text/html',body='<html><body><span class="account-actions__email">fixture@example.invalid</span></body></html>')
    elif request.resource_type=='image':
        route.fulfill(status=200,content_type='image/png',body=blank.getvalue())
    else:
        route.fulfill(status=404,content_type='application/json',body='{"error":"No store mutations are permitted in this test"}')


def working(current):
    return current.evaluate("async()=> (await chrome.storage.local.get('bullseyeWorkingCartV1')).bullseyeWorkingCartV1")


def open_purchase(row):
    panel=row.locator('.purchase-popover')
    if not panel.evaluate("element=>element.matches(':popover-open')"):
        row.locator('.purchase-toggle').click()
    return panel


def save_cart(current,name):
    current.locator('#save-cart-draft').click()
    current.locator('#cart-confirm-name').fill(name)
    current.locator('#confirm-cart-name').click()
    expect(current.locator('#cart-name-dialog')).to_have_count(0)
    expect(current.locator('#saved-cart-draft-status')).to_have_text('Saved')


try:
    with tempfile.TemporaryDirectory() as profile,sync_playwright() as playwright:
        proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        context=playwright.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
            viewport={'width':1440,'height':900},proxy={'server':proxy} if proxy else None,
            ignore_https_errors=bool(proxy),args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        context.on('page',watch)
        context.route('https://**/*',fixture)
        context.route('http://**/*',fixture)
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("()=>{globalThis.fetch=async()=>{throw new Error('Worker network disabled for unavailable-glass fixture.');};}")
        base=f'chrome-extension://{worker.url.split("/")[2]}/picker.html'
        seed_page=context.new_page()
        seed=seed_page.evaluate('''([product,variant])=>{
          const canvas=document.createElement('canvas');canvas.width=500;canvas.height=400;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#F2F2E8';ctx.fillRect(0,0,500,400);
          const key=`${product.id}:${variant.id}`;
          const item={key,productId:product.id,variantId:variant.id,quantity:2,name:product.name,
            sku:variant.sku,title:variant.title,price:variant.price,form:'fine',available:false,image:product.image};
          return {version:6,photoGuideVersion:1,sourceName:'Unavailable White study',sourceDataUrl:canvas.toDataURL(),
            targets:[{id:'white',rgb:[242,242,232],hex:'#F2F2E8',x:.5,y:.5,manual:true,custom:true}],activeTargetId:'white',
            format:'fine',preferredJarSize:'1lb',glassTypes:{transparent:true,opalescent:true},includeTints:false,
            selectedForms:{[product.id]:'fine'},selectedVariants:{[product.id]:String(variant.id)},quantities:{[key]:2},
            chosenMatches:{white:product.id},cart:[item],view:'palette',imageSize:'fit',
            selection:{version:1,targetKeys:{white:key},excludedTargetIds:[],excludedProductIds:[],manualKeys:[]}};
        }''',[product,fine])
        seed_page.close()
        worker.evaluate('(seed)=>chrome.storage.local.set({bullseyeProjectV1:seed})',seed)
        store=context.new_page();store.goto('https://shop.bullseyeglass.com/cart')
        page=context.new_page();page.goto(base+'?workspace=1')
        expect(page.locator('#image-loaded')).to_be_visible()
        row=page.locator('#product-grid .compact-card[data-target-id="white"]')
        expect(row).to_have_attribute('data-product-id',product['id'])
        expect(row.locator('.glass-checkbox')).to_be_checked()
        expect(row.locator('.glass-checkbox')).to_be_enabled()
        expect(row.locator('.product-name .unavailable-note')).to_have_text('* unavailable')
        expect(row.locator('.purchase-toggle')).to_contain_text('Fine frit · 1 lb.')
        expect(page.locator('#save-cart')).to_be_enabled()
        passed('A saved unavailable Fine 1 lb. variant stays selected, enabled and marked next to its main-page name')

        row.locator('.glass-checkbox').uncheck()
        expect(page.locator('#save-cart')).to_be_disabled()
        row.locator('.glass-checkbox').check()
        expect(row.locator('.glass-checkbox')).to_be_checked()
        size=open_purchase(row).locator('.variant-select')
        expect(size).to_have_value(str(fine['id']))
        expect(size.locator(f'option[value="{fine_large["id"]}"]')).to_be_enabled()
        size.select_option(str(fine_large['id']))
        expect(row.locator('.purchase-toggle')).to_contain_text('5 lb.')
        open_purchase(row).locator('.variant-select').select_option(str(fine['id']))
        quantity=open_purchase(row).locator('.quantity-field')
        expect(quantity).to_be_enabled()
        quantity.fill('4');quantity.press('Tab')
        row.get_by_role('button',name='Close purchase options',exact=True).click()
        page.reload()
        expect(row.locator('.glass-checkbox')).to_be_checked()
        expect(row.locator('.purchase-toggle')).to_contain_text('Fine frit · 1 lb. · 4')
        expect(row.locator('.product-name .unavailable-note')).to_have_text('* unavailable')
        passed('Unavailable choices can be unchecked, rechecked, resized and given a quantity without stock substitution; immediate reload keeps them')

        page.locator('#save-palette').click()
        page.locator('#palette-name').fill('Unavailable White palette')
        page.locator('#confirm-save-palette').click()
        expect(page.locator('#saved-dialog')).not_to_be_visible()
        palette=page.evaluate("async()=>{const lib=await import('./lib/saved-palettes.js');const record=(await lib.listPalettes()).find(p=>p.name==='Unavailable White palette');return lib.loadPalette(record.id);}")
        assert len(palette['workspace']['cart'])==1
        saved_item=palette['workspace']['cart'][0]
        assert saved_item['variantId']==fine['id'] and saved_item['quantity']==4 and saved_item['form']=='fine' and saved_item['available'] is False
        page.locator('#save-cart').click()
        expect(page.locator('#cart-count')).to_have_text('4')
        assert working(page)['items'][0]['variantId']==fine['id']
        assert working(page)['items'][0]['available'] is False
        passed('Save palette and Add to Cart retain the exact unavailable variant, grade and selected quantity')

        with context.expect_page() as opened:
            page.locator('#open-cart').click()
        cart=opened.value
        fine_row=cart.locator(f'#saved-cart-items [data-variant-id="{fine["id"]}"]')
        expect(fine_row).to_be_visible()
        expect(fine_row.locator('h3 .unavailable-note')).to_have_text('* unavailable')
        expect(fine_row.locator('.quantity-field')).to_have_value('4')
        fine_row.locator('.cart-size-select').select_option(str(fine_large['id']))
        large_row=cart.locator(f'#saved-cart-items [data-variant-id="{fine_large["id"]}"]')
        expect(large_row.locator('.quantity-field')).to_have_value('4')
        large_row.locator('.cart-size-select').select_option(str(fine['id']))
        fine_row.locator('.quantity-field').fill('6');fine_row.locator('.quantity-field').press('Tab')
        expect(page.locator('#cart-count')).to_have_text('6')
        cart.locator('#open-cart-add').click()
        cart.locator('#saved-cart-search').fill('White')
        cart.locator('#cart-add-form').select_option('medium')
        cart.locator('#cart-add-size').select_option('1lb')
        result=cart.locator('#saved-cart-search-results .saved-cart-search-result[data-product-id="000113"]')
        expect(result).to_have_attribute('data-variant-id',str(medium['id']))
        expect(result.locator('strong .unavailable-note')).to_have_text('* unavailable')
        result.get_by_role('button',name='Add White to saved cart',exact=True).click()
        expect(page.locator('#cart-count')).to_have_text('7')
        cart.locator('#done-cart-add').click()
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        expect(cart.locator('#saved-cart-items h3 .unavailable-note')).to_have_count(2)
        passed('Cart rows keep unavailable markers, editable sizes and quantities; Add Colors accepts another exact sold-out grade')

        save_cart(cart,'Unavailable White cart')
        expected=copy.deepcopy(working(cart)['items'])
        assert {(item['variantId'],item['quantity'],item['available']) for item in expected}=={(fine['id'],6,False),(medium['id'],1,False)}
        named=cart.evaluate("async()=> (await (await import('./lib/saved-carts.js')).listCarts()).find(c=>c.name==='Unavailable White cart')")
        assert named['items']==expected
        cart.reload()
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        assert working(cart)['items']==expected
        cart.locator('#open-saved-carts').click()
        cart.get_by_role('button',name='Edit cart Unavailable White cart',exact=True).click()
        expect(cart.locator('#saved-cart-items h3 .unavailable-note')).to_have_count(2)
        assert working(cart)['items']==expected
        passed('Named and working carts round-trip unavailable IDs, form, quantities and flags through saving, reload and reopening')

        cart.locator('#send-saved-cart').click()
        expect(cart.locator('#saved-cart-message')).to_contain_text('Unavailable: White')
        expect(cart.locator('#saved-cart-message')).to_contain_text('Nothing was sent.')
        expect(cart.locator('#send-saved-cart')).to_be_enabled()
        assert working(cart)['items']==expected
        assert not [request for request in requests if request['method']!='GET'],requests
        passed('Sending identifies unavailable rows and makes no store POST; every saved and working item remains intact')

        for current,label in [(page,'main'),(cart,'cart')]:
            for width in [1440,420]:
                current.set_viewport_size({'width':width,'height':900})
                assert current.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
                current.screenshot(path=str(OUT/f'v068-unavailable-{label}-{width}.png'),full_page=True)
        assert not errors,errors
        context.close()
except Exception as error:
    failure=str(error);traceback.print_exc()
    try:page.screenshot(path=str(OUT/'v068-unavailable-failure.png'),full_page=True)
    except Exception:pass
    raise
finally:
    (OUT/'v068-unavailable-report.json').write_text(json.dumps({'passed':checks,'count':len(checks),'failure':failure,
        'browserErrors':errors,'storeRequests':requests,'storeMode':'Synthetic only; no real account or cart.'},indent=2))
