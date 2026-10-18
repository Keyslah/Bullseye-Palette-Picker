# Version 0.1.0 verification

Verified on 2026-10-18 with Node 24.19.0 and an isolated Google Chrome for Testing 155.0.8059.84 profile.

## Repeatable project checks

Run from the repository root:

```sh
npm test
npm run check
npm run package
```

The 24 automated regression tests pass. They cover the published CIEDE2000 reference pairs, full-color conversion, distinct hues at equal lightness, palette extraction, transparent pixels, stricter and broader match ranges, actual package SKUs, image-request ordering, cancellation, source-tab handoff, and large inline-image metadata.

Structural checks verify the Manifest V3 entry points, JavaScript syntax and imports, bundled assets, 27 colored transparent medium-frit products, 1,080 measured samples, and 72 real jar variants. The packaging script checks ZIP integrity and a root-level manifest.

## Browser verification

An isolated browser UI run passed 14 interaction checks, including a 360-pixel view without horizontal overflow, file import, clicking a photo color, editing and removing palette colors, tighter and broader matches, all 40 selectable product samples, jar sizes, quantities, saved selections, capture acceptance, and image cancellation. No browser page errors were reported.

The extension also loaded as a real MV3 extension in the isolated Chrome profile. Checks confirmed the service worker and side panel, exact decoded image pixels, storage-driven image handoff, and reopening a saved edited palette. A separate immediate-reload check confirmed the pending-save flush.

The native Quick Add injection was exercised against a mock form at the store origin with a prepared test tab. It filled the exact selected variant SKU and quantity without submitting the form. The manual-paste fallback was also exercised. This does not constitute a purchase or an end-to-end test of a signed-in Bullseye cart; the actual store resolves and confirms the products when the user submits Quick Add.

## Manual checks after installation

1. Right-click a web image, grant its particular image-host permission if prompted, and confirm that it opens in the picker.
2. Click a point in the photo, edit or remove that color, and tighten or broaden the match range.
3. Open a glass detail and click different measured samples to inspect its darkness labels.
4. Select glass, edit its jar size and quantity, and reopen the picker to check the saved selection.
5. Use **Send to Bullseye cart**. Review the SKU list in Quick Add, then resolve and add the chosen items on the store. Use **Copy SKU list** if the current store widget requires manual paste.

See the README for install and update instructions, including reloading the unpacked extension after replacing its files.
