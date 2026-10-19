# Bullseye Palette Picker v0.5.0

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
