#!/usr/bin/env python3
"""Build the reviewed Bullseye medium-frit color catalog.

Purpose: download public product metadata and reviewed fired-frit photographs,
         preserve their provenance, and measure full RGB/Lab appearance samples.
Setup: Python 3.11+ and Pillow; run from any directory. Product choices and
       normalized sampling rectangles are in catalog-seed.json beside this file.
Writes: replaces extension/data/catalog.json, the selected bundled photographs,
        and docs/catalog-sources.md. It never changes user browser data or carts.
Constraints: all reviewed single-color transparent (including tints) and
             opalescent medium frit; no clear/colorless glass or color mixtures.
             Empty photo background is never a glass sample. Darkness uses the
             same absolute CIELAB lightness scale across products; matching uses
             the full color.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

from PIL import Image, ImageCms, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = Path(__file__).with_name("catalog-seed.json")
STORE = "https://shop.bullseyeglass.com"
ATTRIBUTION = {
    "name": "Product photographs © Bullseye Glass Co.",
    "url": "https://www.bullseyeglass.com/",
    "termsUrl": "https://bullseyeglass.photodeck.com/-/galleries/product-image-library",
}
SRGB_PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
LINEAR_RGB = [
    (v / 255) / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4
    for v in range(256)
]


def fetch(url: str) -> bytes:
    """Read a public HTTPS resource with bounded retries and a request timeout."""
    if not url.startswith("https://"):
        raise ValueError(f"An HTTPS source is required: {url}")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "BullseyePalettePicker/0.3 (public catalog builder)"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
    raise RuntimeError("Unreachable fetch state")


def linear_to_channel(value: float) -> int:
    encoded = 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
    return round(max(0.0, min(1.0, encoded)) * 255)


def rgb_to_lab(rgb: list[int]) -> list[float]:
    """CIELAB from sRGB, using a D65 white point and the standard 2° observer."""
    red, green, blue = (LINEAR_RGB[channel] for channel in rgb)
    x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047
    y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue
    z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883

    def lab_curve(value: float) -> float:
        delta = 6 / 29
        return value ** (1 / 3) if value > delta ** 3 else value / (3 * delta ** 2) + 4 / 29

    fx, fy, fz = map(lab_curve, (x, y, z))
    return [round(116 * fy - 16, 5), round(500 * (fx - fy), 5), round(200 * (fy - fz), 5)]


def normalized_rect(rect: list[float]) -> list[float]:
    if len(rect) != 4 or not all(math.isfinite(v) for v in rect):
        raise ValueError("sampleRect must contain four finite normalized coordinates")
    left, top, right, bottom = rect
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise ValueError(f"Invalid sampleRect: {rect}")
    return rect


def prepare_image(raw: bytes) -> tuple[Image.Image, dict]:
    image = Image.open(io.BytesIO(raw))
    original_size = list(image.size)
    original_mode = image.mode
    profile_bytes = image.info.get("icc_profile")
    image = ImageOps.exif_transpose(image)
    if profile_bytes:
        original_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
        profile_name = ImageCms.getProfileDescription(original_profile).strip()
        image = ImageCms.profileToProfile(image, original_profile, SRGB_PROFILE, outputMode="RGB")
        conversion = "Converted embedded source ICC profile to sRGB using LittleCMS."
        assumption = None
    else:
        image = image.convert("RGB")
        profile_name = "Untagged: no embedded ICC profile"
        conversion = "Untagged web JPEG interpreted as sRGB; no color adjustment applied."
        assumption = "sRGB (untagged storefront image; original capture profile is unknown)"
    return image, {
        "originalPixels": original_size,
        "originalMode": original_mode,
        "originalIccProfile": profile_name,
        "assumedProfile": assumption,
        "profileConversion": conversion,
    }


def stable_srgb_profile(destination: Path) -> bytes:
    """Reuse an equivalent ICC profile so rebuilds do not alter only timestamps."""
    current = SRGB_PROFILE.tobytes()
    if not destination.exists():
        return current
    with Image.open(destination) as existing:
        previous = existing.info.get("icc_profile")
    if not previous or len(previous) != len(current):
        return current

    def color_definition(profile: bytes) -> bytes:
        normalized = bytearray(profile)
        # ICC header creation date and profile ID do not define color transforms.
        normalized[24:36] = bytes(12)
        normalized[84:100] = bytes(16)
        return bytes(normalized)

    return previous if color_definition(previous) == color_definition(current) else current


def measure_samples(image: Image.Image, rect: list[float], count: int, band_width: float,
                    color_family: str = "chromatic", material_rule: str = "visible-color",
                    material_lightness_range: list[float] | None = None) -> list[dict]:
    """Measure visible glass pixels in bands; reject background before averaging.

    The thresholds are catalog selection rules, not claims about a universal
    human perception boundary. Material must have C* >= 10 for a colored product.
    Gray/black must have C* < 10 and L* <= 94; reviewed white-glass rectangles
    instead have C* < 10 and L* >= 85. White is only sampled inside a manually
    reviewed, densely filled region, so its white background is not substituted
    for glass. The marker points to an eligible source pixel closest in Lab to
    the measured material mean, not a geometrical center that may fall in a gap.
    """
    left, top, right, bottom = normalized_rect(rect)
    width, height = image.size
    half_band = band_width / 2
    if not (0 < band_width < right - left):
        raise ValueError("sampleBandWidth must be positive and narrower than sampleRect")
    if color_family not in ("chromatic", "neutral"):
        raise ValueError(f"Invalid color family: {color_family}")
    if material_rule not in ("visible-color", "neutral-material", "reviewed-white-region"):
        raise ValueError(f"Invalid material rule: {material_rule}")
    lightness_range = material_lightness_range or ([85, 100] if material_rule == "reviewed-white-region" else [0, 94])
    if len(lightness_range) != 2 or not (0 <= lightness_range[0] < lightness_range[1] <= 100):
        raise ValueError(f"Invalid material lightness range: {lightness_range}")
    samples = []
    pixel_details = {}

    def describe_pixel(rgb: tuple[int, int, int]) -> tuple[list[float], bool]:
        if rgb not in pixel_details:
            lab = rgb_to_lab(list(rgb))
            chroma = math.hypot(lab[1], lab[2])
            if color_family == "chromatic":
                eligible = chroma >= 10
            else:
                eligible = chroma < 10 and lightness_range[0] <= lab[0] <= lightness_range[1]
            pixel_details[rgb] = (lab, eligible)
        return pixel_details[rgb]

    for index in range(count):
        x = left + half_band + (right - left - band_width) * index / (count - 1)
        box = (
            round((x - half_band) * width),
            round(top * height),
            round((x + half_band) * width),
            round(bottom * height),
        )
        patch = image.crop(box)
        pixels = patch.width * patch.height
        if pixels == 0:
            raise ValueError("A sample band is smaller than one pixel")
        # getcolors counts exact source pixels; this does not quantize the image.
        colors = [(frequency, rgb) for frequency, rgb in patch.getcolors(pixels)
                  if describe_pixel(rgb)[1]]
        material_pixels = sum(frequency for frequency, _ in colors)
        if material_pixels < max(32, pixels * 0.05):
            continue
        rgb = [
            linear_to_channel(sum(frequency * LINEAR_RGB[pixel_rgb[channel]]
                                  for frequency, pixel_rgb in colors) / material_pixels)
            for channel in range(3)
        ]
        lab = rgb_to_lab(rgb)
        chroma = math.hypot(lab[1], lab[2])
        if (color_family == "chromatic" and chroma < 10) or (color_family == "neutral" and chroma >= 10):
            continue
        representative = min((value for _, value in colors),
                             key=lambda value: sum((a - b) ** 2 for a, b in
                                                   zip(describe_pixel(value)[0], lab)))
        center_x, center_y = (patch.width - 1) / 2, (patch.height - 1) / 2
        locations = ((offset % patch.width, offset // patch.width)
                     for offset, value in enumerate(patch.get_flattened_data()) if value == representative)
        marker_x, marker_y = min(locations,
                                key=lambda point: (point[0] - center_x) ** 2 + (point[1] - center_y) ** 2)
        samples.append({
            "rgb": rgb,
            "hex": "#" + "".join(f"{value:02x}" for value in rgb),
            "lab": lab,
            "darkness": 0,
            "x": round((box[0] + marker_x + 0.5) / width, 6),
            "y": round((box[1] + marker_y + 0.5) / height, 6),
            "bandCenterX": round(x, 6),
            "bandCenterY": round((top + bottom) / 2, 6),
            "materialCoverage": round(material_pixels / pixels, 5),
            "markerRgb": list(representative),
        })
    if len(samples) < 20:
        raise ValueError(f"Too few visible-material samples ({len(samples)}); review the sampling rectangle")
    for sample in samples:
        sample["darkness"] = round(max(0, min(100, 100 - sample["lab"][0])), 2)
    # Keep the image coordinates attached while ordering from light to dark.
    return sorted(samples, key=lambda sample: sample["lab"][0], reverse=True)


def keep_markers_visible(source: Image.Image, preview: Image.Image, samples: list[dict],
                         color_family: str, lightness_range: list[float], rect: list[float]) -> None:
    """Keep material markers on actual glass after the 600px preview is encoded.

    A single full-resolution grain can merge with a bright neighbor when scaled.
    Move only affected markers a few source pixels to eligible material whose
    encoded preview still shows the same color family; measured means do not change.
    """
    def preview_eligible(x: int, y: int) -> bool:
        pixel = preview.getpixel((min(preview.width - 1, x * preview.width // source.width),
                                  min(preview.height - 1, y * preview.height // source.height)))
        lab = rgb_to_lab(list(pixel))
        chroma = math.hypot(lab[1], lab[2])
        return (chroma >= 8 if color_family == "chromatic" else
                chroma < 12 and lightness_range[0] - 3 <= lab[0] <= lightness_range[1] + 3)

    for sample in samples:
        x, y = int(sample["x"] * source.width), int(sample["y"] * source.height)
        if preview_eligible(x, y):
            continue
        candidates = []
        for candidate_y in range(max(round(rect[1] * source.height), y - 6),
                                 min(round(rect[3] * source.height), y + 7)):
            for candidate_x in range(max(round(rect[0] * source.width), x - 6),
                                     min(round(rect[2] * source.width), x + 7)):
                rgb = list(source.getpixel((candidate_x, candidate_y)))
                lab = rgb_to_lab(rgb)
                chroma = math.hypot(lab[1], lab[2])
                eligible = (chroma >= 10 if color_family == "chromatic" else
                            chroma < 10 and lightness_range[0] <= lab[0] <= lightness_range[1])
                if eligible and preview_eligible(candidate_x, candidate_y):
                    score = sum((a - b) ** 2 for a, b in zip(lab, sample["lab"]))
                    score += .02 * ((candidate_x - x) ** 2 + (candidate_y - y) ** 2)
                    candidates.append((score, candidate_x, candidate_y, rgb))
        if not candidates:
            raise ValueError("A material marker disappears in the bundled preview; review its source region")
        _, x, y, rgb = min(candidates)
        sample.update(x=round((x + .5) / source.width, 6),
                      y=round((y + .5) / source.height, 6), markerRgb=rgb,
                      markerAdjustedForPreview=True)


def product_record(seed: dict, defaults: dict, retrieved_at: str, source_cache: Path | None = None) -> dict:
    handle = seed["handle"]
    if not re.fullmatch(r"[a-z0-9-]+", handle):
        raise ValueError(f"Invalid product handle: {handle}")
    product_url = f"{STORE}/products/{handle}"
    metadata_url = f"{product_url}.js"
    cached_metadata = source_cache / f"{handle}.json" if source_cache else None
    metadata_raw = cached_metadata.read_bytes() if cached_metadata and cached_metadata.exists() else fetch(metadata_url)
    metadata = json.loads(metadata_raw)
    title = metadata["title"]
    if not title.endswith(", Medium Frit, Fusible"):
        raise ValueError(f"Unexpected product scope: {title}")
    excluded = ("clear", "iridescent", "dichroic", "mix", "streaky", "reactive ice")
    if any(word in title.lower() for word in excluded):
        raise ValueError(f"Excluded product: {title}")
    codes = {match.group(1) for variant in metadata["variants"]
             if (match := re.match(r"^(\d{6}-0002-F)(?:-|$)", variant["sku"]))}
    if len(codes) != 1 or len(metadata["variants"]) == 0:
        raise ValueError(f"Missing or conflicting medium-frit product codes: {handle}")
    code = codes.pop()
    identifier = code[:6]
    color_family = seed.get("colorFamily", "chromatic")
    material_rule = seed.get("materialRule", "visible-color" if color_family == "chromatic" else "neutral-material")
    if " Transparent," in title:
        glass_type = "Transparent"
        name = title.removesuffix(" Transparent, Medium Frit, Fusible")
    elif " Tint," in title:
        glass_type = "Transparent"
        name = title.removesuffix(", Medium Frit, Fusible")
    elif " Opalescent," in title:
        glass_type = "Opalescent"
        name = title.removesuffix(" Opalescent, Medium Frit, Fusible")
    elif title.endswith(" Translucent, Medium Frit, Fusible") and identifier == "000243" and seed.get("type") == "Opalescent":
        glass_type = "Opalescent"
        name = title.removesuffix(" Translucent, Medium Frit, Fusible")
    else:
        raise ValueError(f"Unreviewed product type: {title}")
    images = metadata.get("images", [])
    image_index = seed.get("imageIndex", 0)
    image_url = images[image_index]
    if isinstance(image_url, dict):
        image_url = image_url["src"]
    if image_url.startswith("//"):
        image_url = "https:" + image_url
    cached_image = source_cache / "images" / f"{handle}-{image_index}.jpg" if source_cache else None
    image_raw = cached_image.read_bytes() if cached_image and cached_image.exists() else fetch(image_url)
    source_image_hash = hashlib.sha256(image_raw).hexdigest()
    image, image_source = prepare_image(image_raw)
    rect = seed.get("sampleRect", defaults["sampleRect"])
    band_width = seed.get("sampleBandWidth", defaults["sampleBandWidth"])
    lightness_range = seed.get("materialLightnessRange", [85, 100] if material_rule == "reviewed-white-region" else [0, 94])
    samples = measure_samples(image, rect, defaults["sampleCount"], band_width, color_family, material_rule,
                              lightness_range)
    dense_boundary = rect[0] + (rect[2] - rect[0]) * 0.25
    dense_samples = [sample for sample in samples if sample["bandCenterX"] <= dense_boundary]
    reference = min(dense_samples or samples, key=lambda sample: sample["lab"][0])
    thickness_reference = {key: reference[key] for key in ("rgb", "lab", "x", "y", "bandCenterX", "bandCenterY")}
    thickness_reference["basis"] = "Darkest measured eligible material band within the left quarter of the reviewed glass region; actual photographed color, not a physical depth measurement."
    destination = PROJECT_ROOT / "extension" / "assets" / "glass" / f"{identifier}.jpg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    bundle = image.copy()
    bundle.thumbnail((defaults["imageMaxPixels"], defaults["imageMaxPixels"]), Image.Resampling.LANCZOS)
    encoded_image = io.BytesIO()
    bundle.save(encoded_image, format="JPEG", quality=95, subsampling=0, optimize=True,
                icc_profile=stable_srgb_profile(destination))
    encoded_bytes = encoded_image.getvalue()
    preview = Image.open(io.BytesIO(encoded_bytes)).convert("RGB")
    keep_markers_visible(image, preview, samples, color_family, lightness_range, rect)
    thickness_reference.update({key: reference[key] for key in ("x", "y")})
    temporary_image = destination.with_suffix(".jpg.tmp")
    temporary_image.write_bytes(encoded_bytes)
    temporary_image.replace(destination)
    return {
        "id": identifier,
        "name": name,
        "fullName": title,
        "code": code,
        "type": glass_type,
        "sourceType": seed.get("sourceType", glass_type),
        "typeGroupingSource": seed.get("typeGroupingSource"),
        "thicknessReference": thickness_reference,
        "colorFamily": color_family,
        "grain": "Medium frit",
        "productUrl": product_url,
        "handle": handle,
        "image": f"assets/glass/{identifier}.jpg",
        "sourceImageUrl": image_url,
        "variants": [{"id": variant["id"], "sku": variant["sku"], "title": variant["title"],
                      "available": variant["available"], "price": variant["price"]}
                     for variant in metadata["variants"]],
        "samples": samples,
        "source": {
            "productDataUrl": metadata_url,
            "productDataSha256": hashlib.sha256(metadata_raw).hexdigest(),
            "retrievedAt": retrieved_at,
            "sourceImageSha256": source_image_hash,
            **image_source,
            "bundledPixels": list(bundle.size),
            "bundledImageSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "bundledProfile": "sRGB IEC61966-2.1 (embedded ICC)",
            "imageKind": seed.get("imageKind", "Fired medium-frit sample photograph"),
            "imageSelection": seed.get("imageSelection", defaults["imageSelection"]),
            "visuallyReviewed": bool(seed.get("visuallyReviewed", False)
                                     and seed.get("reviewedSourceImageSha256") == source_image_hash),
            "sampleRect": rect,
            "sampleBandWidth": band_width,
            "samplingMethod": "Full-resolution sRGB source; visible-material pixels in narrow vertical bands averaged in linear RGB; background excluded before averaging; no invented interpolated samples.",
            "materialRule": material_rule,
            "materialThresholds": {"chromaticMinimumChroma": 10, "neutralMaximumChromaExclusive": 10,
                                   "neutralLightnessRange": lightness_range if color_family == "neutral" else None,
                                   "minimumBandCoverage": 0.05},
            "coordinateSystem": "Normalized full bundled image coordinates, origin at upper left; x/y identify an eligible material pixel near the measured Lab mean that remains visible in the encoded preview. bandCenterX/Y retain the geometric band center.",
            "lightnessMetric": "Absolute CIELAB L*, D65 white point; darkness=clamp(100-L*,0,100) consistently across all glass products.",
            "currency": "USD",
        },
    }


def write_source_notes(catalog: dict) -> None:
    products = catalog["products"]
    transparent_count = sum(product["type"] == "Transparent" for product in products)
    opalescent_count = sum(product["type"] == "Opalescent" for product in products)
    wedge_count = sum("wedge" in product["source"]["imageKind"].lower() for product in products)
    discovery = catalog.get("discovery", {})
    lines = [
        "# Bullseye catalog sources",
        "",
        f"Catalog version: `{catalog['version']}`. Retrieved: {catalog['generatedAt']}.",
        f"Scope: **{len(products)} medium-frit products**, comprising **{transparent_count} transparent** "
        f"and **{opalescent_count} opalescent-group** colors, with "
        f"**{sum(len(product['samples']) for product in products)} measured appearance samples**.",
        "",
        "## Inventory and product scope",
        "",
        "Discovery read all three product sitemaps linked from the [current Bullseye sitemap]"
        "(https://shop.bullseyeglass.com/sitemap.xml), covering 2,931 storefront products and 149 "
        "medium-frit product pages. Every included entry was verified against its public `.js` product "
        "endpoint and actual six-digit `-0002-F` SKU family. Sold-out products remain visible, with "
        "their real variant availability preserved. No product or variant IDs are inferred.",
        "",
        "The transparent filter includes all 20 transparent tint colors, as well as aventurine, "
        "shift, and striking colors. The opalescent filter includes regular Black and White, their "
        "other current opalescent variants, colored opals, Reactive Cloud, and Translucent White. "
        "Bullseye groups Translucent White (000243) under Opalescent Frit in its "
        "[catalog, printed page 28](https://www.bullseyeglass.com/wp-content/uploads/Bullseye_Glass_Catalog_14.pdf); "
        "its storefront name and `sourceType: Translucent` are retained, while `type: Opalescent` "
        "assigns it to the corresponding search button. The [Bullseye tint reference]"
        "(https://www.bullseyeglass.com/make-it-project-tint-tone-plate/) identifies tints as transparent glass. "
        "[Reactive Ice 001009](https://www.bullseyeglass.com/001009-reactive-ice-clear/) is a clear "
        "style and is excluded even though its storefront title omits the word Clear.",
        "",
        "### Excluded medium-frit entries",
        "",
        "| Product | Reason |",
        "| --- | --- |",
    ]
    for entry in discovery.get("excludedProducts", []):
        lines.append(f"| [{entry['name']}]({entry['productUrl']}) | {entry['reason']} |")
    lines += [
        "",
        "Sample sets, mixed-color products, other grain sizes, and clear/colorless products are outside "
        "this catalog. The inventory snapshot and exact exclusions are also retained in catalog JSON.",
        "",
        "## Source and attribution",
        "",
        "Product photographs © Bullseye Glass Co. Each bundled photograph links to its current Bullseye product page. "
        "This is an independent product-selection tool, not an official Bullseye extension.",
        "",
        "- [Bullseye Product Image Library](https://www.bullseyeglass.com/about-our-glass/product-image-library/)",
        "- [Current image-use conditions](https://bullseyeglass.photodeck.com/-/galleries/product-image-library)",
        "- [Bullseye online store](https://shop.bullseyeglass.com/)",
        "",
        "Bullseye permits these product images for promoting Bullseye products and requires attribution. "
        "Do not watermark or rebrand the source images. No user artwork or screenshots are bundled.",
        "",
        "## Photograph selection",
        "",
        "Most entries use Bullseye's fired medium-frit spread: a dense region at the left and progressively "
        "more scattered grains toward the right. The official catalog describes these samples as fired "
        "on 3 mm clear glass, with selected white styles photographed over a black-glass base. "
        "The complete photograph is bundled without a compositional crop, at up to 600 pixels on its longest side.",
        "",
        f"For {wedge_count} transparent tints, the nearly colorless fired spread cannot show enough "
        "visible hue, so the catalog uses the official medium-frit product's cast-wedge photograph. "
        "Only a reviewed rectangle within the front glass face is sampled, above the black backdrop boundary "
        "and away from the top face, bright edges, or white background. These entries explicitly record "
        "`imageKind: Cast medium-frit wedge photograph`; they are not mislabeled as spread photographs. "
        "No physical wedge dimensions or calibrated depth-to-color curve were provided with these photos.",
        "",
        "Medieval Green (001242) and Light Mineral Green (001247) currently use four-grain fired comparison "
        "photographs. Only the top-right tile explicitly labeled `-0002` is sampled. Their cold-grain dish "
        "photo, the other three grain sizes, printed labels, and margins are excluded. All source images "
        "and special sampling rectangles were visually reviewed before inclusion.",
        "",
        "## Material sampling and background rejection",
        "",
        "Sampling operates on the full-resolution sRGB source using 40 narrow vertical bands across each "
        "reviewed rectangle. Visible material pixels are selected before averaging in linear RGB. "
        "White gaps between blue grains cannot become a white sample; black gaps around white grains "
        "cannot become a gray sample. Measurements are actual retained material averages, not generated blends.",
        "",
        "Chromatic source pixels and resulting means must have CIELAB chroma `C* = sqrt(a*² + b*²) >= 10`. "
        "Neutral source pixels and means must have `C* < 10`. These are deliberate library selection thresholds "
        "for visibly colored versus neutral samples, not universal perceptual boundaries. Neutral photographs "
        "also use the product's reviewed lightness interval: ordinary gray samples exclude near-white base "
        "areas, black samples use `L* <= 20`, and white or pale neutral glass over black is confined to a dense "
        "left rectangle with a specified high-lightness interval. Warm gray and cream products retain only "
        "their eligible neutral material. French Vanilla is sampled from visibly yellow material in its dense "
        "left region, avoiding dark gaps and blue fringe reflections.",
        "",
        "A band needs at least 5% eligible material and at least 32 original material pixels. A mean that "
        "crosses the selected chroma boundary is discarded. No missing colors are invented to fill a range. "
        "Each sample marker points to eligible source material near its measured mean in Lab. If that "
        "source grain loses visible color when downscaled, the marker moves a few source pixels to "
        "eligible material that remains visible in the encoded preview; the measured mean is unchanged. Its "
        "geometrical band center and material coverage are recorded separately so the marker cannot simply "
        "fall in a white gap. All masks, thresholds, and rectangles are retained in the product record.",
        "",
        "## Lightness and the estimated thickness guide",
        "",
        "Raw appearance samples are ordered by descending CIELAB L* (light to dark). Their stored `darkness` "
        "uses the same absolute scale for every product: `clamp(100 − L*, 0, 100)`. Thus a photographed black "
        "sample stays near 100 rather than being relabeled 0 because it happened to be the lightest black "
        "sample in a narrow product range. Full-color matching continues to use all three Lab coordinates.",
        "",
        "Each product also records an actual `thicknessReference` color from the darkest eligible sampled "
        "band in the left quarter of its reviewed dense-material region. This reference is independent of "
        "array ordering and is not an inferred physical depth. The extension's estimated thickness guide "
        "compares a transparent sample to that dense reference. Opalescent colors use their full-color "
        "reference rather than claiming a linear transparency relationship. User reference dimensions "
        "are an artist-supplied guide, not a Bullseye calibration of these photographs.",
        "",
        "## Color profiles and reproducibility",
        "",
        "Embedded source ICC profiles are converted to sRGB using Pillow/LittleCMS. Untagged storefront "
        "JPEGs are explicitly interpreted as sRGB; their original capture profile is unknown. Bullseye's "
        "archive documentation describes Adobe RGB originals, which does not establish the profile of an "
        "untagged storefront derivative. Every bundled JPEG embeds an sRGB ICC profile. No automatic "
        "white balance, contrast, saturation, or palette correction is applied.",
        "",
        "Records preserve the source URL and SHA-256, metadata SHA-256, bundled-image SHA-256, dimensions "
        "and profile handling, review status, image kind, selected rectangle, and retrieval timestamp. "
        "Variant IDs, sizes, SKUs, availability, and prices come from the public product JSON. Prices are "
        "USD integer cents and are snapshots; the store provides live prices and availability when shopping.",
        "",
        "Rebuild with `python scripts/build-catalog.py` after installing `requirements-dev.txt`. A previously "
        "downloaded and reviewed source cache may be supplied with `--source-cache PATH`. Review changed "
        "photos before distributing a rebuilt catalog: review flags remain true only when source-image "
        "hashes match the reviewed hashes in the seed. `--limit N` is a development fixture that replaces "
        "the output with that subset.",
        "",
        "## Included products",
        "",
        "| Glass code | Product | Search group | Photograph kind | Samples | Source profile |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for product in products:
        lines.append(f"| {product['code']} | [{product['name']}]({product['productUrl']}) | {product['type']} | "
                     f"[{product['source']['imageKind']}]({product['sourceImageUrl']}) | {len(product['samples'])} | "
                     f"{product['source']['originalIccProfile']} |")
    lines += ["", "Exact source URLs and hashes are retained in `extension/data/catalog.json`.", ""]
    path = PROJECT_ROOT / "docs" / "catalog-sources.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, help="Use previously downloaded product JSON and source photographs from a reviewed cache directory.")
    parser.add_argument("--limit", type=int, help="Build only the first N reviewed seed products (development only).")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    entries = seed["products"][:args.limit] if args.limit else seed["products"]
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    records = []
    for index, entry in enumerate(entries, start=1):
        record = product_record(entry, seed["defaults"], generated_at, args.source_cache)
        if any(existing["id"] == record["id"] for existing in records):
            raise ValueError(f"Duplicate glass code: {record['id']}")
        records.append(record)
        print(f"[{index}/{len(entries)}] {record['code']} {record['name']}: "
              f"{len(record['samples'])} measured samples, {len(record['variants'])} real variants", flush=True)
    catalog = {"version": "0.3.0", "generatedAt": generated_at,
               "scope": "All reviewed single-color transparent and opalescent medium frit, excluding clear",
               "discovery": seed.get("discovery", {}), "attribution": ATTRIBUTION, "products": records}
    destination = PROJECT_ROOT / "extension" / "data" / "catalog.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_catalog = destination.with_suffix(".json.tmp")
    temporary_catalog.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary_catalog.replace(destination)
    write_source_notes(catalog)
    print(f"Wrote {len(records)} products and {sum(len(record['samples']) for record in records)} "
          f"full-color samples to {destination}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, urllib.error.URLError, OSError) as error:
        print(f"Catalog build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
