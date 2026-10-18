# Version 0.2.0 verification

Verified on 2026-10-18 with Node 24.19.0, Python/Pillow, and an isolated Google Chrome for Testing 155.0.8059.84 profile.

## Repeatable project checks

From the repository root:

```sh
npm test
npm run check
python scripts/check-sampling.py
npm run package
```

The JavaScript suite passes **55 regression tests**. Coverage includes the published CIEDE2000 reference pairs, full-color conversion, different hues at equal lightness, palette extraction, transparent pixels, actual source coordinates for automatic dots, strict match ranges, neutral eligibility, real black/white/gray matches, image-request ordering, cancellation, source-tab handoff, account status, cart additions, and replay prevention.

The **four Python sampling tests** verify that blue, black, gray, and white material retains its exact measured RGB when half the sampled region is opposite-color background. They also require each marker to land on actual material even when the geometric band center falls in a gap.

Structural checks verify the Manifest V3 entry points, module syntax/imports, local assets, matching manifest/package versions, and **32 real medium-frit products with 1,268 eligible measured samples and 85 jar variants**. The packaging script checks ZIP integrity and a root-level manifest.

## Catalog review

All 32 source photograph hashes retain their reviewed status. New neutral entries are ordinary Black and White Opalescent plus Charcoal Gray, Light Silver Gray, and Oregon Gray Transparent.

Every one of the 1,268 sample markers was checked against the actual bundled 600-pixel JPEG. No chromatic marker fell below C*=8 after image resizing; no gray or black marker fell in L*>94 background; no White marker fell below L*=85. Measured chromatic sample RGB itself must satisfy C*>=10. Thresholds, rectangles, source records, and representative pixel colors are included in the catalog.

The screenshot regression is explicit: **`#E3E3E3` cannot return Light Sky Blue, even at unlimited match tolerance.** Black, white, middle gray, and light gray return actual neutral products at the normal range.

## Native Chrome UI checks

The extension loaded as a real MV3 extension. UI verification covered:

- Six automatic dots over actual image pixels and six palette matches shown together.
- Dragging a dot resamples that same point without creating an extra dot.
- Clicking the image adds an independent point; clicking outside the image does not.
- A gray edit returns neutral glass instead of colored glass.
- Row checkboxes, jar quantities, and shared selections.
- Named palette save/load in IndexedDB, including image, point coordinates, edited hex colors, selected jars, and quantities.
- Reopening an edited workspace and consuming a pending image only once.
- A native worker image handoff replacing the source correctly.
- Responsive layout and absence of browser page errors.

The additional interaction checks cover duplicate-product quantity synchronization, a checkbox click immediately after a quantity edit, explicit sign-in feedback, one confirmed UI cart action, preventing resubmission of a sent selection, and recovery from an uncertain request by changing the selection. Uncertain writes still cannot be blindly replayed through the worker.

### Measured layout

Measured with a six-color image and six matching glass rows at normal browser zoom:

| Content viewport | Fully visible glass rows | Bottom of fifth row |
| --- | ---: | ---: |
| 1440 × 900 | 5 | 898 px |
| 1440 × 1000 | 5 | 979 px |
| 552 × 1000 | 5 | 979 px |

The 360-pixel view has no horizontal overflow. The source image, palette, cart actions, and glass list remain in that order. More colors extend down the page normally.

The repository preview uses an original geometric landscape fixture. It contains no user screenshots, bookmarks, account data, or personal photographs. Product reference photos remain attributed to Bullseye.

## Native cart integration

An isolated Chrome test executed the actual MV3 worker and its injected store action against intercepted Bullseye-origin fixtures. Checks confirmed:

- A customer avatar identifies a signed-in session even when the footer permanently says “Sign In.”
- Fresh signed-out account HTML overrides a stale avatar in an already-open tab and blocks the POST.
- One native cart-add POST carries actual catalog variant IDs, selected quantities, and the test store-session cookie.
- Existing cart products and quantities remain; added quantities are verified by reading the cart.
- Concurrent clicks and completed transaction replay do not add jars twice.
- A lost add response can be recovered by reading the actual resulting cart quantities.
- Partial inventory fulfillment is reported and a blind repeat POST is blocked.
- Unavailable or unrecognized account status remains unknown.
- Missing or malformed worker responses cannot be reported as successful additions.

All commerce traffic in these tests used intercepted fixtures. This verifies browser integration and failure handling; it does not constitute a live test in a personal Bullseye account.

The account adapter follows Bullseye's current Horizon customer markup. If the store changes those indicators, the adapter returns unknown until updated. It does not assume authentication from an ordinary account link or footer text.

## After installing the update

Replace the files in the existing unpacked extension folder, reload its card at `chrome://extensions`, and reopen the picker. Keeping the same installation preserves local saved palettes. GitHub publication alone does not update an already-loaded unpacked copy.

Right-click an image, move or add a dot, select the desired glass rows, and use **Send to my cart**. If sign-in is required, use Bullseye's normal login and return to send the selection.
