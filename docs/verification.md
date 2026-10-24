# Verification record

## Version 0.6.7

Continues from main and published v0.6.6 commit `27c4207966cfc131f5851276c147cd89e60f9d85`. Source changes are limited to the requested cart workflow, independent Alternatives filters, sign-in labeling, personal-data retention and their verification/documentation. Catalogs, images, photo samples and thickness calculations remain unchanged.

### Cart workflow

Native Chromium tests verify Add to Cart without a naming prompt, summed item quantities on the top-right Cart button, repeated additions, and live synchronization between picker and cart tabs. Edits and quantities survive reload. Add Colors remains a separate dialog, reached from beside the Cart items heading. Main/cart/dialog bounds are checked at desktop and narrow widths.

Successful website sends leave the Send cart to Bullseye button available. Two deliberate sends generate two independent native-store POSTs with the exact displayed variants and quantities. Same-request replay protection, overlapping-click coalescing, and uncertain-outcome guards remain. Empty Bullseye cart is independently confirmed, makes one clear POST and a verification GET, preserves local/named carts, and allows another send. Tests also delete the currently open named cart and verify its working copy remains editable and can be saved under a new ID.

### Personal data and alternatives

Actual Chrome local storage and IndexedDB are exercised in disposable profiles. An in-place version update followed by browser restart keeps the extension ID and every saved workspace, photo, setting, palette and cart. Backup/restore transfers the same records into a different folder with a different unpacked ID. Named records merge without clearing unrelated data; invalid files are rejected before writes. Account/session data and cart-request journals are excluded.

The actual Settings backup download and restore-file controls are exercised. Web Locks wait for in-flight workspace/cart writes before restore; a generation marker blocks writes from stale pages. A second open picker reloads the restored filters and working-cart count. Workspace saves are handed synchronously to the background worker, which serializes them and makes a fresh page wait for pending writes before loading. This fixes the immediate-reload mismatch caught by the first release run, without relaxing its color assertions. Storage read failures propagate rather than causing defaults to overwrite unread data. Working-cart edits are scoped to their active copy and cannot be merged into a different cart opened elsewhere.

Independent Alternatives tests verify that Transparent, Opalescent and Tints affect only the dialog. Choosing an excluded material changes one target and preserves the main settings through reload. Retained layout and black/purple matching suites remain part of the release gate.

### Release gate

The final local JavaScript run passes **229 tests**. Native groups pass as follows: workspace and exact package 47; cart builder 12; toolbar/Alternatives layout 19; Black/purple matching 9; independent Alternatives 5; cart workflow and failure recovery 11. Personal-data checks cover native storage, in-place updates, transfer between installations, cross-tab restore and saving through immediate reload. The focused cart suite includes an injected storage-write failure followed by another edit, and two fast edits queued behind a delayed write; no quantity changes are lost. All successful browser runs report no uncaught page errors.

```sh
npm test
npm run check
npm run package
python scripts/verify-package.py
python tests/v061-browser.py
python tests/v063-layout-browser.py
python tests/v065-matching-browser.py
python tests/v067-alternatives-browser.py
python tests/v067-cart-browser.py
python tests/personal-data-browser.py
```

The v061 suite also runs the cart-builder checks. Browser tests use synthetic storefront responses and disposable profiles; no customer account or live cart is accessed. The ZIP contains exactly 185 files and is verified byte for byte against the source before publishing and again after downloading the published release. Updates require replacing files in the same installed folder, clicking Reload at `chrome://extensions`, and reopening picker/cart tabs.

---

## Version 0.6.6

Continues from the verified current main and published v0.6.5 commit `5a5607a`. The [initial v0.6.6 verification run](https://github.com/Keyslah/Bullseye-Palette-Picker/actions/runs/40028748573) passed on 2026-10-23 with **190 JavaScript tests**, manifest/catalog/module checks, and exact-source ZIP checks.

### Black matching

The failure was reproduced using real catalog photographs. Fine targets `#202729` and `#1C1721`, Coarse `#202020`, and Sheets `#101010` chose Aventurine Blue before the fix. Fine `#202729` gave Aventurine Blue 6.25 ΔE00 and ordinary Black 7.50 ΔE00, exceeding the old 0.25 near-tie preference. All four now automatically choose regular Black (`000100`). The automatic policy uses the existing near-black neutral range: L* ≤ 20 and C* < 10. It selects only an eligible, available Black match; the underlying color scores, photo samples, coordinates, and alternative ordering are unchanged.

The updated native matching suite passed **9 checks**, covering four black/near-black targets across all five forms, actual Fine photographs and marker coordinates, purple and blue controls, independent cart filters, reload and named palette preservation, and explicit colored alternatives overriding the automatic recommendation. The unit tests also cover image-extracted near-black targets, dark chromatic and lighter gray controls, unavailable Black, material exclusions, and strict distance limits.

### Focused cart workspace

The main workspace shows the current cart's items with a full-width **Send to Bullseye Website Cart** button in the first toolbar row, at least 64 px high. **Add Color** opens a native modal containing the catalog, filters, search, grade, and size controls. The catalog is rendered when opened and remains hidden on the main page.

The cart suite passed **10 checks**: empty-cart state; modal open/close/Escape and focus return; real frit and sheet options; mixed grades, quantities and saved carts; unavailable sizes; nested enlarged photos; desktop and narrow bounds; and one explicit send containing exactly the displayed cart's variants and quantities. The retained workspace suite passed **45 checks**, and the toolbar/Alternatives layout suite passed **19 checks**. Successful native runs reported no uncaught browser errors. Store traffic used disposable fixtures.

Actual main-cart and Add Color screenshots were inspected at 1440 px and 380 px. The catalog is separate, the send action stays prominent, and narrow layouts wrap within the viewport. Existing explicit or previously preserved glass choices remain saved; an old pinned choice can be changed through Alternatives.

### Release integrity

The installable ZIP contains exactly **182 files** with a root-level manifest, matching the tested extension and included documentation byte for byte. The publication gate repeats the tests and verifies the downloaded published archive against the same source. Upgrade requires replacing files in the existing extension folder, clicking **Reload** at `chrome://extensions`, and reopening picker/cart tabs.

---

## Version 0.6.5

Verified on 2026-10-20 in disposable native Chromium extension profiles, starting from the actual published v0.6.4 main commit `d2b9196`. The only production logic changes are the regular Black exception in the shared material filter and a target-aware automatic purple preference; no layout, photo data, source-image extraction, or percentage calculation changes are included.

The **186 JavaScript regressions pass**. New cases cover the exact transparent-only eligible set, real Black variants across all five forms, and the screenshot's measured target `#6A12DE` across Powder/Fine/Medium/Coarse. Blue and blue-violet controls retain their original full-color choices. Tests retain availability, finite tolerance, actual sample identity, unchanged scores, neutral handling, and Orange Striker behavior.

The reported Fine mismatch was reproduced exactly: Deep Royal Blue sample `#263AB5` scored 11.36 ΔE00 and 96% reference strength, while Gold Purple `#5D447B` scored 17.42 ΔE00 but had a hue much closer to the purple target. The automatic preference now selects the actual Gold Purple Fine sample at its recorded coordinates, showing approximately 78%. The correction is limited to clearly chromatic purple targets (RGB hue 260–330°, saturation at least 0.25) that would otherwise select a blue sample (180–255°). A replacement must be available, within 25 ΔE00 and no more than 10 ΔE00 worse than the original, with a purple hue within 25° of the target and at least 5° better. These are practical picker preferences; raw CIEDE2000 scores and all alternatives remain unchanged.

The new `tests/v065-matching-browser.py` passes **7 focused checks**: transparent-only Black/purple/blue automatic choices; real Fine photos and marker coordinates; All glass/Alternatives filtering; all-form switching, Refresh, named palette and source/dot restoration; preserved explicit blue selection; independent cart filtering with real Black variants; and no page errors or shopping writes. Actual 1440 px and 650 px screenshots were inspected. Shop requests use fixtures in disposable profiles.

The release gate also repeats the retained native workspace, cart-builder, and Alternatives/layout suites. The final ZIP inventory and every file byte are checked against the tested source before publication and against the downloaded release afterward. Existing pinned glass choices remain saved rather than being reset on upgrade.

---

## Version 0.6.4

Verified on 2026-10-20 in disposable native Chromium 156.0.8078.4 extension profiles. This presentation update moves the existing Settings menu between Sign in and Transparent and shows the requested thickness reference directly on the main palette bar, ending with `*Rough estimate`.

The **175 JavaScript regressions**, structural checks, and exact-source ZIP checks pass. The updated existing layout suite verifies **19 checks**: immediate reference visibility with no menu open; exact toolbar order and complete text containment at 1440, 1000, 650, 380, and 320 px; usable Settings form/package controls at 1000 and 320 px; and retained Alternatives card bounds and purchase popovers at five widths. Actual 1000 px and 320 px main screenshots were visually inspected, along with desktop/narrow Alternatives views. No uncaught browser errors were reported.

The retained native workspace suite covers source-image orientation, compact layout, edited colors and dots, named saves, settings, alternatives, and cart controls. Its compactness check allows the newly visible reference row when it wraps below the palette controls while keeping the prior limit for the controls themselves. Shopping remains isolated from personal accounts and carts.

The release workflow repeats `npm test`, `npm run check`, packaging, `tests/v061-browser.py`, and `tests/v063-layout-browser.py` before publication. The ZIP inventory and every byte are checked against source, then the public release download is checked again. Photograph data and matching calculations are unchanged from v0.6.3; their existing audit is recorded below.

---

## Version 0.6.3

Verified on 2026-10-20 with Node 24.19.0, Python/Pillow/NumPy, and disposable native Chromium 156.0.8078.4 extension profiles. This release continues from the published v0.6.2 source. The earlier records below are historical and describe their respective versions.

### Repeatable checks

```sh
npm test
npm run check
python scripts/check-sampling.py
python scripts/check-form-sampling.py
npm run package
python scripts/verify-package.py
python tests/v062-browser.py
python tests/item-purchase-browser.py
python tests/v063-layout-browser.py
python tests/v063-samples-browser.py
```

The JavaScript suite passes **175 tests**. The five original Python sampling tests still pass. The independent form audit verifies **564 original Bullseye photographs**, **22,499 matching/swatches samples**, and **37,670 spatial inspection entries** against exact source pixels, image hashes, dimensions, and material regions. The original 141-image catalog and its reference data remain intact. The new matching data is specific to Powder, Fine, Medium, and Coarse; jar weights share the corresponding grain photograph.

The native suites cover:

| Suite | Passed checks | Scope |
| --- | ---: | --- |
| Retained v0.6.1 interface | 45 | Source layout, edited colors/dots, palettes, settings, alternatives, and carts |
| Retained v0.6.2 photographs | 22 | All 564 live image sources; main, detail, alternatives, cart, enlarged previews, and exact package bytes |
| Cart builder | 9 | Independent grain/package controls, clear glass, and enlarged photos |
| Individual item purchase | 12 | Real frit/sheet variants, quantity, isolation, reload, named palettes, and filtered explicit choices |
| Alternatives layout and toolbar | 12 | Computed geometry, wrapping, scrolling, usable purchase popovers, and Sign in beside Refresh |
| Selected-photo samples | 11 | Real images, full-color matches, swatches, photo clicks, shared ranges, delayed requests, and saved-work migration |

The retained photograph suite invokes the v0.6.1 and cart-builder suites; the table lists their results separately, not as independent runs to add twice. Successful runs report zero uncaught page errors. An initial concurrent local browser run stalled; sequential reruns and the release workflow execute the native suites without competing browser runs.

### Photographs, markers, and preservation

Actual Aquamarine Blue image bytes were downloaded and decoded for all four forms. Native checks verify the displayed URL, image dimensions, marker position, swatch RGB, nearest full-color match, and approximate percentage together. The supported sampled ranges on the existing shared reference are Powder **20–100%**, Fine **18–100%**, Medium **35–100%**, and Coarse **45–100%**. These minima come from measured samples, not hard-coded form rules. The detailed provenance and material masks are documented in [form sampling](form-sampling.md).

The browser test holds an actual Powder response, switches through Medium and Coarse to Fine, and releases the old response. Fine's photograph, marker, sample, and controls remain current. A real 1186 × 1200 source checks marker placement inside the image's actual contain bounds. White background clicks are ignored when distant or inspect a valid nearby glass point; no white gap becomes a sample.

A v0.6.2 saved workspace upgrades with the same glass choices, exact variant IDs, quantities, source-image pixels, source dots, and manually edited colors. Individual form changes preserve other items and deliberate unchecked states. A regression was confirmed failing before the final fix and passing afterward: changing another item while Transparent is filtered out preserves explicit Aquamarine Blue and Orange Striker choices for when the filter is restored.

### Actual popup layout inspection

The original Alternatives grid assigned approximately 76 px rows to cards roughly 191 px tall. Photo/content overflow then covered following rows. The correction is scoped to Alternatives: content-sized grid rows, explicit bounded photos, and independent card content sizing. Main source-image and match-card density are retained.

Screenshots and computed DOM bounds were inspected at **320, 380, 650, 1440, and 1920 px** viewport widths. Every photo, name, checkbox, percentage, and purchase trigger stays inside its card; rows do not overlap and columns do not spill horizontally. The grid scrolls vertically. Purchase popovers near its lower edge remain visible above the scroller, and their inputs can be used. The existing Sign in control is directly beside Refresh in the same compact toolbar.

### Shopping isolation and release integrity

Tests use disposable profiles with shopping requests blocked or intercepted by explicit fixtures. No personal account or live cart is used. Existing cart safety tests remain in the 175-test suite, including authentication checks, exact variant quantities, concurrent/repeated sends, and uncertain-response recovery. The original named palettes/settings/carts, clear-glass options, enlarged previews, website-cart copying, and Orange Striker preference/Carnelian alternative remain covered.

`scripts/verify-package.py` checks the ZIP's exact **182-file** inventory, root-level manifest version, CRCs, and every file byte against the tested source. It also records the source tree, archive SHA-256, and individual file hashes. The release workflow repeats the regressions before promoting the tested commit to main and publishing v0.6.3. The downloaded release archive is verified with the same checker.

After replacing files in the same installed folder, click **Reload** at `chrome://extensions`, confirm **0.6.3**, then close and reopen picker/cart tabs. Refresh existing source pages before using the image context menu. Keeping the same installed extension preserves Chrome's local saved work.

---

## Version 0.4.0 — historical

Verified on 2026-10-18 with Node 24.19.0 and isolated Google Chrome for Testing 155.0.8059.84 profiles. This section retains the results of version 0.4.0.

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
