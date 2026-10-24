"""Purpose: verify themed sampling, distinct glass/thickness choices and manual-color ownership.
Setup: Python Playwright/Pillow and Chromium; reads the current extension source.
Writes: disposable browser/image data and test-results/v068-prominence screenshots/report.
Constraints: no personal Chrome profile, live account, store mutation or source-image upload.
"""
import base64
import io
import json
import tempfile
import traceback
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
checks, errors = [], []
failure = None
page = None


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def workspace(current, condition='true'):
    return current.evaluate('''async () => {
      const matches=value=>value && (''' + condition + ''');
      const read=async()=>(await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1;
      const value=await read();if(matches(value))return value;
      return new Promise((resolve,reject)=>{
        const finish=value=>{if(!matches(value))return;clearTimeout(timer);chrome.storage.onChanged.removeListener(listener);resolve(value);};
        const listener=(changes,area)=>{if(area==='local' && changes.bullseyeProjectV1)finish(changes.bullseyeProjectV1.newValue);};
        const timer=setTimeout(()=>{chrome.storage.onChanged.removeListener(listener);reject(new Error('Expected workspace save did not arrive'));},15000);
        chrome.storage.onChanged.addListener(listener);read().then(finish,reject);
      });
    }''')


def protected(value):
    return {key: value.get(key) for key in ['targets', 'chosenMatches', 'selection', 'cart',
            'quantities', 'selectedVariants', 'selectedForms']}


def theme(rgb):
    red, green, blue = rgb
    return (blue > red + 45 and blue > green + 25) or (red > green + 60 and green > blue + 30)


def automatic_choices(current, value):
    targets = [target for target in value['targets'] if not target.get('manual')]
    assert 1 <= len(targets) <= value['paletteCount'], targets
    rows = current.locator('#product-grid > .compact-card[data-target-id]').evaluate_all(r'''nodes=>Object.fromEntries(nodes.map(row=>{
      const text=row.querySelector('.match-label')?.textContent || '';
      const thickness=text.match(/(\d+)% thickness/);
      return [row.dataset.targetId,{productId:row.dataset.productId,thickness:thickness?Number(thickness[1]):null}];
    }))''')
    choices = [dict(rows[target['id']], targetId=target['id'], rgb=target['rgb']) for target in targets]
    assert all(choice['productId'] != '000100' for choice in choices), choices
    assert len({(choice['productId'], choice['thickness']) for choice in choices}) == len(choices), choices
    for index, choice in enumerate(choices):
        for other in choices[index + 1:]:
            if choice['productId'] == other['productId']:
                assert choice['thickness'] is not None and other['thickness'] is not None, choices
                assert abs(choice['thickness'] - other['thickness']) >= 10, choices
    manual_products = {rows[target['id']]['productId'] for target in value['targets'] if target.get('manual')}
    manual_keys = set(value['selection']['manualKeys'])
    manual_products.update(item['productId'] for item in value['cart'] if item['key'] in manual_keys)
    assert not manual_products.intersection(choice['productId'] for choice in choices), choices
    return choices


def next_remix(current):
    # Some finite sources legitimately keep the same colors on Remix. Observe the
    # worker's save acknowledgement: an unchanged write emits no storage event.
    current.evaluate('''()=>{
      globalThis.nextRemixSave=new Promise((resolve,reject)=>{
        const original=chrome.runtime.sendMessage;
        const finish=(callback,value)=>{clearTimeout(timer);chrome.runtime.sendMessage=original;callback(value);};
        const timer=setTimeout(()=>finish(reject,new Error('Remix save was not confirmed')),15000);
        chrome.runtime.sendMessage=function(...args){
          const result=original.apply(chrome.runtime,args);
          if(args[0]?.type==='BULLSEYE_SAVE_WORKSPACE'){
            chrome.runtime.sendMessage=original;
            Promise.resolve(result).then(async reply=>{
              if(reply?.saved!==true)throw new Error(reply?.error || 'Workspace save was not confirmed');
              return (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1;
            }).then(value=>finish(resolve,value),error=>finish(reject,error));
          }
          return result;
        };
      });
    }''')
    current.locator('#remix-palette').click()
    return current.evaluate('()=>globalThis.nextRemixSave')


def import_bands(worker, current, name, colors):
    source = Image.new('RGB', (120 * len(colors), 200))
    for index, color in enumerate(colors):
        source.paste(tuple(color), (index * 120, 0, (index + 1) * 120, 200))
    image = io.BytesIO()
    source.save(image, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()
    worker.evaluate('''([name,dataUrl])=>chrome.storage.session.set({pendingImage:{dataUrl,name,updatedAt:Date.now()}})''', [name, data_url])
    return workspace(current, 'value.sourceName===' + json.dumps(name) + ' && value.targets.length>0')


def fixture(route):
    if route.request.resource_type == 'image':
        route.fulfill(status=200, content_type='image/svg+xml',
                      body='<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#dce3db"/></svg>')
    else:
        route.fulfill(status=200, content_type='text/html', body='<html><body>Isolated fixture</body></html>')


try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as pw:
        # Blue/orange texture occupies almost all eligible area; black and a tiny
        # isolated green accent must not consume automatic prominent-color slots.
        source = Image.new('RGB', (800, 400))
        pixels = []
        for y in range(400):
            for x in range(800):
                shade = (x * 7 + y * 11) % 31
                if x < 160:
                    rgb = (0, 0, 0)
                elif x < 512:
                    rgb = (35 + shade, 70 + shade, 165 + shade)
                elif x < 796:
                    rgb = (205 + shade, 105 + shade, 30 + shade)
                else:
                    rgb = (0, 255, 0)
                pixels.append(rgb)
        source.putdata(pixels)
        image = io.BytesIO()
        source.save(image, format='PNG')
        data_url = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()
        context = pw.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
            viewport={'width':1440, 'height':900},
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        context.route('https://**/*', fixture)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch=async()=>{throw new Error('External requests disabled in sampling fixture');}; }")
        worker.evaluate('''dataUrl=>chrome.storage.session.set({pendingImage:{dataUrl,
          name:'Prominent theme fixture',sourceUrl:'https://example.invalid/image.png',updatedAt:Date.now()}})''', data_url)
        base = f'chrome-extension://{worker.url.split("/")[2]}/picker.html?workspace=1'
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base)
        expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#prominence')).to_be_checked()
        expect(page.locator('#show-full-palette')).to_have_count(0)
        assert 'Show full palette' not in page.locator('body').inner_text()
        assert page.locator('#prominence').evaluate("el=>el.parentElement.previousElementSibling.id") == 'show-alternatives'
        initial = workspace(page, "value.sourceName==='Prominent theme fixture' && value.targets.length>0 && value.targets.length<=6")
        assert initial['prominence'] is True
        assert all(theme(target['rgb']) and target['excludeBlack'] for target in initial['targets']), initial['targets']
        assert any(target['rgb'][2] > target['rgb'][0] for target in initial['targets'])
        assert any(target['rgb'][0] > target['rgb'][2] for target in initial['targets'])
        automatic_choices(page, initial)
        assert page.locator('#product-grid .compact-card[data-product-id="000100"]').count() == 0
        passed('Right-click image handoff defaults to Prominence beside Alternatives, samples the broad blue/orange theme and excludes automatic Black')

        page.locator('#prominence').uncheck()
        off = workspace(page, 'value.prominence===false')
        assert protected(off) == protected(initial)
        page.locator('#prominence').check()
        on = workspace(page, 'value.prominence===true')
        assert protected(on) == protected(initial)
        passed('Turning Prominence off and on changes only the saved sampling preference, not existing colors, selections or quantities')

        # Exercise rare automatic accents before adding a manual green target:
        # automatic sampling must later avoid glass represented by manual choices.
        page.locator('#prominence').uncheck()
        workspace(page, 'value.prominence===false')
        broad = next_remix(page)
        assert any(target['rgb'][1] > 240 and target['rgb'][0] < 20 and target['rgb'][2] < 20 for target in broad['targets'])
        assert all(target['rgb'] != [0, 0, 0] for target in broad['targets'])
        assert broad['sourceDataUrl'] == initial['sourceDataUrl']
        automatic_choices(page, broad)
        page.locator('#prominence').check()
        workspace(page, 'value.prominence===true')
        themed = next_remix(page)
        assert all(theme(target['rgb']) for target in themed['targets']), themed['targets']
        assert any(target['rgb'][2] > target['rgb'][0] for target in themed['targets'])
        assert any(target['rgb'][0] > target['rgb'][2] for target in themed['targets'])
        automatic_choices(page, themed)
        passed('Prominence off includes a rare source accent before manual exclusions; returning on keeps both broad themes with distinct glass/thickness choices')

        page.locator('#add-custom-color').click()
        page.locator('#target-hex').fill('#03ff13')
        page.locator('#target-hex').press('Enter')
        page.locator('#close-color-editor').click()
        canvas = page.locator('#source-canvas')
        canvas.scroll_into_view_if_needed()
        bounds = canvas.bounding_box()
        canvas.click(position={'x':bounds['width'] * .10, 'y':bounds['height'] * .5})
        manual = workspace(page, 'value.targets.filter(target=>target.manual).length===2')
        retained = {target['id']: target for target in manual['targets'] if target['manual']}
        assert {target['hex'] for target in retained.values()} == {'#03FF13', '#000000'}
        black_id = next(target['id'] for target in retained.values() if target['hex'] == '#000000')
        expect(page.locator(f'#product-grid > .compact-card[data-target-id="{black_id}"]')).to_have_attribute('data-product-id', '000100')
        passed('Manual custom accents and a manually clicked Black point remain selectable while Prominence is enabled')

        page.locator('#library-tab').click()
        page.locator('#glass-search').fill('French Vanilla')
        extra = page.locator('#product-grid [data-product-id="000137"] .glass-checkbox')
        expect(extra).not_to_be_checked()
        extra.check()
        with_extra = workspace(page, "value.selection.manualKeys.some(key=>key.startsWith('000137:'))")
        extra_item = next(item for item in with_extra['cart'] if item['productId'] == '000137')
        page.locator('#glass-search').fill('')
        page.locator('#palette-tab').click()
        remixed = next_remix(page)
        assert {target['id']: target for target in remixed['targets'] if target['manual']} == retained
        assert all(theme(target['rgb']) for target in remixed['targets'] if not target['manual'])
        automatic_choices(page, remixed)
        assert next(item for item in remixed['cart'] if item['key'] == extra_item['key']) == extra_item
        expect(page.locator(f'#product-grid > .compact-card[data-target-id="{black_id}"]')).to_have_attribute('data-product-id', '000100')
        passed('Remix retains the source theme and avoids repeated glass/thickness choices while preserving exact manual colors, dots, Black and explicitly checked extra glass')

        page.locator('#prominence').uncheck()
        before_reload = workspace(page, 'value.prominence===false')
        page.reload()
        expect(page.locator('#prominence')).not_to_be_checked()
        reloaded = workspace(page, 'value.prominence===false')
        assert protected(reloaded) == protected(before_reload)
        broad_manual = next_remix(page)
        assert {target['id']: target for target in broad_manual['targets'] if target['manual']} == retained
        assert next(item for item in broad_manual['cart'] if item['key'] == extra_item['key']) == extra_item
        assert all(target['rgb'] != [0, 0, 0] for target in broad_manual['targets'] if not target['manual'])
        automatic_choices(page, broad_manual)
        passed('Prominence off survives reload; its next Remix avoids glass already represented manually and preserves exact manual colors, Black and extra glass')

        page.locator('#settings-menu > summary').click()
        page.locator('#save-settings').click()
        page.locator('#settings-name').fill('Broad color sampling')
        page.locator('#confirm-save-settings').click()
        expect(page.locator('#settings-dialog')).not_to_be_visible()
        defaults = page.evaluate("async()=> (await chrome.storage.local.get('bullseyeSettingsV1')).bullseyeSettingsV1")
        assert defaults['prominence'] is False
        if page.locator('#settings-menu').get_attribute('open') is not None:
            page.locator('#settings-menu > summary').click()
        page.locator('#save-palette').click()
        page.locator('#palette-name').fill('Manual colors with broad sampling')
        page.locator('#confirm-save-palette').click()
        expect(page.locator('#saved-dialog')).not_to_be_visible()
        named = page.evaluate("async()=>{const store=await import('./lib/saved-palettes.js');const entries=await store.listPalettes();return store.loadPalette(entries.find(entry=>entry.name==='Manual colors with broad sampling').id);}")
        assert named['workspace']['prominence'] is False
        assert {target['id']: target for target in named['workspace']['targets'] if target['manual']} == retained
        passed('Named settings and saved palettes retain Prominence and the manually selected colors')

        for width in [1440, 420]:
            page.set_viewport_size({'width':width, 'height':900})
            expect(page.locator('#prominence')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
            page.screenshot(path=str(OUT / f'v068-prominence-{width}.png'), full_page=True)
        assert not errors, errors
        passed('Prominence and unavailable labels fit desktop/narrow layouts with no uncaught browser errors')

        flat = io.BytesIO()
        Image.new('RGB', (300, 200), (25, 80, 140)).save(flat, format='PNG')
        worker.evaluate('''dataUrl=>chrome.storage.session.set({pendingImage:{dataUrl,
          name:'Manual edit ID fixture',updatedAt:Date.now()}})''',
            'data:image/png;base64,' + base64.b64encode(flat.getvalue()).decode())
        original = workspace(page, "value.sourceName==='Manual edit ID fixture' && value.targets.length===1")
        original_id = original['targets'][0]['id']
        page.locator('#open-color-editor').click()
        page.locator('#target-hex').fill('#000000')
        page.locator('#target-hex').press('Enter')
        page.locator('#close-color-editor').click()
        workspace(page, "value.targets.length===1 && value.targets[0].manual && value.targets[0].hex==='#000000'")
        page.locator('#remix-palette').click()
        edited_remix = workspace(page, 'value.targets.length===2')
        assert len({target['id'] for target in edited_remix['targets']}) == 2
        assert next(target for target in edited_remix['targets'] if target['manual'])['id'] == original_id
        assert next(target for target in edited_remix['targets'] if not target['manual'])['rgb'] == [25, 80, 140]
        expect(page.locator(f'#product-grid > .compact-card[data-target-id="{original_id}"]')).to_have_attribute('data-product-id', '000100')
        assert not errors, errors
        passed('Editing an automatic dot then Remix preserves its manual ID and color without colliding with a newly sampled source color')

        # Exact RGBs from the bundled Medium photo guide: Red Transparent has
        # two clearly different real samples (56% and 72% measured thickness).
        red_shades = [[216, 110, 62], [205, 50, 30]]
        unique_colors = [[243, 248, 192], red_shades[0], [252, 182, 94],
                         [251, 181, 171], [118, 128, 251], [209, 188, 219]]
        expected_products = {'001426', '001122', '001125', '001305', '000147', '001334'}
        page.locator('#prominence').check()
        workspace(page, 'value.prominence===true')
        distinct = import_bands(worker, page, 'Distinct glass priority fixture', unique_colors + [red_shades[1]])
        for cycle in range(2):
            value = distinct if cycle == 0 else next_remix(page)
            choices = automatic_choices(page, value)
            assert len(choices) == 6 and {choice['productId'] for choice in choices} == expected_products, choices
            assert all(choice['rgb'] in unique_colors + [red_shades[1]] for choice in choices), choices
        passed('Initial sampling and Remix fill six slots with distinct glass products before using a second thickness of an already represented glass')

        fallback = import_bands(worker, page, 'Measured thickness fallback fixture', red_shades)
        for cycle in range(2):
            value = fallback if cycle == 0 else next_remix(page)
            choices = automatic_choices(page, value)
            assert len(choices) == 2 and {choice['productId'] for choice in choices} == {'001122'}, choices
            assert {choice['thickness'] for choice in choices} == {56, 72}, choices
            assert {tuple(choice['rgb']) for choice in choices} == {tuple(color) for color in red_shades}, choices
        passed('When the source offers only one glass, initial sampling and Remix retain both genuinely different measured thicknesses without inventing colors or duplicate matches')

        # Two large Red Transparent bands and a small Light Green band reproduce
        # the old cap-order bug: selecting six then slicing to two keeps two reds.
        # Restore a full manual fixture through the existing generation barrier
        # so an old page's final save cannot overwrite this test-only workspace.
        capacity_photo = Image.new('RGB', (1000, 200))
        capacity_photo.paste(tuple(red_shades[0]), (0, 0, 450, 200))
        capacity_photo.paste(tuple(red_shades[1]), (450, 0, 900, 200))
        capacity_photo.paste(tuple(unique_colors[0]), (900, 0, 1000, 200))
        capacity_image = io.BytesIO()
        capacity_photo.save(capacity_image, format='PNG')
        manual_targets = [{'id':f'manual-capacity-{index}', 'rgb':[0, 0, 0], 'hex':'#000000',
                           'manual':True, 'custom':True, 'weight':0, 'x':(index + 1) / 20, 'y':0.5}
                          for index in range(18)]
        capacity_seed = dict(value, sourceName='Manual capacity fixture',
            sourceDataUrl='data:image/png;base64,' + base64.b64encode(capacity_image.getvalue()).decode(),
            thumbnailDataUrl='', targets=manual_targets, activeTargetId=manual_targets[-1]['id'],
            prominence=True, paletteCount=6, format='medium', preferredJarSize='5lb',
            selectedForms={}, selectedVariants={}, quantities={}, cart=[],
            chosenMatches={target['id']:'000100' for target in manual_targets},
            selection={'version':1, 'targetKeys':{}, 'excludedTargetIds':[],
                       'excludedProductIds':[], 'manualKeys':[]})
        page.evaluate('''async seed=>{
          const session=await import('./lib/personal-data-session.js');
          await session.runPersonalDataRestore(()=>chrome.storage.local.set({bullseyeProjectV1:seed}));
        }''', capacity_seed)
        page.set_viewport_size({'width':1440, 'height':900})
        page.reload()
        expect(page.locator('#image-loaded')).to_be_visible()
        before_capacity = workspace(page, "value.sourceName==='Manual capacity fixture' && value.targets.length===18 && value.targets.every(target=>target.manual && Array.isArray(target.lab))")
        retained_capacity = [target for target in before_capacity['targets'] if target['manual']]
        manual_black = next(item for item in before_capacity['cart'] if item['productId'] == '000100')
        capacity = next_remix(page)
        choices = automatic_choices(page, capacity)
        assert len(capacity['targets']) == 20 and len(choices) == 2, capacity['targets']
        assert {choice['productId'] for choice in choices} == {'001122', '001426'}, choices
        assert [target for target in capacity['targets'] if target['manual']] == retained_capacity
        assert capacity['chosenMatches'] == before_capacity['chosenMatches']
        assert next(item for item in capacity['cart'] if item['key'] == manual_black['key']) == manual_black
        passed('With eighteen manual colors, the two remaining slots choose distinct glass before thickness repeats and preserve every manual color and choice')

        # Convert the two generated dots into explicit manual Black choices.
        # A subsequent Remix has no free slots and must leave all twenty intact.
        for target in [target for target in capacity['targets'] if not target['manual']]:
            page.locator(f'#palette-chips .palette-chip[data-target-id="{target["id"]}"]').click()
            page.locator('#open-color-editor').click()
            page.locator('#target-hex').fill('#000000')
            page.locator('#target-hex').press('Enter')
            page.locator('#close-color-editor').click()
        full_manual = workspace(page, 'value.targets.length===20 && value.targets.every(target=>target.manual)')
        expect(page.locator('#add-custom-color')).to_be_disabled()
        full_remix = next_remix(page)
        assert protected(full_remix) == protected(full_manual)
        assert full_remix['sourceDataUrl'] == full_manual['sourceDataUrl']
        assert len(full_remix['targets']) == 20 and all(target['manual'] for target in full_remix['targets'])
        passed('Remix with twenty manual colors creates no automatic dots and preserves colors, IDs, points, chosen glass, quantities and selections exactly')
        assert not errors, errors
        context.close()
except Exception:
    failure = traceback.format_exc()
    if page:
        try:
            page.screenshot(path=str(OUT / 'v068-prominence-failure.png'), full_page=True)
        except Exception:
            pass
    raise
finally:
    (OUT / 'v068-prominence-report.json').write_text(json.dumps({'count':len(checks), 'passed':checks,
        'browserErrors':errors, 'failure':failure, 'network':'Isolated fixtures; no live cart mutations.'}, indent=2) + '\n')
