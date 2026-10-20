# Bullseye Palette Picker

## v0.6.2: selected-grade photos throughout the app

Powder, Fine, Medium and Coarse now control the actual Bullseye photograph in the main palette, All glass, alternatives, enlarged details and every cart view. These views use the same verified photo selector and the existing 838-listing photo index. Jar weight is independent of frit grain size. Switching grades while details are open refreshes the displayed photo without allowing an earlier image request to replace it.

The selected-grade product photo no longer carries sample coordinates from another photograph. The existing medium-frit sampling image, swatches and thickness estimates remain together under **Thickness color reference · Medium frit** in the detail window. Your source image, colors, dots and chosen matches are unchanged.


## v0.6.1 update

Landscape glass photographs now have their information below them. All match cards fit across the available width or wrap to another row without sideways scrolling. Each name has a plain selection checkbox. Purchase controls show the frit grade or actual sheet thickness as well as size. Alternatives opens in a separate searchable popup without replacing the main palette. Light Orange Striker is preferred over an automatic Carnelian choice; explicitly selected Carnelian remains available and saved.

**Right-click a photo, get matching Bullseye glass selected automatically, and click Send to my cart.**

Version **0.6.0** selects the suggested glass as soon as a palette loads. Choose **Sheets, Powder, Fine, Medium, or Coarse** at the top, save your preferred settings, and keep multiple named carts that you can edit, duplicate, and send directly to Bullseye. Frit starts with an available **5 lb. jar**, with another available size used when necessary.

The reviewed color guide contains **141 colors — 75 transparent and 66 in the opalescent group —** with **5,484 photographed color samples**. The purchase catalog maps those colors to **2,088 actual Bullseye variants**, including standard sheets for 137 colors. Clear is excluded. Independent **Transparent** and **Opalescent** buttons let you search either group or both. See [product-format coverage and sources](docs/product-formats.md).

**Pinterest fix:** the right-click command also appears on photo links and their hover overlays. It reads the visible photo inside the clicked link, using its displayed image source. No additional permissions are required.

![Bullseye Palette Picker: a large portrait image beside its editable palette and compact glass list](https://raw.githubusercontent.com/Keyslah/Bullseye-Palette-Picker/main/docs/picker-preview.png)

Product reference photography © Bullseye Glass Co.


## New in v0.6.0

The workspace puts the source photo and glass comparison first. Buttons share one compact, left-to-right wrapping toolbar rather than separate rows for settings, image controls, cart actions, and filters.

**Top controls.** Refresh, Transparent, Opalescent, and Tints start the toolbar together. Load palettes, Save palette, Save cart, Saved Carts, Send, search, and navigation share its remaining space. Settings contains the glass form, default jar size, named Save settings, and Load settings. Image contains import/capture controls and Fit / Larger / Full width. Account and the information menu hold status and reference text.

**Palette strip.** Show full palette is first at the far left, followed by an uninterrupted sequence of swatches. Color hex values and the editor live behind Edit color rather than occupying every swatch and another full row. Numbered dots still identify sampled image locations.

**Portrait and square photos.** The vertical glass list is to the left of the source photo, even in the narrower side panel. Each card's name, thickness estimate, and purchase control are on the left; its glass photograph is on the right, nearest the source image. Larger is the starting image size and fills the available portrait column. The previous v5 workspace's Fit view changes to Larger once on upgrade, without modifying its image, colors, or dots. Explicitly loading a saved palette or settings preset still restores its chosen view.

**Landscape photos.** Glass cards form a horizontal comparison strip directly beneath the larger image. Extra cards scroll horizontally instead of creating a long vertical list below it.

**Compact product cards.** A single purchase dropdown contains package/sheet size, quantity, selection, and price. The main card no longer repeats SKUs and long detail text. Click the glass photograph for the large reference view, product code, sampled colors, full purchase information, and Use for this color / Alternatives controls.

**French Vanilla and coral alternatives.** Explicit Alternatives and glass search include both neutral and chromatic product families while continuing to ignore background gaps in product photographs. French Vanilla is no longer completely excluded from a pale cream target by the old neutral/chromatic cutoff. Sunset Coral stays available in alternatives. Coral Orange Tint is included when Tints is on. All are still sorted by measured full-color difference; automatic suggestions retain the existing stricter neutral/chromatic eligibility. A deliberately chosen alternative persists through reloads and palette saving.

Refresh still resets settings/view without resampling the photo. Remix separately creates a new sampled palette. Named settings, named palettes, the full cart page, and read-only website-cart copying remain available. Tints remain off by default.

**Cart boundary:** Copy my Bullseye cart reads a local draft without modifying website quantities. Send is additive, not a replacement of the website cart. The v5 cart-copy limits remain: ordinary USD items, quantities 1 to 999, and only supported catalog glass can be sent by this tool. No action completes checkout.

## Install or update in Chrome

No compilation, API key, or Node installation is required to use the extension. A Bullseye account is required for its direct cart action.

1. [Download the repository ZIP](https://github.com/Keyslah/Bullseye-Palette-Picker/archive/refs/heads/main.zip) and extract it to a folder you will keep.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`extension` folder inside the extracted repository**. It contains `manifest.json`.
4. Right-click a web image and choose **Create Bullseye palette**. The toolbar button also opens the picker.

Chrome documents these [unpacked-extension steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Updating an existing installation:** replace the files in the same extension folder with the new version, click **Reload** on its card at `chrome://extensions`, refresh Pinterest or any source page already open, and close/reopen the picker. Keep the same installed extension and folder to retain its saved palettes. An unpacked extension does not automatically update when this GitHub repository changes.

The prepared **`Bullseye-Palette-Picker-v0.6.2.zip`** has `manifest.json` at its root. If you use that package instead of the repository ZIP, extract it and load the extracted root folder.

## Pick and edit colors

- **A larger image.** Right-click an image, choose a file, paste, or capture a region. Portrait and square photos occupy the right column, with the glass list on their left. Landscape photos run above a horizontal glass strip. **Fit / Larger / Full width** controls resize the complete image without cropping it.
- **A dot for every image color.** Automatic colors have numbered points at actual source pixels. Drag a point to resample; click another image location to add another color. Fully transparent pixels do not create false black samples.
- **A clear way back.** Select a swatch or point to edit its hex/color, remove it, or inspect alternatives. Check **Show full palette** at the far left of the swatches to return to all palette colors together.
- **Compact glass comparison.** A vertical list sits left of portrait/square images; landscape images use a horizontal strip. Each card shows a real reference photo, name, estimated thickness, and a compact purchase dropdown. Codes and full information are in the photo detail view.
- **Selected by default.** Each photo color starts with the closest eligible glass that has an available option in the chosen format. Frit prefers an available 5 lb. jar; the **Default jar** control also offers 1 lb. and 5 oz. Shared matches select one package per distinct variant with one shared quantity. No range control, slider, or preliminary checkbox clicks are needed.
- **Editable selections.** Uncheck any glass, change its size or quantity, or choose an alternative. Moving a dot updates its automatic selection. Your unchecked choices remain unchecked while you browse, reopen the picker, or save and reload the palette. Deliberately added extras from All glass are retained.
- **Save the complete palette.** Saved palettes include a local copy of the photo, point positions, edited colors, selected glass, purchase format, package choices, quantities, material filters, and image size. **Load palettes** is in the top toolbar. Saved entries include photo thumbnails and restore their own photo and purchase choices.

The side panel and full workspace both adapt to image orientation. Portrait/square glass comparisons stay on the left; landscape comparisons run horizontally below the photo. An expanded glass reference view lets you inspect the measured samples without enlarging every list row.

Some web images are hosted on a separate domain. The picker requests access to that particular image host after you select the image. File import, paste, and region capture are available when a host will not serve the image.

## Glass format and saved settings

The top **Sheets / Powder / Fine / Medium / Coarse** buttons change the actual purchase options for the current selection. Each option uses its own verified Bullseye product and variant IDs. The source photo, sampled colors, and thickness guide stay available while you switch formats. A color without a verified or available option is not replaced with a fabricated SKU.

| Purchase format | Colors with a verified listing | Purchase variants |
| --- | ---: | ---: |
| Sheets | 137 | 650 |
| Powder frit | 141 | 353 |
| Fine frit | 141 | 351 |
| Medium frit | 141 | 369 |
| Coarse frit | 141 | 365 |
| **Total variants** | **141 distinct guide colors** | **2,088** |

These are the [bundled October 18, 2026 inventory counts](extension/data/product-formats.json); listing coverage does not mean every size is in stock. Sheet choices display their actual thickness, rolled finish, and dimensions. An available standard 3 mm sheet is preferred, with other verified sizes available in the selector. The frit jar preference does not change a sheet's dimensions.

Click **Save settings** and enter a preset name to remember the glass format, preferred jar size, included material types, tint inclusion, full-palette view, starting automatic-color count, and image size. New photos use the current settings. The picker restores a previous workspace or saved palette with its own working choices; saving defaults does not rewrite those saved records.

## Multiple saved carts

**Save cart** copies the current selected glass into a separate cart editor. Give it a name and save it. **Saved Carts**, at the top, opens the cart page and lists all your named carts with color previews, quantities, and estimated totals.

- **Edit** a cart's name, colors, selected sizes, and quantities. Add another color through its search list or remove individual items.
- **Duplicate** creates an independent copy. Changing the copy leaves the original intact.
- **Send to my cart** works directly from a saved-cart entry or from its editor. It uses the same signed-in Bullseye cart action as the main palette.
- **New cart** starts an empty named order. Empty carts can be saved and filled later; sending requires at least one selected item.

Saved carts keep exact variant IDs and quantities, including their purchase form and size when the global format changes. New colors added in the editor use the current format and preferred jar size. If a saved size is unavailable, the editor shows it so you can choose another size or remove it. Editing a saved cart does not replace the photo palette. Saved carts, saved photo palettes, and Bullseye's website cart are independent records.

## Correct color matching

Matching compares the **full color** using CIEDE2000: hue, chroma, and lightness all matter. A green and red with the same grayscale value do not become matches.

The photograph library measures **visible glass material**, excluding nearly colorless gaps from colored frit samples. Every retained sample has an RGB color and a representative location in the reference photo. The library includes all **20 transparent tints**, colored opals, and gray/black/white choices. Translucent White remains labeled with its storefront name and is grouped under Opalescent as in Bullseye’s catalog. White, gray, and black targets are matched only to the neutral products; colored targets use visibly colored samples from chromatic products.

The explicit library policy uses CIELAB chroma **C* = 10** as the dividing line between neutral and chromatic colors. This is a practical eligibility rule for this catalog, not a universal claim about human color perception. Automatic matching ranks every eligible product by its actual color difference; it does not claim that a catalog contains an exact match for every image color. White, gray, or black cannot match the nearly colorless gaps in a colored glass photograph.

This fixes the earlier case where a gray `#E3E3E3` swatch matched the nearly white end of Light Sky Blue. Opalescent White, transparent grays, and Black provide actual neutral choices.

For a near-identical dark neutral match, the picker prefers **ordinary Black (000100)** over a specialty black in the color guide. This applies only when the target has `L* <= 20` and ordinary Black is within **0.25 ΔE00** of the best eligible match. The displayed color-difference scores remain unchanged, and the rule respects material filters and any explicit match tolerance. A materially closer dark green or blue stays first.

### Thickness guide

A result reads, for example, **“Spring Green at 75% thickness.”** At the top right, the picker displays the project's requested reference:

**100% thickness = 6 mm solid glass, 16 mm fine frit**

This is an **estimated thickness guide based on photographed color strength**, not a measurement of the source glass or a Bullseye-certified firing recipe. Percentages remain visible for **every purchase format, including Sheets**. All formats retain the reviewed medium-frit color samples for matching and thickness estimates, separately from the actual selected-grade product photographs; choosing sheets or another frit grain does not create a new physical calibration. A sheet's actual millimeter thickness is shown separately in its purchase-size label. The fine-frit value above is the project's requested reference text.

For transparent glass, the estimate compares the matched sample's lightness with that product's dense color reference, using white as the zero-color anchor. It does not reset the lightest retained material sample to zero. Chromatic opalescent glass also uses the photographed-strength comparison, so different shades no longer all display 100%. Neutral opalescent and opaque glass, including ordinary Black and White, retain their **100% full-color reference**. Neither model establishes physical depth from opaque grains. These labels do not affect the full-color match ranking. The photograph and exact sampled color remain visible for inspection.

The reference library uses **123 fired medium-frit spreads, two explicitly labeled medium-frit tiles, and 16 cast medium-frit wedges**. The wedges provide visible color for pale tints; their reviewed sampling rectangles exclude the surrounding backdrop. Of the 141 source images, **120 are untagged and interpreted as sRGB; 21 carry embedded profiles and are converted to sRGB**. Every bundled image embeds sRGB. Lighting, screens, and actual glass can differ. See [catalog sources and sampling details](docs/catalog-sources.md) for all product links, source hashes, image selections, and measurements.

## Direct cart behavior

The palette's suggested glass is already checked. Click **Send to my cart**, or first edit the checked colors, purchase sizes, or quantities. You can also send a named saved cart directly from its list entry or editor. The extension checks the Bullseye customer session, adds the selected real variants directly through the store's cart API, and opens the cart. It preserves products already there. There is no Quick Add page, SKU submission form, or second Add to Cart step.

Automatic suggestions use the closest eligible full-color match with an available purchase option in the selected format's snapshot. Sold-out colors remain visible in alternatives; choosing one explicitly does not silently substitute another glass. Duplicate matches share one selected variant and quantity. The cart button becomes ready from the local selection; the store receives an addition only when you click it.

If a signed-in session cannot be confirmed, the picker asks you to sign in to Bullseye in the normal store page. It rechecks sign-in before sending. Passwords are handled by Bullseye; the extension does not read or store them.

The cart action uses [Shopify's documented Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart) in a native Bullseye tab. It uses actual variant IDs and quantities. Bullseye confirms stock, prices, quantity limits, and discounts. The extension reports failures instead of claiming an unconfirmed addition succeeded, and does not automatically retry an uncertain cart write.

It never clears your existing store cart or completes checkout. Saving settings, palettes, or named carts does not add anything to Bullseye.

## Development and verification

The extension is plain JavaScript, HTML, and CSS with no remote scripts or runtime dependencies. Its bundled color guide and product-format index work offline. Shopping and importing a web image require their respective network access.

```sh
npm test
npm run check
npm run package
```

Development requires Node 20 or later. Packaging also uses Python 3's standard library and creates `dist/Bullseye-Palette-Picker-v0.6.2.zip`, with the manifest at the ZIP root. Extract that packaged ZIP and load its root folder in Chrome. Version 0.6.0 retains the reviewed **0.3.0 color catalog byte for byte**, including its photographs, RGB/Lab samples, and source timestamps. Its additional purchase options live in a separate format index.

To refresh public purchase-format records or reproduce them from an existing source cache:

```sh
python scripts/build-product-formats.py --refresh
python scripts/build-product-formats.py --offline
```

Run those as separate alternatives. An offline rebuild requires the cached source records; a fresh checkout must obtain them first. This builder writes the format index and its ignored source cache. It does not download reference photographs, change the color guide, or access a customer account or cart. See [format source and validation rules](docs/product-formats.md).

To rebuild the catalog from the documented public product sources:

```sh
python -m pip install -r requirements-dev.txt
python scripts/build-catalog.py
python scripts/check-sampling.py
```

The builder downloads the seed product records and images and replaces the bundled catalog. A changed source photo requires a new visual review. See its header and `--help` for output behavior and sampling constraints.

The [verification record](docs/verification.md) covers color regression tests, neutral eligibility, draggable points, persistence, layout checks, and isolated cart integration tests. Cart fixtures do not constitute a live purchase or a test in your personal Bullseye account.

| File | Purpose |
| --- | --- |
| `extension/manifest.json` | Chrome permissions and extension entry points |
| `extension/service-worker.js` | Image handoff and store integration |
| `extension/picker.html`, `.css`, `.js` | Compact picker, movable points, and shopping controls |
| `extension/lib/color.js`, `palette.js` | Full-color conversion, extraction, and matching rules |
| `extension/lib/selection.js` | Automatic package selection, exclusions, and saved selection intent |
| `extension/lib/saved-palettes.js` | Named palettes stored in the extension |
| `extension/lib/product-formats.js` | Verified purchase formats and default package choices |
| `extension/lib/settings.js` | Explicitly saved defaults, separate from the workspace |
| `extension/lib/saved-carts.js`, `cart-library.js` | Named-cart storage, list, editor, and direct-send controls |
| `extension/data/catalog.json` | Reviewed medium-frit color guide and photo provenance |
| `extension/data/product-formats.json` | Actual sheet/frit variants and public source provenance |
| `scripts/build-catalog.py` | Reproducible catalog builder |
| `scripts/build-product-formats.py` | Public purchase-format inventory builder |
| `tests/` | Regression checks |

## Privacy and attribution

Images, palettes, saved carts, and settings stay in your Chrome profile. There are no analytics, advertising, or image-analysis uploads. See [PRIVACY.md](PRIVACY.md) for stored data and permissions.

An independent project, not affiliated with or endorsed by Bullseye Glass Co. Product photography **© Bullseye Glass Co.** The software license excludes Bullseye photographs and trademarks. See [ATTRIBUTION.md](ATTRIBUTION.md).

## Cart builder additions

Beside Add a color, Grade and Size select the exact frit grade/package or sheet dimensions and thickness for new additions. Each existing row also has its own grade and size controls. Unavailable combinations remain unavailable instead of silently changing your requested size.

Clear is a separate cart filter for Clear Transparent, Clear Transparent Tekta, and Crystal Clear Transparent. These are cart-only products and do not dilute the photo-matching palette.

Click any photo in the cart editor, Add a color results or saved-cart preview for a large image. The image follows the selected frit grade or sheet product. Variant-assigned photos take priority when provided; otherwise the photo is shared by that product's package sizes. More images from that listing can be browsed in the preview. Remote photos require an internet connection. No photo-sampling data is changed.
