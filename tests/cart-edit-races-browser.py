"""Purpose: keep typed quantities when duplicate/ordinary working-cart saves finish.
Setup: native Playwright Chromium; seeds twelve synthetic cart rows before startup.
Writes: disposable profile and test-results/cart-edit-races-report.json only.
Constraints: holds specific local writes explicitly; no timer sleeps or live store access.
"""
import copy
import json
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


def passed(message):
    checks.append(message)
    print('PASS:', message, flush=True)


def working(current, condition='true'):
    return current.evaluate('''async()=>{
      const matches=value=>value && (''' + condition + ''');
      const read=async()=>(await chrome.storage.local.get('bullseyeWorkingCartV1')).bullseyeWorkingCartV1;
      const current=await read();if(matches(current))return current;
      return new Promise((resolve,reject)=>{
        const finish=value=>{if(!matches(value))return;clearTimeout(timer);chrome.storage.onChanged.removeListener(listener);resolve(value);};
        const listener=(changes,area)=>{if(area==='local'&&changes.bullseyeWorkingCartV1)finish(changes.bullseyeWorkingCartV1.newValue);};
        const timer=setTimeout(()=>{chrome.storage.onChanged.removeListener(listener);reject(new Error('Expected working-cart save did not arrive'));},15000);
        chrome.storage.onChanged.addListener(listener);read().then(finish,reject);
      });
    }''')


def records(current):
    return current.evaluate("async()=> (await import('./lib/saved-carts.js')).listCarts()")


def save_named(current, name):
    current.locator('#save-cart-draft').click()
    current.locator('#cart-confirm-name').fill(name)
    current.locator('#confirm-cart-name').click()
    expect(current.locator('#cart-name-dialog')).to_have_count(0)
    expect(current.locator('#saved-cart-name')).to_have_value(name)
    expect(current.locator('#save-cart-draft')).to_be_enabled()
    expect(current.locator('#saved-cart-draft-status')).to_have_text('Saved')


def type_quantity(field, value):
    # Actual keyboard typing stays uncommitted until blur; fill() may dispatch
    # change itself for number inputs and would miss the focused-input race.
    field.click()
    field.press('ControlOrMeta+A')
    field.press_sequentially(str(value))
    expect(field).to_have_value(str(value))
    expect(field).to_be_focused()


def fixture(route):
    route.fulfill(status=200, content_type='text/html', body='<html><body>Isolated fixture</body></html>')


try:
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
            viewport={'width':1440, 'height':900},
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        context.route('https://**/*', fixture)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("()=>{globalThis.fetch=async()=>{throw new Error('External requests disabled in local cart-edit fixture');};}")
        origin = f'chrome-extension://{worker.url.split("/")[2]}'
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(origin + '/manifest.json')
        page.evaluate('''async()=>{
          const catalog=await (await fetch('./data/catalog.json')).json(),formats=await (await fetch('./data/product-formats.json')).json();
          const items=catalog.products.slice(0,12).map((product,index)=>{
            const form=['medium','fine','coarse','powder'][index%4],variant=formats.products[product.id][form].variants[0];
            return {key:`${product.id}:${variant.id}`,productId:product.id,variantId:variant.id,quantity:1,form,
              name:product.name,sku:variant.sku,title:variant.title,price:variant.price,available:variant.available};
          });
          await chrome.storage.local.set({bullseyeWorkingCartV1:{version:1,id:null,instanceId:crypto.randomUUID(),name:'My cart',items,dirty:true}});
        }''')
        page.goto(origin + '/picker.html?workspace=1&cart=1')
        expect(page.locator('#saved-cart-items .saved-cart-item')).to_have_count(12)
        save_named(page, 'First cart')
        original = copy.deepcopy(records(page)[0])
        ids = [str(item['variantId']) for item in original['items']]
        first = page.locator(f'#saved-cart-items [data-variant-id="{ids[0]}"] .quantity-field')
        second = page.locator(f'#saved-cart-items [data-variant-id="{ids[1]}"] .quantity-field')
        third = page.locator(f'#saved-cart-items [data-variant-id="{ids[2]}"] .quantity-field')
        page.evaluate('''()=>{
          const original=chrome.storage.local.set.bind(chrome.storage.local);
          globalThis.armCartWrite=()=>{globalThis.blockNextCartWrite=true;globalThis.cartWriteHeld=false;globalThis.cartWriteCommitted=false;};
          chrome.storage.local.set=async data=>{
            const held=globalThis.blockNextCartWrite && Object.hasOwn(data,'bullseyeWorkingCartV1');
            if(held){globalThis.blockNextCartWrite=false;globalThis.cartWriteHeld=true;await new Promise(resolve=>globalThis.releaseCartWrite=resolve);}
            const result=await original(data);if(held)globalThis.cartWriteCommitted=true;return result;
          };
        }''')

        page.evaluate('()=>armCartWrite()')
        page.locator('#duplicate-cart-draft').click()
        page.locator('#cart-confirm-name').fill('Second cart')
        page.locator('#confirm-cart-name').click()
        page.wait_for_function('()=>globalThis.cartWriteHeld')
        expect(page.locator('#saved-cart-name')).to_have_value('Second cart')
        expect(page.locator('#saved-cart-draft-status')).to_have_text('Saving cart…')
        type_quantity(first, 3)
        page.evaluate('()=>releaseCartWrite()')
        expect(page.locator('#saved-cart-draft-status')).to_have_text('Saved')
        expect(first).to_have_value('3')
        expect(first).to_be_focused()
        first.press('Tab')
        working(page, 'value.items[0].quantity===3')
        save_named(page, 'Second cart')
        current = records(page)
        assert next(record for record in current if record['name'] == 'First cart') == original
        assert next(record for record in current if record['name'] == 'Second cart')['items'][0]['quantity'] == 3
        passed('A quantity typed before the duplicate working-copy write finishes keeps its focus/value, commits on blur and saves independently of the original cart')

        page.evaluate('()=>armCartWrite()')
        first.fill('4')
        first.press('Tab')
        page.wait_for_function('()=>globalThis.cartWriteHeld')
        type_quantity(second, 5)
        page.evaluate('()=>releaseCartWrite()')
        expect(page.locator('#saved-cart-draft-status')).to_have_text('Cart kept automatically')
        expect(second).to_have_value('5')
        expect(second).to_be_focused()
        second.press('Tab')
        working(page, 'value.items[0].quantity===4 && value.items[1].quantity===5')
        save_named(page, 'Second cart')
        current = records(page)
        assert next(record for record in current if record['name'] == 'First cart') == original
        assert [item['quantity'] for item in next(record for record in current if record['name'] == 'Second cart')['items'][:2]] == [4, 5]
        passed('Completion of an ordinary autosave does not replace the next quantity field while it is being typed; both edits persist')

        worker.evaluate('''async()=>{
          const key='bullseyeWorkingCartV1',value=(await chrome.storage.local.get(key))[key];
          value.items[2].quantity=7;value.dirty=true;await chrome.storage.local.set({[key]:value});
        }''')
        expect(third).to_have_value('7')
        expect(first).to_have_value('4')
        expect(second).to_have_value('5')
        type_quantity(first, 8)
        first.press('Tab')
        value = working(page, 'value.items[0].quantity===8 && value.items[1].quantity===5 && value.items[2].quantity===7')
        assert sum(item['quantity'] for item in value['items']) == 29
        save_named(page, 'Second cart')
        page.reload()
        expect(first).to_have_value('8')
        expect(second).to_have_value('5')
        expect(third).to_have_value('7')
        assert next(record for record in records(page) if record['name'] == 'First cart') == original
        passed('A genuinely changed external cart snapshot still refreshes the rows, and subsequent local edits retain valid handlers and survive reload')
        assert not errors, errors
        context.close()
except Exception:
    failure = traceback.format_exc()
    raise
finally:
    (OUT / 'cart-edit-races-report.json').write_text(json.dumps({'count':len(checks), 'passed':checks,
        'browserErrors':errors, 'failure':failure, 'network':'Synthetic local data only; no live account or cart.'}, indent=2) + '\n')
