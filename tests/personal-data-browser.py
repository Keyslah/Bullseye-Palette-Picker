"""Purpose: verify personal-data retention across an in-place version update and restore.
Setup: Python Playwright with Chromium; actual storage modules run in a tiny MV3 harness.
Writes: disposable extension folders/profiles and test-results/personal-data-report.json.
Constraints: no real Chrome profile, account, website requests or purchase actions.
"""
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
checks = []
errors = []


def passed(name):
    checks.append(name)
    print('PASS:', name, flush=True)


def launch(playwright, profile, extension, page_path='personal-data-test.html'):
    context = playwright.chromium.launch_persistent_context(
        str(profile), channel='chromium', headless=True,
        args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
    context.route('http://**', lambda route: route.abort())
    context.route('https://**', lambda route: route.abort())
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    extension_id = worker.url.split('/')[2]
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'chrome-extension://{extension_id}/{page_path}')
    return context, page, extension_id


def snapshot(page):
    return page.evaluate("async () => (await import('./lib/personal-data.js')).createPersonalDataBackup()")


failure = None
try:
    with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
        temporary = Path(folder)
        extension = temporary / 'installed-extension'
        extension.mkdir()
        shutil.copytree(ROOT / 'extension/lib', extension / 'lib')
        manifest = {'manifest_version': 3, 'name': 'Personal-data isolated test', 'version': '0.6.6',
                    'permissions': ['storage'], 'background': {'service_worker': 'worker.js'}}
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        (extension / 'worker.js').write_text('chrome.runtime.onInstalled.addListener(() => {});\n')
        (extension / 'personal-data-test.html').write_text('<!doctype html><title>Isolated storage test</title>')
        profile = temporary / 'profile'
        context, page, original_id = launch(playwright, profile, extension)
        page.evaluate("""async () => {
          const palettes = await import('./lib/saved-palettes.js');
          const carts = await import('./lib/saved-carts.js');
          const settings = await import('./lib/settings.js');
          const presets = await import('./lib/settings-presets.js');
          const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
          const item = {productId:'000100',variantId:52850314739985,quantity:3,name:'Black',form:'fine',title:'5 lb. jar',available:true};
          const workspace = {version:6,format:'fine',preferredJarSize:'1lb',sourceDataUrl:image,thumbnailDataUrl:image,
            imageSize:'fit',includeTints:true,glassTypes:{transparent:true,opalescent:false},
            targets:[{id:'black',rgb:[4,5,6],hex:'#040506',x:0.25,y:0.75,manual:true}],
            chosenMatches:{black:'000100'},selectedForms:{'000100':'fine'},cart:[item]};
          await settings.saveSettings({format:'fine',preferredJarSize:'1lb',imageSize:'fit',showFullPalette:false,
            includeTints:true,glassTypes:{transparent:true,opalescent:false}});
          await presets.saveSettingsPreset('My powder settings',{format:'powder',imageSize:'full'});
          await palettes.savePalette('My saved photo',workspace);
          await carts.saveCart('My saved black',[item]);
          await chrome.storage.local.set({bullseyeProjectV1:workspace,
            bullseyeWorkingCartV1:{version:1,id:null,name:'Working cart',items:[{...item,quantity:5}],dirty:true,createdAt:100,updatedAt:200},
            bullseyeCartRequestsV1:[{requestId:'must-stay-local',status:'completed'}]});
        }""")
        original = snapshot(page)
        assert len(original['palettes']) == len(original['carts']) == 1
        assert len(original['local']['bullseyeSettingsPresetsV1']) == 1
        assert original['local']['bullseyeWorkingCartV1']['items'][0]['quantity'] == 5
        assert 'must-stay-local' not in json.dumps(original)
        passed('Native extension backup includes all personal choices, photos, saved records and working cart only')
        context.close()

        manifest['version'] = '0.6.7'
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        context, page, updated_id = launch(playwright, profile, extension)
        updated = snapshot(page)
        assert updated_id == original_id
        assert updated['extensionVersion'] == '0.6.7'
        for key in ['local', 'palettes', 'carts']:
            assert updated[key] == original[key], key
        passed('In-place version update and browser restart preserve the ID, settings, photos, palettes and carts exactly')

        page.evaluate("""async () => {
          const palettes = await import('./lib/saved-palettes.js');
          const carts = await import('./lib/saved-carts.js');
          const presets = await import('./lib/settings-presets.js');
          await palettes.savePalette('Keep unrelated palette',{targets:[{id:'p',rgb:[1,2,3],hex:'#010203'}],cart:[]});
          await carts.saveCart('Keep unrelated cart',[]);
          await presets.saveSettingsPreset('Keep unrelated settings',{format:'coarse'});
        }""")
        result = page.evaluate("async data => (await import('./lib/personal-data.js')).restorePersonalDataBackup(data)", original)
        assert result['requiresReload'] is True
        page.reload()
        restored = snapshot(page)
        assert len(restored['palettes']) == len(restored['carts']) == 2
        assert len(restored['local']['bullseyeSettingsPresetsV1']) == 2
        original_palette = next(record for record in restored['palettes'] if record['metadata']['id'] == original['palettes'][0]['metadata']['id'])
        assert original_palette == original['palettes'][0]
        assert restored['local']['bullseyeProjectV1'] == original['local']['bullseyeProjectV1']
        assert page.evaluate("async()=> (await chrome.storage.local.get('bullseyeCartRequestsV1')).bullseyeCartRequestsV1[0].requestId") == 'must-stay-local'
        passed('Restore merges named records without deleting unrelated data or replacing the cart-request journal')
        context.close()

        moved = temporary / 'different-install-folder'
        shutil.copytree(extension, moved)
        context, page, moved_id = launch(playwright, profile, moved)
        assert moved_id != original_id
        empty = snapshot(page)
        assert empty['local'] == {} and empty['palettes'] == [] and empty['carts'] == []
        page.evaluate("""async data => {
          const session=await import('./lib/personal-data-session.js');
          const personal=await import('./lib/personal-data.js');
          return session.runPersonalDataRestore(()=>personal.restorePersonalDataBackup(data));
        }""", original)
        page.reload()
        moved_snapshot = snapshot(page)
        for key in ['local', 'palettes', 'carts']:
            assert moved_snapshot[key] == original[key], key
        passed('Backup restores the entire personal workspace into a different unpacked-extension identity')

        other = context.new_page()
        other.goto(page.url)
        for tab in [page, other]:
            tab.evaluate("""async () => {
              window.sessionEvents=[];
              window.personalSession=await import('./lib/personal-data-session.js');
              await personalSession.initPersonalDataSession({onPause:()=>sessionEvents.push('pause'),onComplete:()=>sessionEvents.push('complete')});
            }""")
        page.evaluate("""() => {
          window.oldWrite=personalSession.guardPersonalDataWrite(async()=>{
            window.writeStarted=true;
            await new Promise(resolve=>window.releaseWrite=resolve);
            await chrome.storage.local.set({bullseyeProjectV1:{targets:[],sourceName:'Older queued write'}});
          });
        }""")
        page.wait_for_function('window.writeStarted === true')
        other.evaluate("""() => {
          window.restoreTask=personalSession.runPersonalDataRestore(async()=>{
            window.restoreStarted=true;
            await chrome.storage.local.set({bullseyeProjectV1:{targets:[],sourceName:'Restored data wins'}});
          });
        }""")
        other.wait_for_timeout(100)
        assert not other.evaluate('window.restoreStarted === true')
        page.evaluate('window.releaseWrite()')
        page.evaluate('window.oldWrite')
        other.evaluate('window.restoreTask')
        page.wait_for_function("sessionEvents.includes('complete')")
        assert page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1.sourceName") == 'Restored data wins'
        rejected = page.evaluate("""async()=>{
          try{await personalSession.guardPersonalDataWrite(()=>chrome.storage.local.set({bullseyeProjectV1:{sourceName:'Stale overwrite'}}));return false;}
          catch(error){return /Reload/.test(error.message);}
        }""")
        assert rejected
        assert page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1.sourceName") == 'Restored data wins'
        passed('Restore drains in-flight writes, pauses other tabs and rejects stale-generation writes afterward')
        context.close()

        # Exercise the actual picker controls after the isolated storage contracts.
        context, page, real_id = launch(playwright, temporary / 'real-profile', ROOT / 'extension', 'picker.html?workspace=1')
        worker = context.service_workers[0]
        worker.evaluate("() => { globalThis.fetch=async()=>{throw new Error('No external requests in persistence QA.');}; }")
        expect(page.locator('#form-medium')).to_be_enabled()
        page.evaluate("""async data => {
          const session=await import('./lib/personal-data-session.js');
          const personal=await import('./lib/personal-data.js');
          return session.runPersonalDataRestore(()=>personal.restorePersonalDataBackup(data));
        }""", original)
        page.reload()
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed','false')
        expect(page.locator('#image-fit')).to_have_attribute('aria-pressed','true')
        expect(page.locator('#cart-count')).to_have_text('5')
        page.locator('#settings-menu summary').click()
        with page.expect_download() as downloading:
            page.locator('#export-personal-data').click()
        download = downloading.value
        backup_path = temporary / 'ui-backup.json'
        download.save_as(backup_path)
        ui_backup = json.loads(backup_path.read_text())
        assert ui_backup['format'] == 'bullseye-palette-picker-personal-data'
        assert ui_backup['local']['bullseyeProjectV1']['glassTypes']['opalescent'] is False
        assert ui_backup['local']['bullseyeProjectV1']['sourceDataUrl'].startswith('data:image/png;base64,')
        assert len(ui_backup['palettes']) == len(ui_backup['carts']) == 1
        passed('Actual Settings Back up my data button downloads the full personal-data JSON')

        second = context.new_page()
        second.goto(page.url)
        expect(second.locator('#form-fine')).to_be_enabled()
        second.locator('#include-opalescent').click()
        expect(second.locator('#include-opalescent')).to_have_attribute('aria-pressed','true')
        second.wait_for_timeout(350)
        page.on('dialog',lambda dialog:dialog.accept())
        with page.expect_navigation(wait_until='domcontentloaded'):
            page.locator('#personal-data-file').set_input_files(backup_path)
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed','false')
        expect(second.locator('#include-opalescent')).to_have_attribute('aria-pressed','false')
        assert page.evaluate('document.body.inert') is False
        assert second.evaluate('document.body.inert') is False
        expect(page.locator('#cart-count')).to_have_text('5')
        page.wait_for_timeout(350)
        assert page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1.glassTypes.opalescent") is False
        passed('Actual Restore my data flow reloads every open picker and preserves restored settings and cart count')

        # Delay the worker's guard itself, then destroy the sending picker before
        # its save can run. The next page must wait for that queued final snapshot.
        worker.evaluate("""() => {
          const read=chrome.storage.local.get.bind(chrome.storage.local);
          globalThis.originalWorkspaceRead=read;
          globalThis.workspaceWriteBlocked=false;
          let delay=true;
          chrome.storage.local.get=async key=>{
            if(key==='bullseyePersonalDataGenerationV1' && delay){
              delay=false;globalThis.workspaceWriteBlocked=true;
              await new Promise(resolve=>{globalThis.releaseWorkspaceWrite=resolve;});
            }
            return read(key);
          };
        }""")
        with page.expect_navigation(wait_until='domcontentloaded'):
            page.evaluate("() => {document.getElementById('form-powder').click();location.reload();}")
        for attempt in range(40):
            if worker.evaluate('globalThis.workspaceWriteBlocked === true'):
                break
            page.wait_for_timeout(25)
        assert worker.evaluate('globalThis.workspaceWriteBlocked === true'), 'The old picker did not hand off its pagehide save.'
        assert worker.evaluate("async()=> (await originalWorkspaceRead('bullseyeProjectV1')).bullseyeProjectV1.format") == 'fine'
        worker.evaluate('globalThis.releaseWorkspaceWrite()')
        expect(page.locator('#form-powder')).to_have_attribute('aria-pressed','true')
        assert page.evaluate("async()=> (await chrome.storage.local.get('bullseyeProjectV1')).bullseyeProjectV1.format") == 'powder'
        expect(page.locator('#include-opalescent')).to_have_attribute('aria-pressed','false')
        passed('Immediate reload keeps the final form selection while the old page’s worker save is deliberately blocked')
        context.close()
        assert not errors, errors
except Exception as error:
    failure = str(error)
    raise
finally:
    (OUT / 'personal-data-report.json').write_text(json.dumps({
        'checks': checks, 'count': len(checks), 'failure': failure, 'browserErrors': errors,
        'scope': 'Disposable local MV3 test harness using the actual storage modules; no network requests.',
    }, indent=2) + '\n')
