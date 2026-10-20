"""Purpose: focused v0.6.1 regressions and the native browser acceptance suite.
Setup: reuse the v6 suite with only its changed UI expectations updated.
Writes: two test files and release notes. No customer data or catalog modifications.
Constraints: retain storage, cart and package checks; shopping stays in synthetic fixtures.
"""
from pathlib import Path

def replace(text,old,new):
    assert old in text,old[:110]
    return text.replace(old,new,1)

text=Path('tests/v6-browser.py').read_text().replace('0.6.0','0.6.1').replace('v6-report.json','v061-report.json')
text=replace(text,"Setup: npm run package; install Python playwright/pillow and Playwright Chromium.","Setup: npm run package; install Python playwright/pillow and Playwright Chromium.")
old="                    assert b['x']>a['x'] and abs(a['y']-b['y'])<3"
new=old+'''
                    assert page.locator('#product-grid').evaluate('n=>n.scrollWidth<=n.clientWidth+1')
                    for card in cards.all():
                        info=card.locator('.product-card-content').bounding_box()
                        photo=card.locator('.photo-button').bounding_box()
                        bounds=card.bounding_box()
                        assert photo['y']+photo['height']<=info['y']+1
                        assert bounds['x']>=0 and bounds['x']+bounds['width']<=width+1
                    if width>=650:assert cards.last.bounding_box()['y']+cards.last.bounding_box()['height']<=height+3
                    assert cards.count()==6
                for card in page.locator('#product-grid .compact-card').all():
                    expect(card.locator('.glass-name-row .glass-checkbox')).to_be_visible()
                    assert 'Selected' not in card.locator('.product-card-content').inner_text()
'''
text=replace(text,old,new)
text=replace(text,"        passed('Size, quantity, selection and price live in the compact purchase dropdown')",'''        expect(first.locator('.purchase-toggle')).to_contain_text('Medium frit')
        first.locator('.glass-name-row .glass-checkbox').uncheck()
        expect(first.locator('.glass-name-row .glass-checkbox')).not_to_be_checked()
        first.locator('.glass-name-row .glass-checkbox').check()
        expect(first.locator('.glass-name-row .glass-checkbox')).to_be_checked()
        passed('Plain name-side checkbox changes selection without redundant Selected text')
        for form,label in [('fine','Fine frit'),('coarse','Coarse frit'),('powder','Powder frit'),('sheets','Sheets'),('medium','Medium frit')]:
            page.locator('#settings-menu > summary').click();page.locator('#form-'+form).click()
            page.locator('#settings-menu > summary').click()
            first.locator('.purchase-toggle').click()
            expect(first.locator('.purchase-popover .purchase-grade')).to_have_text(label)
            assert all(label in option for option in first.locator('.purchase-popover option').all_text_contents())
            first.locator('.purchase-popover').get_by_role('button',name='Close purchase options',exact=True).click()
        passed('Every purchase summary and dropdown identifies the frit grade or sheet thickness')''')
# Only the old inline-alternatives test section changes scope. Main library search remains.
a=text.index("        page.locator('#show-alternatives').click()",text.index("passed('Every purchase"))
b=text.index('        photo_before_cart=saved(page)',a)
section=text[a:b].replace("'#glass-search'","'#alternatives-search'").replace("'#product-grid .compact-card'","'#alternatives-grid .compact-card'").replace("'#product-grid .photo-button'","'#alternatives-grid .photo-button'")
# After choosing and reloading, expected primary cards still belong to the main grid.
section=section.replace("expect(page.locator('#alternatives-grid .compact-card').first).to_have_attribute('data-product-id','000137')", "expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','000137')")
section=section.replace("page.locator('#include-tints').click()","page.locator('#alternatives-tints').click()")
section=section.replace("        page.locator('#show-full-palette').check()","        page.locator('#close-alternatives').click()\n        page.locator('#show-full-palette').check()")
text=text[:a]+section+text[b:]
anchor='        photo_before_cart=saved(page)'
new='''        page.locator('#open-color-editor').click()
        page.locator('#target-hex').fill('#F9994F');page.locator('#target-hex').press('Tab')
        page.locator('#close-color-editor').click()
        expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','001025')
        before_alternatives=saved(page)
        original_cards=page.locator('#product-grid .compact-card').evaluate_all('(ns)=>ns.map(n=>n.dataset.productId)')
        page.locator('#product-grid .row-alternatives').first.click()
        expect(page.locator('#alternatives-dialog')).to_be_visible()
        assert page.locator('#product-grid .compact-card').evaluate_all('(ns)=>ns.map(n=>n.dataset.productId)')==original_cards
        assert image_state(saved(page))==image_state(before_alternatives)
        page.screenshot(path=str(OUT/'alternatives-popup.png'),full_page=True)
        page.locator('#alternatives-search').fill('Carnelian')
        expect(page.locator('#alternatives-grid .compact-card')).to_have_count(1)
        page.locator('#alternatives-grid .row-alternatives').click()
        expect(page.locator('#alternatives-dialog')).not_to_be_visible()
        expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','001321')
        saved(page);page.reload();expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','001321')
        passed('Orange Striker is preferred automatically; explicitly chosen Carnelian remains an alternative and survives reload')
        page.locator('#product-grid .photo-button').first.click()
        page.locator('#detail-alternatives').click()
        expect(page.locator('#alternatives-dialog')).to_be_visible()
        page.locator('#close-alternatives').click()
        expect(page.locator('#product-grid .compact-card')).to_have_count(6)
        passed('Card, top toolbar and glass-detail Alternatives actions open an independent popup')
        # More colors must wrap rather than disappear beyond either screen edge.
        page.locator('#image-file').set_input_files(temp/'landscape.png')
        expect(page.locator('#image-loaded')).to_be_visible()
        page.locator('#settings-menu > summary').click()
        page.locator('#palette-count').fill('12');page.locator('#palette-count').press('Tab')
        page.locator('#settings-menu > summary').click()
        expect(page.locator('#product-grid .compact-card')).to_have_count(12)
        for width,height in [(1440,900),(820,1000),(380,800)]:
            page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(200)
            assert page.locator('#product-grid').evaluate('n=>n.scrollWidth<=n.clientWidth+1')
            assert page.locator('#product-grid .compact-card').evaluate_all('(ns)=>ns.every(n=>n.getBoundingClientRect().right<=innerWidth+1)')
            page.screenshot(path=str(OUT/f'landscape-twelve-{width}.png'),full_page=True)
        passed('All twelve landscape matches wrap without horizontal clipping on desktop and narrow panels')
        page.set_viewport_size({'width':1440,'height':900})
''' + anchor
text=replace(text,anchor,new)
Path('tests/v061-browser.py').write_text(text)

Path('tests/match-preference.test.js').write_text('''/**
 * Purpose: verify the user's Orange Striker preference without changing color scores.
 * Setup: node --test with synthetic matches plus the bundled catalog.
 * Writes: none. Constraints: no product removal, no stock or filter bypass, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {preferredAutomaticMatch} from '../extension/lib/match-preference.js';
import {matchCatalog} from '../extension/lib/palette.js';
import {includedGlass} from '../extension/lib/material-filters.js';
const matches=[{product:{id:'001321'},deltaE:1},{product:{id:'001025'},deltaE:6},{product:{id:'000141'},deltaE:12}];
test('only a would-be Carnelian primary is replaced by Orange Striker',()=>{
  assert.equal(preferredAutomaticMatch(matches),matches[1]);
  assert.equal(preferredAutomaticMatch([matches[2],...matches]),matches[2]);
  assert.equal(preferredAutomaticMatch([]),null);
});
test('the preference cannot invent filtered or unavailable Orange Striker',()=>{
  assert.equal(preferredAutomaticMatch([matches[0],matches[2]]),matches[0]);
  assert.equal(preferredAutomaticMatch(matches,m=>m.product.id!=='001025'),matches[0]);
});
test('Carnelian remains in the unchanged alternatives list with unchanged scores',()=>{
  const before=JSON.stringify(matches);preferredAutomaticMatch(matches);
  assert.equal(JSON.stringify(matches),before);assert.equal(matches[0].product.id,'001321');
});
test('actual catalog regression chooses Light Orange Striker for the former Carnelian target',()=>{
  const products=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url))).products.filter(p=>includedGlass(p));
  const ranked=matchCatalog('#F9994F',products,{tolerance:Infinity,limit:Infinity});
  assert.equal(ranked[0].product.id,'001321');
  assert.equal(preferredAutomaticMatch(ranked).product.id,'001025');
  assert.ok(ranked.some(match=>match.product.id==='001321'));
});
''')

Path('docs/release-v0.6.1.md').write_text('''# Bullseye Palette Picker v0.6.1

- Landscape comparison cards have the glass photograph above the name, photo-thickness estimate and purchase control. Every match fits the available width; additional cards wrap onto another row instead of disappearing into a sideways scroller. The normal image size leaves room for the comparison cards. Portrait comparison order is unchanged.
- A plain checkbox is next to each glass name. There is no visible Selected label, and selecting glass does not require opening its purchase controls.
- Purchase summaries, popups and size options identify Fine frit, Medium frit, Coarse frit, Powder frit or Sheets along with the package size. Sheet option titles retain their actual millimeter thickness. Photo thickness percentages remain estimates, separate from frit grade.
- Alternatives opens a separate searchable popup from a comparison card, the toolbar or the glass-detail window. It does not replace the full main palette. With Show full palette turned off, the main area shows the active color's match; Alternatives is still its own popup.
- Light Orange Striker is preferred when the automatic choice would otherwise be Carnelian, provided Orange Striker is included and available in the selected form. Carnelian remains selectable as an alternative, and explicit saved choices are respected. Matching scores and catalog data are unchanged.

The reported glitch investigation was dropped as requested. No unrelated cart, account, image-sampling or catalog behavior was changed.

## Update

Extract the ZIP into the same installed extension folder containing manifest.json, replacing its existing files. Keep the extension installed. At chrome://extensions, click Reload and confirm 0.6.1. Close and reopen the picker/cart tabs so the new JavaScript and styles load. Your existing storage keys and saved palettes/carts are retained.

## Checks

Publication is gated on code regressions, catalog/module checks, native Chromium UI tests and ZIP/source byte equality. Browser checks cover landscape, square and portrait layouts, plain checkboxes, every frit grade, alternatives selection, saved preferences/palettes, independent carts and read-only cart copying. Shopping actions use isolated synthetic test fixtures, not a real customer account or cart.
''')
path=Path('README.md');readme=path.read_text();readme=readme.replace('v0.6.0.zip','v0.6.1.zip')
heading='''## v0.6.1 update

Landscape glass photographs now have their information below them. All match cards fit across the available width or wrap to another row without sideways scrolling. Each name has a plain selection checkbox. Purchase controls show the frit grade or actual sheet thickness as well as size. Alternatives opens in a separate searchable popup without replacing the main palette. Light Orange Striker is preferred over an automatic Carnelian choice; explicitly selected Carnelian remains available and saved.

'''
lines=readme.splitlines(keepends=True);lines.insert(2,heading);path.write_text(''.join(lines))
print('Focused v0.6.1 tests and release notes written; all existing cart/storage checks retained.')
