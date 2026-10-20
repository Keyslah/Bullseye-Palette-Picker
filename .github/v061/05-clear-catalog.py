"""Purpose: add cart-only clear products and grade-specific public photo references.
Setup: run once in the recovery workflow; reuse the public Bullseye catalog reader.
Writes: two additional JSON indexes and source notes only; no original catalog edits.
Constraints: public product/sitemap GETs only. No accounts, carts or credentials.
Photos remain remote Bullseye images; no invented size-specific images or variants.
"""
from pathlib import Path
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor, as_completed
import importlib.util, json, re, urllib.parse

root=Path('.')
spec=importlib.util.spec_from_file_location('public_formats',root/'scripts/build-product-formats.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cache=root/'.cache'/'cart-media';cache.mkdir(parents=True,exist_ok=True)
handles,sitemap_sources=module.list_handles(cache,SimpleNamespace(offline=False,refresh=True))
frit=re.compile(r'^(?:crystal-)?clear-transparent-(powder|fine|medium|coarse)-frit-fusible$')
sheet=re.compile(r'^(?:crystal-)?clear-transparent-((?:double|thin|single)-rolled|tekta)-(\d+(?:-\d+)?)-?mm-fusible$')
clear_handles=sorted(handle for handle in handles if frit.fullmatch(handle) or sheet.fullmatch(handle))
assert 'clear-transparent-fine-frit-fusible' in clear_handles
assert 'clear-transparent-tekta-3mm-fusible' in clear_handles
index=json.loads((root/'extension/data/product-formats.json').read_text())
all_handles=set(clear_handles)
for forms in index['products'].values():
    for entry in forms.values():
        if entry.get('handle'):all_handles.add(entry['handle'])
        for variant in entry.get('variants',[]):
            if variant.get('handle'):all_handles.add(variant['handle'])

def image_url(value):
    if isinstance(value,dict):value=value.get('src') or value.get('url')
    if not isinstance(value,str) or not value:return None
    url=urllib.parse.urljoin(module.STORE,value)
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname not in ('shop.bullseyeglass.com','cdn.shopify.com'):return None
    return url

def fetch_product(handle):
    raw,source=module.read_public(f'{module.STORE}/products/{handle}.js',cache,refresh=True)
    payload=json.loads(raw)
    assert payload.get('handle')==handle,handle
    return payload,source

payloads={};errors={}
with ThreadPoolExecutor(max_workers=10) as pool:
    futures={pool.submit(fetch_product,handle):handle for handle in sorted(all_handles)}
    for future in as_completed(futures):
        handle=futures[future]
        try:payloads[handle]=future.result()
        except Exception as error:errors[handle]=str(error)
        if len(payloads)%100==0:print('Public product images read:',len(payloads),flush=True)
assert not any(handle in errors for handle in clear_handles),{h:errors[h] for h in clear_handles if h in errors}
photos={}
for handle,(payload,source) in sorted(payloads.items()):
    images=[]
    for value in [payload.get('featured_image'),*(payload.get('images') or [])]:
        url=image_url(value)
        if url and url not in images:images.append(url)
    assigned={}
    for variant in payload.get('variants',[]):
        url=image_url(variant.get('featured_image'))
        if url:
            assigned[str(variant['id'])]=url
            if url not in images:images.append(url)
    photos[handle]={'images':images,'variantImages':assigned,'source':source}

groups={};ids=set()
for handle in clear_handles:
    payload,source=payloads[handle]
    assert 'Fusible' in payload['title'],handle
    fm,sm=frit.fullmatch(handle),sheet.fullmatch(handle)
    form=fm.group(1) if fm else 'sheets'
    thickness=float(sm.group(2).replace('-','.')) if sm else None
    finish=sm.group(1).capitalize() if sm else None
    for variant in payload['variants']:
        sku=variant.get('sku','');parts=sku.split('-')
        assert len(parts)>=4 and re.fullmatch(r'\d{6}',parts[0]) and parts[2]=='F',(handle,sku)
        code=parts[0]
        assert code in ('001100','001101','001401'),(handle,sku)
        assert isinstance(variant['id'],int) and 0<variant['id']<2**53 and variant['id'] not in ids
        assert isinstance(variant['price'],int) and variant['price']>=0 and isinstance(variant['available'],bool)
        ids.add(variant['id'])
        name={'001100':'Clear Transparent Tekta','001101':'Clear Transparent','001401':'Crystal Clear Transparent'}[code]
        group=groups.setdefault(code,{'id':code,'code':code,'name':name,'fullName':name,'type':'Transparent',
            'isClear':True,'cartOnly':True,'samples':[],'form':'medium','grain':'Medium frit',
            'variants':[],'allVariants':[],'sources':[],'image':''})
        title=str(variant['title'])
        record={'id':variant['id'],'sku':sku,'sourceTitle':title,'title':f'{thickness:g} mm · {finish} · {title}' if sm else title,
            'form':form,'available':variant['available'],'price':variant['price'],'handle':handle,
            'productUrl':f'{module.STORE}/products/{handle}','shopifyProductId':payload['id']}
        if sm:record.update(thicknessMm=thickness,finish=finish)
        group['allVariants'].append(record)
        if form=='medium':group['variants'].append(record)
        if source not in group['sources']:group['sources'].append(source)
        if not group['image'] and photos[handle]['images']:group['image']=photos[handle]['images'][0]
assert len(groups)==3
(root/'extension/data/clear-cart.json').write_text(json.dumps({'version':1,'retrievedAt':module.now(),'products':list(groups.values()),'sources':sitemap_sources},indent=2)+'\n')
(root/'extension/data/cart-photos.json').write_text(json.dumps({'version':1,'retrievedAt':module.now(),'products':photos,'unavailableSources':errors},separators=(',',':'))+'\n')
Path('docs/cart-photo-sources.md').write_text('# Cart photo and clear-glass sources\n\nAdditional cart data comes from public Bullseye product JSON and sitemaps, with source URLs, timestamps and SHA-256 hashes recorded in clear-cart.json and cart-photos.json. Original product photographs are copyright Bullseye Glass Co. Photos are loaded directly from Bullseye/Shopify when shown, not uploaded to any image-analysis service.\n\nPhoto precedence: exact variant-assigned image, then that grade/sheet product listing image. A shared product photo is not described as a unique jar-weight or sheet-size photograph. The existing medium-frit color-sampling guide remains unchanged and separate.\n')
print('Clear products:',len(groups),'clear variants:',len(ids),'photo listings:',len(photos),'unavailable sources:',len(errors),flush=True)
print('Listings with variant-specific photo assignments:',sum(bool(value['variantImages']) for value in photos.values()),flush=True)
