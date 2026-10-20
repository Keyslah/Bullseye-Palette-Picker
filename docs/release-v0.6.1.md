# Bullseye Palette Picker v0.6.1

- Landscape comparison cards have the glass photograph above the name, photo-thickness estimate and purchase control. Every match fits the available width; additional cards wrap onto another row instead of disappearing into a sideways scroller. The normal image size leaves room for the comparison cards. Portrait comparison order is unchanged.
- A plain checkbox is next to each glass name. There is no visible Selected label, and selecting glass does not require opening its purchase controls.
- Purchase summaries, popups and size options identify Fine frit, Medium frit, Coarse frit, Powder frit or Sheets along with the package size. Sheet option titles retain their actual millimeter thickness. Photo thickness percentages remain estimates, separate from frit grade.
- Alternatives opens a separate searchable popup from a comparison card, the toolbar or the glass-detail window. It does not replace the full main palette. With Show full palette turned off, the main area shows the active color's match; Alternatives is still its own popup.
- Light Orange Striker is preferred when the automatic choice would otherwise be Carnelian, provided Orange Striker is included and available in the selected form. Carnelian remains selectable as an alternative, and explicit saved choices are respected. Matching scores and catalog data are unchanged.

The reported glitch investigation was dropped as requested. No unrelated cart, account, image-sampling or catalog behavior was changed.

## Update

Extract the ZIP into the same installed extension folder containing manifest.json, replacing its existing files. Keep the extension installed. At chrome://extensions, click Reload and confirm 0.6.1. Close and reopen the picker/cart tabs so the new JavaScript and styles load. Your existing storage keys and saved palettes/carts are retained.

## Checks

Publication is gated on code regressions, catalog/module checks, native Chromium UI tests and ZIP/source byte equality. Browser checks cover landscape, square and portrait layouts, plain checkboxes, every frit grade, alternatives selection, saved preferences/palettes, independent carts and read-only cart copying. Shopping actions use isolated synthetic test fixtures, not a real customer account or cart.
