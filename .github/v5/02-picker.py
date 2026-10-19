"""Purpose: add v5 picker controls, named settings and responsive image layout.
Setup: apply after 01-core.py to the inspected v4 picker implementation.
Writes: picker source, one settings dialog module and an isolated v5 stylesheet.
Constraints: Refresh/preset loading preserve photo pixels, target colors and points.
"""
from pathlib import Path

def change(path, old, new):
    file=Path(path); text=file.read_text()
    assert old in text, f'Missing patch anchor in {path}: {old[:100]}'
    file.write_text(text.replace(old,new,1))

Path('extension/lib/settings-dialog.js').write_text('''/**
 * Purpose: always ask for a name when saving settings; list/load independent presets.
 * Setup: initialized once by picker.js with state callbacks; creates its own dialog.
 * Writes: only explicit Save writes preset/default keys. Loading changes working settings.
 * Constraints: no images, colors, dots, carts, remote data, or inline script handlers.
 */
import {listSettingsPresets, saveSettingsPreset} from './settings-presets.js';
import {saveSettings} from './settings.js';
export function initializeSettingsDialog({getSettings, applySettings, onSaved, notify}) {
  const node=(tag,text)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;};
  const dialog=node('dialog');dialog.id='settings-dialog';dialog.className='saved-dialog';
  const shell=node('div');shell.className='dialog-shell';
  const heading=node('div');heading.className='dialog-heading';
  const title=node('h2','Load settings');title.id='settings-dialog-title';dialog.setAttribute('aria-labelledby',title.id);
  const close=node('button','×');close.type='button';close.className='icon-button';close.setAttribute('aria-label','Close settings');close.addEventListener('click',()=>dialog.close());heading.append(title,close);
  const form=node('form');form.id='save-settings-form';form.className='save-palette-form';
  const label=node('label','Settings name');label.htmlFor='settings-name';
  const line=node('div'),input=node('input');input.id='settings-name';input.required=true;input.maxLength=80;input.placeholder='For example: Fine transparent glass';
  const save=node('button','Save settings');save.id='confirm-save-settings';save.type='submit';save.className='button primary-button';line.append(input,save);form.append(label,line);
  const status=node('p');status.id='settings-dialog-message';status.setAttribute('role','status');
  const list=node('div');list.id='settings-list';
  shell.append(heading,form,status,list);dialog.append(shell);document.body.append(dialog);
  let presetId=null,presetName='',busy=false,request=0;
  async function render() {
    const own=++request;list.replaceChildren(node('p','Loading saved settings…'));
    try {
      const presets=await listSettingsPresets();if(own!==request)return;
      list.replaceChildren();if(!presets.length)list.append(node('p','No named settings saved yet.'));
      for(const preset of presets){
        const row=node('div');row.className='settings-preset-row';
        const description=node('div');description.append(node('strong',preset.name),node('p',`${preset.settings.format} · ${preset.settings.preferredJarSize} · ${preset.settings.paletteCount} starting colors`));
        const load=node('button','Load');load.type='button';load.className='button secondary-button';load.setAttribute('aria-label',`Load settings ${preset.name}`);
        load.addEventListener('click',()=>{if(busy)return;try{applySettings(preset.settings);presetId=preset.id;presetName=preset.name;dialog.close();notify(`Loaded settings “${preset.name}”. Your photo, colors and dots were kept.`);}catch(error){status.textContent=error.message;}});
        row.append(description,load);list.append(row);
      }
    }catch(error){if(own===request)list.replaceChildren(node('p',error.message));}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;save.disabled=true;close.disabled=true;status.textContent='Saving…';
    try {
      const name=input.value.trim();const preset=await saveSettingsPreset(name,getSettings(),name===presetName?presetId:null);
      presetId=preset.id;presetName=preset.name;
      try {const saved=await saveSettings(preset.settings);onSaved(saved);status.textContent='Saved.';dialog.close();notify(`Saved settings “${preset.name}”.`);}
      catch(error){status.textContent=`The named preset was saved, but default settings were not updated: ${error.message}`;}
    }catch(error){status.textContent=error.message;}
    finally{busy=false;save.disabled=false;close.disabled=false;}
  });
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  return {open(saving=false){title.textContent=saving?'Save settings':'Load settings';form.hidden=!saving;input.value=presetName;status.textContent='';if(!dialog.open)dialog.showModal();render();if(saving)input.select();}};
}
''')

file='extension/picker.js'
change(file, "import {loadSettings, saveSettings, normalizeSettings} from './lib/settings.js';", "import {loadSettings, normalizeSettings, DEFAULT_SETTINGS} from './lib/settings.js';\nimport {includedGlass} from './lib/material-filters.js';\nimport {initializeSettingsDialog} from './lib/settings-dialog.js';")
change(file, "glassTypes: {transparent: true, opalescent: true}, imageSize: 'fit',", "glassTypes: {transparent: true, opalescent: true}, includeTints:false, imageSize: 'fit',")
change(file, "let savedSettingsFingerprint = '', settingsSaving = false;", "let savedSettingsFingerprint = '', settingsSaving = false, settingsDialog = null;\nconst isCartPage = new URLSearchParams(location.search).get('cart') === '1';\ndocument.body.classList.toggle('cart-page',isCartPage);")
change(file, 'glassTypes:state.glassTypes,paletteCount:state.paletteCount,imageSize:state.imageSize}); }', "glassTypes:state.glassTypes,includeTints:state.includeTints,showFullPalette:state.view!=='alternatives',paletteCount:state.paletteCount,imageSize:state.imageSize}); }")
text=Path(file).read_text();start=text.index('async function saveCurrentSettings() {');end=text.index('function workspaceSnapshot()',start)
text=text[:start]+'''function saveCurrentSettings() { settingsDialog.open(true); }
function applyWorkingSettings(value) {
  if(state.sending)throw new Error('Wait for the current cart addition to finish.');
  const settings=normalizeSettings(value);
  state.glassTypes={...settings.glassTypes};state.includeTints=settings.includeTints;
  state.paletteCount=settings.paletteCount;state.imageSize=settings.imageSize;
  state.query='';$('glass-search').value='';
  state.view=settings.showFullPalette || !activeTarget()?'palette':'alternatives';
  changePurchaseOptions(settings.format,settings.preferredJarSize,true);
  renderAll();persist();
}
function refreshWorkingSettings() {
  try{applyWorkingSettings(DEFAULT_SETTINGS);notify('Settings reset. Your photo, colors and dot positions were kept.');}
  catch(error){notify(error.message,true);}
}
function remixPalette() {
  if(!state.imageData || state.sending)return;
  const seed=crypto.getRandomValues(new Uint32Array(1))[0];
  state.targets=[];state.activeTargetId=null;state.chosenMatches={};state.view='palette';
  state.savedPaletteId=null;state.savedPaletteName='';
  extractStartingColors(false,seed);notify('Remixed a new palette from the same image.');
}
''' +text[end:];Path(file).write_text(text)
change(file, "version:4, format:state.format", "version:5, includeTints:state.includeTints, format:state.format")
change(file, "function persist() { renderSettings();", "function persist() { renderSettings(); if(isCartPage)return;")
change(file, "  state.format = normalizeForm(saved.format || 'medium');", "  state.includeTints = saved.includeTints === true;\n  state.format = normalizeForm(saved.format || 'medium');")
change(file, "    button.addEventListener('click', () => selectTarget(target.id)); chips.append(button);", "    button.addEventListener('click', () => selectTarget(target.id)); chips.append(button);\n    if(index===0)chips.append($('show-full-palette').closest('label')); ")
# Keep the persistent checkbox and its handler before replacing palette chips.
change(file, "const chips = $('palette-chips'); chips.replaceChildren();", "const chips = $('palette-chips'); document.querySelector('.palette-navigation').append($('show-full-palette').closest('label')); chips.replaceChildren();")
change(file, "  $('save-palette').disabled = !state.targets.length;", "  $('save-palette').disabled = !state.targets.length;\n  $('remix-palette').disabled = !state.imageData || state.sending;")
change(file, "  main.classList.toggle('has-portrait', portrait);", "  main.classList.toggle('has-portrait', portrait);\n  const beside = Boolean(state.imageData && window.innerWidth >= 900 && sourceCanvas.width / sourceCanvas.height <= 1.55);\n  main.classList.toggle('image-beside',beside);")
change(file, "  const beside = portrait && window.innerWidth >= 900;", "  // Layout follows both viewport width and photo aspect ratio, including square images.")
change(file, "function includedProducts() {\n  return state.products.filter(product => {\n    const type = String(product.type || '').toLowerCase();\n    return type === 'transparent' ? state.glassTypes.transparent : ['opalescent','opaque'].includes(type) && state.glassTypes.opalescent;\n  });\n}", "function includedProducts() { return state.products.filter(product=>includedGlass(product,state)); }")
change(file, "`${target.hex}:${state.glassTypes.transparent}:${state.glassTypes.opalescent}`", "`${target.hex}:${state.glassTypes.transparent}:${state.glassTypes.opalescent}:${state.includeTints}`")
change(file, "  const products=includedProducts();", "  $('include-tints').setAttribute('aria-pressed',String(state.includeTints));\n  const products=includedProducts();")
change(file, "function extractStartingColors(preserveManual=true)", "function extractStartingColors(preserveManual=true,seed=undefined)")
change(file, "extractPalette(state.imageData,{count:state.paletteCount})", "extractPalette(state.imageData,{count:state.paletteCount,seed})")
change(file, "function bindEvents() {", "function bindEvents() {\n  settingsDialog=initializeSettingsDialog({getSettings:currentSettings,applySettings:applyWorkingSettings,onSaved:settings=>{savedSettingsFingerprint=JSON.stringify(settings);renderSettings();},notify});\n  $('load-settings').addEventListener('click',()=>settingsDialog.open(false));\n  $('refresh-settings').addEventListener('click',refreshWorkingSettings);\n  $('remix-palette').addEventListener('click',remixPalette);\n  $('include-tints').addEventListener('click',()=>{state.includeTints=!state.includeTints;reconcilePaletteSelection();renderResults();persist();});")
change(file, "    try { Promise.resolve(bridge.openWorkspace()).catch", "    try { flushSave().then(()=>bridge.openWorkspace()).catch")
change(file, "    persist();\n  } catch (error) {\n    console.error('Palette Picker could not start:'", "    if(!saved && preferences?.showFullPalette===false && activeTarget()){state.view='alternatives';renderResults();}\n    persist();\n  } catch (error) {\n    console.error('Palette Picker could not start:'")

file='extension/picker.html';text=Path(file).read_text()
text=text.replace('<link rel="stylesheet" href="./picker.css">','<link rel="stylesheet" href="./picker.css">\n    <link rel="stylesheet" href="./picker-v5.css">')
text=text.replace('Opaque colors use a full-color reference.','Photo color strength, not measured physical depth.')
# Move existing buttons, not duplicate IDs or their event handlers.
import re
for id in ('open-saved-carts','send-to-cart'):
    pattern=rf'<button\b[^>]*\bid="{id}"[^>]*>.*?</button>'
    match=re.search(pattern,text);assert match,id
    button=match.group();text=text[:match.start()]+text[match.end():]
    text=text.replace('<div class="header-actions">','<div class="header-actions">'+button,1)
text=text.replace('<div class="header-actions">','<div class="header-actions"><button class="button secondary-button" id="refresh-settings" type="button" title="Reset settings only. Keep the photo, palette colors and dot positions.">Refresh</button>',1)
text=text.replace('>Saved carts</button>','>Saved Carts</button>')
text=text.replace('id="send-to-cart" type="button" disabled>Send to my cart','id="send-to-cart" type="button" disabled>Send to My Cart')
text=text.replace('>All palettes</button>','>Load palettes</button>')
text=text.replace('<span id="settings-status"', '<button class="button secondary-button" id="load-settings" type="button">Load settings</button><span id="settings-status"')
text=text.replace('<button class="text-button" id="add-custom-color"', '<button class="text-button" id="remix-palette" type="button" title="Sample a new palette from this image">Remix</button><button class="text-button" id="add-custom-color"')
text=text.replace('>Opalescent</button></div>','>Opalescent</button><button class="type-filter" id="include-tints" type="button" aria-pressed="false">Tints</button></div>',1)
text=text.replace('Thickness is a photo-based estimate; opaque colors use the full-color reference.','Thickness is a photo-based color-strength estimate; neutral opaque glass uses its full-color reference.')
Path(file).write_text(text)

Path('extension/picker-v5.css').write_text('''/* Purpose: v5 responsive workspace, named settings and full-page carts.
   Setup: after picker.css; no external resources or destructive effects. */
.app-header,.global-settings,.app-main{max-width:none}
.app-header{gap:12px;flex-wrap:wrap}
.header-actions{flex-wrap:wrap;justify-content:flex-end}
.header-actions .button{min-height:29px;font-size:11px;padding:4px 9px}
.brand-heading{gap:12px;min-width:0}
.palette-chips{align-items:center;flex-wrap:wrap}
.palette-chips .full-palette-control{padding:4px 6px;margin-right:7px;white-space:nowrap}
.palette-topline,.palette-bottomline,.results-toolbar,.results-subheading{min-width:0;flex-wrap:wrap}
.palette-tools,.action-buttons{flex-wrap:wrap}
#settings-name{flex:1;min-width:0;height:33px;border:1px solid #c4d0c7;padding:5px 8px;background:white}
#settings-dialog-message{margin:8px 0;overflow-wrap:anywhere}
.settings-preset-row{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid var(--line);padding:12px 0}
.settings-preset-row>div{min-width:0;overflow-wrap:anywhere}.settings-preset-row p{font-size:11px;color:var(--muted)}
@media(min-width:900px){
 .app-main.image-beside{display:grid;grid-template-columns:minmax(0,43%) minmax(0,1fr);gap:18px;align-items:start}
 .app-main.image-beside[data-image-size="larger"]{grid-template-columns:minmax(0,49%) minmax(0,1fr)}
 .app-main.image-beside[data-image-size="full"]{grid-template-columns:minmax(0,53%) minmax(0,1fr)}
 .app-main.image-beside>.image-panel{position:sticky;top:8px}
 .app-main.image-beside>.workspace-results{padding-top:5px}
}
@media(min-width:1200px){
 .product-card{min-height:86px;padding-block:5px}
 .photo-button{width:80px;height:80px}
}
@media(max-width:899px){.app-main.has-portrait{display:block}.header-actions{justify-content:flex-start}}
@media(max-width:540px){
 .app-header,.global-settings{padding-inline:9px}.app-main{padding-inline:9px}
 .header-actions{gap:5px}.header-actions .button{font-size:10px;padding-inline:7px}
 .thickness-reference{font-size:9px}.palette-chips .full-palette-control{font-size:10px}
 .palette-tools{gap:4px}.source-toolbar{flex-wrap:wrap}.source-toolbar>span{max-width:100%}
 .glass-type-filters{flex-wrap:wrap}
}
''')
print('Picker v5 controls, named settings and responsive layout written.')
