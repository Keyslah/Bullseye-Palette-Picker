"""Purpose: verify transparent-only Black and hue-faithful purple automatic matches.
Setup: Python Playwright and Playwright Chromium; BULLSEYE_TEST_ROOT may select
the checkout under test. Uses real bundled samples and public Bullseye CDN photos.
Writes: disposable Chrome profile, synthetic source, screenshots and test-results report.
Constraints: all shop/account requests are isolated fixtures, worker network is blocked,
and no Send/cart endpoint is invoked. Existing user profiles and saved work are untouched.
"""
import json
import os
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(os.environ.get('BULLSEYE_TEST_ROOT', Path(__file__).resolve().parents[1]))
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
CATALOG = {p['id']: p for p in json.loads((EXT / 'data/catalog.json').read_text())['products']}
PHOTOS = json.loads((EXT / 'data/form-samples.json').read_text())['products']
ROYAL_BLUE = next(pid for pid, p in CATALOG.items() if p['name'] == 'Deep Royal Blue')
checks, errors, shop_requests, audit = [], [], [], []
failure = None
context = page = None


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def saved(page):
    page.wait_for_timeout(400)
    return page.evaluate("async () => (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")


def source_work(record):
    return {key: record.get(key) for key in ['sourceDataUrl', 'sourceName', 'targets']}


def watch(page):
    page.set_default_timeout(30000)
    page.on('pageerror', lambda error: errors.append(str(error)))


def isolated_shop(route):
    request = route.request
    path = urlparse(request.url).path
    shop_requests.append({'method': request.method, 'path': path})
    if request.method == 'GET' and path == '/cart':
        route.fulfill(status=200, content_type='text/html', body='<html><body><span class="account-actions__email">isolated@example.invalid</span></body></html>')
    else:
        route.fulfill(status=404, content_type='application/json', body='{"error":"No live store access in this test"}')


def card(target):
    return page.locator(f'#product-grid .compact-card[data-target-id="{target}"]')


def transparent_cards_only(selector):
    ids = page.locator(selector).evaluate_all('(nodes) => nodes.map(node => node.dataset.productId)')
    assert ids and '000100' in ids, ids
    assert all(pid == '000100' or CATALOG[pid]['type'] == 'Transparent' for pid in ids), ids
    return ids


def set_form(form):
    page.locator('#settings-menu > summary').click()
    page.locator('#form-' + form).click()
    expect(page.locator('#form-' + form)).to_have_attribute('aria-pressed', 'true')
    page.locator('#settings-menu > summary').click()


def photo_audit(target, form):
    row = card(target)
    pid = row.get_attribute('data-product-id')
    expected = PHOTOS[pid][form]
    image = row.locator('.glass-photo img')
    expect(image).to_have_attribute('src', expected['imageUrl'])
    image.evaluate('async img => { await img.decode(); }')
    assert image.evaluate('img => [img.naturalWidth,img.naturalHeight]') == expected['pixels']
    marker = row.locator('.sample-marker')
    expect(marker).to_be_visible()
    sample_id = marker.get_attribute('data-sample-id')
    sample = next(s for s in expected['samples'] if s['id'] == sample_id)
    assert abs(float(marker.get_attribute('data-x')) - sample['x']) < 1e-9
    assert abs(float(marker.get_attribute('data-y')) - sample['y']) < 1e-9
    return {'target': target, 'productId': pid, 'name': CATALOG[pid]['name'], 'form': form,
            'imageUrl': expected['imageUrl'], 'sampleId': sample_id, 'sampleHex': sample['hex']}


try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as pw:
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        context = pw.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
            viewport={'width': 1440, 'height': 1000}, proxy={'server': proxy} if proxy else None,
            ignore_https_errors=bool(proxy), args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        context.route('https://shop.bullseyeglass.com/**', isolated_shop)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch = async () => { throw new Error('External worker requests disabled in matching test'); }; }")
        base = f'chrome-extension://{worker.url.split("/")[2]}/picker.html'
        store = context.new_page()
        store.goto('https://shop.bullseyeglass.com/cart')
        page = context.new_page()
        watch(page)
        page.goto(base + '?workspace=1')
        expect(page.locator('#form-fine')).to_be_enabled()
        seed = page.evaluate('''() => {
          const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;
          const ctx=canvas.getContext('2d'),colors=['#000000','#6A12DE','#263AB5'];
          colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*400,0,400,600);});
          return {version:6,photoGuideVersion:1,sourceName:'Black, screenshot purple and blue controls',sourceDataUrl:canvas.toDataURL(),
            targets:colors.map((hex,i)=>({id:['black','purple','blue'][i],hex,rgb:hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)),
              x:(i+.5)/3,y:.5,manual:true,custom:true})),activeTargetId:'purple',format:'fine',preferredJarSize:'5lb',
            glassTypes:{transparent:true,opalescent:false},includeTints:false,chosenMatches:{},view:'palette',imageSize:'larger'};
        }''')
        page.close()
        worker.evaluate('(seed) => chrome.storage.local.set({bullseyeProjectV1:seed})', seed)
        page = context.new_page()
        watch(page)
        page.goto(base + '?workspace=1')
        expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#include-transparent')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed', 'false')
        expect(card('black')).to_have_attribute('data-product-id', '000100')
        expect(card('purple')).to_have_attribute('data-product-id', '001334')
        expect(card('blue')).to_have_attribute('data-product-id', ROYAL_BLUE)
        baseline = saved(page)
        protected = source_work(baseline)
        assert baseline['chosenMatches'] == {}, baseline['chosenMatches']
        passed('Transparent-only Fine automatically matches regular Black, Gold Purple for screenshot #6A12DE, and Deep Royal Blue for actual blue')
        audit.extend(photo_audit(target, 'fine') for target in ['black', 'purple', 'blue'])
        page.screenshot(path=str(OUT / 'v065-matching-fine-1440.png'), full_page=True)
        passed('Each initial match displays its real Fine photograph and a marker at that photograph’s recorded sample')

        page.locator('#library-tab').click()
        expect(page.locator('#product-grid .compact-card[data-product-id="000100"]')).to_be_visible()
        transparent_cards_only('#product-grid .compact-card')
        page.locator('#include-transparent').click()
        expect(page.locator('#product-grid .compact-card')).to_have_count(0)
        page.locator('#include-transparent').click()
        page.locator('#palette-tab').click()
        card('purple').locator('.row-alternatives').click()
        expect(page.locator('#alternatives-dialog')).to_be_visible()
        transparent_cards_only('#alternatives-grid .compact-card')
        expect(page.locator(f'#alternatives-grid .compact-card[data-product-id="{ROYAL_BLUE}"]')).to_have_count(1)
        page.locator('#close-alternatives').click()
        passed('Regular Black stays available in transparent-only All glass and Alternatives; other opals stay excluded and disabling both materials shows none')

        page.locator('#save-palette').click()
        page.locator('#palette-name').fill('Black and purple regression')
        page.locator('#confirm-save-palette').click()
        expect(page.locator('#saved-dialog')).not_to_be_visible()
        named = page.evaluate("async () => { const lib=await import('./lib/saved-palettes.js'); const list=await lib.listPalettes(); return lib.loadPalette(list.find(p=>p.name==='Black and purple regression').id); }")
        assert source_work(named['workspace']) == protected

        for form in ['powder', 'medium', 'coarse', 'fine']:
            set_form(form)
            expect(card('purple')).not_to_have_attribute('data-product-id', ROYAL_BLUE)
            assert source_work(saved(page)) == protected
        expect(card('purple')).to_have_attribute('data-product-id', '001334')
        page.locator('#refresh-settings').click()
        assert source_work(saved(page)) == protected
        set_form('fine')
        if page.locator('#include-opalescent').get_attribute('aria-pressed') == 'true':
            page.locator('#include-opalescent').click()
        expect(card('purple')).to_have_attribute('data-product-id', '001334')
        page.reload()
        expect(page.locator('#image-loaded')).to_be_visible()
        expect(card('purple')).to_have_attribute('data-product-id', '001334')
        assert source_work(saved(page)) == protected
        restored_named = page.evaluate("async id => (await import('./lib/saved-palettes.js')).loadPalette(id)", named['id'])
        assert restored_named == named
        passed('Form switching, Refresh and reopening preserve the source image, manually edited colors, source dots and the named palette')

        page.set_viewport_size({'width': 650, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        page.screenshot(path=str(OUT / 'v065-matching-fine-650.png'), full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1000})
        card('purple').locator('.row-alternatives').click()
        page.locator('#alternatives-search').fill('Deep Royal Blue')
        page.locator(f'#alternatives-grid .compact-card[data-product-id="{ROYAL_BLUE}"] .row-alternatives').click()
        expect(card('purple')).to_have_attribute('data-product-id', ROYAL_BLUE)
        chosen = saved(page)
        assert chosen['chosenMatches']['purple'] == ROYAL_BLUE
        assert source_work(chosen) == protected
        page.reload()
        expect(card('purple')).to_have_attribute('data-product-id', ROYAL_BLUE)
        assert source_work(saved(page)) == protected
        passed('An explicit Deep Royal Blue alternative still overrides the automatic purple recommendation and survives reload')

        before_cart = saved(page)
        cart = context.new_page()
        watch(cart)
        cart.goto(base + '?workspace=1&cart=1&mode=selection')
        expect(cart.locator('#cart-add-form')).to_be_visible()
        if cart.locator('#cart-include-opalescent').get_attribute('aria-pressed') == 'true':
            cart.locator('#cart-include-opalescent').click()
        expect(cart.locator('#cart-include-transparent')).to_have_attribute('aria-pressed', 'true')
        cart.locator('#cart-add-form').select_option('fine')
        cart.locator('#cart-add-size').select_option('1lb')
        cart.locator('#saved-cart-search').fill('Black')
        expect(cart.locator('#saved-cart-search-results [data-product-id="000100"]')).to_be_visible()
        ids = cart.locator('#saved-cart-search-results .saved-cart-search-result').evaluate_all('(nodes) => nodes.map(n=>n.dataset.productId)')
        assert '000100' in ids and all(pid == '000100' or CATALOG[pid]['type'] == 'Transparent' for pid in ids), ids
        expect(cart.get_by_role('button', name='Add Black to saved cart', exact=True)).to_be_enabled()
        cart.locator('#cart-include-transparent').click()
        expect(cart.locator('#saved-cart-search-results .saved-cart-search-result')).to_have_count(0)
        assert saved(page) == before_cart
        passed('The cart’s independent transparent-only filter exposes real Black variants while excluding other opals and leaves the picker workspace untouched')
        assert not errors, errors
        assert not any(r['method'] != 'GET' or '/cart/add' in r['path'] for r in shop_requests), shop_requests
        passed('No uncaught browser errors and no live or mocked shopping writes')
        context.close()
except Exception as error:
    failure = str(error)
    traceback.print_exc()
    try:
        page.screenshot(path=str(OUT / 'v065-matching-failure.png'), full_page=True)
    except Exception:
        pass
    raise
finally:
    (OUT / 'v065-matching-report.json').write_text(json.dumps({'passed': checks, 'count': len(checks),
        'failure': failure, 'browserErrors': errors, 'photoAudit': audit, 'shopRequests': shop_requests,
        'storeMode': 'Isolated fixtures only; real public product photographs; no cart writes.'}, indent=2))
