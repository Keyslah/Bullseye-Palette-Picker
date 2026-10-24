/**
 * Purpose: verify complete personal-data backups, validation and merge-only restore.
 * Setup: node --test; isolated memory browser storage and deterministic photo data.
 * Writes: disposable test memory only; no user's profile or Bullseye store access.
 * Constraints: native IndexedDB behavior is also checked by personal-data-browser.py.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAL_DATA_FORMAT, PERSONAL_DATA_VERSION, normalizePersonalDataBackup,
  createPersonalDataBackup, restorePersonalDataBackup,
} from '../extension/lib/personal-data.js';

const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const item = {productId:'000100', variantId:52850314739985, quantity:3, name:'Black', title:'5 lb. jar', form:'fine', available:true};
const workspace = {
  version:6, sourceDataUrl:photo, thumbnailDataUrl:photo, sourceName:'My glass design',
  sourceUrl:'https://example.invalid/inspiration', glassTypes:{transparent:true,opalescent:false},
  imageSize:'fit', format:'fine', preferredJarSize:'1lb', includeTints:true,
  targets:[{id:'black', rgb:[4,5,6], x:0.2, y:0.8, manual:true}], chosenMatches:{black:'000100'},
  selectedForms:{'000100':'fine'}, selectedVariants:{'000100':String(item.variantId)}, cart:[item],
};
const backup = () => ({
  format:PERSONAL_DATA_FORMAT, version:PERSONAL_DATA_VERSION, exportedAt:'2026-10-24T00:00:00.000Z', extensionVersion:'0.6.6',
  local:{
    bullseyeProjectV1:structuredClone(workspace),
    bullseyeSettingsV1:{format:'fine', preferredJarSize:'1lb', glassTypes:{transparent:true,opalescent:false}, imageSize:'fit', includeTints:true, showFullPalette:false},
    bullseyeSettingsPresetsV1:[{id:'settings-one',name:'My settings',settings:{format:'powder',imageSize:'full'},updatedAt:100}],
    bullseyeWorkingCartV1:{id:null,name:'Current cart',items:[{...item,quantity:5}],createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-24T00:00:00.000Z'},
  },
  palettes:[{metadata:{id:'palette-one',name:'Glass design',updatedAt:100,thumbnailDataUrl:photo},workspace:structuredClone(workspace)}],
  carts:[{id:'cart-one',name:'Fine black',items:[item],createdAt:100,updatedAt:200}],
});
function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {configurable:true, writable:true, value});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

// Transactions stage their writes and only commit at oncomplete, so aborted writes
// cannot pass restore's success checks. This is not used in place of native QA.
function storageHarness(t, local = {}, initial = {}) {
  const values = structuredClone(local), databases = structuredClone(initial), writes = [], calls = [];
  let nextWriteFailure = null;
  replaceGlobal(t, 'chrome', {runtime:{id:'personal-data-test',getManifest:()=>({version:'0.6.7'})},storage:{local:{
    async get(keys) { calls.push(['get',keys]); return Object.fromEntries(keys.filter(key => Object.hasOwn(values,key)).map(key => [key,structuredClone(values[key])])); },
    async set(data) { calls.push(['set',data]); Object.assign(values,structuredClone(data)); },
  }}});
  replaceGlobal(t, 'localStorage', {getItem() { throw new Error('Chrome must not use preview storage.'); },setItem() { throw new Error('Chrome must not use preview storage.'); }});
  replaceGlobal(t, 'indexedDB', {open(name) {
    calls.push(['open',name]);
    databases[name] ||= name === 'bullseyeSavedPalettes' ? {metadata:[],workspaces:[]} : {carts:[]};
    const request = {result:{close() {},transaction(stores,mode) {
      const staged = [], result = {error:null};
      let aborted = false;
      result.abort = () => { aborted=true;queueMicrotask(()=>result.onabort?.()); };
      result.objectStore = store => ({
        getAll() {
          const read = {};
          queueMicrotask(()=>{read.result=structuredClone(databases[name][store]);read.onsuccess?.();});
          return read;
        },
        put(value) { staged.push([store,structuredClone(value)]); },
      });
      setTimeout(() => {
        if (aborted) return;
        if (mode === 'readwrite' && nextWriteFailure) {
          result.error=nextWriteFailure;nextWriteFailure=null;result.onabort?.();return;
        }
        for (const [store,value] of staged) {
          writes.push([name,store,value]);
          databases[name][store]=databases[name][store].filter(record=>record.id!==value.id).concat(value);
        }
        result.oncomplete?.();
      },0);
      return result;
    }}};
    queueMicrotask(()=>request.onsuccess?.());return request;
  }});
  return {values,databases,writes,calls,failNextWrite(error){nextWriteFailure=error;}};
}

test('backup preserves photo pixels, points, package choices, working cart and every preference', () => {
  const source = backup(), result = normalizePersonalDataBackup(JSON.stringify(source));
  assert.equal(result.palettes[0].workspace.sourceDataUrl, photo);
  assert.equal(result.palettes[0].metadata.thumbnailDataUrl, photo);
  assert.deepEqual(result.local.bullseyeProjectV1.targets, workspace.targets);
  assert.deepEqual(result.local.bullseyeProjectV1.chosenMatches, workspace.chosenMatches);
  assert.deepEqual(result.local.bullseyeProjectV1.selectedForms, {'000100':'fine'});
  assert.equal(result.local.bullseyeSettingsV1.showFullPalette, false);
  assert.equal(result.local.bullseyeSettingsV1.glassTypes.opalescent, false);
  assert.equal(result.local.bullseyeSettingsV1.imageSize, 'fit');
  assert.equal(result.local.bullseyeWorkingCartV1.items[0].quantity, 5);
  assert.equal(result.carts[0].items[0].variantId, item.variantId);
  result.local.bullseyeProjectV1.targets[0].x = 1;
  result.palettes[0].workspace.chosenMatches.black = 'another';
  assert.equal(source.local.bullseyeProjectV1.targets[0].x, 0.2);
  assert.equal(source.palettes[0].workspace.chosenMatches.black, '000100');
});

test('backup whitelist excludes account, session and old cart-request journal data', () => {
  const source = backup();
  Object.assign(source.local, {bullseyeCartRequestsV1:{requestId:'do-not-transfer'},pendingImage:{sourceUrl:'private'},account:{email:'private'}});
  source.carts[0].items[0] = {...item,accessToken:'do-not-transfer'};
  const result = normalizePersonalDataBackup(source), serialized = JSON.stringify(result);
  assert.deepEqual(Object.keys(result.local).sort(), ['bullseyeProjectV1','bullseyeSettingsV1','bullseyeSettingsPresetsV1','bullseyeWorkingCartV1'].sort());
  assert.ok(!serialized.includes('do-not-transfer'));
  assert.ok(!serialized.includes('accessToken'));
});

test('bad schema and invalid nested records are rejected before any storage access', async t => {
  const harness = storageHarness(t);
  const invalid = [null, '{broken', {...backup(),format:'another-app'}, {...backup(),version:2}];
  const badQuantity=backup();badQuantity.local.bullseyeWorkingCartV1.items[0].quantity=0;invalid.push(badQuantity);
  const badColor=backup();badColor.palettes[0].workspace.targets[0].rgb=[1,2,400];invalid.push(badColor);
  const remoteImage=backup();remoteImage.palettes[0].workspace.sourceDataUrl='https://tracking.invalid/photo.png';invalid.push(remoteImage);
  const duplicate=backup();duplicate.carts.push(structuredClone(duplicate.carts[0]));invalid.push(duplicate);
  const malformedSettings=backup();malformedSettings.local.bullseyeSettingsV1.format='unknown';invalid.push(malformedSettings);
  for (const value of invalid) await assert.rejects(restorePersonalDataBackup(value));
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.writes, []);
});

test('restore merges named records without deleting unrelated palettes, carts, presets or storage', async t => {
  const preservedPalette={id:'keep-palette',name:'Keep my palette',updatedAt:1};
  const preservedCart={id:'keep-cart',name:'Keep my cart',items:[],createdAt:1,updatedAt:1};
  const harness=storageHarness(t, {
    unrelated:{keep:true}, bullseyeCartRequestsV1:[{id:'keep-journal'}],
    bullseyeSettingsPresetsV1:[{id:'keep-settings',name:'Keep my settings',settings:{format:'coarse'},updatedAt:1},
      {id:'settings-one',name:'Old same ID',settings:{format:'medium'},updatedAt:1}],
  }, {
    bullseyeSavedPalettes:{metadata:[preservedPalette],workspaces:[{id:'keep-palette',workspace:{targets:[]}}]},
    bullseyeSavedCarts:{carts:[preservedCart]},
  });
  const result=await restorePersonalDataBackup(backup());
  assert.deepEqual(result,{palettes:1,carts:1,settingsPresets:1,requiresReload:true});
  assert.equal(harness.databases.bullseyeSavedPalettes.metadata.length,2);
  assert.deepEqual(harness.databases.bullseyeSavedPalettes.metadata.find(record=>record.id==='keep-palette'),preservedPalette);
  assert.equal(harness.databases.bullseyeSavedPalettes.workspaces.find(record=>record.id==='palette-one').workspace.sourceDataUrl,photo);
  assert.deepEqual(harness.databases.bullseyeSavedCarts.carts.find(record=>record.id==='keep-cart'),preservedCart);
  assert.equal(harness.values.bullseyeSettingsPresetsV1.length,2);
  assert.equal(harness.values.bullseyeSettingsPresetsV1.find(record=>record.id==='settings-one').name,'My settings');
  assert.deepEqual(harness.values.unrelated,{keep:true});
  assert.deepEqual(harness.values.bullseyeCartRequestsV1,[{id:'keep-journal'}]);
  assert.equal(harness.values.bullseyeWorkingCartV1.items[0].quantity,5);
});

test('an exported snapshot round-trips named records and photos through the browser stores', async t => {
  const harness=storageHarness(t);
  await restorePersonalDataBackup(backup());
  const result=await createPersonalDataBackup();
  assert.equal(result.extensionVersion,'0.6.7');
  assert.ok(Number.isFinite(Date.parse(result.exportedAt)));
  for (const key of ['local','palettes','carts']) assert.deepEqual(result[key],normalizePersonalDataBackup(backup())[key]);
  assert.equal(harness.databases.bullseyeSavedCarts.carts.length,1);
  await restorePersonalDataBackup(result);
  assert.equal(harness.databases.bullseyeSavedCarts.carts.length,1,'Restoring twice must not duplicate named carts.');
  assert.equal(harness.values.bullseyeSettingsPresetsV1.length,1,'Restoring twice must not duplicate presets.');
});

test('missing data in a backup leaves current defaults and working cart untouched', async t => {
  const harness=storageHarness(t,{bullseyeSettingsV1:{format:'coarse'},bullseyeWorkingCartV1:{id:null,name:'Keep',items:[item]}});
  const minimal={format:PERSONAL_DATA_FORMAT,version:1,local:{},palettes:[],carts:[]};
  await restorePersonalDataBackup(minimal);
  assert.deepEqual(harness.values.bullseyeSettingsV1,{format:'coarse'});
  assert.equal(harness.values.bullseyeWorkingCartV1.name,'Keep');
  assert.ok(!harness.calls.some(([method])=>method==='set'));
});

test('storage read errors do not overwrite data or fall back to preview storage', async t => {
  const harness=storageHarness(t), error=new Error('Storage unavailable');
  globalThis.chrome.storage.local.get=async()=>{throw error;};
  await assert.rejects(restorePersonalDataBackup(backup()),value=>value===error);
  assert.deepEqual(harness.writes,[]);
  await assert.rejects(createPersonalDataBackup(),value=>value===error);
  assert.deepEqual(harness.writes,[]);
});

test('aborted writes report failure and do not claim the backup was restored', async t => {
  const harness=storageHarness(t), error=new Error('Storage quota reached');
  harness.failNextWrite(error);
  await assert.rejects(restorePersonalDataBackup(backup()),value=>value.cause===error && /Restore did not finish/.test(value.message));
  assert.deepEqual(harness.writes,[]);
  assert.ok(!harness.calls.some(([method])=>method==='set'));
});
