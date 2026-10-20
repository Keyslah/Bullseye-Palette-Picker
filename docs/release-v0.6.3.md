# Bullseye Palette Picker v0.6.3

## Changes

- Powder, Fine, Medium, and Coarse now use samples from their own actual Bullseye photograph for full-color matching, percentages, marker positions, clickable swatches, and nearby-glass inspection. The separate Medium-only reference panel is removed.
- All four forms keep the same existing reference for each glass color. No photograph is independently stretched from 0% to 100%. For Aquamarine Blue, the sampled ranges are Powder 20–100%, Fine 18–100%, Medium 35–100%, and Coarse 45–100%.
- Samples are tied to the exact source URL and image coordinates. Background gaps, dish rims, wedge backdrops, and other non-glass regions are excluded. The viewer identifies fired spreads, unfired dishes, and cast wedges as approximate visual guides.
- Sign in is beside Refresh at the top-left of the existing toolbar, with the existing account checks and status behavior.
- Each color's purchase dropdown includes Form, Package size, and Quantity. Form changes select actual Bullseye variants/SKUs and retain quantity and the same jar weight where available. Sheets expose real dimensions and thicknesses. Explicit per-color forms persist independently of the global default.
- Alternatives retains its separate popup. Content-sized rows and bounded photos prevent overlap; cards wrap and scroll vertically, and purchase popovers remain usable above the scrolling area.
- Source photos, image dots, edited palette colors, saved palettes/settings/carts, clear-glass options, enlarged cart photos, website-cart copying, and shopping safeguards are retained. Existing saved target-to-glass choices are preserved when adopting the new sample data. Orange Striker retains its requested automatic preference, and Carnelian remains an explicit alternative.

## Verification

The source data includes 564 exact frit photographs, 22,499 matching/swatches samples, and 37,670 spatial inspection entries. An independent audit verifies every recorded RGB at its actual source-image coordinate, along with the image URL, SHA-256, dimensions, and material region. Form ranges use the shared original reference.

Native Chromium tests load actual Bullseye image bytes, exercise all four Aquamarine forms, swatch and photograph clicks, item form/size/quantity controls, saved work, and rapid switching with a delayed older photo response. Alternatives is measured and visually inspected at 320, 380, 650, 1440, and 1920 pixels, including open purchase popovers. Existing palette, settings, cart, clear-glass, and source-layout regressions are included. Shopping runs in disposable profiles with intercepted fixtures; no personal Bullseye cart is modified.

The release workflow runs the regressions before publication. The ZIP is checked for the exact expected file list, root-level manifest, and byte-for-byte equality with the tested source. Source provenance and repeatable commands are in [form sampling](form-sampling.md) and [verification](verification.md).

## Update the installed extension

1. Extract `Bullseye-Palette-Picker-v0.6.3.zip` into the **same folder currently installed in Chrome**, replacing the old files. The ZIP has `manifest.json` at its root.
2. Open `chrome://extensions`, click **Reload** on Bullseye Palette Picker, and confirm version **0.6.3**.
3. Close existing picker and cart tabs, then reopen them from the extension. Refresh already-open source pages before using their image context menu again.

Keep the same extension installation and folder so Chrome retains the local saved work. Do not uninstall the existing extension. Publishing to GitHub does not update an unpacked extension automatically.
