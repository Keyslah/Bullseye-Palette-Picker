/**
 * Purpose: named settings presets, separate from photos, carts and working state.
 * Setup: Chrome local storage in the extension; localStorage only in previews.
 * Writes: explicit saves replace only a named preset with the same id.
 * Constraints: propagate storage failures; never send preferences over the network.
 */
import {normalizeSettings} from './settings.js';
export const PRESETS_KEY = 'bullseyeSettingsPresetsV1';
const inExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
let writes = Promise.resolve();
async function read() {
  const value = inExtension() ? (await chrome.storage.local.get(PRESETS_KEY))[PRESETS_KEY]
    : JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Saved settings could not be read.');
  return value.map(record => {
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') throw new Error('A saved settings preset is damaged.');
    return {...record, settings:normalizeSettings(record.settings)};
  });
}
export async function listSettingsPresets() {
  await writes.catch(() => {});
  return (await read()).sort((a,b) => b.updatedAt - a.updatedAt);
}
export function saveSettingsPreset(name, settings, id = null) {
  const action = writes.catch(() => {}).then(async () => {
    const clean = String(name || '').trim();
    if (!clean || clean.length > 80) throw new Error('Give these settings a name of 1 to 80 characters.');
    const normalized = normalizeSettings(settings), records = await read();
    const existing = id ? records.find(record => record.id === id) : null;
    if (id && !existing) throw new Error('These saved settings no longer exist. Save with a new name.');
    const record = {id:existing?.id || crypto.randomUUID(), name:clean, settings:normalized, updatedAt:Date.now()};
    const next = records.filter(value => value.id !== record.id).concat(record);
    if (inExtension()) await chrome.storage.local.set({[PRESETS_KEY]:next});
    else localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    return structuredClone(record);
  });
  writes = action;
  return action;
}
