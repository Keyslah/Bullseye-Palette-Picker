"""Purpose: verify the main toolbar/reference and Alternatives card bounds in Chromium.
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
REFERENCE = '100% thickness = 6 mm solid glass, 16 mm fine frit *Rough estimate'
checks, errors, audits, main_audits = [], [], [], []


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def assert_main_controls(page):
    reference = page.locator('#thickness-reference')
    expect(reference).to_have_count(1)
    expect(reference).to_be_visible()
    expect(reference).to_have_text(REFERENCE)
    assert reference.evaluate("n => n.parentElement.matches('.palette-flow') && n.parentElement.lastElementChild===n && !n.closest('details,dialog')")
    assert page.locator('#about-menu .thickness-reference').count() == 0
    assert REFERENCE.split(' *')[0] not in page.locator('#about-menu').text_content()
    expect(page.locator('#sign-in')).to_be_visible()
    audit = page.evaluate('''() => {
      const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const reference=document.querySelector('#thickness-reference'),range=document.createRange();range.selectNodeContents(reference);
      return {width:innerWidth,height:innerHeight,header:rect(document.querySelector('.app-header')),
        order:[...document.querySelector('#main-toolbar').children].slice(0,4).map(n=>n.id),
        controls:['#refresh-settings','#sign-in','#settings-menu>summary','#include-transparent'].map(s=>rect(document.querySelector(s))),
        openMenus:document.querySelectorAll('.toolbar-menu[open]').length,
        reference:rect(reference),lines:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})),
        referenceScrollWidth:reference.scrollWidth,referenceClientWidth:reference.clientWidth,
        documentWidth:document.documentElement.scrollWidth};
    }''')
    assert audit['order'] == ['refresh-settings','sign-in','settings-menu','include-transparent'], audit
    assert audit['openMenus'] == 0, audit
    for first, second in zip(audit['controls'], audit['controls'][1:]):
        assert abs(first['y'] - second['y']) <= 2, audit
        assert 0 <= second['x'] - first['right'] < 8, audit
    if audit['width'] == 1440:
        assert audit['header']['height'] < 44, audit
    r = audit['reference']
    assert r['x'] >= 0 and r['right'] <= audit['width']+1 and r['y'] >= 0 and r['bottom'] <= audit['height'], audit
    assert audit['referenceScrollWidth'] <= audit['referenceClientWidth']+1, audit
    assert audit['lines'], audit
    for line in audit['lines']:
        assert line['x'] >= r['x']-1 and line['right'] <= r['right']+1, audit
        assert line['y'] >= r['y']-1 and line['bottom'] <= r['bottom']+1, audit
    assert audit['documentWidth'] <= audit['width']+1, audit
    return audit


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
        if not args.audit_only:
            expect(page.locator('#thickness-reference')).to_be_visible()
            expect(page.locator('#thickness-reference')).to_have_text(REFERENCE)
            assert page.locator('.toolbar-menu[open]').count() == 0
            passed('Exact thickness reference is visible on the initial picker without opening a menu')
        page.locator('#image-file').set_input_files(temp / 'source.png')
        expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
        expect(page.locator('#account-status')).to_contain_text('Sign in to Bullseye')
        for width, height in [(1440, 900), (1000, 800), (650, 900), (380, 800), (320, 700)]:
            page.set_viewport_size({'width':width,'height':height})
            if not args.audit_only:
                main_audits.append(assert_main_controls(page))
                passed(f'Settings follows Sign in before Transparent; the complete main reference is visible and fits at {width}px')
            page.screenshot(path=str(OUT / f'{prefix}-main-{width}.png'), full_page=True)
            if not args.audit_only and width in [1000, 320]:
                page.locator('#settings-menu > summary').click()
                menu = page.locator('#settings-menu .menu-content')
                expect(menu).to_be_visible()
                box = menu.bounding_box()
                assert box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width'] <= width+1 and box['y']+box['height'] <= height+1, box
                page.locator('#form-fine').click()
                expect(page.locator('#form-fine')).to_have_attribute('aria-pressed','true')
                page.locator('#preferred-jar-size').select_option('1lb')
                expect(page.locator('#preferred-jar-size')).to_have_value('1lb')
                expect(page.locator('#save-settings')).to_be_visible()
                expect(page.locator('#load-settings')).to_be_visible()
                page.screenshot(path=str(OUT / f'{prefix}-settings-{width}.png'), full_page=True)
                page.locator('#preferred-jar-size').select_option('5lb')
                page.locator('#form-medium').click()
                expect(page.locator('#form-medium')).to_have_attribute('aria-pressed','true')
                page.locator('#settings-menu > summary').click()
                expect(menu).not_to_be_visible()
                expect(page.locator('#palette-chips .palette-chip')).to_have_count(6)
                passed(f'Relocated Settings opens on-screen and its form/package controls remain usable at {width}px')
        page.set_viewport_size({'width':1440,'height':900})
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
    (OUT / (prefix + '-report.json')).write_text(json.dumps({'checks':checks,'errors':errors,'mainAudits':main_audits,'audits':audits}, indent=2))
