# Bullseye Palette Picker v0.6.2

## Photograph correction

- Powder, Fine, Medium and Coarse now show their actual Bullseye photographs on the main palette cards, All glass, alternatives and the enlarged detail window. Those views use the exact same photo selector as the cart.
- Mixed-grade cart items, Add a color results and enlarged cart previews continue to use each item's own frit grade or sheet product, independently of jar weight.
- Changing the grade refreshes an already-open detail photo. Detached older image nodes cannot overwrite the new selection.
- The medium-frit sampling photograph and its swatches/marker are kept separately under **Thickness color reference · Medium frit**. They are not placed on a different fine/powder photo.
- No source-photo edits, dot changes, re-sampling, matching-rule changes or unrelated layout changes.

## Verification

The new live-photo suite fetches and decodes all 564 frit photographs (141 colors across four grain sizes), with URL, dimensions and SHA-256 evidence. Native Chromium loads the actual CDN photos in the main cards, enlarged view, alternatives and cart, including the reported Aquamarine Blue example. Photo requests in that suite are not mocked or replaced with placeholder images. Previous native layout, settings, palette and cart suites also run, using isolated shopping fixtures. No personal account or live shopping cart is modified. The packaged extension is checked byte-for-byte against source.

## Update

Extract `Bullseye-Palette-Picker-v0.6.2.zip` into the same installed extension folder, replacing its files. Do not uninstall. At `chrome://extensions`, click **Reload** on Bullseye Palette Picker and confirm **0.6.2**. Close and reopen existing picker/cart tabs, and refresh already-open source pages. The ZIP contains `manifest.json` at its root. Photos load directly from Bullseye's public image CDN.
