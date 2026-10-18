# Purchase formats and source records

Version 0.4.0 adds verified purchase options for the same 141 base colors in the reviewed color guide. The [bundled format index](../extension/data/product-formats.json) was generated on **October 18, 2026 at 22:00:57 UTC** from public Bullseye product records and the existing medium-frit catalog. It contains **2,088 distinct purchase variants**.

## Coverage

| Format | Canonical ID | Colors with a listing | Colors with an available variant in the snapshot | Variants |
| --- | --- | ---: | ---: | ---: |
| Sheets | `sheets` | 137 | 134 | 650 |
| Powder frit | `powder` | 141 | 135 | 353 |
| Fine frit | `fine` | 141 | 139 | 351 |
| Medium frit | `medium` | 141 | 137 | 369 |
| Coarse frit | `coarse` | 141 | 138 | 365 |

The rows share the same base color codes; they are not separate sets of unique colors. Prices and availability are storefront snapshots, and Bullseye checks the selected real variants when adding them to its cart. The medium row preserves the previously reviewed 0.3.0 snapshot, including its original source timestamps.

Four guide colors have no verified standard sheet listing within this build's scope:

| Color code | Glass |
| --- | --- |
| `000102` | Blue Black |
| `001242` | Medieval Green |
| `001247` | Light Mineral Green |
| `001838` | Dark Amber Tint |

Those entries have no sheet variant or SKU to send. This records the result of the scoped public listing search; it does not claim that every specialty product or historical sheet offering was searched.

## Source and validation rules

The builder reads [Bullseye's public sitemap index](https://shop.bullseyeglass.com/sitemap.xml), its product sitemaps, and each matching product's public `/products/<handle>.js` record. The format index retains the source URL, retrieval time, SHA-256, storefront product ID, and exact variant ID, SKU, title, price, and availability. Its `sources` entries provide the complete product provenance without duplicating hundreds of listings here.

Listings must match a guide color's six-digit code and be fusible glass. Frit records must also match the requested grain in both the product title and SKU:

| Frit form | Grain segment in the SKU |
| --- | --- |
| Powder | `0008` |
| Fine | `0001` |
| Medium | `0002` |
| Coarse | `0003` |

Sheets are limited to standard single-color, double-, thin-, or single-rolled fusible products for the same base color. Clear/colorless, iridescent, dichroic, streaky, mixed-color, sample, and accessory listings are outside this index. Product and variant IDs are read from verified records; changing a grain code in a SKU is not used to invent another product.

Verified sheet options include 2 mm, 3 mm, and 6 mm products where listed. Each size retains its own physical thickness, rolled finish, dimensions, product URL, and variant ID. The default selector prefers an available 3 mm option; it can use another verified size when needed. Frit prefers the chosen default jar size—initially 5 lb.—and falls back to another available size. Existing chosen variants remain addressable across all five formats, so a saved cart keeps its exact items when the global format changes.

## Color and thickness guide

The [reviewed color catalog](../extension/data/catalog.json) remains **version 0.3.0, byte for byte unchanged**. The format index records its `colorGuideVersion` and `colorGuideSha256`. The 141 reference photographs and 5,484 RGB/Lab samples continue to drive full-color matching for every purchase format.

The displayed percentage remains an **estimated thickness guide from the medium-frit color photographs**, including when Sheets is selected. It is not a new measurement of sheet transmission, frit packing, or physical depth. Actual sheet thickness is shown separately in the size selector. The project's header reference remains **100% thickness = 6 mm solid glass, 16 mm fine frit**. See the [README thickness explanation](../README.md#thickness-guide) and [photo sampling record](catalog-sources.md) for the underlying method.

## Rebuilding the format index

Use Python 3's standard library; no new runtime dependency is required for this builder.

```sh
python scripts/build-product-formats.py --refresh
```

This retrieves public inventory and replaces `extension/data/product-formats.json` plus its ignored metadata cache. It does not download reference photographs, change `catalog.json`, or access an account or cart. A source record that fails validation stops the build instead of creating a substitute variant.

After the source cache exists, reproduce the index without network access:

```sh
python scripts/build-product-formats.py --offline
```

`--refresh` and `--offline` are mutually exclusive. The offline path preserves the existing index generation timestamp and uses the recorded source responses. Run `npm test` and `npm run check` after a rebuild; the [verification record](verification.md) describes the tested behavior and its limits.
