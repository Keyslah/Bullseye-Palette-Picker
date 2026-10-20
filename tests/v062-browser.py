"""Purpose: verify actual Powder/Fine/Medium/Coarse photographs in the native extension.
Setup: installed Playwright Chromium/Pillow and internet for public Bullseye photo GETs.
Writes: a disposable browser profile and real-image screenshots/audit under test-results.
Constraints: no personal account or cart. Photo HTTP requests are NEVER replaced with
blank images or synthetic replies. Every bundled frit-photo URL is fetched and decoded.
"""
import concurrent.futures, hashlib, io, json, re, tempfile, time, traceback, urllib.request, zipfile
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];EXT=ROOT/'extension';OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
photo_index=json.loads((EXT/'data/cart-photos.json').read_text())['products']
formats=json.loads((EXT/'data/product-formats.json').read_text())['products']
catalog=json.loads((EXT/'data/catalog.json').read_text())['products']
grades={'powder':'0008','fine':'0001','medium':'0002','coarse':'0003'}
checks=[];errors=[];audit=[];failure=None;context=None

def done(text):checks.append(text);print('PASS:',text,flush=True)
def get_image(job):
    pid,form,handle,url=job
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=25) as r:
                assert r.status==200;mime=r.headers.get('Content-Type','');body=r.read()
            image=Image.open(io.BytesIO(body));image.load();assert min(image.size)>50
            if pid in ['001108','001247']:
                (OUT/f'actual-{pid}-{form}.jpg').write_bytes(body)
            return {'color':pid,'form':form,'handle':handle,'url':url,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'pixels':list(image.size),'mime':mime}
        except Exception as error:
            if attempt==2:raise RuntimeError(f'Live photograph failed: {pid} {form} {url}: {error}') from error
            time.sleep(attempt+1)

def source(pid,form):
    v=formats[pid][form]['variants'][0];return photo_index[v['handle']]['images'][0]
def check_photo(locator,url):
    expect(locator).to_have_attribute('src',url)
    result=locator.evaluate('async img=>{await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,url:img.currentSrc};}')
    assert min(result['width'],result['height'])>50,result
    assert result['url']==url,result

def state(page):
    page.wait_for_timeout(400)
    return page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")
def no_overflow(page):assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')

try:
    jobs=[]
    for product in catalog:
        for form in grades:
            variant=formats[product['id']][form]['variants'][0];handle=variant['handle'];url=photo_index[handle]['images'][0]
            assert re.search(product['id']+'-'+grades[form]+r'[-_]F',url,re.I)
            jobs.append((product['id'],form,handle,url))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for record in pool.map(get_image,jobs):audit.append(record)
    (OUT/'v062-live-photo-audit.json').write_text(json.dumps(audit,indent=2))
    assert len(audit)==564
    done('All 564 frit photographs fetched from actual Bullseye CDN URLs and decoded')
    aqua=[record for record in audit if record['color']=='001108']
    assert len(set(record['sha256'] for record in aqua))==4
    done('Aquamarine Blue has four distinct actual image files for Powder/Fine/Medium/Coarse')

    with tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,viewport={'width':1440,'height':1050},args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => { const real=globalThis.fetch; globalThis.fetch=(u,o)=>String(u).includes('/products/')?real(u,o):Promise.reject(new Error('Account/cart reads disabled in photo-only test')); }")
        base='chrome-extension://'+worker.url.split('/')[2]+'/picker.html'
        page=context.new_page();page.set_default_timeout(30000);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'?workspace=1')
        expect(page.locator('#form-fine')).to_be_enabled()
        assert page.evaluate('chrome.runtime.getManifest().version')=='0.6.2'
        seed=page.evaluate('''async()=>{
          const c=document.createElement('canvas');c.width=1200;c.height=500;const ctx=c.getContext('2d');
          const ids=['001108','001247','001215','001025','001305','000137'];
          const colors=['#98B5B3','#307965','#E99EBE','#F49A1C','#D59D89','#E7D7AB'];
          const targets=colors.map((hex,i)=>{ctx.fillStyle=hex;ctx.fillRect(i*200,0,200,500);return {id:'photo-test-'+i,rgb:[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)),hex,x:(i+.5)/6,y:.5,manual:true,custom:true};});
          const record={version:6,format:'fine',preferredJarSize:'5lb',sourceName:'Grain photo verification',sourceDataUrl:c.toDataURL(),targets,activeTargetId:targets[0].id,chosenMatches:Object.fromEntries(targets.map((t,i)=>[t.id,ids[i]])),glassTypes:{transparent:true,opalescent:true},paletteCount:6,imageSize:'larger',view:'palette'};
          await chrome.storage.local.set({bullseyeProjectV1:record});return record;
        }''')
        page.reload();expect(page.locator('#image-loaded')).to_be_visible()
        expect(page.locator('#product-grid .compact-card')).to_have_count(6)
        aqua_card=page.locator('#product-grid [data-product-id="001108"]')
        first_state=state(page)
        for form in grades:
            page.locator('#settings-menu>summary').click();page.locator('#form-'+form).click()
            if page.locator('#settings-menu').get_attribute('open') is not None:page.locator('#settings-menu>summary').click()
            for pid in ['001108','001247']:
                row=page.locator(f'#product-grid [data-product-id="{pid}"]')
                check_photo(row.locator('.glass-photo img'),source(pid,form))
                assert row.locator('.glass-photo .sample-marker').count()==0
            no_overflow(page)
            page.screenshot(path=str(OUT/f'v062-main-{form}.png'),full_page=True)
            aqua_card.locator('.photo-button').click()
            check_photo(page.locator('#detail-photo img'),source('001108',form))
            expect(page.locator('#detail-photo-grade')).to_contain_text(form.capitalize()+' frit')
            assert page.locator('#detail-photo .sample-marker').count()==0
            assert page.locator('#detail-reference').get_attribute('open') is None
            page.locator('#detail-dialog').screenshot(path=str(OUT/f'v062-detail-{form}.png'))
            page.locator('#detail-reference>summary').click()
            assert page.locator('#detail-reference-photo img').get_attribute('src')=='assets/glass/001108.jpg'
            page.locator('#detail-samples button').last.click()
            check_photo(page.locator('#detail-photo img'),source('001108',form))
            page.locator('#close-detail').click()
            done(f'Main cards and enlarged {form} photographs load the actual matching-grade pictures')
            aqua_card.locator('.row-alternatives').click();page.locator('#alternatives-search').fill('Aquamarine Blue')
            alternative=page.locator('#alternatives-grid [data-product-id="001108"]')
            check_photo(alternative.locator('.glass-photo img'),source('001108',form))
            alternative.locator('.photo-button').click()
            check_photo(page.locator('#detail-photo img'),source('001108',form))
            page.locator('#close-detail').click();page.locator('#close-alternatives').click()
            done(f'Alternatives and their detail popup use the actual {form} photograph')
        # An open detail view follows a grade change; stale downloads cannot replace its node.
        aqua_card.locator('.photo-button').click()
        for form in ['powder','medium','coarse','fine']:
            page.locator('#form-'+form).evaluate('b=>b.click()')
        expect(page.locator('#detail-dialog')).to_be_visible()
        check_photo(page.locator('#detail-photo img'),source('001108','fine'))
        page.wait_for_timeout(800)
        check_photo(page.locator('#detail-photo img'),source('001108','fine'))
        page.locator('#close-detail').click()
        done('Rapid grade switches, including an open detail window, finish on Fine without a stale Medium photo')
        page.locator('#library-tab').click();page.locator('#glass-search').fill('Aquamarine Blue')
        check_photo(page.locator('#product-grid [data-product-id="001108"] .glass-photo img'),source('001108','fine'))
        page.locator('#palette-tab').click()
        done('All-glass library shares the same selected-grade photographs')
        last_state=state(page)
        assert last_state['sourceDataUrl']==first_state['sourceDataUrl']
        assert last_state['targets']==first_state['targets']
        assert last_state['chosenMatches']==first_state['chosenMatches']
        done('Source image, dot coordinates, edited colors and chosen matches stay unchanged')
        with context.expect_page() as created:page.locator('#save-cart').click()
        cart=created.value;cart.set_default_timeout(30000);cart.on('pageerror',lambda e:errors.append(str(e)));cart.wait_for_load_state()
        expect(cart.locator('#cart-editor-dialog')).to_be_visible()
        cart.locator('#saved-cart-search').fill('Aquamarine Blue')
        result=cart.locator('#saved-cart-search-results [data-product-id="001108"]')
        for form in grades:
            cart.locator('#cart-add-form').select_option(form);cart.locator('#cart-add-size').select_option('1lb')
            check_photo(result.locator('.cart-photo-button img'),source('001108',form))
            result.locator('.cart-photo-button').click();check_photo(cart.locator('#cart-large-photo'),source('001108',form));cart.locator('#close-cart-photo').click()
            item=cart.locator('#saved-cart-items [data-product-id="001108"]')
            item.locator('.cart-grade-select').select_option(form)
            check_photo(item.locator('.cart-photo-button img'),source('001108',form))
            item.locator('.cart-photo-button').click();check_photo(cart.locator('#cart-large-photo'),source('001108',form));cart.locator('#close-cart-photo').click()
            done(f'Cart Add-a-color, existing item and enlarged preview use the actual {form} picture')
        cart.screenshot(path=str(OUT/'v062-cart-photos.png'),full_page=True)
        assert not errors,errors
        done('No uncaught browser errors during actual-photo interactions')
        context.close();context=None
    with zipfile.ZipFile(ROOT/'dist/Bullseye-Palette-Picker-v0.6.2.zip') as archive:
        assert archive.testzip() is None
        for f in EXT.rglob('*'):
            if f.is_file():assert archive.read(f.relative_to(EXT).as_posix())==f.read_bytes(),f
    done('Released ZIP bytes match the tested extension source')
except Exception as e:
    failure=str(e);traceback.print_exc()
    if context:
        for i,pg in enumerate(context.pages):
            try:pg.screenshot(path=str(OUT/f'v062-failure-{i}.png'),full_page=True)
            except Exception:pass
    raise
finally:
    (OUT/'v062-report.json').write_text(json.dumps({'checks':checks,'count':len(checks),'livePhotoCount':len(audit),'browserErrors':errors,'failure':failure,'mode':'Native Chromium extension. Photos are actual live CDN responses. No user account, checkout or live cart mutations.'},indent=2))
