# Bullseye Palette Picker v0.6.5

## Changes

- Regular Black (`000100`) remains available with Transparent enabled and Opalescent disabled, in automatic matching, All glass, Alternatives, and the cart builder. The exception does not admit other opalescent colors or change the catalog's material classifications. Disabling both material types still excludes everything.
- Corrected the reported purple-to-blue automatic match. The screenshot's purple `#6A12DE` now chooses Gold Purple Fine using its real photographed sample `#5D447B`, with the circle at that sample's actual location and an approximately 78% reference label. True blue targets still choose blue glass.
- The purple preference uses actual selected-form photo hues within a bounded full-color distance and respects available variants. It does not alter color-difference scores, photograph data, percentage calculations, manual glass choices, or the Orange Striker preference.

The source image, manually edited colors, dots, named palettes/settings/carts, compact layout, visible rough thickness reference, and shopping safeguards are retained. Previously pinned glass choices remain saved; Alternatives can change an existing explicit choice.

## Verification

- All 186 JavaScript regressions pass, including real Black variants in all five forms, the exact purple screenshot color across all frit forms, blue/blue-violet controls, stock and strict color-cutoff safeguards, and unchanged raw sample data.
- A focused native-browser suite checks actual Fine photographs and marker coordinates, transparent-only filters in the picker and cart, form switching, named palette/source/dot restoration, and preservation of an explicitly chosen blue alternative. Desktop and narrow screenshots are visually inspected.
- The release gate repeats the existing workspace, cart-builder, and Alternatives/layout suites alongside the focused matching suite. Shop/account/cart requests use disposable fixtures; no personal cart is touched.
- The installable ZIP contains a root-level manifest and is checked byte for byte against source. The published download is verified again after release.

## Update

Extract `Bullseye-Palette-Picker-v0.6.5.zip` into the same installed extension folder, replacing its files. Open `chrome://extensions`, click **Reload**, and confirm **0.6.5**. Close and reopen the picker and cart tabs; refresh already-open source pages. Keep the same installed extension and folder to retain local saved work.
