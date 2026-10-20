# Samples from the selected frit photograph

The picker measures the actual first photograph selected by the existing product
photo router for each Powder, Fine, Medium and Coarse product. Jar weights share
that grade's photograph. The original catalog, uploaded photographs and saved
palette records are not replaced by this data build.

## Source and coordinates

`extension/data/form-samples.json` contains **564 photograph records** for 141
glass colors in four forms. Each record includes the exact CDN URL, source-byte
SHA-256, source dimensions, reviewed material region, photo kind, and measured
samples. The source URLs are those already verified in `cart-photos.json` and
mapped to real handles/variants in `product-formats.json`.

Each point is an actual pixel from that photograph after its embedded color
profile is converted to sRGB. Untagged images are interpreted as sRGB. `x` and
`y` are normalized full-image coordinates, with the origin at the upper left.
There is no crop coordinate substitution or reuse of Medium coordinates. A marker
is eligible for display only while the exact measured `imageUrl` is displayed.
Contain sizing and any letterboxing must be accounted for by the viewer.

The final data contains **22,499 matching/swatches samples** and **37,670 additional
spatial inspection entries**. Some spatial entries are also selected as a swatch;
these are measurements/entries, not a count of distinct RGB colors. Each photo has
up to 40 color-diverse swatches, including its measured lightness endpoints, plus
up to 72 spatial entries so clicking glass can inspect a nearby actual point.

## Material masks and visual review

All 564 selected first photos were reviewed in 12 contact sheets on 2026-10-20.
The selected photographs comprise:

| Kind | Photographs | Region and exclusions |
| --- | ---: | --- |
| Fired frit spread | 480 | Interior of the spread, excluding the outer image edge. Material filtering rejects bright background gaps. White/cream styles over black use a restricted dense left region. |
| Unfired frit in a dish | 8 | Medieval Green and Light Mineral Green. A circle well inside the dish excludes the rim and background. These are labeled as unfired photographs. |
| Cast frit wedge | 76 | Front-face rectangle above the black backdrop horizon, away from top faces and outside edges. |

These selected first photographs do not contain the printed labels or four-tile
comparison images used by some older Medium reference records. The old reference
rectangle is never applied to a dish or wedge simply because its color ID matches.

Sampling first rejects nonmaterial pixels. Visible chromatic material uses the
existing catalog threshold of CIELAB C* ≥ 10. Neutral glass uses C* < 10 plus the
reviewed lightness range. Candidate marker locations must also have eligible
neighbors, reducing edge halos and isolated compression pixels. Material-only
means are calculated in linear RGB within local bands/cells; the recorded sample
is the actual material pixel nearest that full Lab mean. No background is averaged
into a glass color and no interpolated color is presented as an actual pixel.

Three actual Powder appearances are neutral although their Medium photographs
are chromatic: French Vanilla (000137), Elephant Gray (000206) and Gray Blue Tint
(001864). Their reviewed interior regions retain the real low-chroma material
and explicitly record that form's color family. French Vanilla's blue edge
reflections are excluded. The original reference family remains separately
identified so its shared reference does not change when the selected form changes.

## Shared percentage scale

The new data does not contain an independently normalized 0–100 scale for each
photo. `productWithFormSamples` retains the original glass color's
`thicknessReference` object. The display calculation remains the existing
white-anchored photo-strength comparison and its existing 100% cap. Reference
family and actual photo-material family are kept separate where necessary.

For Aquamarine Blue (001108), the measured, rounded ranges on that shared scale are:

| Photograph | Supported sampled percentage range |
| --- | --- |
| Powder | 20–100% |
| Fine | 18–100% |
| Medium | 35–100% |
| Coarse | 45–100% |

Those endpoints come from the photographed samples; no minimum is hard-coded for
Coarse, Powder, or any other form. Full-color CIEDE2000 matching uses the selected
photo's RGB values independently of the displayed percentage.

The comparison is an approximate photo color guide, with the original shared
reference preserved. It is not a physical-depth measurement. Lighting, scattering,
and a dish versus fired spread can cause values to reach the existing cap; the
viewer identifies the photo kind rather than claiming identical physical samples.

## Repeatable verification

The builder requires Python, Pillow and NumPy. It downloads public image bytes
only, uses a local cache, and never opens an account or shopping cart:

```sh
python -m pip install pillow numpy
python scripts/build-form-samples.py
node tests/form-samples.test.js
python scripts/check-form-sampling.py
```

The independent checker downloads missing original photographs, verifies all
564 source hashes/dimensions and all 60,169 recorded point RGB values against
their exact original pixel positions, then checks the recorded material regions
and thresholds. The completed audit reports zero marker RGB error. Its evidence
is written to `test-results/form-sampling-audit.json`.

The JavaScript checks verify all real form/variant photo URLs, coordinate bounds,
material-family eligibility, shared-reference identity, Aquamarine's measured
ranges, full-color matching, nearby-photo inspection, background rejection, and
absence of cross-form coordinate fallbacks. Native browser tests separately verify
rendered marker placement, swatch clicks, form changes and request ordering.

Product photographs © Bullseye Glass Co. The exact public sources are retained
per record in the data index. See [catalog sources](catalog-sources.md) and
[photo routing sources](cart-photo-sources.md) for the existing attribution and
public product metadata provenance.
