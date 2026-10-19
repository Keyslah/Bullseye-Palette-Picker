"""Purpose: document the reconstructed v5 release and correct the test setup callback.
Setup: recovery workflow applies this patch once from the repository root.
Writes: release/help/privacy text and the isolated browser harness only.
Constraints: no release marker, no changes to user data or passing criteria.
"""
from pathlib import Path

def change(path,old,new):
    file=Path(path);text=file.read_text()
    assert old in text,f'Missing anchor in {path}: {old[:90]}'
    file.write_text(text.replace(old,new,1))

change('tests/v5-browser.py',"worker.evaluate(\"globalThis.fetch = async () => { throw new Error('External worker requests disabled in acceptance tests.'); };\")", "worker.evaluate(\"() => { globalThis.fetch = async () => { throw new Error('External worker requests disabled in acceptance tests.'); }; }\")")

path=Path('README.md');text=path.read_text().replace('v0.4.0.zip','v0.5.0.zip')
text=text.replace('Version **0.4.0**','Version **0.5.0**',1)
text=text.replace('Version 0.4.0 retains','Version 0.5.0 retains')
intro='''
## New in v0.5.0

- **Better use of the screen:** square and portrait photos sit beside the palette/results on wide windows. Wide landscapes remain above the results. Photo aspect ratios and draggable dots stay aligned.
- **Tints start off:** enable **Tints** when you want the 20 pale-tint products included. They have not been removed from the catalog.
- **Corrected thickness labels:** chromatic opalescent samples compare photographed color strength instead of all being labeled 100%. The two Dark Forest Green regression targets reproduce 100% and 77%. These remain photo estimates, not calibrated physical thicknesses.
- **Refresh and Remix are separate:** top **Refresh** resets working settings and returns to the full-palette view without changing the photo, colors, edited colors, or dot positions. **Remix** deliberately samples a new palette from the same photo and replaces the current color edits/dots.
- **Named settings:** **Save settings** always opens a name form. **Load settings** restores a named preset without resampling the image. Saving the same currently selected preset name updates it; a different name creates another preset. Existing default settings remain supported.
- **Clear palette navigation:** **Load palettes** opens the existing photo-palette library. **Show full palette** is beside color #1.
- **A full cart tab:** **Saved Carts**, **Save cart**, or the selected-glass summary opens the cart workspace in a normal browser tab. Save and Duplicate ask for a name. The cart has its own material/tint-filtered color browser with photo thickness ranges. Global format changes affect new additions, not already saved cart variants.
- **Copy my Bullseye cart:** reads the currently signed-in website cart into an editable, unsaved local copy. Copying does not add, remove, or change website quantities. Save the copy under a name to keep it. Catalog prices are estimates; the website remains authoritative.

**Website-copy limits:** items outside the bundled glass catalog remain visible in the local copy with exact variant IDs and quantities, but must be removed before sending that copy with this tool. Custom-property/subscription items are rejected rather than silently changed. USD and quantities from 1 to 999 per variant are supported.

**Send is additive.** Sending a copied cart adds the selected quantities to what is already on the website; it does not replace existing quantities. No action here clears the website cart or completes checkout.

'''
text=text.replace('## Install or update in Chrome',intro+'## Install or update in Chrome',1)
text=text.replace('**All palettes** is the leftmost control immediately below the palette swatches.','**Load palettes** is the leftmost control immediately below the palette swatches.')
text=text.replace('Check **Show full palette** directly below the swatches','Check **Show full palette** beside color #1')
text=text.replace('Portrait photos use a large left column','Portrait and square photos use a large left column')
text=text.replace('**Saved carts**, directly below the palette, lists','**Saved Carts**, at the top, opens the cart page and lists')
text=text.replace('Click **Save settings** to remember the glass format, preferred jar size, included material types, starting automatic-color count, and image size.','Click **Save settings** and enter a preset name to remember the glass format, preferred jar size, included material types, tint inclusion, full-palette view, starting automatic-color count, and image size.')
text=text.replace('Opalescent and opaque glass use a **100% full-color reference**, including ordinary Black and White, because a photograph of opaque grains does not establish their physical depth.','Chromatic opalescent glass also uses the photographed-strength comparison, so different shades no longer all display 100%. Neutral opalescent and opaque glass, including ordinary Black and White, retain their **100% full-color reference**. Neither model establishes physical depth from opaque grains.')
path.write_text(text)

path=Path('PRIVACY.md');text=path.read_text().replace('The version 4 workspace','The version 5 workspace')
text=text.replace('**All palettes**','**Load palettes**')
text=text.replace('Material filters and image size are also retained.','Material filters, tint inclusion, and image size are also retained. The cart-only page does not overwrite this photo workspace.')
text=text.replace('starting automatic-color count, and image size.','starting automatic-color count, image size, tint inclusion, and full-palette view. Named presets also use the separate `bullseyeSettingsPresetsV1` key, storing only a preset ID, name, settings, and update time.',1)
text=text.replace('## Other network requests','''**Copy my Bullseye cart** runs only when clicked. It uses the same native store tab and sign-in check, then reads the cart with GET requests. Only product names, SKUs, variant IDs, size labels, quantities, and display prices are returned to the local cart editor. The copy does not return cart tokens, customer identity, notes, addresses, payment data, or checkout information. It is an unsaved draft until you choose a name and save it locally. Copying does not post a cart change or alter website quantities. Unsupported custom-property/subscription items produce an error rather than silently changing their meaning.

## Other network requests''',1)
text=text.replace('Check the store session and add explicitly chosen variants in a Bullseye tab','Check the store session, read a cart copy when clicked, and add explicitly chosen variants in a Bullseye tab')
path.write_text(text)

Path('docs/release-v0.5.0.md').write_text('''# Bullseye Palette Picker v0.5.0

Reconstructed from the saved v0.4.0 source and the recovered v5 requirements. This release is not a claim that the original interrupted temporary workspace was recovered.

## Included

- Space-efficient square/portrait image layout with preserved aspect ratio and point alignment.
- Tints off by default, with an explicit inclusion button in both color browsers.
- Variable photo-strength labels for chromatic opalescent glass. Dark Forest Green regression targets reproduce 100% and 77%; neutral opaque glass retains its full-color reference.
- Named settings presets, clear Load settings and Load palettes actions, and name prompts for saves.
- Top Refresh resets settings/view only. Remix separately resamples the current image.
- Show full palette beside color #1; a normal new tab for Open full page.
- Full cart page with independently saved/duplicated carts and a material-filtered color browser showing thickness information.
- Explicit Copy my Bullseye cart reads the website cart without modifying it. Existing direct Send behavior remains additive and never completes checkout.

## Update

Extract `Bullseye-Palette-Picker-v0.5.0.zip`. Its root contains `manifest.json`.

For an existing unpacked installation, replace the contents of the same installed extension folder. Do not remove the extension or switch its installed folder. Open `chrome://extensions`, click **Reload** on Bullseye Palette Picker, confirm **0.5.0**, refresh already-open source pages such as Pinterest, and close/reopen the picker and cart tabs. Keeping the same extension installation and folder preserves local palettes and carts.

For a new installation, enable Developer mode at `chrome://extensions`, choose Load unpacked, and select the extracted folder containing `manifest.json`.

## Verification and boundaries

The release workflow runs the JavaScript regressions, module/catalog checks, native Chromium acceptance tests, and a byte-for-byte ZIP/source check before publication. Store tests use isolated synthetic fixtures, not a real customer account or shopping cart. The reviewed catalog, product-format index and reference photographs remain unchanged.

Thickness labels remain photo-based estimates, not a physical calibration. Website-cart copies support ordinary USD items with quantities of 1 to 999. Out-of-catalog items remain visible in the copy but cannot be sent by this glass picker; custom-property/subscription items are rejected. Sending a copied cart adds quantities to the existing website cart rather than replacing it.
''')
Path('docs/v5-recovery-status.md').write_text('''# v0.5.0 reconstruction status

The original interrupted temporary workspace was not recovered. The v5 requirements were reconstructed on top of v0.4.0 commit ec892ecabf8d2da585448fb2b96e3abe8536db20.

The implementation is now committed in the recovery/v0.5.0 branch. Each recovery patch is saved before it runs, and the resulting source is checkpointed before tests. Completed implementation includes tint settings, corrected opal photo-strength labels, named settings, separate Refresh/Remix, full-cart-page editing and naming, read-only website-cart copying, and the wide square/portrait image layout.

Publication is gated by `.github/v5/PUBLISH`, the complete test workflow, and a non-forced fast-forward of main. The release record and successful publication run, not this status note, establish whether the ZIP is publicly released. See release-v0.5.0.md for controls, update steps and supported limits.
''')
print('Release/help/privacy text updated and browser test setup corrected.')
