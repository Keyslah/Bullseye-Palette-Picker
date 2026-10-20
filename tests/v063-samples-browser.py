"""Purpose: verify real form photos, sampled glass markers and shared percentages.
Setup: Python Playwright/Pillow, Chromium and public Bullseye CDN network access.
Writes: disposable extension profile, real-photo audit and screenshots in test-results.
Constraints: no personal account/cart; all shop traffic is blocked. Delayed photo tests
forward unchanged bytes fetched from the real CDN, never synthetic image placeholders.
"""
import asyncio, base64, hashlib, io, json, math, os, re, tempfile, traceback, urllib.request
from pathlib import Path
from contextlib import asynccontextmanager
from PIL import Image
from playwright.async_api import async_playwright, expect

ROOT=Path(os.environ.get('BULLSEYE_TEST_ROOT',Path(__file__).resolve().parents[1]))
EXT=ROOT/'extension';OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
DATA=json.loads((EXT/'data/form-samples.json').read_text())
CATALOG=json.loads((EXT/'data/catalog.json').read_text())['products']
FORMATS=json.loads((EXT/'data/product-formats.json').read_text())['products']
FORMS=['powder','fine','medium','coarse']
checks=[];errors=[];audit=[];failure=None
images={}

def done(message):
    checks.append(message);print('PASS:',message,flush=True)

def source_photo(pid,form):
    record=DATA['products'][pid][form]
    with urllib.request.urlopen(record['imageUrl'],timeout=40) as response:
        assert response.status==200
        raw=response.read();mime=response.headers.get('Content-Type','')
    digest=hashlib.sha256(raw).hexdigest()
    assert digest==record['sourceSha256'],(pid,form,'CDN image changed since sampling',digest,record['sourceSha256'])
    image=Image.open(io.BytesIO(raw));image.load()
    assert list(image.size)==record['pixels']
    images[(pid,form)]=image.convert('RGB')
    (OUT/f'v063-actual-{pid}-{form}.jpg').write_bytes(raw)
    return {'productId':pid,'form':form,'url':record['imageUrl'],'sha256':digest,'bytes':len(raw),'pixels':list(image.size),'mime':mime}

async def saved(page):
    await page.wait_for_timeout(400)
    return await page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1")

async def expected_samples(page,pid,form,target_rgb):
    return await page.evaluate('''async ({pid,form,rgb})=>{
      const [{matchCatalog,sampleThickness},{productWithFormSamples},catalog,index]=await Promise.all([
        import('./lib/palette.js'),import('./lib/form-samples.js'),fetch('./data/catalog.json').then(r=>r.json()),fetch('./data/form-samples.json').then(r=>r.json())]);
      const base=catalog.products.find(p=>p.id===pid),product=productWithFormSamples(base,form,index);
      const best=matchCatalog({rgb},[product],{includeOtherFamilies:true})[0]?.sample;
      const values=product.samples.map(s=>Math.round(sampleThickness(s,product))).filter(Number.isFinite);
      return {best,range:[Math.min(...values),Math.max(...values)],samples:product.samples.map(s=>({...s,percent:Math.round(sampleThickness(s,product))})),
        inspection:(product.photoGuide.inspectionSamples||[]).map(s=>({...s,percent:Math.round(sampleThickness(s,product))})),reference:product.thicknessReference};
    }''',{'pid':pid,'form':form,'rgb':target_rgb})

async def loaded_photo(page,pid,form,selector='#detail-photo'):
    expected=DATA['products'][pid][form]
    image=page.locator(selector+' .glass-photo img')
    await expect(image).to_have_attribute('src',expected['imageUrl'])
    info=await image.evaluate('async img=>{await img.decode();return {url:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight};}')
    assert info['url']==expected['imageUrl'] and [info['width'],info['height']]==expected['pixels'],info
    return info

async def marker_info(page,selector='#detail-photo'):
    await expect(page.locator(selector+' .photo-sample-plane')).to_be_visible()
    return await page.locator(selector+' .glass-photo').evaluate('''node=>{
      const img=node.querySelector('img'),plane=node.querySelector('.photo-sample-plane'),marker=node.querySelector('.sample-marker');
      if(!plane || !marker)throw new Error('Loaded sampled photograph has no plane/marker');
      const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
      const p=rect(plane),m=rect(marker),i=rect(img);
      return {x:(m.x+m.width/2-p.x)/p.width,y:(m.y+m.height/2-p.y)/p.height,
        id:marker.dataset.sampleId||'',plane:p,image:i,natural:[img.naturalWidth,img.naturalHeight]};
    }''')

def assert_marker(info,sample):
    assert abs(info['x']-sample['x'])<.002 and abs(info['y']-sample['y'])<.002,(info,sample)
    if info['id']:assert info['id']==sample['id'],(info,sample)
    image=info['image'];plane=info['plane'];nw,nh=info['natural']
    scale=min(image['width']/nw,image['height']/nh)
    width,height=nw*scale,nh*scale
    assert abs(plane['width']-width)<1.25 and abs(plane['height']-height)<1.25,(plane,image)
    assert abs(plane['x']-(image['x']+(image['width']-width)/2))<1.25
    assert abs(plane['y']-(image['y']+(image['height']-height)/2))<1.25

def assert_real_glass_pixel(pid,form,sample):
    image=images[(pid,form)];w,h=image.size
    rgb=image.getpixel((min(w-1,int(sample['x']*w)),min(h-1,int(sample['y']*h))))
    # Aquamarine marker positions must remain visibly colored actual material,
    # not the neutral white substrate between or outside the grains.
    assert max(rgb)-min(rgb)>=12 and min(rgb)<225,(pid,form,sample,rgb)

async def check_marker_sample(page,expected,selector='#detail-photo'):
    info=await marker_info(page,selector)
    candidates=expected['samples']+expected['inspection']
    sample=min(candidates,key=lambda s:(s['x']-info['x'])**2+(s['y']-info['y'])**2)
    assert_marker(info,sample)
    return sample

async def click_plane(page,x,y):
    plane=page.locator('#detail-photo .photo-sample-plane')
    await plane.scroll_into_view_if_needed()
    bounds=await plane.bounding_box()
    await page.mouse.click(bounds['x']+bounds['width']*x,bounds['y']+bounds['height']*y)

@asynccontextmanager
async def native_browser(profile,proxy):
    """Capture a failure before closing Chrome, then release its profile files."""
    async with async_playwright() as p:
        context=await p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
            viewport={'width':1440,'height':1100},proxy={'server':proxy} if proxy else None,ignore_https_errors=bool(proxy),
            args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        failed=False
        try:
            yield context
        except BaseException:
            failed=True
            for i,page in enumerate(context.pages):
                try:await page.screenshot(path=str(OUT/f'v063-samples-failure-{i}.png'),full_page=True)
                except Exception:pass
            raise
        finally:
            try:await context.close()
            except Exception:
                # Preserve the test failure if Chromium has already disconnected.
                if not failed:raise

async def run():
    global failure
    try:
        jobs=[('001108',form) for form in FORMS]+[('001414','powder')]
        for record in await asyncio.gather(*(asyncio.to_thread(source_photo,*job) for job in jobs)):audit.append(record)
        assert len({record['sha256'] for record in audit if record['productId']=='001108'})==4
        done('All four Aquamarine photos and one non-square source were fetched live, decoded and matched to their sampling hashes')
        proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        with tempfile.TemporaryDirectory() as profile:
            async with native_browser(profile,proxy) as context:
                await context.route('https://shop.bullseyeglass.com/**',lambda route:route.abort())
                worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
                await worker.evaluate("() => {globalThis.fetch=async()=>{throw new Error('Shop/account/cart requests disabled in photo-sample test');};}")
                base='chrome-extension://'+worker.url.split('/')[2]+'/picker.html?workspace=1'
                page=await context.new_page();page.set_default_timeout(30000)
                page.on('pageerror',lambda error:errors.append(str(error)))
                await page.goto(base);await expect(page.locator('#library-count')).to_have_text(re.compile(r'[1-9]\d*'));await page.wait_for_timeout(700)
                seed=await page.evaluate('''()=>{
                  const c=document.createElement('canvas');c.width=1000;c.height=500;const ctx=c.getContext('2d');
                  ctx.fillStyle='#98B5B3';ctx.fillRect(0,0,500,500);ctx.fillStyle='#F49A1C';ctx.fillRect(500,0,500,500);
                  return {version:6,format:'medium',preferredJarSize:'5lb',sourceName:'Form sample verification',sourceDataUrl:c.toDataURL(),
                    targets:[{id:'aqua',rgb:[152,181,179],hex:'#98B5B3',x:.25,y:.5,manual:true,custom:true},
                      {id:'orange',rgb:[244,154,28],hex:'#F49A1C',x:.75,y:.5,manual:true,custom:true}],
                    chosenMatches:{aqua:'001108',orange:'001025'},activeTargetId:'aqua',glassTypes:{transparent:true,opalescent:true},view:'palette'};
                }''')
                # v0.6.2 saved automatic choices live in targetKeys, without an
                # explicit chosenMatches entry. Upgrade must preserve those choices.
                seed.pop('chosenMatches')
                seed['selection']={'version':1,'targetKeys':{},'excludedTargetIds':[],'excludedProductIds':[],'manualKeys':[]}
                seed['cart']=[];seed['selectedVariants']={};seed['quantities']={}
                for target_id,pid,quantity in [('aqua','001108',4),('orange','001025',2)]:
                    variant=next(v for v in FORMATS[pid]['medium']['variants'] if v['available'] and v['title']=='5 lb. jar')
                    product=next(p for p in CATALOG if p['id']==pid);key=pid+':'+str(variant['id'])
                    seed['selection']['targetKeys'][target_id]=key
                    seed['cart'].append({'key':key,'productId':pid,'variantId':variant['id'],'form':'medium','sku':variant['sku'],'name':product['name'],
                        'image':product['image'],'title':variant['title'],'price':variant['price'],'available':True,'quantity':quantity})
                    seed['selectedVariants'][pid]=str(variant['id']);seed['quantities'][key]=quantity
                await page.close();await worker.evaluate('(record)=>chrome.storage.local.set({bullseyeProjectV1:record})',seed)
                page=await context.new_page();page.set_default_timeout(30000);page.on('pageerror',lambda error:errors.append(str(error)))
                await page.goto(base)
                aqua='#product-grid .compact-card[data-product-id="001108"]'
                await expect(page.locator(aqua)).to_be_visible();await expect(page.locator('#image-loaded')).to_be_visible();initial=await saved(page)
                assert initial['chosenMatches']=={'aqua':'001108','orange':'001025'}
                assert initial['photoGuideVersion']==1
                assert {(i['productId'],i['variantId'],i['quantity']) for i in initial['cart']}=={(i['productId'],i['variantId'],i['quantity']) for i in seed['cart']}
                original=Image.open(io.BytesIO(base64.b64decode(seed['sourceDataUrl'].split(',',1)[1]))).convert('RGBA')
                restored=Image.open(io.BytesIO(base64.b64decode(initial['sourceDataUrl'].split(',',1)[1]))).convert('RGBA')
                assert original.size==restored.size and original.tobytes()==restored.tobytes()
                done('A v0.6.2 automatic saved selection upgrades with the same glass choices, exact variants, quantities and source image')
                await page.locator(aqua+' .photo-button').click()
                assert await page.locator('#detail-reference').count()==0
                ranges={};references=[];markers={}
                # Delay an actual Powder response after its bytes arrive, switch forms,
                # then release the older image while Fine remains the current selection.
                old_url=DATA['products']['001108']['powder']['imageUrl']
                started=asyncio.Event();release=asyncio.Event();finished=asyncio.Event();held=[]
                async def delay_real_photo(route):
                    response=await route.fetch();body=await response.body()
                    assert response.status==200 and hashlib.sha256(body).hexdigest()==DATA['products']['001108']['powder']['sourceSha256']
                    held.append({'url':route.request.url,'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)})
                    started.set();await release.wait()
                    try:await route.fulfill(response=response,body=body)
                    except Exception as error:
                        # Detached image requests may be cancelled; cancellation also
                        # must not change the current photograph or its marker.
                        if 'closed' not in str(error).lower() and 'canceled' not in str(error).lower():raise
                    finally:finished.set()
                await context.route(old_url,delay_real_photo)
                await page.locator('#detail-purchase .product-form-select').select_option('powder')
                await asyncio.wait_for(started.wait(),30)
                for form in ['medium','coarse','fine']:
                    await page.locator('#detail-purchase .product-form-select').select_option(form)
                await loaded_photo(page,'001108','fine')
                fine=await expected_samples(page,'001108','fine',[152,181,179])
                assert_marker(await marker_info(page),fine['best'])
                release.set();await asyncio.wait_for(finished.wait(),15);await page.wait_for_timeout(600)
                await loaded_photo(page,'001108','fine');assert_marker(await marker_info(page),fine['best'])
                await context.unroute(old_url,delay_real_photo)
                assert held
                await page.locator('#detail-dialog').screenshot(path=str(OUT/'v063-rapid-final-fine.png'))
                done('Rapid Powder→Medium→Coarse→Fine switching remains Fine after the real delayed Powder response is released')

                for form in FORMS:
                    await page.locator('#detail-purchase .product-form-select').select_option(form)
                    await loaded_photo(page,'001108',form)
                    await expect(page.locator('#detail-photo-grade')).to_contain_text(form.capitalize())
                    expected=await expected_samples(page,'001108',form,[152,181,179])
                    references.append(expected['reference']);ranges[form]=expected['range']
                    info=await marker_info(page);assert_marker(info,expected['best']);markers[form]=[info['x'],info['y']]
                    assert_real_glass_pixel('001108',form,expected['best'])
                    await loaded_photo(page,'001108',form,aqua)
                    assert_marker(await marker_info(page,aqua),expected['best'])
                    labels=[int(value) for value in re.findall(r'\d+',await page.locator('#detail-range').inner_text())]
                    assert labels==expected['range'],(form,labels,expected['range'])
                    buttons=page.locator('#detail-samples button')
                    await expect(buttons).to_have_count(len(expected['samples']))
                    for index in [0,len(expected['samples'])//2,len(expected['samples'])-1]:
                        sample=expected['samples'][index]
                        button=buttons.nth(index)
                        actual_rgb=await button.locator('span').evaluate('node=>getComputedStyle(node).backgroundColor')
                        assert [int(value) for value in re.findall(r'\d+',actual_rgb)][:3]==sample['rgb']
                        await button.click();assert_marker(await marker_info(page),sample)
                        await expect(page.locator('#detail-sample-label')).to_contain_text(str(sample['percent'])+'%')
                        assert_real_glass_pixel('001108',form,sample)
                    # Click a known sampled glass position using real browser pointer input.
                    sample=expected['samples'][len(expected['samples'])//3]
                    await click_plane(page,sample['x'],sample['y'])
                    selected=await check_marker_sample(page,expected)
                    assert math.hypot(selected['x']-sample['x'],selected['y']-sample['y'])<.035
                    await expect(page.locator('#detail-sample-label')).to_contain_text(str(selected['percent'])+'%')
                    # White background is never itself a glass sample. A distant
                    # gap is ignored; a near gap may snap onto real nearby glass.
                    candidates=expected['samples']+expected['inspection']
                    corners=[(.005,.005),(.995,.005),(.005,.995),(.995,.995)]
                    image=images[('001108',form)];w,h=image.size
                    whites=[pt for pt in corners if min(image.getpixel((int(pt[0]*w),int(pt[1]*h))))>230]
                    assert whites,(form,'No true white corner to inspect')
                    blank=max(whites,key=lambda pt:min(math.hypot(pt[0]-s['x'],pt[1]-s['y']) for s in candidates))
                    distance=min(math.hypot(blank[0]-s['x'],blank[1]-s['y']) for s in candidates)
                    before=await marker_info(page);await click_plane(page,*blank);after=await marker_info(page)
                    if distance>.18:
                        assert abs(before['x']-after['x'])<1e-5 and abs(before['y']-after['y'])<1e-5
                    else:
                        glass=await check_marker_sample(page,expected)
                        assert_real_glass_pixel('001108',form,glass)
                        assert math.hypot(glass['x']-blank[0],glass['y']-blank[1])<=.18
                    await page.locator('#detail-dialog').screenshot(path=str(OUT/f'v063-detail-samples-{form}.png'))
                    done(f'{form.capitalize()} uses its own actual photo, closest full-color sample, measured range, swatches and glass-only marker/click coordinates')
                assert all(reference==references[0] for reference in references)
                assert all(bounds[0]>0 for bounds in ranges.values()),ranges
                assert len(set(tuple(bounds) for bounds in ranges.values()))>1,ranges
                assert len(set(tuple(value) for value in markers.values()))==4,markers
                done('All forms retain one shared color reference; measured minima and match coordinates differ without resetting each photo to 0–100%')

                await page.locator('#close-detail').click()
                current=await saved(page)
                assert current['sourceDataUrl']==initial['sourceDataUrl'] and current['targets']==initial['targets']
                assert current['chosenMatches']==initial['chosenMatches']
                assert current['format']=='medium' and current['selectedForms']=={'001108':'coarse'}
                initial_other=[i for i in initial['cart'] if i['productId']!='001108']
                assert [i for i in current['cart'] if i['productId']!='001108']==initial_other
                done('Photo inspection and rapid local form switching preserve uploaded image, source dots, manual colors, other items and global form')

                # Real non-square source verifies the marker plane tracks containment.
                await page.locator('#form-powder').evaluate('button=>button.click()')
                await page.locator('#library-tab').click()
                name=next(p['name'] for p in CATALOG if p['id']=='001414')
                await page.locator('#glass-search').fill(name)
                await page.locator('#product-grid [data-product-id="001414"] .photo-button').click()
                await loaded_photo(page,'001414','powder')
                other=await expected_samples(page,'001414','powder',[152,181,179])
                await page.locator('#detail-samples button').nth(0).click()
                assert_marker(await marker_info(page),other['samples'][0])
                await page.locator('#detail-dialog').screenshot(path=str(OUT/'v063-nonsquare-marker.png'))
                done('A real 1186×1200 Powder image uses its actual contain bounds for marker placement')
                assert not errors,errors
                done('No uncaught browser errors; no personal account or shopping cart access')
    except Exception as error:
        failure=str(error);traceback.print_exc()
        raise
    finally:
        (OUT/'v063-samples-report.json').write_text(json.dumps({'checks':checks,'count':len(checks),'failure':failure,'browserErrors':errors,'livePhotoAudit':audit,'mode':'Disposable native Chromium; actual public CDN images; shopping requests blocked.'},indent=2))

asyncio.run(run())
