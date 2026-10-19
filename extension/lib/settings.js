/**
 * Explicitly saved defaults for future palettes. Kept apart from the current
 * workspace, named photo palettes, and named carts; no account or network calls.
 * Chrome storage failures propagate and never fall back to preview storage.
 */
export const SETTINGS_KEY = 'bullseyeSettingsV1';
export const DEFAULT_SETTINGS = Object.freeze({
  version:1, format:'medium', preferredJarSize:'5lb',
  glassTypes:Object.freeze({transparent:true, opalescent:true}),
  paletteCount:6, imageSize:'larger', includeTints:false, showFullPalette:true,
});

function option(value, allowed, fallback, label) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`Choose a valid ${label}.`);
  return value;
}

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object.');
  if (value.version !== undefined && value.version !== 1) throw new Error('This settings version is not supported.');
  const types = value.glassTypes === undefined ? {} : value.glassTypes;
  if (!types || typeof types !== 'object' || Array.isArray(types)) throw new Error('Choose valid glass types.');
  for (const type of ['transparent','opalescent']) {
    if (types[type] !== undefined && typeof types[type] !== 'boolean') throw new Error('Glass type settings must be on or off.');
  }
  const paletteCount = value.paletteCount === undefined ? DEFAULT_SETTINGS.paletteCount : value.paletteCount;
  if (!Number.isInteger(paletteCount) || paletteCount < 2 || paletteCount > 12) {
    throw new Error('Choose between 2 and 12 starting palette colors.');
  }
  for (const flag of ['includeTints','showFullPalette']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Error('View settings must be on or off.');
  }
  return {
    version:1,
    includeTints:value.includeTints ?? false, showFullPalette:value.showFullPalette ?? true,
    format:option(value.format === 'sheet' ? 'sheets' : value.format, ['sheets','powder','fine','medium','coarse'], DEFAULT_SETTINGS.format, 'glass format'),
    preferredJarSize:option(value.preferredJarSize, ['5lb','1lb','5oz'], DEFAULT_SETTINGS.preferredJarSize, 'default jar size'),
    glassTypes:{transparent:types.transparent ?? true, opalescent:types.opalescent ?? true},
    paletteCount,
    imageSize:option(value.imageSize, ['fit','larger','full'], DEFAULT_SETTINGS.imageSize, 'image size'),
  };
}

const hasExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

function chromeStore(method) {
  const store = chrome.storage?.local;
  if (typeof store?.[method] !== 'function') throw new Error('Chrome settings storage is unavailable. Reload the extension.');
  return store;
}

function previewStore() {
  if (!globalThis.localStorage) throw new Error('Settings are unavailable in this browser.');
  return globalThis.localStorage;
}

/** Absence is distinct from defaults, so a restored workspace can retain its choices. */
export async function loadSettings() {
  let saved;
  if (hasExtension()) {
    const result = await chromeStore('get').get(SETTINGS_KEY);
    saved = result?.[SETTINGS_KEY];
  } else {
    const text = previewStore().getItem(SETTINGS_KEY);
    if (text === null || text === undefined) return null;
    saved = JSON.parse(text);
  }
  return saved === undefined || saved === null ? null : normalizeSettings(saved);
}

/** Call only for an explicit Save settings action. Loading never rewrites preferences. */
export async function saveSettings(settings) {
  const saved = normalizeSettings(settings);
  if (hasExtension()) await chromeStore('set').set({[SETTINGS_KEY]:saved});
  else previewStore().setItem(SETTINGS_KEY, JSON.stringify(saved));
  return normalizeSettings(saved);
}
