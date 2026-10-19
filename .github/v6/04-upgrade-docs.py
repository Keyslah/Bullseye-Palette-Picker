"""Purpose: apply the requested larger starting view once when upgrading a v5 workspace.
Setup: numbered v6 workflow patch, after the compact UI and acceptance tests.
Writes: workspace display migration, release/help text and a migration browser assertion.
Constraints: keep image/color/point/cart data and named palette/settings choices unchanged.
"""
from pathlib import Path

def change(path,old,new):
    p=Path(path);s=p.read_text();assert old in s,f'Missing anchor: {path}: {old[:90]}'
    p.write_text(s.replace(old,new,1))

change('extension/picker.js','version:5, includeTints:state.includeTints','version:6, includeTints:state.includeTints')
change('extension/picker.js',
 "    restoreWorkspace(saved);\n    renderAll();",
 "    restoreWorkspace(saved);\n    // Apply the requested larger starting view once on upgrade, not on each reload.\n    if(saved && Number(saved.version || 0)<6 && saved.imageSize==='fit')state.imageSize='larger';\n    renderAll();")
change('tests/v6-browser.py',
 "        passed('Existing saved-photo and workspace restoration survive v6 reload')",
 """        passed('Existing saved-photo and workspace restoration survive v6 reload')
        older=copy.deepcopy(restored);older['version']=5;older['imageSize']='fit'
        page.evaluate("async value=>chrome.storage.local.set({bullseyeProjectV1:value})",older)
        page.reload();expect(page.locator('#image-loaded')).to_be_visible()
        upgraded=saved(page)
        assert upgraded['version']==6 and upgraded['imageSize']=='larger'
        assert image_state(upgraded)==image_state(restored)
        passed('Upgrading the old Fit workspace starts larger without changing its photo or colors')""")

p=Path('README.md');s=p.read_text()
s=s.replace('Version **0.5.0**','Version **0.6.0**',1)
s=s.replace('v0.5.0.zip','v0.6.0.zip')
s=s.replace('Version 0.5.0 retains','Version 0.6.0 retains')
start=s.index('## New in v0.5.0');end=s.index('## Install or update in Chrome',start)
s=s[:start]+'''## New in v0.6.0

The workspace puts the source photo and glass comparison first. Buttons share one compact, left-to-right wrapping toolbar rather than separate rows for settings, image controls, cart actions, and filters.

**Top controls.** Refresh, Transparent, Opalescent, and Tints start the toolbar together. Load palettes, Save palette, Save cart, Saved Carts, Send, search, and navigation share its remaining space. Settings contains the glass form, default jar size, named Save settings, and Load settings. Image contains import/capture controls and Fit / Larger / Full width. Account and the information menu hold status and reference text.

**Palette strip.** Show full palette is first at the far left, followed by an uninterrupted sequence of swatches. Color hex values and the editor live behind Edit color rather than occupying every swatch and another full row. Numbered dots still identify sampled image locations.

**Portrait and square photos.** The vertical glass list is to the left of the source photo, even in the narrower side panel. Each card's name, thickness estimate, and purchase control are on the left; its glass photograph is on the right, nearest the source image. Larger is the starting image size and fills the available portrait column. The previous v5 workspace's Fit view changes to Larger once on upgrade, without modifying its image, colors, or dots. Explicitly loading a saved palette or settings preset still restores its chosen view.

**Landscape photos.** Glass cards form a horizontal comparison strip directly beneath the larger image. Extra cards scroll horizontally instead of creating a long vertical list below it.

**Compact product cards.** A single purchase dropdown contains package/sheet size, quantity, selection, and price. The main card no longer repeats SKUs and long detail text. Click the glass photograph for the large reference view, product code, sampled colors, full purchase information, and Use for this color / Alternatives controls.

**French Vanilla and coral alternatives.** Explicit Alternatives and glass search include both neutral and chromatic product families while continuing to ignore background gaps in product photographs. French Vanilla is no longer completely excluded from a pale cream target by the old neutral/chromatic cutoff. Sunset Coral stays available in alternatives. Coral Orange Tint is included when Tints is on. All are still sorted by measured full-color difference; automatic suggestions retain the existing stricter neutral/chromatic eligibility. A deliberately chosen alternative persists through reloads and palette saving.

Refresh still resets settings/view without resampling the photo. Remix separately creates a new sampled palette. Named settings, named palettes, the full cart page, and read-only website-cart copying remain available. Tints remain off by default.

**Cart boundary:** Copy my Bullseye cart reads a local draft without modifying website quantities. Send is additive, not a replacement of the website cart. The v5 cart-copy limits remain: ordinary USD items, quantities 1 to 999, and only supported catalog glass can be sent by this tool. No action completes checkout.

''' +s[end:]
s=s.replace('Check **Show full palette** beside color #1','Check **Show full palette** at the far left of the swatches')
s=s.replace('**Load palettes** is the leftmost control immediately below the palette swatches.','**Load palettes** is in the top toolbar.')
s=s.replace('**One vertical glass list.** Each row includes the real reference photo, glass name and code, estimated thickness percentage, package or sheet size, quantity, and selection control.','**Compact glass comparison.** A vertical list sits left of portrait/square images; landscape images use a horizontal strip. Each card shows a real reference photo, name, estimated thickness, and a compact purchase dropdown. Codes and full information are in the photo detail view.')
s=s.replace('Portrait and square photos use a large left column in the full workspace, with the palette and glass list beside them. Landscape photos run across the top.','Portrait and square photos occupy the right column, with the glass list on their left. Landscape photos run above a horizontal glass strip.')
s=s.replace('The narrow side panel keeps the image above the palette and results. The full workspace adapts to the image\'s orientation.','The side panel and full workspace both adapt to image orientation. Portrait/square glass comparisons stay on the left; landscape comparisons run horizontally below the photo.')
p.write_text(s)

Path('docs/release-v0.6.0.md').write_text('''# Bullseye Palette Picker v0.6.0

## Compact comparison workspace

- Refresh and Transparent / Opalescent / Tints together at the start of the top toolbar.
- Load palettes and the remaining buttons flow left to right instead of occupying separate sparse rows.
- Show full palette at the far left, outside the uninterrupted swatch sequence.
- Larger images by default, including a one-time migration of the previous v5 Fit workspace. Photo pixels, colors, edits, and dot positions are retained.
- Portrait/square matches run vertically to the left of the source image. Each glass card has its information on the left and its photograph on the right, adjacent to the source.
- Landscape matches run in a horizontal strip directly below the image.
- Size, quantity, selection, and price are in a compact purchase dropdown. Click the glass photo for the code and full reference details.
- French Vanilla and Sunset Coral can be found and deliberately selected across the old neutral/chromatic alternative boundary. Coral Orange Tint remains controlled by Tints. Automatic matching is not forced to promote any named product.

Existing named palettes, named settings, saved carts, direct cart sending, and read-only website-cart copying remain supported. Catalog data, all reference photos, and product-format records are unchanged. Thickness percentages remain photo-based estimates, not physical calibration.

## Update

Extract `Bullseye-Palette-Picker-v0.6.0.zip` and replace the files in the same installed extension folder, the folder containing `manifest.json`. Keep the existing extension installed to retain its saved palettes and carts. At `chrome://extensions`, click Reload on Bullseye Palette Picker and confirm 0.6.0. Refresh already-open source pages such as Pinterest, then close/reopen picker and cart tabs.

The ZIP has `manifest.json` at its root. A new installation uses Load unpacked on that extracted root folder.

## Verification

The publication workflow requires the JavaScript regressions, source/catalog checks, native Chromium interaction/layout tests, and ZIP/source byte equality to pass. Native tests cover portrait, square, and landscape layouts at 380, 650, 820, 1024, 1440, and 1920 pixels wide, along with named settings/palettes, purchase dropdowns, explicit alternative choices, and independent carts. Shopping tests use isolated synthetic fixtures, not a real customer account or cart.
''')
print('v6 initial-view migration, browser assertion and release notes saved.')
