"""Purpose: complete missing public photo metadata and exercise the added cart workflow.
Setup: apply after the cart-photo index/UI. Retry only missing product listings slowly.
Writes: photo metadata, a few test-only image fixtures, test invocation and documentation.
Constraints: respect Retry-After; public GET requests only. Fixtures never enter the ZIP.
No account, live-cart, original sampling catalog or product-format changes.
"""
from pathlib import Path
import json, time, urllib.request, urllib.error, urllib.parse, hashlib, subprocess
from datetime import datetime,timezone
path=Path('extension/data/cart-photos.json');data=json.loads(path.read_text())
missing=sorted(data['unavailableSources'],key=lambda h:(not h.startswith('french-vanilla'),h))
def get(url):
    for attempt in range(3):
        try:
            request=urllib.request.Request(url,headers={'User-Agent':'BullseyePalettePicker/0.6.1 (public product photographs)'})
            with urllib.request.urlopen(request,timeout=25) as response:return response.read(),response.headers.get_content_type()
        except urllib.error.HTTPError as error:
            if error.code!=429 or attempt==2:raise
            try:delay=float(error.headers.get('Retry-After',15))
            except (TypeError,ValueError):delay=15
            time.sleep(max(15,min(delay,120)))
        except (urllib.error.URLError,TimeoutError):
            if attempt==2:raise
            time.sleep(5*(attempt+1))
def image_url(value):
    if isinstance(value,dict):value=value.get('src') or value.get('url')
    if not isinstance(value,str) or not value:return None
    url=urllib.parse.urljoin('https://shop.bullseyeglass.com',value);parsed=urllib.parse.urlsplit(url)
    return url if parsed.scheme=='https' and parsed.hostname in ('shop.bullseyeglass.com','cdn.shopify.com') else None
for i,handle in enumerate(missing):
    url=f'https://shop.bullseyeglass.com/products/{handle}.js'
    try:
        raw,_=get(url);payload=json.loads(raw);assert payload.get('handle')==handle
        images=[]
        for item in [payload.get('featured_image'),*(payload.get('images') or [])]:
            src=image_url(item)
            if src and src not in images:images.append(src)
        assigned={}
        for v in payload.get('variants',[]):
            src=image_url(v.get('featured_image'))
            if src:
                assigned[str(v['id'])]=src
                if src not in images:images.append(src)
        data['products'][handle]={'images':images,'variantImages':assigned,'source':{'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'retrievedAt':datetime.now(timezone.utc).isoformat()}}
        data['unavailableSources'].pop(handle,None)
    except Exception as error:data['unavailableSources'][handle]=str(error)
    if (i+1)%20==0:
        print('Photo sources completed:',len(data['products']),'remaining:',len(data['unavailableSources']),flush=True)
        path.write_text(json.dumps(data,separators=(',',':'))+'\n')
    time.sleep(1.0)
path.write_text(json.dumps(data,separators=(',',':'))+'\n')
assert len(data['products'])>800,('Photo coverage remains incomplete',len(data['products']))

# Small real-image fixtures let native tests verify and visually inspect the preview
# without permitting any live account/store mutation during browser tests.
folder=Path('tests/fixtures/cart-photos');folder.mkdir(parents=True,exist_ok=True)
fixtures={}
wanted=[h for h in data['products'] if h.startswith('french-vanilla-opalescent-')]
wanted+=['clear-transparent-fine-frit-fusible','clear-transparent-tekta-3mm-fusible']
for handle in wanted:
    for url in data['products'][handle]['images']:
        if url in fixtures:continue
        raw,mime=get(url);assert mime.startswith('image/') and len(raw)<15000000
        suffix={'image/png':'.png','image/webp':'.webp','image/gif':'.gif'}.get(mime,'.jpg')
        file=folder/(hashlib.sha256(url.encode()).hexdigest()[:20]+suffix);file.write_bytes(raw)
        fixtures[url]={'path':str(file),'mime':mime,'sourceUrl':url,'sha256':hashlib.sha256(raw).hexdigest()}
        time.sleep(.3)
(folder/'index.json').write_text(json.dumps(fixtures,indent=2)+'\n')

p=Path('tests/v061-browser.py');s=p.read_text()
s+='''\n# The added cart-builder acceptance test is a separate isolated browser/profile.\nimport subprocess\nsubprocess.run(['python',str(ROOT/'tests/cart-builder-browser.py')],check=True)\n'''
p.write_text(s)
p=Path('docs/release-v0.6.1.md');s=p.read_text().replace('No unrelated cart, account, image-sampling or catalog behavior was changed.','Existing account integration, image sampling and the original color-matching catalog are unchanged.')
p.write_text(s)
p=Path('PRIVACY.md');s=p.read_text()
if '## Cart product photographs' not in s:
    s+='''\n## Cart product photographs\n\nCart thumbnails and enlarged previews request public product photographs from shop.bullseyeglass.com or cdn.shopify.com, with referrer information omitted. These requests carry no photo-palette image or customer information. cart-photos.json records the public image sources. clear-cart.json contains additional clear-glass purchase variants for the cart only; they are not added to automatic photo matching.\n'''
    p.write_text(s)
subprocess.run(['git','add','PRIVACY.md'],check=True)
print('Verified photo metadata:',len(data['products']),'unavailable:',len(data['unavailableSources']),'real test photos:',len(fixtures),flush=True)
