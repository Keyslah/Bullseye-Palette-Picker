"""Purpose: extend native acceptance tests for the replacement v6 layout.
Setup: reuses v5 storage/cart coverage while changing deliberate UI expectations.
Writes: tests only; all shop operations use synthetic fixtures, never a user account.
Constraints: preserve original functional assertions and add compact-layout checks.
"""
from pathlib import Path
s=Path('tests/v5-browser.py').read_text().replace('v5','v6').replace('V5','V6').replace('0.5.0','0.6.0')
s=s.replace("assert result_box['x'] >= box['x']+box['width']-2", "assert result_box['x']+result_box['width'] <= box['x']+2")
s=s.replace("document.querySelector('#palette-chips').children[1].contains(document.querySelector('#show-full-palette'))", "document.querySelector('.palette-flow').firstElementChild.contains(document.querySelector('#show-full-palette')) && [...document.querySelector('#palette-chips').children].every(node=>node.classList.contains('palette-chip'))")
s=s.replace('Show full palette stays beside color number one','Show full palette is far left and never splits palette colors')
s=s.replace("        page.locator('#target-hex').fill('#AB23CD');page.locator('#target-hex').press('Tab')", "        page.locator('#open-color-editor').click()\n        page.locator('#target-hex').fill('#AB23CD');page.locator('#target-hex').press('Tab')\n        page.locator('#close-color-editor').click()")
s=s.replace("        page.locator('#form-fine').click();", "        page.locator('#settings-menu > summary').click()\n        page.locator('#form-fine').click();")
s=s.replace("        page.locator('#save-settings').click()", "        page.locator('#settings-menu > summary').click()\n        page.locator('#save-settings').click()")
s=s.replace("        page.locator('#load-settings').click();", "        page.locator('#settings-menu > summary').click()\n        page.locator('#load-settings').click();")
s=s.replace("        cart.locator('#form-sheets').click()", "        cart.locator('#settings-menu > summary').click()\n        cart.locator('#form-sheets').click()\n        cart.locator('#settings-menu > summary').click()")
s=s.replace("no_overflow(page,f'{image_name} {width}x{height}')", """no_overflow(page,f'{image_name} {width}x{height}')
                if image_name!='landscape':
                    result=page.locator('.workspace-results').bounding_box()
                    source=page.locator('#source-canvas').bounding_box()
                    assert result['x']+result['width']<=source['x']+2
                    assert abs(result['y']-source['y'])<8
                    first=page.locator('#product-grid .compact-card').first
                    info=first.locator('.product-card-content').bounding_box()
                    photo=first.locator('.photo-button').bounding_box()
                    assert info['x']+info['width']<=photo['x']+2
                    assert photo['x']+photo['width']<=source['x']+2
                    if width>=650:assert source['width']>width*.43
                else:
                    cards=page.locator('#product-grid .compact-card')
                    a,b=cards.nth(0).bounding_box(),cards.nth(1).bounding_box()
                    assert b['x']>a['x'] and abs(a['y']-b['y'])<3
                assert page.locator('#product-grid .product-code').count()==0
                expect(page.locator('#product-grid .product-price').first).not_to_be_visible()
                header=page.locator('.app-header').bounding_box()
                flow=page.locator('#palette-panel').bounding_box()
                if width>=650:assert header['height']+flow['height']<155,(header,flow)
                row=page.locator('#refresh-settings').bounding_box()
                for control in ['include-transparent','include-opalescent','include-tints']:
                    assert abs(page.locator('#'+control).bounding_box()['y']-row['y'])<3
                assert page.locator('#open-saved').evaluate("n=>n.parentElement.id==='main-toolbar'")""")
s=s.replace("        photo_before_cart=saved(page)", """        first=page.locator('#product-grid .compact-card').first
        first.locator('.purchase-toggle').click()
        panel=first.locator('.purchase-popover')
        expect(panel).to_be_visible()
        qty=panel.locator('.quantity-field');qty.fill('2');qty.press('Tab')
        expect(first.locator('.purchase-toggle')).to_contain_text('2')
        panel.get_by_role('button',name='Close purchase options',exact=True).click()
        expect(panel).not_to_be_visible()
        passed('Size, quantity, selection and price live in the compact purchase dropdown')
        page.locator('#open-color-editor').click()
        page.locator('#target-hex').fill('#F7F4E3');page.locator('#target-hex').press('Tab')
        page.locator('#close-color-editor').click()
        page.locator('#show-alternatives').click()
        page.locator('#glass-search').fill('French Vanilla')
        expect(page.locator('#product-grid .compact-card')).to_have_count(1)
        page.locator('#product-grid .photo-button').click()
        expect(page.locator('#detail-code')).to_contain_text('000137')
        page.locator('#detail-choose').click()
        expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','000137')
        saved(page)
        page.reload();expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#product-grid .compact-card').first).to_have_attribute('data-product-id','000137')
        passed('French Vanilla is a selectable pale-color alternative and survives reload')
        page.locator('#show-alternatives').click();page.locator('#glass-search').fill('Sunset Coral')
        expect(page.locator('#product-grid .compact-card')).to_have_count(1)
        page.locator('#glass-search').fill('Coral Orange Tint')
        expect(page.locator('#product-grid .compact-card')).to_have_count(0)
        page.locator('#include-tints').click()
        expect(page.locator('#product-grid .compact-card')).to_have_count(1)
        page.locator('#show-full-palette').check()
        passed('Sunset Coral remains available; Coral Orange Tint obeys the visible Tints toggle')
        photo_before_cart=saved(page)""")
s=s.replace("        cart.locator('#saved-cart-search').fill('tint')", "        if cart.locator('#cart-include-tints').get_attribute('aria-pressed')=='true':cart.locator('#cart-include-tints').click()\n        cart.locator('#saved-cart-search').fill('tint')")
# Cover the screenshot's side-panel range as well as full-page widths.
s=s.replace("[(1440,900),(1920,1080),(900,800),(650,900),(380,800)]", "[(1440,900),(1920,1080),(1024,1150),(820,1000),(650,900),(380,800)]")
# Save screenshots at every tested size to allow actual visual inspection.
s=s.replace("if width==1440:page.screenshot(path=str(OUT/f'{image_name}-1440.png'),full_page=True)", "page.screenshot(path=str(OUT/f'{image_name}-{width}.png'),full_page=True)")
Path('tests/v6-browser.py').write_text(s)
Path('tests/v6-alternatives.test.js').write_text('''/** Purpose: verify explicit alternatives without weakening automatic matching.
 * Setup: node --test with the unchanged catalog. Writes: none, read-only fixtures.
 * Constraints: honor filters and never match background gaps of colored glass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {matchCatalog,getColorFamily} from '../extension/lib/palette.js';
import {includedGlass} from '../extension/lib/material-filters.js';
const products=JSON.parse(fs.readFileSync(new URL('../extension/data/catalog.json',import.meta.url))).products;
test('French Vanilla and Sunset Coral are explicit alternatives to a pale cream',()=>{
 const ps=products.filter(p=>includedGlass(p));
 const strict=matchCatalog('#F7F4E3',ps,{limit:Infinity});
 assert.ok(strict.every(m=>m.product.colorFamily==='neutral'));
 const alternatives=matchCatalog('#F7F4E3',ps,{limit:Infinity,includeOtherFamilies:true});
 for(const name of ['French Vanilla','Sunset Coral'])assert.ok(alternatives.some(m=>m.product.name===name));
 assert.equal(alternatives.length,ps.length);
 assert.ok(alternatives.every(m=>getColorFamily(m.sample)===m.product.colorFamily));
 assert.deepEqual(strict,matchCatalog('#F7F4E3',ps,{limit:Infinity}));
});
test('Coral Orange Tint obeys explicit tint inclusion and material settings',()=>{
 for(const includeTints of [false,true]){
  const ps=products.filter(p=>includedGlass(p,{includeTints}));
  const m=matchCatalog('#EF964D',ps,{limit:Infinity,includeOtherFamilies:true});
  assert.equal(m.some(m=>m.product.name==='Coral Orange Tint'),includeTints);
 }
 const ps=products.filter(p=>includedGlass(p,{includeTints:true,glassTypes:{transparent:false}}));
 assert.ok(matchCatalog('#F7F4E3',ps,{limit:Infinity,includeOtherFamilies:true}).every(m=>m.product.type==='Opalescent'));
});
''')
print('v6 native UI and alternative-color regressions written.')
