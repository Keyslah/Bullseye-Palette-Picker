/**
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
