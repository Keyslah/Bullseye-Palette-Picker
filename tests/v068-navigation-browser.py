"""Purpose: verify Cart, Full page and native cart results never replace a source tab.
Setup: Python Playwright/Pillow plus Chromium; loads current extension source.
Writes: disposable browser/profile, fixture cart and test-results/v068-navigation-report.json.
Constraints: cart API/account requests are mocked; new result tabs may load public storefront HTML.
Only synthetic shopping data is changed; no signed-in account or live cart is used.
the test inspects the source tab's URL, history, unsaved input and Back/Forward behavior.
"""
import io
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
checks, errors, additions, clears, failed_requests, routed = [], [], [], [], [], []
store_items = []
failure = None
blank = io.BytesIO()
Image.new('RGB', (100, 100), (230, 235, 226)).save(blank, format='PNG')
gallery_url = 'https://shop.bullseyeglass.com/collections/source-gallery'
source_url = 'https://shop.bullseyeglass.com/products/source-glass?view=inspiration'


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def watch(page):
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error))
        if page.url.startswith('chrome-extension://') or page.url in [source_url, gallery_url] else None)
    page.on('dialog', lambda dialog: dialog.accept())


def fixture(route):
    request = route.request
    path = urlparse(request.url).path
    routed.append({'url':request.url, 'type':request.resource_type})
    if path == '/cart/add.js' and request.method == 'POST':
        additions.append(request.post_data_json)
        for item in request.post_data_json['items']:
            existing = next((line for line in store_items if line['variant_id'] == item['id']), None)
            if existing:
                existing['quantity'] += item['quantity']
            else:
                store_items.append({'id':item['id'], 'variant_id':item['id'], 'quantity':item['quantity']})
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'items':store_items}))
    elif path == '/cart/clear.js' and request.method == 'POST':
        clears.append(request.post_data_json)
        store_items.clear()
        route.fulfill(status=200, content_type='application/json', body='{"items":[],"item_count":0}')
    elif path == '/cart.js':
        route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'items':store_items, 'item_count':sum(item['quantity'] for item in store_items), 'currency':'USD',
        }))
    elif request.resource_type == 'image':
        route.fulfill(status=200, content_type='image/png', body=blank.getvalue())
    else:
        route.fulfill(status=200, content_type='text/html', body='''<!doctype html>
          <title>Isolated source glass</title><span class="account-actions__email">fixture@example.invalid</span>
          <h1>Original inspiration page</h1><input id="source-note" value="original"><p>Test fixture only.</p>''')


def history(session):
    value = session.send('Page.getNavigationHistory')
    return {'currentIndex':value['currentIndex'], 'urls':[entry['url'] for entry in value['entries']]}


try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as playwright:
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        context = playwright.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
            viewport={'width':1440, 'height':900},
            proxy={'server':proxy} if proxy else None, ignore_https_errors=bool(proxy),
            # Chrome-created result tabs can begin navigation before Playwright
            # attaches its per-page TLS override; this applies only to the test profile.
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
                  *(['--ignore-certificate-errors'] if proxy else [])])
        context.on('page', watch)
        context.on('requestfailed', lambda request: failed_requests.append({'url':request.url,'failure':request.failure}))
        context.route('https://**/*', fixture)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch=async()=>{throw new Error('External worker requests blocked in new-tab test');}; }")
        origin = f'chrome-extension://{worker.url.split("/")[2]}'
        picker = context.new_page()
        picker.goto(origin + '/manifest.json')
        picker.evaluate('''async () => {
          const catalog=await (await fetch('./data/catalog.json')).json();
          const formats=await (await fetch('./data/product-formats.json')).json();
          const {productForForm}=await import('./lib/product-formats.js');
          const product=productForForm(catalog.products.find(p=>p.id==='000141'),formats,'medium');
          const variant=product.variants.find(v=>v.available);
          await (await import('./lib/working-cart.js')).saveWorkingCart({name:'Separate tab fixture',items:[{
            productId:product.id,variantId:variant.id,quantity:2,name:product.name,title:variant.title,
            sku:variant.sku,price:variant.price,available:true,form:'medium',
          }]});
        }''')
        source = context.new_page()
        source.goto(gallery_url)
        source.goto(source_url)
        source.evaluate("document.querySelector('#source-note').value='Keep this unsaved source note'")
        source_session = context.new_cdp_session(source)
        source_history = history(source_session)
        assert gallery_url in source_history['urls'] and source_history['currentIndex'] > 0
        source_navigations = []
        source.on('framenavigated', lambda frame: source_navigations.append(frame.url) if frame == source.main_frame else None)

        def assert_source():
            assert source.url == source_url
            assert history(source_session) == source_history
            expect(source.locator('#source-note')).to_have_value('Keep this unsaved source note')
            assert not source_navigations, source_navigations

        picker.goto(origin + '/picker.html?workspace=1')
        expect(picker.locator('#cart-count')).to_have_text('2')
        picker_url = picker.url
        tab_count = len(context.pages)
        with context.expect_page() as opened:
            picker.locator('#open-cart').click()
        cart = opened.value
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(1)
        assert 'cart=1' in cart.url and cart.url.startswith(origin + '/picker.html?')
        assert len(context.pages) == tab_count + 1 and picker.url == picker_url
        assert cart.evaluate('async () => (await chrome.tabs.getCurrent()).active') is True
        assert_source()
        passed('Actual Cart button creates a new active extension tab; source URL, history and unsaved input remain intact')

        tab_count = len(context.pages)
        with context.expect_page() as opened:
            picker.locator('#open-workspace').click()
        full_page = opened.value
        expect(full_page.locator('#form-medium')).to_be_enabled()
        assert full_page.url == origin + '/picker.html?workspace=1'
        assert len(context.pages) == tab_count + 1 and picker.url == picker_url
        assert full_page.evaluate('async () => (await chrome.tabs.getCurrent()).active') is True
        assert_source()
        passed('Actual Full page button creates another active tab without replacing the original picker or source website')

        for number in [1, 2]:
            tab_count = len(context.pages)
            with context.expect_page() as opened:
                cart.locator('#send-saved-cart').click()
            website_cart = opened.value
            try:
                website_cart.wait_for_url('https://shop.bullseyeglass.com/cart')
            except Exception as error:
                raise AssertionError({'opened':website_cart.url, 'tabs':[tab.url for tab in context.pages],
                    'message':cart.locator('#saved-cart-message').inner_text(), 'errors':errors,
                    'pageText':website_cart.locator('body').inner_text(), 'failedRequests':failed_requests,'routed':routed}) from error
            expect(cart.locator('#saved-cart-message')).to_contain_text('2 jars added to your Bullseye cart.')
            assert len(additions) == number and len(context.pages) == tab_count + 1
            assert_source()
        assert sum(item['quantity'] for item in store_items) == 4
        passed('Each deliberate Send displays Bullseye cart in a fresh tab; the source product page is never navigated')

        tab_count = len(context.pages)
        with context.expect_page() as opened:
            cart.locator('#empty-bullseye-cart').click()
        empty_cart = opened.value
        empty_cart.wait_for_url('https://shop.bullseyeglass.com/cart')
        expect(cart.locator('#saved-cart-message')).to_contain_text('Bullseye cart emptied.')
        assert len(clears) == 1 and not store_items and len(context.pages) == tab_count + 1
        assert_source()
        passed('Empty cart also displays its result separately, preserving all original source-page state')

        source.go_back()
        assert source.url == gallery_url
        source.go_forward()
        assert source.url == source_url
        assert not errors, errors
        passed('Source Back and Forward still navigate the original gallery/product history; no uncaught extension or source errors')
        context.close()
except Exception as error:
    failure = str(error)
    raise
finally:
    (OUT / 'v068-navigation-report.json').write_text(json.dumps({
        'passed':checks, 'count':len(checks), 'failure':failure, 'browserErrors':errors,
        'addPosts':len(additions), 'clearPosts':len(clears),
        'storeMode':'Synthetic source and cart API fixtures; no signed-in account or live shopping cart changed.',
    }, indent=2))
