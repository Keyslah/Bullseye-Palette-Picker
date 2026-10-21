# Bullseye Palette Picker v0.6.4

## Changes

- The main picker page immediately displays **100% thickness = 6 mm solid glass, 16 mm fine frit \*Rough estimate** on the palette bar above the source image. The reference wraps within narrower panels and is removed from the information popup.
- The existing Settings menu now sits directly after Sign in and before Transparent. Its glass-form, jar-size, and named settings controls are retained.
- Corrected the information menu's outdated Medium-only description to reflect the existing per-form photographs and shared color reference.

This update changes presentation only. Matching, photograph data, percentages, source images, dots, saved work, individual purchase options, and cart operations retain their v0.6.3 behavior.

## Verification

The release gate runs the existing JavaScript regressions, structural checks, native workspace regression, and the updated native layout suite. Browser checks verify the reference is visible with all menus closed, the requested toolbar order, readable wrapping at desktop and narrow widths, and usable Settings controls. Existing Alternatives card bounds, scrolling, and purchase popovers remain covered. Store traffic uses isolated fixtures.

The installable ZIP has a root-level manifest and is verified byte for byte against the tested source before publication. The published download is verified again after release.

## Update

Extract `Bullseye-Palette-Picker-v0.6.4.zip` into the same installed extension folder, replacing its files. At `chrome://extensions`, click **Reload** and confirm **0.6.4**. Close and reopen the picker and cart tabs; refresh already-open source pages. Keep the same installed extension and folder to retain local saved work.
