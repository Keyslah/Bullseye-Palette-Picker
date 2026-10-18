# Verification record

## Version 0.4.0

Verified on 2026-10-18 with Node 24.19.0 and isolated Google Chrome for Testing 155.0.8059.84 profiles. This section describes the current release; the records below retain the results of earlier versions.

### Project checks

```sh
npm test
npm run check
npm run package
```

The final JavaScript suite passes **125 tests, with zero failures**. The existing full-color, neutral, thickness, image-handoff, signed-in cart, and replay-protection regressions remain in the suite. New coverage includes automatic selection ownership and opt-outs, available 5 lb. defaults, legacy workspace migration, real product formats, unchanged color matching across all forms, saved-cart normalization, and isolated explicit settings storage.

Structural checks pass for Manifest V3 entry points, module syntax/imports, local assets, package/manifest version 0.4.0, and the complete product-format mapping. The separate color guide remains version **0.3.0**, byte for byte unchanged. Its SHA-256 is checked against the new format index, along with all original sample, source-review, and bundled-image checks. The photographs and sampling code were not changed or resampled in this release; the earlier Python sampling results remain recorded below. No Chrome permissions were added.

### One color guide, five purchase forms

All five purchase forms retain the same **141 colors, 5,484 measured full-color samples, and 141 reviewed medium-frit photographs**. The guide still contains 75 transparent colors and 66 in the opalescent group, with clear/colorless and mixed-color listings excluded.

| Purchase form | Colors with a verified listing | Colors with an available option in the snapshot | Actual variants |
| --- | ---: | ---: | ---: |
| Sheets | 137 | 134 | 650 |
| Powder frit | 141 | 135 | 353 |
| Fine frit | 141 | 139 | 351 |
| Medium frit | 141 | 137 | 369 |
| Coarse frit | 141 | 138 | 365 |
| **Total distinct purchase variants** | | | **2,088** |

The format index records actual public Bullseye product and variant IDs, SKUs, titles, source URLs, retrieval times, and source hashes. Product-format tests check exact base-color codes and grain families; sheet records keep their source-specific thickness and size. The offline builder reproduced the index byte for byte from its source cache. See [format coverage and source rules](product-formats.md).

Every one of the 141 guide colors has an explicit entry for each form. The four colors without a verified standard sheet listing are Blue Black 000102, Medieval Green 001242, Light Mineral Green 001247, and Dark Amber Tint 001838. Native Chrome verified that an explicitly chosen missing-sheet color remains visible without a selected item, an incorrect product link, or an unrelated product fetch. No variant is invented by changing a SKU segment.

### Native Chrome checks

| Suite | Passed check executions |
| --- | ---: |
| Main palette and automatic-selection regression, rerun after the full integration | 36 |
| Purchase forms, mixed saved carts, sheet refreshes, and direct sending | 49 |
| Explicit settings and workspace/palette restoration | 15 |
| Named saved-cart interface | 25 |
| Native IndexedDB saved-cart storage | 13 |
| **Total** | **138** |

These suites have some deliberately overlapping coverage. All reported zero browser page errors.

The main palette starts with the eligible, available suggested glass selected and **Send to my cart** enabled. Available 5 lb. jars are preferred. Changing the global jar preference uses the requested available size, with another available option used when necessary. Shared color matches select one variant with a shared quantity. Explicit unchecked choices, alternative selections, edited sizes and quantities, and manual extras survive the intended dot, filter, photo, and restore operations. Legacy partial selections remain partial; a deliberately empty current selection is not silently refilled. The pink fixture chooses available Light Pink Striker while sold-out Fuchsia remains visible in its full-color alternatives.

All five form buttons were exercised against the real bundled index. The selected variant IDs and SKUs change to the requested purchase form, while source photographs, point coordinates, color-guide samples, and **thickness percentages remain present, including for Sheets**. Quantities and deliberate opt-outs are preserved during global remapping. Changing forms, settings, or saved-cart contents performs no store cart write.

Sheet selections prefer an available 3 mm choice and retain actual 2 mm and 6 mm choices where listed. The result-row code, detail code, and product link follow the selected variant. Refreshing the selected sheet's own product handle updates that source's inventory without erasing variants belonging to the other sheet thicknesses. Physical sheet millimeters remain part of the purchase-size label; the percentage continues to use the unchanged medium-frit photo guide.

Saved-cart checks cover named creation, quantity/size/form edits, adding and removing colors, multiple saved records, duplication from both list and editor, independent copies, rename, deletion, empty-cart storage, and reload. Saved mixed-form carts retain their exact IDs and quantities when the global format changes. New colors added to an editor use the current form and jar preference. Unavailable saved variants remain visible for editing. Saving or editing a cart leaves the complete photo palette intact. IndexedDB checks confirm transaction completion, duplicate-name disambiguation, copy isolation, and rejection of updates to deleted records.

Explicit settings checks verify the separate `bullseyeSettingsV1` key, all supported forms and jar sizes, material filters, starting automatic-color count, and image size. A current workspace or a named palette restores its own choices ahead of saved future defaults. Settings-only read/write failures are reported without overwriting workspace/cart storage or falling back to preview storage.

### Layout and saved photographs

The final 1440 × 900 Chrome viewport, at normal browser zoom, measured:

| Source photo height | Fully visible glass rows | Bottom of fifth row | Bottom of sixth row |
| --- | ---: | ---: | ---: |
| 750 px | **5** | 836.8 px | 931.8 px |

The sixth row continues below the viewport. The top form controls, 5 lb. default, selected palette, and direct Send action remain visible. The 552- and 360-pixel layouts have no horizontal overflow. The saved-cart editor also fits a 420 × 900 viewport with its Send footer visible while the item list scrolls.

The final main regression confirms that movable image points, complete saved photos, exact selections, and restoration still work with the new shopping controls. Portrait/landscape placement, image sizing, Show full palette, and the leftmost All palettes control are retained. The repository preview is an original geometric portrait fixture with no personal image or account data. Its account-status display comes from an intercepted test session.

### Direct cart verification and limits

The main palette and saved-cart controls share the existing signed-in direct-cart action and transaction journal. Native tests verify a fresh signed-out result blocks sending, an authenticated fixture sends the exact variant IDs and quantities once, existing website cart quantities are preserved, and the just-sent selection cannot be added again through a repeated click or reopen. The form suite independently sent one sheet order and one Fine-frit order, producing exactly two authenticated fixture POSTs with the expected real catalog variants. Settings and editing operations produced none.

The 125-test suite also retains uncertain-response, partial-stock, lost-response recovery, concurrent-click, interrupted-worker, and replay protection checks. No live personal Bullseye account or cart was used. These results verify the extension in disposable native Chrome profiles with intercepted store traffic; Bullseye remains responsible for live stock, final prices, and accepting the selected quantities.

The thickness header remains **100% thickness = 6 mm solid glass, 16 mm fine frit**. Percentages are the requested estimate from photographed color strength, not a newly measured sheet or frit-depth calibration. They never change full-color match scores.

Replace files in the same installed unpacked extension folder, click **Reload** at `chrome://extensions`, refresh already-open source pages, and reopen the picker. Keeping the same extension installation preserves profile-local saved palettes, saved carts, and settings. Publishing GitHub alone does not reload an installed unpacked copy.

---

## Version 0.3.0 — historical

Verified on 2026-10-18 with Node 24.19.0, Python/Pillow, and an isolated Google Chrome for Testing 155.0.8059.84 profile. This section retains the results and catalog size of version 0.3.0.

### Repeatable checks

From the repository root:

```sh
npm test
npm run check
python scripts/check-sampling.py
npm run package
```

The final JavaScript suite passes **85 tests**, including **27 palette/matching tests**. It covers CIEDE2000 reference values, full-color matching, automatic nearest matches beyond the old cutoff, material-type filters, neutral eligibility, actual image-point coordinates, absolute internal darkness, estimated thickness references, Pinterest image handoff, request cancellation, customer-session handling, cart writes, and replay prevention.

The **five Python sampling tests** verify that blue, black, gray, and white retain their measured material RGB when background is present; absolute darkness remains meaningful even for a uniform black image; and a marker whose source grain loses visible color during resizing is moved to actual material that remains visible in the bundled preview. Marker movement never changes the measured sample color.

Structural checks cover Manifest V3 entry points, local assets and module imports, matching manifest/package/catalog versions, exact seed/catalog inventory coverage, RGB/Lab consistency, source-image review hashes, bundled-image hashes, measured reference colors, and ZIP integrity with a root-level manifest. Version 0.3.0 adds no Chrome permissions.

### Complete catalog review

| Inventory | Count |
| --- | ---: |
| Included medium-frit colors | **141** |
| Transparent, including 20 transparent tints | **75** |
| Opalescent search group | **66** |
| Measured appearance samples | **5,484** |
| Real jar variants | **369** |
| Explicitly excluded medium-frit listings | **8** |

Discovery read every product sitemap from Bullseye's current store and verified the medium-frit product JSON and `-0002-F` SKU family. The eight exclusions are five clear/colorless listings and three mixed-color listings. Translucent White is assigned to the opalescent search group according to Bullseye's catalog, while retaining its exact storefront name and source type. The complete inventory, exclusions, photograph URLs, and selection rules are in [catalog sources](catalog-sources.md).

All **141 source photographs were visually reviewed**, their review hashes match the source bytes, and every bundled JPEG decodes and matches its recorded hash. All **32 photographs from version 0.2.1 remain byte-for-byte identical**. The library uses 123 fired spreads, two explicitly labeled medium-frit tiles, and 16 cast medium-frit wedges with reviewed front-face crops. Cold-frit dishes, other grain sizes, labels, bright gaps, and surrounding backdrops are excluded from sampling.

All **5,484 markers** were checked against the encoded 600-pixel previews. Chromatic material remains visibly colored after resizing, and neutral markers stay within their reviewed material intervals. Two small-grain markers required a nearby eligible position after downsampling; the measured RGB/Lab values were unchanged. All measured chromatic samples themselves meet C*≥10, and all neutral samples meet C*<10.

Of the source photos, **120 are untagged and interpreted as sRGB; 21 contain embedded profiles that are converted to sRGB**. Every bundled JPEG embeds sRGB. Images and catalog JSON are written atomically. No user photographs or screenshots are included in the repository preview or product-image library.

### Matching and thickness regressions

Automatic matching immediately returns the closest eligible full-color sample. The old Standard/Loose control is removed from the user flow. `#E3E3E3`, white, gray, and black cannot use the pale gaps from Light Sky Blue or any other chromatic product. Transparent-only and opalescent-only searches cannot reintroduce the excluded group.

With the expanded catalog, screenshot pink `#FA4EB5` automatically chooses **Fuchsia**; **Light Pink Striker** is the second transparent alternative, and **Pink Opalescent** is the closest opalescent-only result. Choosing an alternative and saving it preserves that user selection, including its selected jar and quantity.

For very dark neutral targets (C*<10 and L*≤20), ordinary **Black 000100** is preferred when it is within **0.25 ΔE00** of the best eligible result. The actual color-difference scores are unchanged. Three focused regressions verify this near-identical-match preference, keep a materially closer dark color ahead of Black, and ensure material filters and explicit strict tolerances are still respected. Native Chrome confirms `#000000` selects ordinary Black at **100% thickness**, while the transparent-only filter does not reintroduce opalescent Black.

The user-facing thickness guide displays **100% thickness = 6 mm solid glass, 16 mm fine frit** at the top right. The catalog and cart products remain medium frit. This is the requested estimated guide, not a measurement or Bullseye calibration of the source photographs. Transparent estimates use the product's recorded dense reference and actual sampled RGB; opalescent glass uses its full-color 100% reference. Black therefore never becomes 0% merely because it is the lightest black sample in a narrow photograph range. Missing or invalid reference colors cannot produce invented percentages, and thickness labels never alter full-color scores.

### Native Chrome interface checks

Native MV3 interface checks passed in four recorded runs: **30 initial checks**, **six focused recovery checks**, **17 checks with the completed 141-color catalog**, and **two final ordinary-Black policy checks**. These are 55 successful check executions with some deliberately repeated coverage across datasets, not 55 unrelated behaviors. All runs reported zero browser page errors.

Verified behavior includes:

- Portrait photographs occupy a large left column with palette and glass rows beside them; horizontal photographs occupy the top.
- Fit, Larger, and Full width preserve the image's aspect ratio and the alignment of its numbered color points.
- Points still drag and resample after enlargement; clicking the enlarged image adds a point.
- All palettes is the leftmost control immediately below the swatches and remains accessible before import or after source removal.
- Show full palette returns from an individual color's alternatives to every palette row and clears the alternatives search.
- The actual interface lists exactly 141 colors with both material buttons active, 75 transparent, or 66 in the opalescent group.
- Turning both groups off shows a clear selection prompt; type filters retain chosen jars and quantities.
- Saved palettes retain their actual local photo, thumbnail, point coordinates, edited colors, chosen alternatives, jar sizes, quantities, material filters, and image layout.
- Reopening a saved workspace restores the photo and selections; an unreadable saved photo preserves the current workspace instead of falsely reporting success.
- The narrow 552- and 360-pixel layouts have no horizontal overflow.

The completed-catalog portrait run at normal browser zoom measured:

| Content viewport | Source photo height | Fully visible glass rows | Bottom of fifth row | Bottom of sixth row |
| --- | ---: | ---: | ---: | ---: |
| 1440 × 900 | 788 px | **6** | 798.8 px | 893.8 px |

The earlier 1440 × 1000 layout run also displayed all six rows. Additional colors extend down the page. The repository preview uses an original geometric portrait fixture with no personal account or user-image data; Bullseye product photography remains attributed.

### Cart scope and update lifecycle

The native direct-cart implementation is unchanged in this release. Its final automated fixtures pass as part of the 85-test suite, including fresh customer checks, one add request with real variant IDs and quantities, preserving existing cart items, and recovery from duplicate, partial, or uncertain responses. The earlier isolated native Chrome cart checks are recorded below. No live personal Bullseye account or cart was used for these verification runs.

Replace the files in the existing unpacked extension folder, click **Reload** on its card at `chrome://extensions`, refresh Pinterest or any source page already open, and close/reopen the picker. Keep the same installation and folder to retain saved palettes. Publishing this repository does not update an already-loaded unpacked copy.

---

## Version 0.2.1 Pinterest patch — historical

Verified on 2026-10-18. Pinterest's current home-feed photo hover overlay was inspected in the connected Chrome tab: the overlay sits inside the photo's link and intercepts the image context. The new `findLinkedImage` resolver returned that photo's actual displayed `currentSrc` when run against the live page.

The main context-menu entry now covers both images and links. Direct image clicks retain their existing path. Link-only clicks use a one-time isolated DOM lookup in the clicked frame; no manifest permissions were added. Only photos within the exact clicked link are considered. Hidden carousel slides, small icons, and ambiguous choices are excluded.

The complete JavaScript suite passes **71 tests**, including 12 serialized DOM resolver checks and four new worker regressions for linked-photo handoff, direct-image precedence, missing/denied page access, and stale lookup cancellation. The code and packaging checks also pass.

After replacing the installed files, reload the extension at `chrome://extensions`, refresh the Pinterest tab, and reopen the picker. Publishing this patch does not update an existing unpacked installation. The live-page check verifies the new image lookup; it does not establish that the user's installed copy has been updated.

## Version 0.2.0 verification — historical

Verified on 2026-10-18 with Node 24.19.0, Python/Pillow, and an isolated Google Chrome for Testing 155.0.8059.84 profile.

### Repeatable project checks

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

### Catalog review

All 32 source photograph hashes retain their reviewed status. New neutral entries are ordinary Black and White Opalescent plus Charcoal Gray, Light Silver Gray, and Oregon Gray Transparent.

Every one of the 1,268 sample markers was checked against the actual bundled 600-pixel JPEG. No chromatic marker fell below C*=8 after image resizing; no gray or black marker fell in L*>94 background; no White marker fell below L*=85. Measured chromatic sample RGB itself must satisfy C*>=10. Thresholds, rectangles, source records, and representative pixel colors are included in the catalog.

The screenshot regression is explicit: **`#E3E3E3` cannot return Light Sky Blue, even at unlimited match tolerance.** Black, white, middle gray, and light gray return actual neutral products at the normal range.

### Native Chrome UI checks

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

#### Measured layout

Measured with a six-color image and six matching glass rows at normal browser zoom:

| Content viewport | Fully visible glass rows | Bottom of fifth row |
| --- | ---: | ---: |
| 1440 × 900 | 5 | 898 px |
| 1440 × 1000 | 5 | 979 px |
| 552 × 1000 | 5 | 979 px |

The 360-pixel view has no horizontal overflow. The source image, palette, cart actions, and glass list remain in that order. More colors extend down the page normally.

The repository preview uses an original geometric landscape fixture. It contains no user screenshots, bookmarks, account data, or personal photographs. Product reference photos remain attributed to Bullseye.

### Native cart integration

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

### After installing the update

Replace the files in the existing unpacked extension folder, reload its card at `chrome://extensions`, and reopen the picker. Keeping the same installation preserves local saved palettes. GitHub publication alone does not update an already-loaded unpacked copy.

Right-click an image, move or add a dot, select the desired glass rows, and use **Send to my cart**. If sign-in is required, use Bullseye's normal login and return to send the selection.
