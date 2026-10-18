# Bullseye Palette Picker

**Turn a photo into an editable palette of colored transparent Bullseye medium frit.**

The first version includes **27 glass colors, 1,080 sampled colors, and 72 jar variants**, linked to real Bullseye product listings. Colorless clear is excluded.

Matching uses the **full color**—hue, saturation, and lightness—through CIEDE2000. Darkness is a label on the matched sample, such as **“Spring Green at 75% darkness.”** It does not decide which hue matches.

![Bullseye Palette Picker with an editable green palette and four photographed glass matches](https://raw.githubusercontent.com/Keyslah/Bullseye-Palette-Picker/main/docs/picker-preview.png)

The preview uses a Bullseye reference photograph as its input. Product photography © Bullseye Glass Co.

## Install in Chrome

No compilation, Node installation, account, or API key is required to use the extension.

1. On this repository, choose **Code → Download ZIP**, then extract the ZIP to a folder you will keep.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the **`extension` folder inside the extracted repository**. This is the folder containing `manifest.json`.
5. Open Chrome's extensions menu and pin **Bullseye Palette Picker** if you want its toolbar button.
6. Right-click a web photograph and choose **Create Bullseye palette**, or open the picker and choose an image.

These are Chrome's [documented unpacked-extension steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). This first version is distributed here as an unpacked extension.

### Updating an installed copy

Replace the files in your existing extension folder with the new version, then go to `chrome://extensions` and click **Reload** on Bullseye Palette Picker. **Close and reopen its side panel/workspace** so it reads the updated code and catalog. Refresh any open Bullseye page before trying a new Quick Add handoff. Chrome does not automatically reload unpacked extension code after a file change.

## Use it

- **Start with a photo:** right-click an image on the web, choose a file, drop a file, or paste an image.
- **Choose the colors yourself:** click anywhere in the photo to add that color. The automatic palette is only a starting point.
- **Edit the selection:** select a palette swatch, change its color or hex value, remove it, or add another custom color.
- **Adjust the match range:** tighter shows closer full-color matches; looser includes more alternatives. Selected glass stays selected as you explore.
- **Inspect the reference:** each match includes the actual frit photograph, the matching sample location, and its darkness percentage.
- **Pick your glass:** choose individual matches or browse the glass library; edit jar sizes and quantities in **My glass**.
- **Shop the selection:** use **Send to Bullseye cart** to open the store's Quick Add page. Review the SKU list, submit it to resolve the products, and choose **Add to Cart**. If the store's form cannot be prefilled, use **Copy SKU list** and paste it there.

Some web images use a separate image host. The picker can request permission for that host after you choose the image. **Capture a region**, file import, and paste provide alternatives when direct image access is unavailable.

The current image is reduced and saved locally with your palette and selected glass so you can reopen the project. See [PRIVACY.md](PRIVACY.md) for the stored data and removal behavior.

## How the color library works

Each product contains 40 measured colors from narrow bands across its real fired-frit photograph. The measured full-color RGB values are retained. Matching compares every measured sample with the selected image color and returns the closest sample for each glass product.

For labeling, samples are ordered by perceptual lightness. Darkness is normalized within that glass's sampled range:

- **100% darkness:** darkest sampled appearance of that product.
- **50% darkness:** halfway between its lightest and darkest sampled lightness values.
- **0% darkness:** lightest sampled appearance of that product.

A result's percentage is calculated from the actual matching sample. There is no separate darkness slider. Selections of the same glass and jar size share one shopping entry.

The matcher does not quietly widen a tight range when nothing qualifies. It offers explicit nearest alternatives so the user can choose.

The photographs are practical color references. Current storefront images are untagged; the catalog records an sRGB assumption and keeps the original source URLs and hashes. See [catalog sources and sampling details](https://github.com/Keyslah/Bullseye-Palette-Picker/blob/main/docs/catalog-sources.md) for the reproducible measurements and all 27 products.

## Shopping behavior

The starter catalog stores actual jar-specific SKUs and Shopify variant IDs. Displayed prices are catalog snapshots in USD; Bullseye confirms prices, availability, quantity rules, discounts, and shipping.

The first release hands the selection to [Bullseye's existing Quick Add-to-Cart page](https://shop.bullseyeglass.com/pages/quick-add-to-cart). It uses the store in the user's current browser and leaves final cart submission to the user. It does not collect a Bullseye password, clear an existing cart, or complete checkout.

## Development

Runtime code is plain JavaScript, HTML, and CSS with no third-party scripts or build step. The bundled catalog and photographs work offline after installation. See [PRIVACY.md](PRIVACY.md) for storage and permissions.

The first release passes 24 automated regression tests, structural/package checks, and isolated Chrome interaction checks. See the [verification record](https://github.com/Keyslah/Bullseye-Palette-Picker/blob/main/docs/verification.md) for coverage and the scope of the cart test.

Useful commands from the repository root:

```sh
npm test
npm run check
npm run package
```

These development commands require Node 20 or later. Packaging also uses Python 3's standard library and writes an installable ZIP into `dist/`; extract that ZIP and select its root folder in **Load unpacked**.

To rebuild the catalog:

```sh
python -m pip install -r requirements-dev.txt
python scripts/build-catalog.py
```

This downloads the seed products from Bullseye, reprocesses the photos, and overwrites the bundled catalog/images. Changed source photos lose their reviewed status until inspected. The builder's header and `--help` describe its scope and output behavior.

### Main files

| Path | Purpose |
| --- | --- |
| `extension/manifest.json` | Chrome permissions and entry points |
| `extension/service-worker.js` | Right-click image handoff and Quick Add integration |
| `extension/picker.html`, `.css`, `.js` | Responsive picker, editable palette, and glass selection |
| `extension/lib/color.js` | Full-color conversion and CIEDE2000 |
| `extension/lib/palette.js` | Image palette extraction and catalog matching |
| `extension/data/catalog.json` | Actual sampled colors, product records, and provenance |
| `scripts/build-catalog.py` | Reproducible starter-catalog builder |
| `tests/` | Color, matching, and browser-bridge regression checks |

## Attribution

An independent project for glass artists. Not affiliated with or endorsed by Bullseye Glass Co. Product photography **© Bullseye Glass Co.** The software license does not cover Bullseye photographs or trademarks. See [ATTRIBUTION.md](ATTRIBUTION.md).
