#!/usr/bin/env python3
"""Map the reviewed medium-frit colors to real Bullseye purchase formats.

Reads public Bullseye sitemap/product JSON and the bundled color guide. Writes
only product-formats.json and an ignored metadata cache; no images are fetched,
no color samples change, and no customer account or cart is accessed.
Run --refresh for current public inventory, or --offline to reproduce a cached
build. Sheet listings must be standard single-color fusible rolled glass.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
STORE = 'https://shop.bullseyeglass.com'
FORMS = ('sheets', 'powder', 'fine', 'medium', 'coarse')
LABELS = {'sheets':'Sheets','powder':'Powder','fine':'Fine','medium':'Medium','coarse':'Coarse'}
FRIT_CODES = {'powder':'0008','fine':'0001','medium':'0002','coarse':'0003'}
SHEET_SUFFIX = re.compile(r'-(double|thin|single)-rolled-(\d+(?:-\d+)?)-mm-fusible$')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def read_public(url, cache, *, offline=False, refresh=False):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'shop.bullseyeglass.com':
        raise ValueError(f'Only public Bullseye HTTPS sources are accepted: {url}')
    path = cache / (Path(parsed.path).name + ('-' + hashlib.sha256(parsed.query.encode()).hexdigest()[:10] if parsed.query else ''))
    meta = path.with_name(path.name + '.meta.json')
    if path.exists() and (offline or not refresh):
        raw = path.read_bytes()
        metadata = json.loads(meta.read_text()) if meta.exists() else {'retrievedAt':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')}
    else:
        if offline:
            raise FileNotFoundError(f'Cached source missing: {url}')
        request = urllib.request.Request(url, headers={'User-Agent':'BullseyePalettePicker/0.4 (public product format catalog)'})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=35) as response:
                    raw = response.read()
                break
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)
        metadata = {'retrievedAt':now()}
        path.write_bytes(raw)
        meta.write_text(json.dumps(metadata) + '\n')
    return raw, {'url':url, 'sha256':hashlib.sha256(raw).hexdigest(), **metadata}


def list_handles(cache, args):
    raw, index_source = read_public(STORE+'/sitemap.xml', cache, offline=args.offline, refresh=args.refresh)
    pages = [node.text for node in ET.fromstring(raw).findall('.//{*}sitemap/{*}loc') if '/sitemap_products_' in node.text]
    if not pages:
        raise ValueError('The public sitemap index contained no product pages.')
    handles = set()
    sources = [index_source]
    for url in pages:
        page, source = read_public(url, cache, offline=args.offline, refresh=args.refresh)
        sources.append(source)
        for node in ET.fromstring(page).findall('.//{*}url/{*}loc'):
            parsed = urllib.parse.urlsplit(node.text)
            if parsed.netloc == 'shop.bullseyeglass.com' and parsed.path.startswith('/products/'):
                handles.add(parsed.path.removeprefix('/products/'))
    return handles, sources


def sheet_info(handle):
    found = SHEET_SUFFIX.search(handle)
    if not found:
        raise ValueError(f'Unsupported sheet listing: {handle}')
    return {'finish':f'{found.group(1).capitalize()}-rolled', 'thicknessMm':float(found.group(2).replace('-','.'))}


def sheet_order(handle):
    mm = sheet_info(handle)['thicknessMm']
    return (0 if mm == 3 else 1 if mm == 2 else 2, mm, handle)


def normalize_source_product(code, form, payload, source):
    handle = payload['handle']
    title = str(payload.get('title',''))
    if 'Fusible' not in title or not payload.get('id'):
        raise ValueError(f'Product is not verified fusible glass: {handle}')
    if form != 'sheets' and not re.search(rf'\b{LABELS[form]} Frit\b', title, re.I):
        raise ValueError(f'Unexpected frit form: {title}')
    info = sheet_info(handle) if form == 'sheets' else {}
    variants = []
    for raw in payload.get('variants',[]):
        sku = str(raw.get('sku',''))
        parts = sku.split('-')
        if len(parts) < 4 or parts[0] != code or parts[2] != 'F':
            raise ValueError(f'Wrong base color/nonfusible variant in {handle}: {sku}')
        if form != 'sheets' and parts[1] != FRIT_CODES[form]:
            raise ValueError(f'Wrong frit grain code for {form}: {sku}')
        if form == 'sheets' and parts[1] != {2:'0050',3:'0030',6:'0060'}.get(info['thicknessMm']):
            raise ValueError(f'Unexpected sheet SKU/thickness mapping in {handle}: {sku}')
        if not isinstance(raw.get('available'),bool) or not isinstance(raw.get('price'),int) or not raw.get('id'):
            raise ValueError(f'Incomplete real variant inventory in {handle}: {sku}')
        size = str(raw['title'])
        variant = {
            'id':raw['id'], 'sku':sku,
            'title':f"{info['thicknessMm']:g} mm · {info['finish']} · {size}" if form == 'sheets' else size,
            'sourceTitle':size, 'price':raw['price'], 'available':raw['available'],
            'form':form, 'handle':handle, 'productUrl':f'{STORE}/products/{handle}',
            'shopifyProductId':payload['id'],
        }
        if info:
            variant.update(info)
        variants.append(variant)
    if not variants:
        raise ValueError(f'No real variants in {handle}')
    return {
        'handle':handle, 'productUrl':f'{STORE}/products/{handle}', 'shopifyProductId':payload['id'],
        'fullName':title, 'variants':variants, 'source':source, **info,
    }


def missing_form(code, form):
    return {'form':form,'label':LABELS[form],'grain':'Sheets' if form == 'sheets' else f'{LABELS[form]} frit',
            'missing':True,'available':False,'handle':None,'productUrl':None,'shopifyProductId':None,'variants':[],
            'reason':f'No standard single-color fusible {LABELS[form].lower()} listing for {code} in the verified public product sitemap.'}


def combine_form(form, records):
    first = records[0]
    variants = [variant for record in records for variant in record['variants']]
    return {
        'form':form,'label':LABELS[form],'grain':'Sheets' if form == 'sheets' else f'{LABELS[form]} frit',
        'missing':False,'available':any(variant['available'] for variant in variants),
        'handle':first['handle'],'productUrl':first['productUrl'],'shopifyProductId':first['shopifyProductId'],
        'fullName':first['fullName'],'variants':variants,
        'sources':[{key:record[key] for key in ('handle','productUrl','shopifyProductId','fullName','source')} for record in records],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--refresh',action='store_true')
    parser.add_argument('--workers',type=int,default=6)
    args = parser.parse_args()
    if args.offline and args.refresh:
        parser.error('--offline and --refresh are mutually exclusive')
    cache = ROOT/'.cache'/'product-formats'
    cache.mkdir(parents=True,exist_ok=True)
    catalog_raw = (ROOT/'extension/data/catalog.json').read_bytes()
    catalog = json.loads(catalog_raw)
    handles, sitemap_sources = list_handles(cache,args)
    jobs = []
    requested = {}
    for base in catalog['products']:
        code,stem = base['id'],base['handle'].removesuffix('-medium-frit-fusible')
        requested[code] = {}
        for form in FORMS:
            if form == 'sheets':
                selected = sorted([h for h in handles if h.startswith(stem+'-') and SHEET_SUFFIX.search(h) and h[:SHEET_SUFFIX.search(h).start()] == stem],key=sheet_order)
            elif form == 'medium':
                selected = [base['handle']]
            else:
                handle = f'{stem}-{form}-frit-fusible'
                selected = [handle] if handle in handles else []
            requested[code][form] = selected
            jobs.extend((code,form,handle) for handle in selected if form != 'medium')
    print(f"Verifying {len(jobs)} public format listings; preserving {len(catalog['products'])} medium guide records.",flush=True)
    records = {}
    def fetch_job(job):
        code,form,handle = job
        raw,source = read_public(f'{STORE}/products/{handle}.js',cache,offline=args.offline,refresh=args.refresh)
        payload = json.loads(raw)
        if payload.get('handle') != handle:
            raise ValueError(f'Unexpected product redirect for {handle}')
        return handle,normalize_source_product(code,form,payload,source)
    errors = []
    with ThreadPoolExecutor(max_workers=max(1,min(8,args.workers))) as pool:
        futures = {pool.submit(fetch_job,job):job for job in jobs}
        for count,future in enumerate(as_completed(futures),1):
            try:
                handle,record = future.result(); records[handle] = record
            except Exception as error:
                errors.append({'product':futures[future],'error':str(error)})
            if count % 100 == 0 or count == len(jobs):
                print(f'Verified {count}/{len(jobs)} listings; errors={len(errors)}',flush=True)
    if errors:
        (cache/'errors.json').write_text(json.dumps(errors,indent=2)+'\n')
        raise ValueError(f'{len(errors)} source records failed validation; see {cache/"errors.json"}')
    for base in catalog['products']:
        handle,code = base['handle'],base['id']
        cache_raw = ROOT/'.cache/catalog-full'/f'{handle}.json'
        # The medium snapshot is already verified by build-catalog/check.mjs.
        # Its real product ID is recoverable from the original public JSON.
        if cache_raw.exists():
            payload = json.loads(cache_raw.read_bytes())
        else:
            raw,_ = read_public(f'{STORE}/products/{handle}.js',cache,offline=args.offline,refresh=args.refresh)
            payload = json.loads(raw)
        payload = {**payload,'handle':handle,'title':base['fullName'],'variants':base['variants']}
        source = {'url':base['source']['productDataUrl'],'sha256':base['source']['productDataSha256'],'retrievedAt':base['source']['retrievedAt'],'snapshot':'Bundled reviewed medium-frit catalog'}
        records[handle] = normalize_source_product(code,'medium',payload,source)
    products = {}
    for base in catalog['products']:
        code = base['id']
        products[code] = {form:combine_form(form,[records[handle] for handle in requested[code][form]]) if requested[code][form] else missing_form(code,form) for form in FORMS}
    missing = [{'code':code,'form':form} for code,forms in products.items() for form,record in forms.items() if record['missing']]
    counts = {form:{'listedColors':sum(not forms[form]['missing'] for forms in products.values()),
                    'availableColors':sum(forms[form]['available'] for forms in products.values()),
                    'variants':sum(len(forms[form]['variants']) for forms in products.values())} for form in FORMS}
    output_path = ROOT/'extension/data/product-formats.json'
    old = json.loads(output_path.read_bytes()) if output_path.exists() else {}
    output = {
        'version':1,'generatedAt':old.get('generatedAt',now()) if args.offline else now(),
        'colorGuideVersion':catalog['version'],'colorGuideSha256':hashlib.sha256(catalog_raw).hexdigest(),
        'source':{'store':STORE,'currency':'USD','sitemaps':sitemap_sources,'sitemapProductCount':len(handles),
                  'matchingGuide':'All formats reuse the existing reviewed medium-frit RGB/Lab samples and photo-based thickness percentages.',
                  'scope':'Same 141 base color codes only; standard single-color fusible sheets and powder/fine/medium/coarse frit. No clear, iridescent, dichroic, streaky, mixtures, samples, or accessories.',
                  'sheetPolicy':'Standard 3 mm sheet listed first, then 2 mm and 6 mm where verified; all size choices retain their actual product and variant IDs.',
                  'inventoryNote':'Availability and prices are public storefront snapshots; the Bullseye cart checks the chosen real variants.'},
        'counts':counts,'missing':missing,'products':products,
    }
    output_path.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'counts':counts,'missing':missing,'bytes':output_path.stat().st_size},indent=2))


if __name__ == '__main__':
    main()
