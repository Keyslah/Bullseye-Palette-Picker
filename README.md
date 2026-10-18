# Bullseye Palette Picker

**Right-click a photo, move its color points, choose matching Bullseye frit, and send the selected jars to your signed-in cart.**

Version **0.2.0** puts the image first, its editable palette directly below, and the glass results in one compact vertical list. Its **32-product catalog contains 1,268 measured material samples and 85 real jar variants**: 27 colored transparent medium-frit products, three transparent grays, regular Black, and Opalescent White. Colorless clear is excluded.

![Bullseye Palette Picker: image and draggable points above an editable palette and compact glass list](https://raw.githubusercontent.com/Keyslah/Bullseye-Palette-Picker/main/docs/picker-preview.png)

Product reference photography © Bullseye Glass Co.

## Install or update in Chrome

No compilation, API key, or Node installation is required to use the extension. A Bullseye account is required for its direct cart action.

1. [Download the repository ZIP](https://github.com/Keyslah/Bullseye-Palette-Picker/archive/refs/heads/main.zip) and extract it to a folder you will keep.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`extension` folder inside the extracted repository**. It contains `manifest.json`.
4. Right-click a web image and choose **Create Bullseye palette**. The toolbar button also opens the picker.

Chrome documents these [unpacked-extension steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Updating an existing installation:** replace the files in the same extension folder with the new version, click **Reload** on its card at `chrome://extensions`, and close/reopen the picker. Keep the same installed extension and folder to retain its saved palettes. An unpacked extension does not automatically update when this GitHub repository changes.

## Pick and edit colors

- **Image first.** Right-click an image, choose a file, paste, or capture a region.
- **A dot for every image color.** Automatic colors have numbered points at actual source pixels. Drag a point to resample; click another image location to add another color. Fully transparent pixels do not create false black samples.
- **Palette directly below.** Select a swatch or point to edit its hex/color, remove it, or inspect alternatives. The result list initially shows the closest eligible glass for every palette color together.
- **One vertical glass list.** Each row includes the real reference photo, glass name and code, matching darkness percentage, jar size, quantity, and selection control.
- **Choose the matches yourself.** Change individual matches or browse the catalog. A tighter match range allows less color difference; a broader range adds alternatives. The range never permits colored glass to masquerade as white, gray, or black.
- **Save palettes.** Save a named palette and load or delete it later inside the extension. Saved palettes include the image, point positions, edited colors, selected glass, jar sizes, and quantities.

The full workspace uses the same vertical order as the side panel. An expanded reference view lets you inspect the measured glass samples without enlarging every list row.

Some web images are hosted on a separate domain. The picker requests access to that particular image host after you select the image. File import, paste, and region capture are available when a host will not serve the image.

## Correct color matching

Matching compares the **full color** using CIEDE2000: hue, chroma, and lightness all matter. A green and red with the same grayscale value do not become matches.

The photograph library measures **visible glass material**, excluding nearly colorless gaps from colored frit samples. Every retained sample has an RGB color and a representative location in the reference photo. White, gray, and black targets are matched only to the neutral products; colored targets use visibly colored samples from chromatic products.

The explicit library policy uses CIELAB chroma **C* = 10** as the dividing line between neutral and chromatic colors. This is a practical eligibility rule for this catalog, not a universal claim about human color perception. It also applies when asking for broad alternatives. A result outside the selected color-difference range is not silently presented as a close match.

This fixes the earlier case where a gray `#E3E3E3` swatch matched the nearly white end of Light Sky Blue. Opalescent White, transparent grays, and Black provide actual neutral choices.

### Darkness labels

A result reads, for example, **“Spring Green at 75% darkness.”** The percentage describes that product's retained photographed sample range:

- **100%:** its darkest measured appearance.
- **50%:** halfway between its lightest and darkest measured perceptual lightness.
- **0%:** its lightest eligible measured appearance.

There is no separate darkness slider. Darkness labels do not determine which hue matches and do not describe a physical recipe. The photograph and exact sampled color remain visible for inspection.

The reference photos are practical digital comparisons. Source images currently carry no color profile; the pipeline records its sRGB assumption and source hashes. Lighting, screens, and actual glass can differ. See [catalog sources and sampling details](docs/catalog-sources.md) for the products and reproducible measurements.

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

Development requires Node 20 or later. Packaging also uses Python 3's standard library and creates `dist/Bullseye-Palette-Picker-v0.2.0.zip`, with the manifest at the ZIP root. Extract that packaged ZIP and load its root folder in Chrome.

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
