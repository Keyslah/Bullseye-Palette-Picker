# Bullseye catalog sources

Catalog version: `0.2.0`. Retrieved: 2026-10-18T19:02:22Z.
Scope: 32 medium-frit products: colored transparents, transparent grays, and ordinary opalescent Black and White, with 1268 measured appearance samples.

## Source and attribution

Product photographs © Bullseye Glass Co. Each bundled photograph links to its current Bullseye product page.
The catalog is an independent tool for selecting Bullseye products; it is not an official Bullseye extension.

- [Bullseye Product Image Library](https://www.bullseyeglass.com/about-our-glass/product-image-library/)
- [Current image-use conditions](https://bullseyeglass.photodeck.com/-/galleries/product-image-library)
- [Bullseye online store](https://shop.bullseyeglass.com/)

Bullseye permits these product images for promoting Bullseye products and requires attribution. Do not watermark or rebrand the source images. No artwork photographs are included.

## Selection and measurements

The catalog includes colored transparent medium frit, three transparent grays, and ordinary Black and White Opalescent medium frit. Opalescent Black and White are accurately labeled; they are not represented as transparent glass. Colorless clear, other opalescent products, mixed, streaky, iridescent, dichroic, and aventurine products are excluded. The photographs show the fired frit samples, with a dense region at the left and a more scattered region to the right. Product jars and cold-frit photographs are not sampled.

The complete sample photograph is bundled without a compositional crop, at up to 600 pixels on its longest side. Sampling uses the normalized rectangle recorded for each product and 40 narrow vertical bands, with the outer border excluded. Each band's visible material RGB channels are averaged in linear light from the full-resolution source. Version 0.2 excludes empty spaces between grains before averaging: they cannot turn blue glass into a white match or black glass into a light gray match. The resulting colors are measured material averages, not generated blends. Marker coordinates identify the eligible source pixel closest in Lab to the measured band color, so a marker does not simply land at a geometrical band center inside a white gap. The original band centers and retained material coverage are recorded separately.

For chromatic products, source pixels and resulting samples must have CIELAB chroma `C* = sqrt(a*² + b*²) >= 10`. This is a deliberate selection threshold for visibly colored samples, not a universal perceptual claim. Gray material must have `C* < 10` and `L* <= 94`. The Black photograph additionally uses `L* <= 20` to exclude bright grain-edge halos. White is sampled only within the reviewed densely filled left rectangle of its black-background photograph, with `C* < 10` and `L* >= 85`; black background cannot become a white sample. At least 5% of a band and at least 32 original pixels must be eligible material. A band whose mean crosses the selected chroma boundary is discarded. No white, blue, or gray color is invented to fill a missing range. Oregon Gray is naturally warm; only its measured neutral portions qualify as neutral matches. These material thresholds and reviewed rectangles are retained per product.

Samples are ordered by descending CIELAB L* (light to dark). Their darkness values are relative to the measured lightest and darkest appearance of the same product: `100 × (maxL − L) / (maxL − minL)`. This value is a label and ordering aid; full color matching uses all three color coordinates, not darkness alone.

## Color profiles and reproducibility

Embedded input ICC profiles are converted to sRGB using Pillow/LittleCMS. Untagged storefront JPEGs are explicitly assumed to be sRGB; their original capture profile cannot be established from those files. Bullseye's archive documentation describes Adobe RGB originals, which does not establish the profile of an untagged storefront derivative. The pipeline does not assign Adobe RGB to untagged files. Every bundled JPEG contains an sRGB ICC profile. No automatic white-balance, saturation, contrast, or palette correction is applied.

Each product record contains the original image URL, exact source-image SHA-256, metadata SHA-256, bundled-image SHA-256, source dimensions/profile, conversion details, sampling rectangle, review status, and retrieval timestamp. Variant IDs, package names, SKU, availability, and prices are copied from the public product JSON endpoint. Prices are USD integer cents and are snapshots; the store supplies live prices and availability when shopping.

Rebuild with `python scripts/build-catalog.py` after installing `requirements-dev.txt`. Review any newly changed source photographs before distributing an updated catalog. The review flag is retained only when the downloaded source hash matches the reviewed hash in the seed file. Use `--limit 1` only for a development fixture; it replaces the output catalog with that subset.

## Included products

| Glass code | Product | Type | Image source | Samples | Source profile |
| --- | --- | --- | --- | ---: | --- |
| 001426-0002-F | [Spring Green](https://shop.bullseyeglass.com/products/spring-green-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001426-0002-F_01.jpg?v=1765591311) | 40 | Untagged: no embedded ICC profile |
| 001122-0002-F | [Red](https://shop.bullseyeglass.com/products/red-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001122-0002-F_01.jpg?v=1765591261) | 40 | Untagged: no embedded ICC profile |
| 001125-0002-F | [Orange](https://shop.bullseyeglass.com/products/orange-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001125-0002-F_01.jpg?v=1765591264) | 40 | Untagged: no embedded ICC profile |
| 001320-0002-F | [Marigold Yellow](https://shop.bullseyeglass.com/products/marigold-yellow-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001320-0002-F_01.jpg?v=1765591289) | 40 | Untagged: no embedded ICC profile |
| 001120-0002-F | [Yellow](https://shop.bullseyeglass.com/products/yellow-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001120-0002-F_01.jpg?v=1765591258) | 40 | Untagged: no embedded ICC profile |
| 001137-0002-F | [Medium Amber](https://shop.bullseyeglass.com/products/medium-amber-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001137-0002-F_01.jpg?v=1765591270) | 40 | Untagged: no embedded ICC profile |
| 001437-0002-F | [Light Amber](https://shop.bullseyeglass.com/products/light-amber-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001437-0002-F_01.jpg?v=1765591317) | 40 | Untagged: no embedded ICC profile |
| 001138-0002-F | [Dark Amber](https://shop.bullseyeglass.com/products/dark-amber-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001138-0002-F_01.jpg?v=1765591271) | 40 | Untagged: no embedded ICC profile |
| 001119-0002-F | [Sienna](https://shop.bullseyeglass.com/products/sienna-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001119-0002-F_01.jpg?v=1765591257) | 40 | Untagged: no embedded ICC profile |
| 001311-0002-F | [Cranberry Pink](https://shop.bullseyeglass.com/products/cranberry-pink-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001311-0002-F_01.jpg?v=1765590898) | 40 | Untagged: no embedded ICC profile |
| 001215-0002-F | [Light Pink Striker](https://shop.bullseyeglass.com/products/light-pink-striker-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001215-0002-F_01.jpg?v=1765591278) | 40 | Untagged: no embedded ICC profile |
| 001322-0002-F | [Garnet Red](https://shop.bullseyeglass.com/products/garnet-red-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001322-0002-F_01.jpg?v=1765591292) | 40 | Untagged: no embedded ICC profile |
| 001234-0002-F | [Violet Striker](https://shop.bullseyeglass.com/products/violet-striker-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001234-0002-F_01.jpg?v=1765591283) | 40 | Untagged: no embedded ICC profile |
| 001128-0002-F | [Deep Royal Purple](https://shop.bullseyeglass.com/products/deep-royal-purple-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001128-0002-F_01.jpg?v=1765591267) | 40 | Untagged: no embedded ICC profile |
| 001114-0002-F | [Deep Royal Blue](https://shop.bullseyeglass.com/products/deep-royal-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001114-0002-F_01.jpg?v=1765591251) | 40 | Untagged: no embedded ICC profile |
| 001118-0002-F | [Midnight Blue](https://shop.bullseyeglass.com/products/midnight-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001118-0002-F_01.jpg?v=1765591255) | 40 | Untagged: no embedded ICC profile |
| 001464-0002-F | [True Blue](https://shop.bullseyeglass.com/products/true-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001464-0002-F_01.jpg?v=1765591329) | 40 | Untagged: no embedded ICC profile |
| 001444-0002-F | [Sea Blue](https://shop.bullseyeglass.com/products/sea-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001444-0002-F_01.jpg?v=1765591325) | 40 | Untagged: no embedded ICC profile |
| 001176-0002-F | [Peacock Blue](https://shop.bullseyeglass.com/products/peacock-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001176-0002-F_01.jpg?v=1765591402) | 40 | Untagged: no embedded ICC profile |
| 001414-0002-F | [Light Sky Blue](https://shop.bullseyeglass.com/products/light-sky-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001414-0002-F_01.jpg?v=1765591306) | 37 | Untagged: no embedded ICC profile |
| 001116-0002-F | [Turquoise Blue](https://shop.bullseyeglass.com/products/turquoise-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001116-0002-F_01.jpg?v=1765591254) | 40 | Untagged: no embedded ICC profile |
| 001408-0002-F | [Light Aquamarine Blue](https://shop.bullseyeglass.com/products/light-aquamarine-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001408-0002-F_01.jpg?v=1765591301) | 33 | Untagged: no embedded ICC profile |
| 001406-0002-F | [Steel Blue](https://shop.bullseyeglass.com/products/steel-blue-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001406-0002-F_01.jpg?v=1765591299) | 40 | Untagged: no embedded ICC profile |
| 001107-0002-F | [Light Green](https://shop.bullseyeglass.com/products/light-green-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001107-0002-F_01.jpg?v=1765591243) | 40 | Untagged: no embedded ICC profile |
| 001417-0002-F | [Emerald Green](https://shop.bullseyeglass.com/products/emerald-green-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001417-0002-F_01.jpg?v=1765591309) | 40 | Untagged: no embedded ICC profile |
| 001145-0002-F | [Kelly Green](https://shop.bullseyeglass.com/products/kelly-green-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001145-0002-F_01.jpg?v=1765591275) | 40 | Untagged: no embedded ICC profile |
| 001207-0002-F | [Fern Green](https://shop.bullseyeglass.com/products/fern-green-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001207-0002-F_01.jpg?v=1765591277) | 40 | Untagged: no embedded ICC profile |
| 001129-0002-F | [Charcoal Gray](https://shop.bullseyeglass.com/products/charcoal-gray-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001129-0002-F_01.jpg?v=1765591268) | 40 | Untagged: no embedded ICC profile |
| 001429-0002-F | [Light Silver Gray](https://shop.bullseyeglass.com/products/light-silver-gray-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001429-0002-F_01.jpg?v=1765591315) | 40 | Untagged: no embedded ICC profile |
| 001449-0002-F | [Oregon Gray](https://shop.bullseyeglass.com/products/oregon-gray-transparent-medium-frit-fusible) | Transparent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/001449-0002-F_01.jpg?v=1765591326) | 38 | Untagged: no embedded ICC profile |
| 000100-0002-F | [Black](https://shop.bullseyeglass.com/products/black-opalescent-medium-frit-fusible) | Opalescent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/000100-0002-F_01.jpg?v=1765591388) | 40 | Untagged: no embedded ICC profile |
| 000113-0002-F | [White](https://shop.bullseyeglass.com/products/white-opalescent-medium-frit-fusible) | Opalescent | [Photograph](https://cdn.shopify.com/s/files/1/0737/5237/9665/files/000113-0002-F_01.jpg?v=1765591423) | 40 | Untagged: no embedded ICC profile |

All source URLs and image hashes are also preserved in `extension/data/catalog.json`.
