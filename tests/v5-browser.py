"""Purpose: run native-browser acceptance checks for the reconstructed v5 extension.
Setup: npm run package; install Python playwright/pillow and Playwright Chromium.
Writes: disposable test profile, synthetic images and test-results screenshots/report.
Constraints: no user account or live cart access; every store page request is mocked.
"""
import copy
import hashlib
import json
import tempfile
import traceback
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'extension'
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
checks=[]
errors=[]
requests=[]

def passed(name):
    checks.append(name)
    print('PASS:',name,flush=True)

def saved(page):
    page.wait_for_timeout(450)
    return page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")

def image_state(state):
    return {key:state.get(key) for key in ['sourceDataUrl','targets']}

def watch(page):
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.on('dialog',lambda dialog: dialog.accept())
    page.set_default_timeout(15000)

def no_overflow(page,label):
    metrics=page.evaluate('''()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
      overflowing:[...document.querySelectorAll('body *')].filter(node=>{
        const r=node.getBoundingClientRect();return r.width>0 && r.height>0 && r.right>innerWidth+2 && getComputedStyle(node).position!=='absolute';
      }).slice(0,12).map(n=>[n.id,n.className,n.getBoundingClientRect().right])})''')
    assert metrics['scroll'] <= metrics['width']+2, (label,metrics)
    passed('No horizontal overflow: '+label)

def name_cart(page,name):
    page.locator('#cart-confirm-name').fill(name)
    page.locator('#confirm-cart-name').click()
    expect(page.locator('#cart-name-dialog')).to_have_count(0)
    expect(page.locator('#saved-cart-draft-status')).to_have_text('Saved')

catalog=json.loads((EXT/'data/catalog.json').read_text())
formats=json.loads((EXT/'data/product-formats.json').read_text())
product=next(p for p in catalog['products'] if p['id']=='000141')
variant=next(v for v in formats['products'][product['id']]['medium']['variants'] if v['available'])
unknown_id=999999999999
store={'items':[{'variant_id':variant['id'],'id':variant['id'],'quantity':2,'sku':variant['sku'],'product_title':product['name'],'variant_title':variant['title'],'price':variant['price'],'final_price':variant['price']},
                {'variant_id':unknown_id,'id':unknown_id,'quantity':1,'sku':'TEST-TOOL','product_title':'Test-only studio tool','variant_title':'One','price':100,'final_price':100}],
       'currency':'USD','token':'must-not-be-returned','note':'must-not-be-returned'}
initial_store=copy.deepcopy(store)
html='<!doctype html><html><body><span class="account-actions__email">test@example.invalid</span><p>Isolated test store. No live account.</p></body></html>'

def route_store(route):
    request=route.request
    path=urlparse(request.url).path
    requests.append({'path':path,'method':request.method})
    if path.endswith('/cart.js') and request.method=='GET':
        body={**store,'item_count':sum(item['quantity'] for item in store['items'])}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(body))
    elif path.endswith('/cart/add.js') and request.method=='POST':
        body=request.post_data_json
        for addition in body['items']:
            item=next((item for item in store['items'] if item['variant_id']==addition['id']),None)
            if item:item['quantity']+=addition['quantity']
            else:store['items'].append({'variant_id':addition['id'],'id':addition['id'],'quantity':addition['quantity']})
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':store['items']}))
    elif path.endswith('/cart') and request.method=='GET':
        route.fulfill(status=200,content_type='text/html',body=html)
    else:
        route.fulfill(status=404,content_type='application/json',body='{"error":"Unconfigured test request"}')

page=None
context=None
try:
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
        temp=Path(folder)
        for name,width,height in [('square',800,800),('portrait',640,960),('landscape',1200,500)]:
            image=Image.new('RGB',(width,height))
            image.putdata([((x*255//width),(y*255//height),((x//55+y//67)%4)*80) for y in range(height) for x in range(width)])
            image.save(temp/f'{name}.png')
        context=playwright.chromium.launch_persistent_context(str(temp/'profile'),channel='chromium',headless=True,viewport={'width':1440,'height':900},args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        context.route('https://shop.bullseyeglass.com/**',route_store)
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        # Service-worker requests cannot bypass the isolated storefront fixture.
        worker.evaluate("() => { globalThis.fetch = async () => { throw new Error('External worker requests disabled in acceptance tests.'); }; }")
        extension_id=worker.url.split('/')[2]
        base=f'chrome-extension://{extension_id}/picker.html'
        store_page=context.new_page();store_page.goto('https://shop.bullseyeglass.com/cart')
        page=context.new_page();watch(page);page.goto(base+'?workspace=1')
        expect(page.locator('#form-medium')).to_be_enabled()
        expect(page.locator('#account-status')).to_have_text('Signed in to Bullseye')
        assert page.evaluate('chrome.runtime.getManifest().version')=='0.5.0'
        passed('Native MV3 extension starts at version 0.5.0')

        page.locator('#library-tab').click()
        expect(page.locator('#include-tints')).to_have_attribute('aria-pressed','false')
        expect(page.locator('#product-grid .product-card')).to_have_count(121)
        page.locator('#include-tints').click()
        expect(page.locator('#product-grid .product-card')).to_have_count(141)
        page.locator('#include-tints').click()
        passed('Tints excluded by default and all twenty can be included')

        for image_name in ['square','portrait','landscape']:
            page.locator('#image-file').set_input_files(temp/f'{image_name}.png')
            expect(page.locator('#image-loaded')).to_be_visible()
            expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
            for width,height in [(1440,900),(1920,1080),(900,800),(650,900),(380,800)]:
                page.set_viewport_size({'width':width,'height':height})
                page.wait_for_timeout(250)
                no_overflow(page,f'{image_name} {width}x{height}')
                box=page.locator('#source-canvas').bounding_box()
                expected_ratio={'square':1,'portrait':640/960,'landscape':1200/500}[image_name]
                assert abs(box['width']/box['height']-expected_ratio)<0.015
                if width>=900 and image_name!='landscape':
                    assert 'image-beside' in page.locator('.app-main').get_attribute('class')
                    result_box=page.locator('.workspace-results').bounding_box()
                    assert result_box['x'] >= box['x']+box['width']-2
                    assert result_box['y']<200
                if width==1440:page.screenshot(path=str(OUT/f'{image_name}-1440.png'),full_page=True)
        passed('Square and portrait results stay beside photos; landscape and narrow panels adapt')
        page.set_viewport_size({'width':1440,'height':900})
        page.locator('#image-file').set_input_files(temp/'square.png')
        expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
        assert page.evaluate("document.querySelector('#palette-chips').children[1].contains(document.querySelector('#show-full-palette'))")
        passed('Show full palette stays beside color number one')

        before=saved(page)
        point=page.locator('.source-point').first
        start=point.bounding_box();canvas=page.locator('#source-canvas').bounding_box()
        page.mouse.move(start['x']+start['width']/2,start['y']+start['height']/2)
        page.mouse.down();page.mouse.move(canvas['x']+canvas['width']*.72,canvas['y']+canvas['height']*.28,steps=8);page.mouse.up()
        after=saved(page)
        assert before['targets'][0]['x']!=after['targets'][0]['x'] or before['targets'][0]['y']!=after['targets'][0]['y']
        page.locator('#target-hex').fill('#AB23CD');page.locator('#target-hex').press('Tab')
        edited=saved(page)
        assert any(target['hex']=='#AB23CD' and target['custom'] for target in edited['targets'])
        passed('Dragging and manual color editing work in the resized image')

        page.locator('#form-fine').click();page.locator('#preferred-jar-size').select_option('1lb')
        page.locator('#include-tints').click();page.locator('#show-full-palette').uncheck()
        page.locator('#save-settings').click()
        page.locator('#settings-name').fill('Fine study');page.locator('#confirm-save-settings').click()
        expect(page.locator('#settings-dialog')).not_to_be_visible()
        before=saved(page)
        page.locator('#refresh-settings').click();reset=saved(page)
        assert image_state(reset)==image_state(before)
        assert reset['format']=='medium' and reset['preferredJarSize']=='5lb' and not reset['includeTints'] and reset['view']=='palette'
        page.locator('#load-settings').click();page.get_by_role('button',name='Load settings Fine study',exact=True).click()
        loaded=saved(page)
        assert image_state(loaded)==image_state(before)
        assert loaded['format']=='fine' and loaded['preferredJarSize']=='1lb' and loaded['includeTints'] and loaded['view']=='alternatives'
        passed('Named settings round-trip; Refresh and Load settings preserve image, colors and dots')

        page.locator('#refresh-settings').click();original=saved(page)
        page.locator('#remix-palette').click();remixed=saved(page)
        assert remixed['sourceDataUrl']==original['sourceDataUrl'] and remixed['targets']!=original['targets']
        assert all(not target['manual'] for target in remixed['targets'])
        passed('Remix samples a new palette separately from Refresh')
        page.locator('#save-palette').click();page.locator('#palette-name').fill('V5 browser palette');page.locator('#confirm-save-palette').click()
        expect(page.locator('#saved-list')).to_contain_text('V5 browser palette')
        page.locator('#close-saved').click()
        page.reload();expect(page.locator('#image-loaded')).to_be_visible()
        restored=saved(page)
        assert restored['targets']==remixed['targets']
        passed('Existing saved-photo and workspace restoration survive v5 reload')
        with context.expect_page() as new_tab:
            page.locator('#open-workspace').click()
        full=new_tab.value;watch(full);full.wait_for_load_state()
        expect(full.locator('#image-loaded')).to_be_visible()
        assert '?workspace=1' in full.url
        full.close()
        passed('Open full page creates a normal browser tab with the current photo')

        photo_before_cart=saved(page)
        with context.expect_page() as new_tab:
            page.locator('#save-cart').click()
        cart=new_tab.value;watch(cart);cart.wait_for_load_state()
        expect(cart.locator('#cart-editor-dialog')).to_be_visible()
        assert 'cart=1' in cart.url
        assert cart.locator('#cart-editor-dialog').bounding_box()['width']>1200
        expect(cart.locator('#saved-cart-items .saved-cart-item').first).to_be_visible()
        cart.locator('#save-cart-draft').click();name_cart(cart,'First cart')
        first_records=cart.evaluate("async()=> (await import('./lib/saved-carts.js')).listCarts()")
        assert len(first_records)==1
        first=copy.deepcopy(first_records[0])
        cart.locator('#duplicate-cart-draft').click();name_cart(cart,'Second cart')
        quantity=cart.locator('#saved-cart-items .quantity-field').first
        quantity.fill('3');quantity.press('Tab')
        cart.locator('#save-cart-draft').click();name_cart(cart,'Second cart')
        records=cart.evaluate("async()=> (await import('./lib/saved-carts.js')).listCarts()")
        assert len(records)==2
        assert next(record for record in records if record['name']=='First cart')['items']==first['items']
        assert next(record for record in records if record['name']=='Second cart')['items'][0]['quantity']==3
        passed('Full cart page saves and duplicates named carts independently')
        cart.locator('#open-saved-carts').click()
        expect(cart.locator('#saved-carts-list')).to_contain_text('First cart')
        cart.get_by_role('button',name='Edit cart First cart',exact=True).click()
        expect(cart.locator('#saved-cart-name')).to_have_value('First cart')
        ids_before=cart.locator('#saved-cart-items .saved-cart-item').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.variantId)')
        cart.locator('#form-sheets').click()
        assert cart.locator('#saved-cart-items .saved-cart-item').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.variantId)')==ids_before
        passed('Saved carts load and retain exact variants when the global purchase form changes')
        cart.locator('#saved-cart-search').fill('tint')
        expect(cart.locator('#saved-cart-search-results .saved-cart-search-result')).to_have_count(0)
        cart.locator('#cart-include-tints').click()
        assert cart.locator('#saved-cart-search-results .saved-cart-search-result').count()>0
        expect(cart.locator('#saved-cart-search-results .cart-thickness').first).to_contain_text('% thickness')
        cart.locator('#saved-cart-search').fill('')
        passed('Cart color browser has material/tint filters and thickness information')
        for width,height in [(1440,900),(800,900),(380,800)]:
            cart.set_viewport_size({'width':width,'height':height});cart.wait_for_timeout(200)
            no_overflow(cart,f'cart {width}x{height}')
        cart.set_viewport_size({'width':1440,'height':900})
        cart.screenshot(path=str(OUT/'cart-1440.png'),full_page=True)

        assert not [r for r in requests if r['method']!='GET']
        cart.locator('#copy-website-cart').click()
        expect(cart.locator('#saved-cart-message')).to_contain_text('website cart was not changed')
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        assert store==initial_store
        assert not [r for r in requests if r['method']!='GET']
        read=cart.evaluate("async()=> (await import('./lib/extension.js')).readBullseyeCart()")
        assert 'token' not in read and 'note' not in read and 'test@example.invalid' not in json.dumps(read)
        cart.locator('#save-cart-draft').click();name_cart(cart,'Website copy')
        records=cart.evaluate("async()=> (await import('./lib/saved-carts.js')).listCarts()")
        website=next(record for record in records if record['name']=='Website copy')
        assert sorted((item['variantId'],item['quantity']) for item in website['items'])==sorted((item['variant_id'],item['quantity']) for item in initial_store['items'])
        passed('Native website cart copy uses GET only and preserves exact item IDs and quantities')
        cart.locator(f'#saved-cart-items [data-variant-id="{unknown_id}"] .icon-button').click()
        cart.locator('#save-cart-draft').click();name_cart(cart,'Website copy')
        cart.locator('#send-to-cart').click()
        expect(cart.locator('#send-to-cart')).to_contain_text('Added to cart')
        assert len([r for r in requests if r['method']=='POST'])==1
        assert next(item for item in store['items'] if item['variant_id']==variant['id'])['quantity']==4
        assert next(item for item in store['items'] if item['variant_id']==unknown_id)['quantity']==1
        assert saved(page)==photo_before_cart
        passed('Explicit cart Send adds once to mocked store and never rewrites photo workspace')
        cart.screenshot(path=str(OUT/'cart-copy-1440.png'),full_page=True)
        assert not errors,errors
        passed('No uncaught browser JavaScript errors')
        context.close();context=None

    archive=ROOT/'dist/Bullseye-Palette-Picker-v0.5.0.zip'
    with zipfile.ZipFile(archive) as packed:
        assert packed.testzip() is None
        assert json.loads(packed.read('manifest.json'))['version']=='0.5.0'
        for file in EXT.rglob('*'):
            if file.is_file():assert packed.read(str(file.relative_to(EXT)))==file.read_bytes(),str(file)
    passed('Packaged extension bytes match the tested source exactly')
except Exception:
    if context:
        for i,open_page in enumerate(context.pages):
            try:open_page.screenshot(path=str(OUT/f'failure-{i}.png'),full_page=True)
            except Exception:pass
    print('BROWSER ERRORS:',errors,flush=True)
    traceback.print_exc()
    raise
finally:
    report={'passed':checks,'count':len(checks),'browserErrors':errors,'storeRequests':requests,
            'storeMode':'Isolated synthetic fixture. No real account or cart mutations.'}
    (OUT/'v5-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)
