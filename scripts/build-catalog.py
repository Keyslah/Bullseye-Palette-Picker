#!/usr/bin/env python3
"""Build the reviewed Bullseye transparent medium-frit color catalog.

Purpose: download public product metadata and reviewed fired-frit photographs,
         preserve their provenance, and measure full RGB/Lab appearance samples.
Setup: Python 3.11+ and Pillow; run from any directory. Product choices and
       normalized sampling rectangles are in catalog-seed.json beside this file.
Writes: replaces extension/data/catalog.json, the selected bundled photographs,
        and docs/catalog-sources.md. It never changes user browser data or carts.
Constraints: only colored transparent medium frit; no clear, mixed, opalescent,
             iridescent, or aventurine glass. Darkness labels describe relative
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
        headers={"User-Agent": "BullseyePalettePicker/0.1 (public catalog builder)"},
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


def measure_samples(image: Image.Image, rect: list[float], count: int, band_width: float) -> list[dict]:
    """Average narrow vertical bands in linear RGB, retaining internal clear gaps."""
    left, top, right, bottom = normalized_rect(rect)
    width, height = image.size
    half_band = band_width / 2
    if not (0 < band_width < right - left):
        raise ValueError("sampleBandWidth must be positive and narrower than sampleRect")
    samples = []
    for index in range(count):
        x = left + half_band + (right - left - band_width) * index / (count - 1)
        box = (
            round((x - half_band) * width),
            round(top * height),
            round((x + half_band) * width),
            round(bottom * height),
        )
        patch = image.crop(box)
        histogram = patch.histogram()
        pixels = patch.width * patch.height
        if pixels == 0:
            raise ValueError("A sample band is smaller than one pixel")
        rgb = [
            linear_to_channel(sum(histogram[channel * 256 + value] * LINEAR_RGB[value]
                                  for value in range(256)) / pixels)
            for channel in range(3)
        ]
        lab = rgb_to_lab(rgb)
        # An empty outer margin must never become an advertised glass match.
        if lab[0] > 99.7 and max(rgb) - min(rgb) < 3:
            continue
        samples.append({
            "rgb": rgb,
            "hex": "#" + "".join(f"{value:02x}" for value in rgb),
            "lab": lab,
            "darkness": 0,
            "x": round(x, 6),
            "y": round((top + bottom) / 2, 6),
        })
    if len(samples) < 24:
        raise ValueError("Too few nonblank measured samples; review the sampling rectangle")
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
    if "Transparent, Medium Frit, Fusible" not in title:
        raise ValueError(f"Unexpected product scope: {title}")
    excluded = ("clear", "opalescent", "iridescent", "dichroic", "aventurine", "mix", "streaky")
    if any(word in title.lower() for word in excluded):
        raise ValueError(f"Excluded product: {title}")
    codes = {match.group(1) for variant in metadata["variants"]
             if (match := re.match(r"^(\d{6}-0002-F)(?:-|$)", variant["sku"]))}
    if len(codes) != 1 or len(metadata["variants"]) == 0:
        raise ValueError(f"Missing or conflicting medium-frit product codes: {handle}")
    code = codes.pop()
    identifier = code[:6]
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
    samples = measure_samples(image, rect, defaults["sampleCount"], band_width)
    destination = PROJECT_ROOT / "extension" / "assets" / "glass" / f"{identifier}.jpg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    bundle = image.copy()
    bundle.thumbnail((defaults["imageMaxPixels"], defaults["imageMaxPixels"]), Image.Resampling.LANCZOS)
    bundle.save(destination, format="JPEG", quality=95, subsampling=0, optimize=True,
                icc_profile=SRGB_PROFILE.tobytes())
    return {
        "id": identifier,
        "name": title.removesuffix(" Transparent, Medium Frit, Fusible"),
        "fullName": title,
        "code": code,
        "type": "Transparent",
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
            "samplingMethod": "Full-resolution sRGB source; narrow vertical bands averaged in linear RGB; internal gaps retained; no invented interpolated samples.",
            "coordinateSystem": "Normalized full bundled image coordinates, origin at upper left; x/y mark each averaged band's center.",
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
        f"Scope: {len(products)} colored transparent medium-frit products, with "
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
        "Only colored transparent medium-frit products are included. Colorless clear, opalescent, mixed, "
        "streaky, iridescent, dichroic, and aventurine products are excluded. The photographs show the fired "
        "frit samples, with a dense region at the left and a more scattered region to the right. "
        "Product jars and cold-frit photographs are not sampled.",
        "",
        "The complete sample photograph is bundled without a compositional crop, at up to 600 pixels on its "
        "longest side. Sampling uses the normalized rectangle recorded for each product and 40 narrow "
        "vertical bands, with the outer border excluded. Each band's RGB channels are averaged in linear "
        "light from the full-resolution source. Internal clear spaces between grains remain part of the "
        "measured appearance. Nearly blank margin bands are rejected. The resulting colors are measured "
        "band averages, not isolated grain colors or generated blends. Marker coordinates identify the "
        "band centers in the complete bundled image.",
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
        "| Glass code | Product | Image source | Samples | Source profile |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for product in products:
        lines.append(f"| {product['code']} | [{product['name']}]({product['productUrl']}) | "
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
    catalog = {"version": "0.1.0", "generatedAt": generated_at,
               "scope": "Transparent medium frit", "attribution": ATTRIBUTION, "products": records}
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
