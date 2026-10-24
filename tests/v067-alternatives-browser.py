"""Purpose: verify Alternatives filters stay local and explicit choices survive reload.
Setup: Python Playwright and Playwright Chromium; run from any working directory.
Writes: a disposable browser profile and test-results/v067-alternatives-report.json.
Constraints: all network responses are isolated fixtures; no personal profile,
account, website cart, or persistent user settings are accessed.
"""
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
checks, errors = [], []


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def workspace(page):
    page.wait_for_timeout(400)
    return page.evaluate("async () => (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")


def protected(record):
    return {key: record.get(key) for key in ['glassTypes', 'includeTints', 'chosenMatches',
            'selection', 'cart', 'quantities', 'selectedVariants', 'targets']}


def card(page, target):
    return page.locator(f'#product-grid .compact-card[data-target-id="{target}"]')


def isolated_network(route):
    if route.request.url.startswith('https://shop.bullseyeglass.com/'):
        route.fulfill(status=200, content_type='text/html', body='<html><body>Isolated shop fixture</body></html>')
    else:
        route.fulfill(status=200, content_type='image/svg+xml',
            body='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#aaa"/></svg>')


try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
            viewport={'width':1440, 'height':900},
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        context.route('https://**/*', isolated_network)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch = async () => { throw new Error('External requests disabled in Alternatives test'); }; }")
        base = f'chrome-extension://{worker.url.split("/")[2]}/picker.html?workspace=1'
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Build and seed fixtures before any picker exists; a live picker correctly
        # hands its own snapshot to the worker when it closes or reloads.
        page.goto(f'chrome-extension://{worker.url.split("/")[2]}/manifest.json')
        seed = page.evaluate('''() => {
          const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;
          const ctx=canvas.getContext('2d'),colors=['#F7F4E3','#6A12DE'];
          colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*300,0,300,300);});
          return {version:6,photoGuideVersion:1,sourceName:'Independent alternative filters',sourceDataUrl:canvas.toDataURL(),
            targets:colors.map((hex,i)=>({id:['cream','purple'][i],hex,rgb:hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)),
              x:(i+.5)/2,y:.5,manual:true,custom:true})),activeTargetId:'cream',format:'fine',preferredJarSize:'5lb',
            glassTypes:{transparent:true,opalescent:false},includeTints:false,chosenMatches:{},view:'palette',imageSize:'larger'};
        }''')
        page.close()
        worker.evaluate('(seed) => chrome.storage.local.set({bullseyeProjectV1:seed})', seed)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base)
        expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed', 'false')
        untouched = card(page, 'purple').get_attribute('data-product-id')

        card(page, 'cream').locator('.row-alternatives').click()
        before = protected(workspace(page))
        page.locator('#alternatives-search').fill('French Vanilla')
        expect(page.locator('#alternatives-grid .compact-card')).to_have_count(0)
        page.locator('#alternatives-opalescent').click()
        expect(page.locator('#alternatives-grid .compact-card[data-product-id="000137"]')).to_be_visible()
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed', 'false')
        page.locator('#alternatives-search').fill('Coral Orange Tint')
        expect(page.locator('#alternatives-grid .compact-card')).to_have_count(0)
        page.locator('#alternatives-tints').click()
        expect(page.locator('#alternatives-grid .compact-card')).to_have_count(1)
        expect(page.locator('#include-tints')).to_have_attribute('aria-pressed', 'false')
        page.locator('#alternatives-transparent').click()
        expect(page.locator('#alternatives-grid .compact-card')).to_have_count(0)
        expect(page.locator('#include-transparent')).to_have_attribute('aria-pressed', 'true')
        assert protected(workspace(page)) == before
        expect(card(page, 'purple')).to_have_attribute('data-product-id', untouched)
        passed('All three Alternatives filters update only the dialog; main filters, matches, selected glass and stored preferences stay unchanged')

        page.locator('#close-alternatives').click()
        card(page, 'cream').locator('.row-alternatives').click()
        expect(page.locator('#alternatives-transparent')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('#alternatives-opalescent')).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('#alternatives-tints')).to_have_attribute('aria-pressed', 'false')
        passed('Reopening Alternatives starts with a fresh copy of the main filters')

        page.locator('#alternatives-opalescent').click()
        page.locator('#alternatives-search').fill('French Vanilla')
        page.locator('#alternatives-grid .compact-card[data-product-id="000137"] .row-alternatives').click()
        expect(card(page, 'cream')).to_have_attribute('data-product-id', '000137')
        expect(card(page, 'purple')).to_have_attribute('data-product-id', untouched)
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed', 'false')
        assert workspace(page)['chosenMatches']['cream'] == '000137'
        page.reload()
        expect(card(page, 'cream')).to_have_attribute('data-product-id', '000137')
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed', 'false')
        passed('An explicit Opalescent alternative replaces only its target and survives reload with main Opalescent still off')

        card(page, 'cream').locator('.row-alternatives').click()
        page.locator('#alternatives-tints').click()
        page.locator('#alternatives-search').fill('Coral Orange Tint')
        tint = page.locator('#alternatives-grid .compact-card').get_attribute('data-product-id')
        page.locator('#alternatives-grid .row-alternatives').click()
        expect(card(page, 'cream')).to_have_attribute('data-product-id', tint)
        expect(page.locator('#include-tints')).to_have_attribute('aria-pressed', 'false')
        workspace(page)
        page.reload()
        expect(card(page, 'cream')).to_have_attribute('data-product-id', tint)
        expect(card(page, 'purple')).to_have_attribute('data-product-id', untouched)
        expect(page.locator('#include-tints')).to_have_attribute('aria-pressed', 'false')
        passed('An explicit tint alternative also survives without enabling main-page Tints')
        assert not errors, errors
        passed('No uncaught browser errors')
        context.close()
finally:
    (OUT / 'v067-alternatives-report.json').write_text(json.dumps({'checks':checks, 'errors':errors}, indent=2))
