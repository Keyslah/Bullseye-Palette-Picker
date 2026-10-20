"""Purpose: verify Alternatives card bounds and compact sign-in placement in Chromium.
Setup: Python Playwright/Pillow and an installed Playwright Chromium; run from the repo.
Writes: disposable profile, synthetic source image, screenshots and DOM metrics in test-results.
Constraints: account/store responses are isolated fixtures; no live cart actions. Product
photographs are public Bullseye CDN images. --audit-only records the old layout without gates.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--audit-only', action='store_true')
args = parser.parse_args()
prefix = 'v063-layout-before' if args.audit_only else 'v063-layout'
checks, errors, audits = [], [], []


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def metrics(page):
    return page.locator('#alternatives-grid').evaluate('''grid => {
      const rect = n => {const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const css = n => {const s=getComputedStyle(n);return Object.fromEntries(['display','gridTemplateColumns','gridTemplateRows','gridAutoRows','minHeight','height','alignItems','alignContent','overflow','width','aspectRatio'].map(k=>[k,s[k]]));};
      return {width:innerWidth,height:innerHeight,grid:rect(grid),scrollWidth:grid.scrollWidth,clientWidth:grid.clientWidth,scrollHeight:grid.scrollHeight,clientHeight:grid.clientHeight,css:css(grid),
       cards:[...grid.children].map(n=>({id:n.dataset.productId,box:rect(n),css:css(n),photo:rect(n.querySelector('.photo-button')),photoCss:css(n.querySelector('.photo-button')),body:rect(n.querySelector('.product-card-content')),
        parts:[...n.querySelectorAll('.photo-button,.product-name,.glass-checkbox,.match-label,.purchase-toggle,.row-alternatives')].map(p=>({selector:p.className,box:rect(p)}))}))};
    }''')


def assert_cards(audit):
    assert audit['scrollWidth'] <= audit['clientWidth'] + 1, audit
    assert audit['scrollHeight'] > audit['clientHeight'], audit
    cards = audit['cards']
    assert len(cards) > 12
    for card in cards:
        bounds = card['box']
        for part in card['parts']:
            r = part['box']
            assert r['x'] >= bounds['x'] - 1 and r['right'] <= bounds['right'] + 1, (card, part)
            assert r['y'] >= bounds['y'] - 1 and r['bottom'] <= bounds['bottom'] + 1, (card, part)
        assert card['photo']['bottom'] <= card['body']['y'] + 1, card
    for i, first in enumerate(cards):
        a = first['box']
        for second in cards[i + 1:]:
            b = second['box']
            overlaps_x = min(a['right'], b['right']) - max(a['x'], b['x']) > 1
            overlaps_y = min(a['bottom'], b['bottom']) - max(a['y'], b['y']) > 1
            assert not (overlaps_x and overlaps_y), (first, second)


try:
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as p:
        temp = Path(folder)
        image = Image.new('RGB', (640, 960))
        image.putdata([(x * 255 // 640, y * 255 // 960, 100) for y in range(960) for x in range(640)])
        image.save(temp / 'source.png')
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        context = p.chromium.launch_persistent_context(str(temp / 'profile'), channel='chromium', headless=True,
            viewport={'width':1440,'height':900}, proxy={'server':proxy} if proxy else None,
            ignore_https_errors=bool(proxy),  # Only the isolated proxy-backed test profile.
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        context.route('https://shop.bullseyeglass.com/**', lambda route: route.fulfill(status=200,content_type='text/html',body='<div class="account-actions__sign-ins">Sign in</div>'))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch = async () => new Response('<div class=\"account-actions__sign-ins\">Sign in</div>', {status:200,headers:{'Content-Type':'text/html'}}); }")
        base = 'chrome-extension://' + worker.url.split('/')[2] + '/picker.html'
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)
        page.goto(base + '?workspace=1')
        expect(page.locator('#form-medium')).to_be_enabled()
        page.locator('#image-file').set_input_files(temp / 'source.png')
        expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
        expect(page.locator('#account-status')).to_contain_text('Sign in to Bullseye')
        if not args.audit_only:
            expect(page.locator('#sign-in')).to_be_visible()
            assert page.locator('#sign-in').evaluate("n => n.parentElement.id==='main-toolbar' && n.previousElementSibling.id==='refresh-settings'")
            a, b = page.locator('#refresh-settings').bounding_box(), page.locator('#sign-in').bounding_box()
            assert abs(a['y'] - b['y']) <= 2
            assert b['x'] >= a['x'] + a['width'] and b['x'] - a['x'] - a['width'] < 8
            toolbar = page.locator('#main-toolbar').evaluate("n=>({width:n.clientWidth,children:[...n.children].map(c=>({id:c.id,width:c.getBoundingClientRect().width,y:c.getBoundingClientRect().y}))})")
            assert page.locator('.app-header').bounding_box()['height'] < 44, toolbar
            passed('Existing sign-in control sits immediately beside Refresh in the same toolbar')
        page.screenshot(path=str(OUT / (prefix + '-toolbar.png')), full_page=True)
        page.locator('#product-grid .row-alternatives').first.click()
        expect(page.locator('#alternatives-dialog')).to_be_visible()
        loaded = page.locator('#alternatives-grid .glass-photo img').evaluate_all('''async images => {
          await Promise.all(images.slice(0,16).map(img => img.decode().catch(() => {})));
          return images.slice(0,16).filter(img=>img.naturalWidth>0).length;
        }''')
        assert loaded == 16, ('Actual public photo loads', loaded)
        for width, height in [(1440, 900), (1920, 1080), (650, 900), (380, 800), (320, 700)]:
            page.set_viewport_size({'width':width,'height':height})
            page.locator('#alternatives-grid').evaluate('n => n.scrollTop=0')
            page.wait_for_timeout(200)
            audit = metrics(page)
            audits.append(audit)
            if not args.audit_only:
                assert_cards(audit)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
                passed(f'All card content contained; rows wrap without overlap or horizontal overflow at {width}px')
            page.screenshot(path=str(OUT / f'{prefix}-{width}.png'), full_page=True)
            if not args.audit_only:
                # Open a real top-layer popover close to the scroller's lower edge.
                grid = page.locator('#alternatives-grid')
                button = page.locator('#alternatives-grid .purchase-toggle').nth(10)
                button.scroll_into_view_if_needed()
                button.click()
                panel = page.locator('.purchase-popover:popover-open')
                expect(panel).to_be_visible()
                box = panel.bounding_box()
                assert box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width'] <= width+1 and box['y']+box['height'] <= height+1
                quantity = panel.locator('.quantity-field')
                expect(quantity).to_be_visible()
                quantity.fill('3')
                quantity.press('Tab')
                expect(quantity).to_have_value('3')
                assert panel.evaluate("n => [...n.querySelectorAll('select,input')].every(control => {const b=control.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===control;})")
                page.screenshot(path=str(OUT / f'{prefix}-purchase-{width}.png'), full_page=True)
                panel.locator('[aria-label="Close purchase options"]').click()
                passed(f'Purchase popover remains on-screen and usable above the scrolling popup at {width}px')
        assert not errors, errors
        passed('No browser page errors')
        context.close()
finally:
    (OUT / (prefix + '-report.json')).write_text(json.dumps({'checks':checks,'errors':errors,'audits':audits}, indent=2))
