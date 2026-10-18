#!/usr/bin/env python3
"""Build the reviewed Bullseye medium-frit color catalog.

Purpose: download public product metadata and reviewed fired-frit photographs,
         preserve their provenance, and measure full RGB/Lab appearance samples.
Setup: Python 3.11+ and Pillow; run from any directory. Product choices and
       normalized sampling rectangles are in catalog-seed.json beside this file.
Writes: replaces extension/data/catalog.json, the selected bundled photographs,
        and docs/catalog-sources.md. It never changes user browser data or carts.
Constraints: colored transparent frit plus reviewed neutral grays and ordinary
             opalescent black/white; no clear, mixed, iridescent, or aventurine
             glass. Empty photo background is never a glass sample.
             Darkness labels describe relative
             lightness within one product; matching must use the full color.
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
        headers={"User-Agent": "BullseyePalettePicker/0.2 (public catalog builder)"},
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
    minimum = min(sample["lab"][0] for sample in samples)
    maximum = max(sample["lab"][0] for sample in samples)
    for sample in samples:
        sample["darkness"] = round(100 * (maximum - sample["lab"][0]) / (maximum - minimum), 2) \
            if maximum > minimum else 0
    # Keep the image coordinates attached while ordering from light to dark.
    return sorted(samples, key=lambda sample: sample["lab"][0], reverse=True)


def product_record(seed: dict, defaults: dict, retrieved_at: str) -> dict:
    handle = seed["handle"]
    if not re.fullmatch(r"[a-z0-9-]+", handle):
        raise ValueError(f"Invalid product handle: {handle}")
    product_url = f"{STORE}/products/{handle}"
    metadata_url = f"{product_url}.js"
    metadata_raw = fetch(metadata_url)
    metadata = json.loads(metadata_raw)
    title = metadata["title"]
    if not title.endswith(", Medium Frit, Fusible"):
        raise ValueError(f"Unexpected product scope: {title}")
    excluded = ("clear", "iridescent", "dichroic", "aventurine", "mix", "streaky")
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
    elif " Opalescent," in title and color_family == "neutral" and identifier in ("000100", "000113"):
        glass_type = "Opalescent"
        name = title.removesuffix(" Opalescent, Medium Frit, Fusible")
    else:
        raise ValueError(f"Unreviewed product type: {title}")
    images = metadata.get("images", [])
    image_index = seed.get("imageIndex", 0)
    image_url = images[image_index]
    if isinstance(image_url, dict):
        image_url = image_url["src"]
    if image_url.startswith("//"):
        image_url = "https:" + image_url
    image_raw = fetch(image_url)
    source_image_hash = hashlib.sha256(image_raw).hexdigest()
    image, image_source = prepare_image(image_raw)
    rect = seed.get("sampleRect", defaults["sampleRect"])
    band_width = seed.get("sampleBandWidth", defaults["sampleBandWidth"])
    lightness_range = seed.get("materialLightnessRange", [85, 100] if material_rule == "reviewed-white-region" else [0, 94])
    samples = measure_samples(image, rect, defaults["sampleCount"], band_width, color_family, material_rule,
                              lightness_range)
    destination = PROJECT_ROOT / "extension" / "assets" / "glass" / f"{identifier}.jpg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    bundle = image.copy()
    bundle.thumbnail((defaults["imageMaxPixels"], defaults["imageMaxPixels"]), Image.Resampling.LANCZOS)
    bundle.save(destination, format="JPEG", quality=95, subsampling=0, optimize=True,
                icc_profile=stable_srgb_profile(destination))
    return {
        "id": identifier,
        "name": name,
        "fullName": title,
        "code": code,
        "type": glass_type,
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
            "imageKind": "Fired medium-frit sample photograph",
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
            "coordinateSystem": "Normalized full bundled image coordinates, origin at upper left; x/y identify a visible material pixel closest in Lab to the measured band mean. bandCenterX/Y retain the geometric band center.",
            "lightnessMetric": "CIELAB L*, D65 white point; darkness=100*(maxL-L)/(maxL-minL) within this product.",
            "currency": "USD",
        },
    }


def write_source_notes(catalog: dict) -> None:
    products = catalog["products"]
    lines = [
        "# Bullseye catalog sources",
        "",
        f"Catalog version: `{catalog['version']}`. Retrieved: {catalog['generatedAt']}.",
        f"Scope: {len(products)} medium-frit products: colored transparents, transparent grays, "
        "and ordinary opalescent Black and White, with "
        f"{sum(len(product['samples']) for product in products)} measured appearance samples.",
        "",
        "## Source and attribution",
        "",
        "Product photographs © Bullseye Glass Co. Each bundled photograph links to its current Bullseye product page.",
        "The catalog is an independent tool for selecting Bullseye products; it is not an official Bullseye extension.",
        "",
        "- [Bullseye Product Image Library](https://www.bullseyeglass.com/about-our-glass/product-image-library/)",
        "- [Current image-use conditions](https://bullseyeglass.photodeck.com/-/galleries/product-image-library)",
        "- [Bullseye online store](https://shop.bullseyeglass.com/)",
        "",
        "Bullseye permits these product images for promoting Bullseye products and requires attribution. "
        "Do not watermark or rebrand the source images. No artwork photographs are included.",
        "",
        "## Selection and measurements",
        "",
        "The catalog includes colored transparent medium frit, three transparent grays, and ordinary "
        "Black and White Opalescent medium frit. Opalescent Black and White are accurately labeled; "
        "they are not represented as transparent glass. Colorless clear, other opalescent products, mixed, "
        "streaky, iridescent, dichroic, and aventurine products are excluded. The photographs show the fired "
        "frit samples, with a dense region at the left and a more scattered region to the right. "
        "Product jars and cold-frit photographs are not sampled.",
        "",
        "The complete sample photograph is bundled without a compositional crop, at up to 600 pixels on its "
        "longest side. Sampling uses the normalized rectangle recorded for each product and 40 narrow "
        "vertical bands, with the outer border excluded. Each band's visible material RGB channels are "
        "averaged in linear light from the full-resolution source. Version 0.2 excludes empty spaces "
        "between grains before averaging: they cannot turn blue glass into a white match or black glass "
        "into a light gray match. The resulting colors are measured material averages, not generated blends. "
        "Marker coordinates identify the eligible source pixel closest in Lab to the measured band color, "
        "so a marker does not simply land at a geometrical band center inside a white gap. "
        "The original band centers and retained material coverage are recorded separately.",
        "",
        "For chromatic products, source pixels and resulting samples must have CIELAB chroma "
        "`C* = sqrt(a*² + b*²) >= 10`. This is a deliberate selection threshold for visibly colored "
        "samples, not a universal perceptual claim. Gray material must have `C* < 10` and `L* <= 94`. "
        "The Black photograph additionally uses `L* <= 20` to exclude bright grain-edge halos. "
        "White is sampled only within the reviewed densely filled left rectangle of its black-background "
        "photograph, with `C* < 10` and `L* >= 85`; black background cannot become a white sample. "
        "At least 5% of a band and at least 32 original pixels must be eligible material. A band whose "
        "mean crosses the selected chroma boundary is discarded. No white, blue, or gray color is invented "
        "to fill a missing range. Oregon Gray is naturally warm; only its measured neutral portions "
        "qualify as neutral matches. These material thresholds and reviewed rectangles are retained per product.",
        "",
        "Samples are ordered by descending CIELAB L* (light to dark). Their darkness values are relative "
        "to the measured lightest and darkest appearance of the same product: "
        "`100 × (maxL − L) / (maxL − minL)`. This value is a label and ordering aid; full color "
        "matching uses all three color coordinates, not darkness alone.",
        "",
        "## Color profiles and reproducibility",
        "",
        "Embedded input ICC profiles are converted to sRGB using Pillow/LittleCMS. Untagged storefront "
        "JPEGs are explicitly assumed to be sRGB; their original capture profile cannot be established "
        "from those files. Bullseye's archive documentation describes Adobe RGB originals, which does "
        "not establish the profile of an untagged storefront derivative. The pipeline does not assign "
        "Adobe RGB to untagged files. Every bundled JPEG contains an sRGB ICC profile. No automatic "
        "white-balance, saturation, contrast, or palette correction is applied.",
        "",
        "Each product record contains the original image URL, exact source-image SHA-256, metadata SHA-256, "
        "bundled-image SHA-256, source dimensions/profile, conversion details, sampling rectangle, "
        "review status, and retrieval timestamp. Variant IDs, package names, SKU, availability, and "
        "prices are copied from the public product JSON endpoint. Prices are USD integer cents and "
        "are snapshots; the store supplies live prices and availability when shopping.",
        "",
        "Rebuild with `python scripts/build-catalog.py` after installing `requirements-dev.txt`. "
        "Review any newly changed source photographs before distributing an updated catalog. "
        "The review flag is retained only when the downloaded source hash matches the reviewed hash in the seed file. "
        "Use `--limit 1` only for a development fixture; it replaces the output catalog with that subset.",
        "",
        "## Included products",
        "",
        "| Glass code | Product | Type | Image source | Samples | Source profile |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for product in products:
        lines.append(f"| {product['code']} | [{product['name']}]({product['productUrl']}) | {product['type']} | "
                     f"[Photograph]({product['sourceImageUrl']}) | {len(product['samples'])} | "
                     f"{product['source']['originalIccProfile']} |")
    lines += ["", "All source URLs and image hashes are also preserved in `extension/data/catalog.json`.", ""]
    path = PROJECT_ROOT / "docs" / "catalog-sources.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, help="Build only the first N reviewed seed products (development only).")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    entries = seed["products"][:args.limit] if args.limit else seed["products"]
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    records = []
    for index, entry in enumerate(entries, start=1):
        record = product_record(entry, seed["defaults"], generated_at)
        if any(existing["id"] == record["id"] for existing in records):
            raise ValueError(f"Duplicate glass code: {record['id']}")
        records.append(record)
        print(f"[{index}/{len(entries)}] {record['code']} {record['name']}: "
              f"{len(record['samples'])} measured samples, {len(record['variants'])} real variants", flush=True)
    catalog = {"version": "0.2.0", "generatedAt": generated_at,
               "scope": "Colored transparent and neutral medium frit", "attribution": ATTRIBUTION, "products": records}
    destination = PROJECT_ROOT / "extension" / "data" / "catalog.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_source_notes(catalog)
    print(f"Wrote {len(records)} products and {sum(len(record['samples']) for record in records)} "
          f"full-color samples to {destination}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, urllib.error.URLError, OSError) as error:
        print(f"Catalog build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
