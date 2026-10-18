/** Saved defaults are independent of workspaces and use only the active storage surface. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS, SETTINGS_KEY, normalizeSettings, loadSettings, saveSettings} from '../extension/lib/settings.js';

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {configurable:true, writable:true, value});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial)), calls = [];
  return {
    values, calls,
    getItem(key) { calls.push(['get',key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set',key]); values.set(key,value); },
  };
}

test('default settings use medium frit and 5 lb jars without sharing mutable objects', () => {
  assert.deepEqual(normalizeSettings(), {
    version:1, format:'medium', preferredJarSize:'5lb', glassTypes:{transparent:true,opalescent:true}, paletteCount:6,imageSize:'fit',
  });
  const first = normalizeSettings(), second = normalizeSettings();
  first.glassTypes.transparent = false;
  assert.equal(second.glassTypes.transparent, true);
  assert.equal(DEFAULT_SETTINGS.glassTypes.transparent, true);
});

test('settings retain every supported format, jar preference, and deliberate material exclusion', () => {
  for (const format of ['sheets','powder','fine','medium','coarse']) assert.equal(normalizeSettings({format}).format, format);
  assert.equal(normalizeSettings({format:'sheet'}).format, 'sheets');
  for (const preferredJarSize of ['5lb','1lb','5oz']) assert.equal(normalizeSettings({preferredJarSize}).preferredJarSize, preferredJarSize);
  assert.deepEqual(normalizeSettings({glassTypes:{transparent:false,opalescent:false}}).glassTypes, {transparent:false,opalescent:false});
  assert.deepEqual(normalizeSettings({glassTypes:{transparent:false}}).glassTypes, {transparent:false,opalescent:true});
  for (const imageSize of ['fit','larger','full']) assert.equal(normalizeSettings({imageSize}).imageSize, imageSize);
  for (const paletteCount of [2,12]) assert.equal(normalizeSettings({paletteCount}).paletteCount, paletteCount);
});

test('invalid explicit preferences are rejected instead of silently changing the saved choice', () => {
  for (const value of [null, [], 'medium', false]) assert.throws(() => normalizeSettings(value), /object/);
  for (const value of [0,2,'1']) assert.throws(() => normalizeSettings({version:value}), /version/);
  for (const format of ['clear','Medium',null,12]) assert.throws(() => normalizeSettings({format}), /glass format/);
  for (const preferredJarSize of ['5','5 lb','10lb',null]) assert.throws(() => normalizeSettings({preferredJarSize}), /jar size/);
  for (const glassTypes of [null,[],true]) assert.throws(() => normalizeSettings({glassTypes}), /glass types/);
  for (const type of ['transparent','opalescent']) assert.throws(() => normalizeSettings({glassTypes:{[type]:'false'}}), /on or off/);
  for (const paletteCount of [0,1,13,2.5,'6',Infinity,null]) assert.throws(() => normalizeSettings({paletteCount}), /2 and 12/);
  assert.throws(() => normalizeSettings({imageSize:'small'}), /image size/);
});

test('Chrome preference reads distinguish absence, normalize a partial record, and do not write', async t => {
  const calls = [], values = {};
  replaceGlobal(t, 'chrome', {runtime:{id:'settings-test'},storage:{local:{
    async get(key) { calls.push(['get',key]); return values; },
    async set() { throw new Error('Loading must not save settings.'); },
  }}});
  replaceGlobal(t, 'localStorage', {getItem() { throw new Error('Must not read preview storage.'); }});
  assert.equal(await loadSettings(), null);
  values[SETTINGS_KEY] = {format:'fine',glassTypes:{transparent:false}};
  const saved = await loadSettings();
  assert.equal(saved.format, 'fine');
  assert.equal(saved.preferredJarSize, '5lb');
  assert.deepEqual(saved.glassTypes, {transparent:false,opalescent:true});
  saved.glassTypes.transparent = true;
  assert.equal(values[SETTINGS_KEY].glassTypes.transparent, false);
  assert.deepEqual(calls, [['get',SETTINGS_KEY],['get',SETTINGS_KEY]]);
});

test('explicit Chrome saves write only preferences and preserve separate workspace and cart data', async t => {
  const values = {bullseyeProjectV1:{photo:'keep'},bullseyeCartJournalV1:[{status:'complete'}]}, writes = [];
  replaceGlobal(t, 'chrome', {runtime:{id:'settings-test'},storage:{local:{
    async get(key) { return {[key]:values[key]}; },
    async set(value) { writes.push(structuredClone(value)); Object.assign(values,structuredClone(value)); },
  }}});
  replaceGlobal(t, 'localStorage', {setItem() { throw new Error('Must not write preview storage.'); }});
  const source = {format:'coarse',preferredJarSize:'1lb',glassTypes:{transparent:false,opalescent:true},paletteCount:9,imageSize:'larger',sourceDataUrl:'private-photo',cart:['not-settings']};
  const result = await saveSettings(source);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), [SETTINGS_KEY]);
  assert.equal('sourceDataUrl' in values[SETTINGS_KEY], false);
  assert.equal('cart' in values[SETTINGS_KEY], false);
  assert.deepEqual(values.bullseyeProjectV1, {photo:'keep'});
  assert.deepEqual(values.bullseyeCartJournalV1, [{status:'complete'}]);
  assert.equal(result.format, 'coarse');
  result.glassTypes.transparent = true;
  assert.equal(source.glassTypes.transparent, false);
  assert.equal(values[SETTINGS_KEY].glassTypes.transparent, false);
  assert.equal((await loadSettings()).preferredJarSize, '1lb');
});

test('Chrome read/write failures propagate without falling back to preview storage', async t => {
  const denied = new Error('Chrome storage access denied.');
  const preview = memoryStorage();
  replaceGlobal(t, 'localStorage', preview);
  replaceGlobal(t, 'chrome', {runtime:{id:'settings-test'},storage:{local:{
    async get() { throw denied; }, async set() { throw denied; },
  }}});
  await assert.rejects(loadSettings(), error => error === denied);
  await assert.rejects(saveSettings({format:'powder'}), error => error === denied);
  assert.deepEqual(preview.calls, []);
  globalThis.chrome.storage = undefined;
  await assert.rejects(loadSettings(), /Chrome settings storage is unavailable/);
  await assert.rejects(saveSettings({}), /Chrome settings storage is unavailable/);
  assert.deepEqual(preview.calls, []);
});

test('preview preferences roundtrip in their own key without touching workspace data', async t => {
  replaceGlobal(t, 'chrome', undefined);
  const preview = memoryStorage({bullseyeProjectV1:'{"photo":"keep"}'});
  replaceGlobal(t, 'localStorage', preview);
  assert.equal(await loadSettings(), null);
  await saveSettings({format:'sheets',preferredJarSize:'5oz',imageSize:'full'});
  const saved = await loadSettings();
  assert.equal(saved.format, 'sheets');
  assert.equal(saved.preferredJarSize, '5oz');
  assert.equal(saved.imageSize, 'full');
  assert.equal(preview.values.get('bullseyeProjectV1'), '{"photo":"keep"}');
  assert.deepEqual(preview.calls, [['get',SETTINGS_KEY],['set',SETTINGS_KEY],['get',SETTINGS_KEY]]);
});

test('corrupt stored preferences are reported without overwriting them', async t => {
  replaceGlobal(t, 'chrome', undefined);
  const preview = memoryStorage({[SETTINGS_KEY]:'{broken JSON'});
  replaceGlobal(t, 'localStorage', preview);
  await assert.rejects(loadSettings(), SyntaxError);
  assert.equal(preview.values.get(SETTINGS_KEY), '{broken JSON');
  preview.values.set(SETTINGS_KEY, JSON.stringify({format:'unknown'}));
  await assert.rejects(loadSettings(), /glass format/);
  assert.ok(preview.calls.every(([action]) => action === 'get'));
});

test('invalid settings fail before a storage write and preview write errors remain visible', async t => {
  let writes = 0;
  replaceGlobal(t, 'chrome', {runtime:{id:'settings-test'},storage:{local:{async set() { writes++; }}}});
  await assert.rejects(saveSettings({preferredJarSize:'invalid'}), /jar size/);
  assert.equal(writes, 0);
  replaceGlobal(t, 'localStorage', {setItem() { throw new Error('Preview storage quota reached.'); }});
  globalThis.chrome = undefined;
  await assert.rejects(saveSettings({}), /quota reached/);
});
