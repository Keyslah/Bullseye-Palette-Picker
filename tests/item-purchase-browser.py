"""Purpose: verify independent purchase forms, real SKUs, quantities and saved work.
Setup: Python Playwright/Chromium; run from any directory. No personal profile is used.
Writes: disposable extension profile and test-results/item-purchase-report.json.
Constraints: shop/account requests are blocked; photos use only public CDN URLs.
"""
import json, tempfile, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'extension';OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
formats=json.loads((EXT/'data/product-formats.json').read_text())['products']
photos=json.loads((EXT/'data/cart-photos.json').read_text())['products']
checks=[];errors=[];failure=None;context=None

def done(message):
    checks.append(message);print('PASS:',message,flush=True)

def saved(page):
    page.wait_for_timeout(400)
    return page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")

def item(record,pid):
    return next((entry for entry in record['cart'] if entry['productId']==pid),None)

def card(page,pid='001108'):
    return page.locator(f'#product-grid .compact-card[data-product-id="{pid}"]')

def open_purchase(page,pid='001108'):
    row=card(page,pid)
    if not row.locator('.purchase-popover').evaluate("p=>p.matches(':popover-open')"):
        row.locator('.purchase-toggle').click()
    return row.locator('.purchase-popover')

def photo_url(pid,form,variant_id):
    variant=next(entry for entry in formats[pid][form]['variants'] if str(entry['id'])==str(variant_id))
    return photos[variant['handle']]['images'][0]

try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,viewport={'width':1440,'height':1000},args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        context.route('https://shop.bullseyeglass.com/**',lambda route:route.abort())
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { globalThis.fetch=async()=>{throw new Error('Account/cart/product requests blocked in isolated purchase tests');}; }")
        base='chrome-extension://'+worker.url.split('/')[2]+'/picker.html?workspace=1'
        page=context.new_page();page.set_default_timeout(15000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base);expect(page.locator('#form-medium')).to_be_enabled();page.wait_for_timeout(700)
        seed=page.evaluate('''()=>{
          const c=document.createElement('canvas');c.width=800;c.height=400;
          const ctx=c.getContext('2d');ctx.fillStyle='#98B5B3';ctx.fillRect(0,0,400,400);ctx.fillStyle='#F49A1C';ctx.fillRect(400,0,400,400);
          return {version:6,format:'medium',preferredJarSize:'5lb',sourceName:'Isolated item form test',sourceDataUrl:c.toDataURL(),
            targets:[{id:'aqua',rgb:[152,181,179],hex:'#98B5B3',x:.25,y:.5,manual:true,custom:true},{id:'orange',rgb:[244,154,28],hex:'#F49A1C',x:.75,y:.5,manual:true,custom:true}],
            activeTargetId:'aqua',chosenMatches:{aqua:'001108',orange:'001025'},glassTypes:{transparent:true,opalescent:true},view:'palette'};
        }''')
        page.close();worker.evaluate('(record)=>chrome.storage.local.set({bullseyeProjectV1:record})',seed)
        page=context.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base);expect(card(page)).to_be_visible();initial=saved(page)
        other=item(initial,'001025')
        panel=open_purchase(page)
        assert panel.locator('.product-form-select option').evaluate_all('nodes=>nodes.map(n=>n.value)')==['powder','fine','medium','coarse','sheets']
        panel.locator('.quantity-field').fill('7');panel.locator('.quantity-field').dispatch_event('change')
        one_lb=next(v for v in formats['001108']['medium']['variants'] if v['available'] and v['title']=='1 lb. jar')
        panel.locator('.variant-select').select_option(str(one_lb['id']))
        for form in ['fine','powder','coarse','medium']:
            panel=open_purchase(page);panel.locator('.product-form-select').select_option(form)
            current=saved(page);chosen=item(current,'001108')
            expected=next(v for v in formats['001108'][form]['variants'] if v['available'] and v['title']=='1 lb. jar')
            assert chosen['variantId']==expected['id'] and chosen['sku']==expected['sku'],chosen
            assert chosen['quantity']==7 and chosen['form']==form,chosen
            assert current['format']=='medium' and current['selectedForms']=={'001108':form}
            assert item(current,'001025')==other
            assert current['sourceDataUrl']==initial['sourceDataUrl'] and current['targets']==initial['targets']
            expect(card(page).locator('.glass-photo img')).to_have_attribute('src',photo_url('001108',form,chosen['variantId']))
            expect(open_purchase(page).locator('.quantity-field')).to_have_value('7')
            done(f'Individual {form} retains 1 lb, quantity 7, actual SKU/photo and untouched other color/source')
        panel=open_purchase(page);panel.locator('.product-form-select').select_option('sheets')
        thin=next(v for v in formats['001108']['sheets']['variants'] if v['available'] and v['thicknessMm']==2)
        panel=open_purchase(page);panel.locator('.variant-select').select_option(str(thin['id']))
        assert '2 mm' in panel.locator('.variant-select option:checked').inner_text()
        assert thin['sourceTitle'] in panel.locator('.variant-select option:checked').inner_text()
        current=saved(page);chosen=item(current,'001108')
        assert chosen['variantId']==thin['id'] and chosen['quantity']==7
        expect(card(page).locator('.glass-photo img')).to_have_attribute('src',photo_url('001108','sheets',thin['id']))
        done('Sheets uses actual dimension/thickness choices and exact sheet variant with preserved quantity')
        panel.locator('.icon-button').click();card(page).locator('.photo-button').click()
        page.locator('#detail-purchase .product-form-select').select_option('powder')
        expect(page.locator('#detail-photo-grade')).to_contain_text('Powder')
        assert item(saved(page),'001108')['quantity']==7
        page.locator('#close-detail').click()
        done('Enlarged detail purchase form updates the same individual selection')
        card(page).locator('.glass-checkbox').uncheck();panel=open_purchase(page)
        panel.locator('.product-form-select').select_option('fine')
        current=saved(page);assert item(current,'001108') is None
        assert current['quantities']['001108:'+current['selectedVariants']['001108']]==7
        assert item(current,'001025')==other
        done('Changing an unchecked color preserves its quantity without selecting it or changing other items')
        panel=open_purchase(page);panel.locator('.icon-button').click()
        page.locator('#save-palette').click();page.locator('#palette-name').fill('Independent forms');page.locator('#confirm-save-palette').click()
        expect(page.locator('#saved-dialog')).not_to_be_visible();before_reload=saved(page)
        page.reload();expect(card(page)).to_be_visible();restored=saved(page)
        assert restored['selectedForms']=={'001108':'fine'}
        assert restored['selectedVariants']['001108']==before_reload['selectedVariants']['001108']
        assert restored['sourceDataUrl']==initial['sourceDataUrl'] and restored['targets']==initial['targets']
        assert item(restored,'001108') is None
        done('Reload restores independent form, package, quantity, unchecked state and manually edited source dots')
        page.locator('#form-coarse').evaluate('button=>button.click()')
        after_global=saved(page)
        assert after_global['format']=='coarse' and after_global['selectedForms']=={'001108':'fine'}
        assert item(after_global,'001025')['form']=='coarse'
        assert card(page).locator('.purchase-toggle').inner_text().startswith('Fine frit')
        done('Global default changes preserve explicit item form while untouched colors follow the default')
        saved_palette=page.evaluate("async()=>{const m=await import('./lib/saved-palettes.js');const all=await m.listPalettes();return await m.loadPalette(all.find(p=>p.name==='Independent forms').id);}")
        assert saved_palette['workspace']['selectedForms']=={'001108':'fine'}
        assert saved_palette['workspace']['sourceDataUrl']==initial['sourceDataUrl']
        assert saved_palette['workspace']['targets']==initial['targets']
        done('Named palette stores the exact individual form and source data independently of later settings')
        # Explicit transparent choices must survive while filters temporarily
        # display opalescent fallbacks and another visible item's form is edited.
        before_filter=saved(page)
        assert before_filter['chosenMatches']['aqua']=='001108'
        page.locator('#include-transparent').click()
        hidden_aqua=page.locator('#product-grid .compact-card[data-target-id="aqua"]')
        other_fallback=page.locator('#product-grid .compact-card[data-target-id="orange"]')
        expect(hidden_aqua).to_be_visible();expect(other_fallback).to_be_visible()
        assert hidden_aqua.get_attribute('data-product-id')!='001108'
        assert other_fallback.get_attribute('data-product-id')!='001025'
        other_fallback.locator('.purchase-toggle').click()
        other_fallback.locator('.purchase-popover .product-form-select').select_option('fine')
        while_hidden=saved(page)
        assert while_hidden['chosenMatches']==before_filter['chosenMatches'],(before_filter['chosenMatches'],while_hidden['chosenMatches'])
        page.locator('#include-transparent').click()
        expect(page.locator('#product-grid .compact-card[data-target-id="aqua"]')).to_have_attribute('data-product-id','001108')
        after_filter=saved(page)
        assert after_filter['chosenMatches']==before_filter['chosenMatches']
        assert after_filter['sourceDataUrl']==before_filter['sourceDataUrl'] and after_filter['targets']==before_filter['targets']
        expect(card(page).locator('.purchase-toggle')).to_contain_text('Fine frit')
        done('Changing another visible item form preserves explicit glass choices hidden by material filters and restores their original cards')
        assert not errors,errors
        done('No uncaught browser errors; all account/cart traffic was blocked')
        context.close();context=None
except Exception as error:
    failure=str(error);traceback.print_exc()
    if context:
        for i,page in enumerate(context.pages):
            try:page.screenshot(path=str(OUT/f'item-purchase-failure-{i}.png'),full_page=True)
            except Exception:pass
    raise
finally:
    (OUT/'item-purchase-report.json').write_text(json.dumps({'checks':checks,'count':len(checks),'failure':failure,'browserErrors':errors,'commerce':'All shop/account/cart requests blocked; disposable profile only.'},indent=2))
