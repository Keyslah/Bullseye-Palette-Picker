# Bullseye Palette Picker

**Right-click a photo, move its color points, choose matching Bullseye frit, and send the selected jars to your signed-in cart.**

Version **0.3.0** automatically finds the nearest eligible full-color glass match, includes **141 medium-frit colors — 75 transparent and 66 in the opalescent group —** and makes room for a much larger source image. Clear is excluded. Independent **Transparent** and **Opalescent** buttons let you search either group or both.

**Pinterest fix:** the right-click command also appears on photo links and their hover overlays. It reads the visible photo inside the clicked link, using its displayed image source. No additional permissions are required.

![Bullseye Palette Picker: a large portrait image beside its editable palette and compact glass list](https://raw.githubusercontent.com/Keyslah/Bullseye-Palette-Picker/main/docs/picker-preview.png)

Product reference photography © Bullseye Glass Co.

## Install or update in Chrome

No compilation, API key, or Node installation is required to use the extension. A Bullseye account is required for its direct cart action.

1. [Download the repository ZIP](https://github.com/Keyslah/Bullseye-Palette-Picker/archive/refs/heads/main.zip) and extract it to a folder you will keep.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`extension` folder inside the extracted repository**. It contains `manifest.json`.
4. Right-click a web image and choose **Create Bullseye palette**. The toolbar button also opens the picker.

Chrome documents these [unpacked-extension steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Updating an existing installation:** replace the files in the same extension folder with the new version, click **Reload** on its card at `chrome://extensions`, refresh Pinterest or any source page already open, and close/reopen the picker. Keep the same installed extension and folder to retain its saved palettes. An unpacked extension does not automatically update when this GitHub repository changes.

## Pick and edit colors

- **A larger image.** Right-click an image, choose a file, paste, or capture a region. Portrait photos use a large left column in the full workspace, with the palette and glass list beside them. Landscape photos run across the top. **Fit / Larger / Full width** controls resize the complete image without cropping it.
- **A dot for every image color.** Automatic colors have numbered points at actual source pixels. Drag a point to resample; click another image location to add another color. Fully transparent pixels do not create false black samples.
- **A clear way back.** Select a swatch or point to edit its hex/color, remove it, or inspect alternatives. Check **Show full palette** directly below the swatches to return to all palette colors together.
- **One vertical glass list.** Each row includes the real reference photo, glass name and code, estimated thickness percentage, jar size, quantity, and selection control.
- **Automatic closest matches.** The nearest eligible color is selected immediately. No range control or slider is needed. Choose an alternative yourself or browse the catalog, and use the highlighted material buttons to include transparent glass, opalescent glass, or both.
- **Save the complete palette.** Saved palettes include a local copy of the photo, point positions, edited colors, selected glass, jar sizes, quantities, material filters, and image size. **All palettes** is the leftmost control immediately below the palette swatches. Saved entries include photo thumbnails.

The narrow side panel keeps the image above the palette and results. The full workspace adapts to the image's orientation. An expanded glass reference view lets you inspect the measured samples without enlarging every list row.

Some web images are hosted on a separate domain. The picker requests access to that particular image host after you select the image. File import, paste, and region capture are available when a host will not serve the image.

## Correct color matching

Matching compares the **full color** using CIEDE2000: hue, chroma, and lightness all matter. A green and red with the same grayscale value do not become matches.

The photograph library measures **visible glass material**, excluding nearly colorless gaps from colored frit samples. Every retained sample has an RGB color and a representative location in the reference photo. The complete library contains **5,484 measured samples and 369 real jar variants**. It includes all **20 transparent tints**, colored opals, and current gray/black/white choices. Translucent White remains labeled with its storefront name and is grouped under Opalescent as in Bullseye’s catalog. White, gray, and black targets are matched only to the neutral products; colored targets use visibly colored samples from chromatic products.

The explicit library policy uses CIELAB chroma **C* = 10** as the dividing line between neutral and chromatic colors. This is a practical eligibility rule for this catalog, not a universal claim about human color perception. Automatic matching ranks every eligible product by its actual color difference; it does not claim that a catalog contains an exact match for every image color. White, gray, or black cannot match the nearly colorless gaps in a colored glass photograph.

This fixes the earlier case where a gray `#E3E3E3` swatch matched the nearly white end of Light Sky Blue. Opalescent White, transparent grays, and Black provide actual neutral choices.

For a near-identical dark neutral match, the picker prefers **ordinary Black frit (000100)** over a specialty black. This applies only when the target has `L* <= 20` and ordinary Black is within **0.25 ΔE00** of the best eligible match. The displayed color-difference scores remain unchanged, and the rule respects material filters and any explicit match tolerance. A materially closer dark green or blue stays first.

### Thickness guide

A result reads, for example, **“Spring Green at 75% thickness.”** At the top right, the picker displays the project's requested reference:

**100% thickness = 6 mm solid glass, 16 mm fine frit**

This is an **estimated thickness guide based on photographed color strength**, not a measurement of the source glass or a Bullseye-certified firing recipe. The catalog and cart products remain **medium frit**; the fine-frit value is the guide's reference text.

For transparent glass, the estimate compares the matched sample's lightness with that product's dense color reference, using white as the zero-color anchor. It does not reset the lightest retained material sample to zero. Opalescent and opaque glass use a **100% full-color reference**, including ordinary Black and White, because a photograph of opaque grains does not establish their physical depth. These labels do not affect the full-color match ranking. The photograph and exact sampled color remain visible for inspection.

The reference library uses **123 fired medium-frit spreads, two explicitly labeled medium-frit tiles, and 16 cast medium-frit wedges**. The wedges provide visible color for pale tints; their reviewed sampling rectangles exclude the surrounding backdrop. Of the 141 source images, **120 are untagged and interpreted as sRGB; 21 carry embedded profiles and are converted to sRGB**. Every bundled image embeds sRGB. Lighting, screens, and actual glass can differ. See [catalog sources and sampling details](docs/catalog-sources.md) for all product links, source hashes, image selections, and measurements.

## Direct cart behavior

Select the glass and click **Send to my cart**. The extension checks the Bullseye customer session, adds the selected real jar variants directly through the store's cart API, and opens the cart. It preserves products already there. There is no Quick Add page, SKU submission form, or second Add to Cart step.

If a signed-in session cannot be confirmed, the picker asks you to sign in to Bullseye in the normal store page. It rechecks sign-in before sending. Passwords are handled by Bullseye; the extension does not read or store them.

The cart action uses [Shopify's documented Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart) in a native Bullseye tab. It uses actual variant IDs and quantities. Bullseye confirms stock, prices, quantity limits, and discounts. The extension reports failures instead of claiming an unconfirmed addition succeeded, and does not automatically retry an uncertain cart write.

It never clears your existing store cart or completes checkout. The local glass selection and named palettes are separate from Bullseye's cart.

## Development and verification

The extension is plain JavaScript, HTML, and CSS with no remote scripts or runtime dependencies. Its bundled reference catalog works offline. Shopping and importing a web image require their respective network access.

```sh
npm test
npm run check
npm run package
```

Development requires Node 20 or later. Packaging also uses Python 3's standard library and creates `dist/Bullseye-Palette-Picker-v0.3.0.zip`, with the manifest at the ZIP root. Extract that packaged ZIP and load its root folder in Chrome.

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
| `extension/lib/saved-palettes.js` | Named palettes stored in the extension |
| `extension/data/catalog.json` | Measured glass samples, variants, and provenance |
| `scripts/build-catalog.py` | Reproducible catalog builder |
| `tests/` | Regression checks |

## Privacy and attribution

Images and palettes are processed and stored in your browser. There are no analytics, advertising, or image-analysis uploads. See [PRIVACY.md](PRIVACY.md) for stored data and permissions.

An independent project, not affiliated with or endorsed by Bullseye Glass Co. Product photography **© Bullseye Glass Co.** The software license excludes Bullseye photographs and trademarks. See [ATTRIBUTION.md](ATTRIBUTION.md).
