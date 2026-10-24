"""Purpose: verify persistent working carts, repeat sending, and explicit website emptying.
Setup: Python Playwright/Pillow plus Chromium; loads the current extension source.
Writes: disposable profile/image and test-results screenshots/report.
Constraints: every remote request is mocked; no live account or shopping cart is used.
"""
import copy
import io
import json
import os
import re
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
checks, errors, requests, additions, clears = [], [], [], [], []
store_items = []
session = {'signed_in': True, 'accept_dialog': True}
failure = None
page = None
blank = io.BytesIO()
Image.new('RGB', (300, 300), (228, 234, 222)).save(blank, format='PNG')


def passed(name):
    checks.append(name)
    print('PASS:', name, flush=True)


def watch(current):
    current.set_default_timeout(15000)
    current.on('pageerror', lambda error: errors.append(str(error)))
    current.on('dialog', lambda dialog: dialog.accept() if session['accept_dialog'] else dialog.dismiss())


def route_store(route):
    request = route.request
    path = urlparse(request.url).path
    requests.append({'path': path, 'method': request.method})
    if path.endswith('/cart.js') and request.method == 'GET':
        route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'items': store_items, 'item_count': sum(item['quantity'] for item in store_items), 'currency': 'USD',
        }))
    elif path.endswith('/cart/add.js') and request.method == 'POST':
        body = request.post_data_json
        additions.append(copy.deepcopy(body))
        for item in body['items']:
            existing = next((line for line in store_items if line['variant_id'] == item['id']), None)
            if existing:
                existing['quantity'] += item['quantity']
            else:
                store_items.append({'id': item['id'], 'variant_id': item['id'], 'quantity': item['quantity']})
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'items': store_items}))
    elif path.endswith('/cart/clear.js') and request.method == 'POST':
        clears.append(request.post_data_json)
        store_items.clear()
        route.fulfill(status=200, content_type='application/json', body='{"items":[],"item_count":0}')
    elif path.endswith('/cart') and request.method == 'GET':
        marker = '<span class="account-actions__email">fixture@example.invalid</span>' if session['signed_in'] else '<div class="account-actions__sign-ins">Sign in</div>'
        route.fulfill(status=200, content_type='text/html', body=f'<!doctype html><html><body>{marker}<p>Synthetic test store.</p></body></html>')
    elif request.resource_type == 'image':
        route.fulfill(status=200, content_type='image/png', body=blank.getvalue())
    else:
        route.fulfill(status=404, content_type='application/json', body='{"error":"Unconfigured synthetic request"}')


def working(current):
    return current.evaluate("async () => (await chrome.storage.local.get('bullseyeWorkingCartV1')).bullseyeWorkingCartV1")


def check_layout(current, width, label):
    current.set_viewport_size({'width': width, 'height': 900 if width == 1440 else 850})
    current.evaluate('window.scrollTo(0,0)')
    assert current.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), label
    current.screenshot(path=str(OUT / f'v067-{label}-{width}.png'), full_page=True)


def save_named_cart(current, name):
    current.locator('#save-cart-draft').click()
    current.locator('#cart-confirm-name').fill(name)
    current.locator('#confirm-cart-name').click()
    expect(current.locator('#cart-name-dialog')).to_have_count(0)
    expect(current.locator('#saved-cart-draft-status')).to_have_text('Saved')


try:
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
        temp = Path(folder)
        image = Image.new('RGB', (700, 900))
        image.putdata([(30 + x * 180 // 700, 35 + y * 170 // 900, 50 + ((x // 70 + y // 90) % 3) * 65) for y in range(900) for x in range(700)])
        image.save(temp / 'cart-study.png')
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        context = playwright.chromium.launch_persistent_context(
            str(temp / 'profile'), channel='chromium', headless=True,
            viewport={'width': 1440, 'height': 900}, proxy={'server': proxy} if proxy else None,
            ignore_https_errors=bool(proxy),
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'],
        )
        context.on('page', watch)
        context.route('https://**/*', route_store)
        context.route('http://**/*', route_store)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch = async () => { throw new Error('External worker requests disabled in this fixture.'); }; }")
        base = f'chrome-extension://{worker.url.split("/")[2]}/picker.html'
        store_page = context.new_page()
        store_page.goto('https://shop.bullseyeglass.com/cart')
        page = context.new_page()
        page.goto(base + '?workspace=1')
        expect(page.locator('#form-medium')).to_be_enabled()
        expect(page.locator('#account-status')).to_have_text('Signed in to Bullseye')
        expect(page.locator('#send-to-cart')).to_have_count(0)
        expect(page.get_by_role('button', name='Send to my cart', exact=True)).to_have_count(0)
        expect(page.locator('#save-cart')).to_have_text('Add to Cart')
        expect(page.locator('#cart-count')).to_have_text('0')
        cart_button = page.locator('#open-cart').bounding_box()
        assert cart_button['x'] > 1300 and cart_button['y'] < 30, cart_button
        passed('Main page has Add to Cart and a top-right Cart badge; the old Send button is absent')

        page.locator('#library-tab').click()
        page.locator('#glass-search').fill('000141')
        selected = page.locator('#product-grid .product-card[data-product-id="000141"]')
        expect(selected).to_have_count(1)
        selected.locator('.glass-checkbox').check()
        selected.locator('.purchase-toggle').click()
        quantity = selected.locator('.quantity-field')
        quantity.fill('3')
        quantity.press('Tab')
        selected.get_by_role('button', name='Close purchase options', exact=True).click()
        expect(page.locator('#save-cart')).to_be_enabled()
        page.locator('#save-cart').click()
        expect(page.locator('#cart-count')).to_have_text('3')
        page.locator('#save-cart').click()
        expect(page.locator('#cart-count')).to_have_text('6')
        expect(page.locator('#cart-name-dialog')).to_have_count(0)
        assert len(working(page)['items']) == 1
        assert working(page)['items'][0]['quantity'] == 6
        assert not additions and not clears
        passed('Add to Cart stores selected quantities locally; repeated Add increments the total without a naming dialog')

        with context.expect_page() as opened:
            page.locator('#open-cart').click()
        cart = opened.value
        cart.wait_for_url(re.compile(r'.*[?&]cart=1(?:&|$).*'))
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(1)
        expect(cart.locator('#saved-cart-items .quantity-field')).to_have_value('6')
        expect(cart.locator('#cart-add-dialog')).not_to_be_visible()
        expect(cart.locator('.saved-cart-search-result:visible')).to_have_count(0)
        expect(cart.locator('#open-cart-add')).to_have_text('+ Add Colors')
        add_box = cart.locator('#open-cart-add').bounding_box()
        first_box = cart.locator('#saved-cart-items .saved-cart-item').bounding_box()
        assert add_box['y'] + add_box['height'] <= first_box['y'], (add_box, first_box)
        passed('Cart opens the persistent working cart in a new tab, with Add Colors directly above the items')

        original_variant = cart.locator('#saved-cart-items .saved-cart-item').get_attribute('data-variant-id')
        cart.locator('#saved-cart-items .quantity-field').fill('4')
        cart.locator('#saved-cart-items .quantity-field').press('Tab')
        expect(page.locator('#cart-count')).to_have_text('4')
        cart.reload()
        expect(cart.locator('#saved-cart-items .quantity-field')).to_have_value('4')
        cart.locator('#open-cart-add').click()
        expect(cart.locator('#cart-add-dialog')).to_be_visible()
        expect(cart.locator('#saved-cart-search')).to_be_focused()
        cart.locator('#saved-cart-search').fill('French Vanilla')
        cart.locator('#cart-add-form').select_option('fine')
        cart.locator('#cart-add-size').select_option('1lb')
        result = cart.locator('#saved-cart-search-results [data-product-id="000137"]')
        added_variant = result.get_attribute('data-variant-id')
        result.get_by_role('button', name='Add French Vanilla to saved cart', exact=True).click()
        expect(page.locator('#cart-count')).to_have_text('5')
        cart.locator('#done-cart-add').click()
        original_row = cart.locator(f'#saved-cart-items [data-variant-id="{original_variant}"]')
        original_row.get_by_role('button', name=re.compile(r'^Remove saved ')).click()
        expect(page.locator('#cart-count')).to_have_text('1')
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(1)
        page.locator('#save-cart').click()
        expect(page.locator('#cart-count')).to_have_text('4')
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        expect(cart.locator(f'#saved-cart-items [data-variant-id="{original_variant}"] .quantity-field')).to_have_value('3')
        expect(cart.locator(f'#saved-cart-items [data-variant-id="{added_variant}"] .quantity-field')).to_have_value('1')
        cart.reload()
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        assert sum(item['quantity'] for item in working(cart)['items']) == 4
        passed('Cart quantity, addition and removal update the main badge live; cross-tab additions and reload preserve the cart')

        page.locator('#glass-search').fill('')
        page.locator('#image-file').set_input_files(temp / 'cart-study.png')
        expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
        for width in [1440, 420]:
            check_layout(page, width, 'main')
            nav = page.locator('#open-cart').bounding_box()
            assert nav['x'] + nav['width'] <= width + 1 and nav['y'] < 30, nav
            check_layout(cart, width, 'cart')
            send = cart.locator('#send-saved-cart')
            expect(send).to_have_text('Send cart to Bullseye')
            send_box = send.bounding_box()
            assert send_box['height'] >= 60 and send_box['width'] >= width - 44, send_box
            cart.locator('#open-cart-add').click()
            expect(cart.locator('#cart-add-dialog')).to_be_visible()
            cart.locator('#saved-cart-search').fill('')
            check_layout(cart, width, 'add-colors')
            box = cart.locator('#cart-add-dialog').bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width + 1, box
            cart.locator('#done-cart-add').click()
        passed('Main, cart and separate Add Colors dialog fit at 1440 and 420 pixels with screenshots')

        cart.set_viewport_size({'width': 1440, 'height': 900})
        local_before = copy.deepcopy(working(cart)['items'])
        expected_items = {(int(item['variantId']), item['quantity']) for item in local_before}
        assert not additions and not clears
        for number in [1, 2]:
            cart.locator('#send-saved-cart').click()
            expect(cart.locator('#saved-cart-message')).to_have_text('4 jars added to your Bullseye cart.')
            expect(cart.locator('#send-saved-cart')).to_have_text('Send cart to Bullseye')
            expect(cart.locator('#send-saved-cart')).to_be_enabled()
            assert len(additions) == number, additions
            assert {(item['id'], item['quantity']) for item in additions[-1]['items']} == expected_items
        assert sum(item['quantity'] for item in store_items) == 8
        assert working(cart)['items'] == local_before
        passed('Two explicit sends produce two exact add POSTs, keep the local cart and reenable Send after each success')

        session['accept_dialog'] = False
        cart.locator('#empty-bullseye-cart').click()
        assert not clears
        assert sum(item['quantity'] for item in store_items) == 8
        session['accept_dialog'] = True
        start_request = len(requests)
        cart.locator('#empty-bullseye-cart').click()
        expect(cart.locator('#saved-cart-message')).to_contain_text('Bullseye cart emptied.')
        expect(cart.locator('#empty-bullseye-cart')).to_be_enabled()
        expect(cart.locator('#send-saved-cart')).to_be_enabled()
        assert len(clears) == 1 and not store_items
        clear_requests = requests[start_request:]
        clear_index = next(index for index, request in enumerate(clear_requests) if request['path'].endswith('/cart/clear.js'))
        assert clear_requests[clear_index]['method'] == 'POST'
        assert any(request['path'].endswith('/cart.js') and request['method'] == 'GET' for request in clear_requests[clear_index + 1:])
        assert working(cart)['items'] == local_before
        expect(page.locator('#cart-count')).to_have_text('4')
        cart.locator('#send-saved-cart').click()
        expect(cart.locator('#saved-cart-message')).to_have_text('4 jars added to your Bullseye cart.')
        expect(cart.locator('#send-saved-cart')).to_be_enabled()
        assert len(additions) == 3 and len(clears) == 1
        assert sum(item['quantity'] for item in store_items) == 4
        passed('Cancel leaves the website cart intact; confirmed Empty clears once, verifies it, retains local items and allows another Send')

        session['signed_in'] = False
        page.reload()
        expect(page.locator('#sign-in')).to_be_visible()
        expect(page.get_by_role('button', name=re.compile(r'^Sign in'))).to_have_count(1)
        expect(page.locator('#account-menu > summary')).to_have_text('Account')
        expect(page.locator('#cart-count')).to_have_text('4')
        for width in [1440, 420]:
            check_layout(page, width, 'signed-out')
        passed('Signed-out main page shows exactly one Sign in button and retains the working-cart count')

        save_named_cart(cart, 'Working cart deletion regression')
        named_before = copy.deepcopy(working(cart))
        assert named_before['id'] and named_before['items'] == local_before
        cart.locator('#open-saved-carts').click()
        saved_entry = cart.locator(f'#saved-carts-list [data-cart-id="{named_before["id"]}"]')
        expect(saved_entry).to_be_visible()
        saved_entry.get_by_role('button', name='Delete cart Working cart deletion regression', exact=True).click()
        expect(saved_entry).to_have_count(0)
        cart.locator('#close-saved-carts').click()
        expect(cart.locator('#saved-cart-items .saved-cart-item')).to_have_count(2)
        detached = working(cart)
        assert detached['id'] is None and detached['items'] == named_before['items']
        expect(page.locator('#cart-count')).to_have_text('4')
        fine_row = cart.locator(f'#saved-cart-items [data-variant-id="{added_variant}"]')
        fine_row.locator('.quantity-field').fill('2')
        fine_row.locator('.quantity-field').press('Tab')
        expect(page.locator('#cart-count')).to_have_text('5')
        cart.locator('#open-cart-add').click()
        cart.locator('#saved-cart-search').fill('French Vanilla')
        cart.locator('#cart-add-form').select_option('coarse')
        cart.locator('#cart-add-size').select_option('1lb')
        cart.get_by_role('button', name='Add French Vanilla to saved cart', exact=True).click()
        expect(page.locator('#cart-count')).to_have_text('6')
        cart.locator('#done-cart-add').click()
        save_named_cart(cart, 'Working cart saved after deletion')
        named_after = working(cart)
        assert named_after['id'] and named_after['id'] != named_before['id']
        assert len(named_after['items']) == 3
        stored_names = cart.evaluate("async () => (await (await import('./lib/saved-carts.js')).listCarts()).map(cart => cart.name)")
        assert 'Working cart deletion regression' not in stored_names
        assert 'Working cart saved after deletion' in stored_names
        assert len(additions) == 3 and len(clears) == 1
        passed('Deleting the open named cart preserves its working copy; editing, adding colors and saving it again create a valid new named cart')

        cart.evaluate('''() => {
          globalThis.testOriginalCartStorageSet=chrome.storage.local.set.bind(chrome.storage.local);
          let failNext=true;
          chrome.storage.local.set=async data => {
            if(failNext && Object.hasOwn(data,'bullseyeWorkingCartV1')) {
              failNext=false;throw new Error('Injected transient working-cart save failure');
            }
            return globalThis.testOriginalCartStorageSet(data);
          };
        }''')
        original_row = cart.locator(f'#saved-cart-items [data-variant-id="{original_variant}"]')
        fine_row = cart.locator(f'#saved-cart-items [data-variant-id="{added_variant}"]')
        original_row.locator('.quantity-field').fill('7')
        original_row.locator('.quantity-field').press('Tab')
        expect(cart.locator('#saved-cart-message')).to_contain_text('Injected transient working-cart save failure')
        expect(cart.locator('#saved-cart-draft-status')).to_have_text('Save failed')
        expect(original_row.locator('.quantity-field')).to_have_value('7')
        assert next(item for item in working(cart)['items'] if str(item['variantId']) == original_variant)['quantity'] == 3
        fine_row.locator('.quantity-field').fill('5')
        fine_row.locator('.quantity-field').press('Tab')
        expect(cart.locator('#saved-cart-draft-status')).to_have_text('Cart kept automatically')
        expect(original_row.locator('.quantity-field')).to_have_value('7')
        expect(fine_row.locator('.quantity-field')).to_have_value('5')
        expect(page.locator('#cart-count')).to_have_text('13')
        retried = {str(item['variantId']):item['quantity'] for item in working(cart)['items']}
        assert retried[original_variant] == 7 and retried[added_variant] == 5
        cart.evaluate('''() => {
          chrome.storage.local.set=globalThis.testOriginalCartStorageSet;
          delete globalThis.testOriginalCartStorageSet;
        }''')
        cart.reload()
        expect(original_row.locator('.quantity-field')).to_have_value('7')
        expect(fine_row.locator('.quantity-field')).to_have_value('5')
        passed('A failed autosave shows Save failed; the next edit retries all unsaved changes and both quantities survive reload')

        cart.evaluate('''([first,second]) => {
          const original=chrome.storage.local.set.bind(chrome.storage.local);
          let delayNext=true;
          chrome.storage.local.set=async data => {
            if(delayNext && Object.hasOwn(data,'bullseyeWorkingCartV1')) {
              delayNext=false;await new Promise(resolve=>setTimeout(resolve,100));
            }
            return original(data);
          };
          for(const [id,value] of [[first,8],[second,6]]) {
            const input=document.querySelector(`#saved-cart-items [data-variant-id="${id}"] .quantity-field`);
            input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }''', [original_variant, added_variant])
        expect(cart.locator('#saved-cart-draft-status')).to_have_text('Cart kept automatically')
        expect(original_row.locator('.quantity-field')).to_have_value('8')
        expect(fine_row.locator('.quantity-field')).to_have_value('6')
        expect(page.locator('#cart-count')).to_have_text('15')
        queued = {str(item['variantId']):item['quantity'] for item in working(cart)['items']}
        assert queued[original_variant] == 8 and queued[added_variant] == 6
        assert len(additions) == 3 and len(clears) == 1
        passed('Two immediate edits queued behind a delayed storage write both persist without reverting or double-counting quantities')

        assert not errors, errors
        assert all(request['method'] == 'GET' or request['path'] in ['/cart/add.js', '/cart/clear.js'] for request in requests)
        context.close()
except Exception as error:
    failure = str(error)
    traceback.print_exc()
    try:
        page.screenshot(path=str(OUT / 'v067-cart-failure.png'), full_page=True)
    except Exception:
        pass
    raise
finally:
    (OUT / 'v067-cart-report.json').write_text(json.dumps({
        'passed': checks, 'count': len(checks), 'failure': failure, 'browserErrors': errors,
        'addPosts': len(additions), 'clearPosts': len(clears),
        'storeMode': 'Synthetic fixture only. No real account or cart accessed.',
    }, indent=2))
