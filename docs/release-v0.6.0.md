# Bullseye Palette Picker v0.6.0

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
