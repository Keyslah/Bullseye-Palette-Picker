"""Purpose: verify palette order changes without changing color or purchase state.
Setup: Python Playwright and Chromium; loads current extension in disposable profiles.
Writes: fixture workspaces, named palettes and test-results/v068-reorder reports/screenshots.
Constraints: every external request is a local fixture; no live account or cart is used.
"""
import json
import re
import tempfile
import traceback
from pathlib import Path

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
    result = {key:value.get(key) for key in ['activeTargetId', 'sourceDataUrl', 'glassTypes', 'includeTints',
        'chosenMatches', 'selectedForms', 'selectedVariants', 'quantities', 'selection']}
    result['targets'] = {target['id']:target for target in value['targets']}
    result['cart'] = {item['key']:item for item in value['cart']}
    return result


def card(current, target):
    return current.locator(f'#product-grid > [data-target-id="{target}"]')


def chip(current, target):
    return current.locator(f'#palette-chips > .palette-chip[data-target-id="{target}"]')


def assert_order(current, expected):
    current.wait_for_function('expected => JSON.stringify([...document.querySelectorAll("#palette-chips > .palette-chip")].map(el=>el.dataset.targetId))===JSON.stringify(expected)', arg=expected)
    assert current.locator('#palette-chips > *').count() == len(expected)
    assert current.locator('#product-grid > [data-target-id]').evaluate_all('(nodes)=>nodes.map(node=>node.dataset.targetId)') == expected
    assert current.locator('#palette-chips > .palette-chip').all_inner_texts() == [str(i+1) for i in range(len(expected))]
    assert current.locator('#product-grid .glass-target-badge').all_inner_texts() == [str(i+1) for i in range(len(expected))]
    numbers = current.locator('#image-points > .source-point').evaluate_all('(nodes)=>Object.fromEntries(nodes.map(node=>[node.dataset.targetId,node.textContent]))')
    assert numbers == {target:str(index+1) for index,target in enumerate(expected)}


def drag(source, destination, horizontal, after):
    bounds = destination.bounding_box()
    position = {'x':bounds['width']*.5, 'y':bounds['height']*.5}
    position['x' if horizontal else 'y'] = (bounds['width' if horizontal else 'height'] - 4) if after else 4
    source.drag_to(destination, target_position=position)


def fixture(route):
    if route.request.resource_type == 'image':
        route.fulfill(status=200, content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#dce3db"/></svg>')
    else:
        route.fulfill(status=200, content_type='text/html', body='<html><body>Isolated fixture</body></html>')


try:
    with sync_playwright() as playwright:
        for orientation in ['portrait', 'landscape']:
            with tempfile.TemporaryDirectory() as profile:
                context = playwright.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
                    viewport={'width':1440, 'height':1000},
                    args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
                context.route('https://**/*', fixture)
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
                worker.evaluate("() => { globalThis.fetch=async()=>{throw new Error('External requests disabled in reorder fixture');}; }")
                origin = f'chrome-extension://{worker.url.split("/")[2]}'
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/manifest.json')
                page.evaluate('''async orientation => {
                  const catalog=await (await fetch('./data/catalog.json')).json();
                  const formats=await (await fetch('./data/product-formats.json')).json();
                  const {productForForm}=await import('./lib/product-formats.js');
                  const ids=['green','red','orange','coral'],hexes=['#287850','#96202D','#E88128','#D17E96'];
                  const productIds=['001426','001122','001125','001305'];
                  const canvas=document.createElement('canvas');
                  canvas.width=orientation==='portrait'?420:840;canvas.height=orientation==='portrait'?700:420;
                  const ctx=canvas.getContext('2d');
                  hexes.forEach((hex,index)=>{ctx.fillStyle=hex;ctx.fillRect(index*canvas.width/4,0,canvas.width/4,canvas.height);});
                  const selectedForms={[productIds[1]]:'fine'},selectedVariants={},quantities={};
                  productIds.forEach((id,index)=>{
                    const product=productForForm(catalog.products.find(p=>p.id===id),formats,selectedForms[id]||'medium');
                    const variant=product.variants.find(v=>v.available)||product.variants[0];
                    selectedVariants[id]=String(variant.id);quantities[`${id}:${variant.id}`]=index+2;
                  });
                  await chrome.storage.local.set({bullseyeProjectV1:{version:6,photoGuideVersion:1,
                    sourceName:`${orientation} reorder fixture`,sourceDataUrl:canvas.toDataURL(),
                    targets:ids.map((id,index)=>({id,rgb:hexes[index].match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)),
                      manual:index%2===0,custom:index%2===0,x:(index+.5)/4,y:.5})),
                    activeTargetId:'orange',format:'medium',preferredJarSize:'5lb',imageSize:'larger',
                    glassTypes:{transparent:true,opalescent:true},includeTints:false,view:'palette',
                    chosenMatches:Object.fromEntries(ids.map((id,index)=>[id,productIds[index]])),
                    selectedForms,selectedVariants,quantities}});
                }''', orientation)
                page.goto(origin + '/picker.html?workspace=1')
                expect(page.locator('#image-loaded')).to_be_visible()
                expect(page.locator('.app-main')).to_have_class(re.compile('image-beside' if orientation == 'portrait' else 'image-landscape'))
                workspace(page, "value.targets.length===4 && !!value.targets[0].lab")
                assert_order(page, ['green', 'red', 'orange', 'coral'])

                # Establish explicit exclusions, a different jar, and an edited
                # quantity through the same controls that must coexist with drag.
                card(page, 'red').locator('.glass-checkbox').uncheck()
                card(page, 'green').locator('.purchase-toggle').click()
                select = card(page, 'green').locator('.variant-select')
                previous = select.input_value()
                options = select.locator('option:not([disabled])').evaluate_all('(nodes)=>nodes.map(node=>node.value)')
                chosen = next(value for value in options if value != previous)
                select.select_option(chosen)
                quantity = card(page, 'green').locator('.quantity-field')
                quantity.fill('7')
                quantity.press('Tab')
                card(page, 'green').get_by_role('button', name='Close purchase options').click()
                before = workspace(page, "value.selectedVariants['001426']===" + json.dumps(chosen) + " && Object.values(value.quantities).includes(7) && value.selection.excludedTargetIds.includes('red')")
                baseline = protected(before)
                expect(card(page, 'coral').locator('.unavailable-note')).to_be_visible()

                drag(chip(page, 'green'), chip(page, 'coral'), True, True)
                assert_order(page, ['red', 'orange', 'coral', 'green'])
                moved = workspace(page, "value.targets.at(-1).id==='green'")
                assert protected(moved) == baseline
                expect(chip(page, 'orange')).to_have_attribute('aria-pressed', 'true')
                expect(card(page, 'red').locator('.glass-checkbox')).not_to_be_checked()
                passed(f'{orientation}: dragging a compact color chip changes only order; active color, dots, pins, variants, quantities and exclusions stay intact')

                drag(card(page, 'green').locator('.palette-reorder-handle'), card(page, 'red'), orientation == 'landscape', False)
                assert_order(page, ['green', 'red', 'orange', 'coral'])
                restored = workspace(page, "value.targets[0].id==='green'")
                assert protected(restored) == baseline
                card(page, 'green').locator('.photo-button').click()
                expect(page.locator('#detail-dialog')).to_be_visible()
                page.locator('#close-detail').click()
                expect(card(page, 'green').locator('.variant-select')).to_have_value(chosen)
                expect(card(page, 'green').locator('.quantity-field')).to_have_value('7')
                passed(f'{orientation}: main card grip reorders {"top to bottom" if orientation == "portrait" else "left to right"}; color numbers follow and photo/purchase controls remain functional')

                chip(page, 'coral').press('Alt+Home')
                assert_order(page, ['coral', 'green', 'red', 'orange'])
                chip(page, 'coral').press('Alt+End')
                assert_order(page, ['green', 'red', 'orange', 'coral'])
                card(page, 'green').locator('.palette-reorder-handle').press('End')
                expected = ['red', 'orange', 'coral', 'green']
                assert_order(page, expected)
                # Reload without waiting out the save debounce: pagehide must
                # retain the final order through the worker's persistence queue.
                page.reload()
                expect(page.locator('#image-loaded')).to_be_visible()
                assert_order(page, expected)
                reloaded = workspace(page, "value.targets.at(-1).id==='green'")
                assert protected(reloaded) == baseline
                passed(f'{orientation}: chip and grip keyboard moves preserve selection and the final order survives immediate reload')

                name = f'Reordered {orientation}'
                page.locator('#save-palette').click()
                page.locator('#palette-name').fill(name)
                page.locator('#confirm-save-palette').click()
                expect(page.locator('#saved-dialog')).not_to_be_visible()
                saved = page.evaluate('''async name => {const store=await import('./lib/saved-palettes.js');
                  const entry=(await store.listPalettes()).find(p=>p.name===name);return store.loadPalette(entry.id);}''', name)
                assert [target['id'] for target in saved['workspace']['targets']] == expected
                assert saved['colors'] == [target['hex'] for target in saved['workspace']['targets']]
                chip(page, 'green').press('Alt+Home')
                assert_order(page, ['green', 'red', 'orange', 'coral'])
                page.locator('#open-saved').click()
                page.get_by_role('button', name=f'Load palette {name}', exact=True).click()
                expect(page.locator('#saved-dialog')).not_to_be_visible()
                assert_order(page, expected)
                loaded = workspace(page, "value.targets.at(-1).id==='green' && !!value.savedPaletteId")
                assert protected(loaded) == baseline
                passed(f'{orientation}: named palette save/load restores the chosen order, matching thumbnail swatches, and unchanged color/purchase state')

                for width in [420, 320]:
                    page.set_viewport_size({'width':width, 'height':1000})
                    page.wait_for_function('document.documentElement.scrollWidth <= innerWidth + 2')
                    containment = page.locator('#product-grid > .compact-card').evaluate_all('''nodes=>nodes.map(row=>{
                      const heading=row.querySelector('.glass-name-row'),name=heading.querySelector('.product-name');
                      const bounds=heading.getBoundingClientRect(),checkbox=heading.querySelector('.glass-checkbox').getBoundingClientRect();
                      const text=document.createRange();text.selectNodeContents(name);
                      return {id:row.dataset.targetId,checkboxInside:checkbox.left>=bounds.left && checkbox.right<=bounds.right+1,
                        textInside:[...text.getClientRects()].every(rect=>rect.left>=bounds.left-1 && rect.right<=checkbox.left+1),
                        gripInside:row.querySelector('.palette-reorder-handle').getBoundingClientRect().left>=row.getBoundingClientRect().left-1};
                    })''')
                    page.screenshot(path=str(OUT / f'v068-reorder-{orientation}-{width}.png'), full_page=True)
                    assert all(item['checkboxInside'] and item['textInside'] and item['gripInside'] for item in containment), containment
                page.locator('#library-tab').click()
                expect(page.locator('#product-grid .palette-reorder-handle')).to_have_count(0)
                expect(page.locator('#product-grid [data-reorder-target]')).to_have_count(0)
                page.locator('#palette-tab').click()
                card(page, 'orange').locator('.row-alternatives').click()
                expect(page.locator('#alternatives-dialog')).to_be_visible()
                expect(page.locator('#alternatives-grid .palette-reorder-handle')).to_have_count(0)
                expect(page.locator('#alternatives-grid [data-reorder-target]')).to_have_count(0)
                assert not errors, errors
                passed(f'{orientation}: grips, unavailable labels and checkboxes stay contained at 420/320px; All glass and Alternatives do not gain reordering')
                context.close()
                page = None
except Exception:
    failure = traceback.format_exc()
    if page:
        try:
            page.screenshot(path=str(OUT / 'v068-reorder-failure.png'), full_page=True)
        except Exception:
            pass
    raise
finally:
    (OUT / 'v068-reorder-report.json').write_text(json.dumps({'count':len(checks), 'passed':checks,
        'browserErrors':errors, 'failure':failure, 'network':'Isolated fixtures; no live account or cart.'}, indent=2) + '\n')
