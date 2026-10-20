#!/usr/bin/env python3
"""Build exact-photo color samples for each catalog frit form.

Purpose: measure actual public Bullseye Powder/Fine/Medium/Coarse photographs.
Setup: Python, Pillow and NumPy; existing catalog, product-formats and cart-photos.
Writes: form-samples.json, an audit, and optional review contact sheets. Downloads
        are public image GETs cached under .cache; user images/carts are untouched.
Constraints: no per-photo thickness normalization. The runtime keeps the original
             per-color reference. Masks exclude backdrops, rims, labels and gaps.
             Source pixels remain full sRGB color; every marker has that exact RGB.
"""

from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("catalog_builder", Path(__file__).with_name("build-catalog.py"))
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)
FORMS = ("powder", "fine", "medium", "coarse")
DISH_IDS = {"001242", "001247"}


def lab_array(rgb):
    linear = np.asarray(CATALOG.LINEAR_RGB)[rgb]
    xyz = linear @ np.array([[.4124564, .2126729, .0193339],
                             [.3575761, .7151522, .1191920],
                             [.1804375, .0721750, .9503041]])
    xyz /= [.95047, 1, 1.08883]
    d = 6 / 29
    f = np.where(xyz > d ** 3, np.cbrt(xyz), xyz / (3 * d ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16,
                     500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])], axis=-1)


def region_for(product, form):
    """Reviewed interiors in the actual first image selected by cart-photos.

    2026-10-20 review: 480 fired spreads, 8 unfired dishes, 76 cast wedges.
    Spread images fill the frame. White styles restrict sampling to their dense
    left glass. All wedges use their front face above the black horizon; the dish
    mask stays well inside the circular rim. These are photo regions, not physical
    depth assumptions and not copied marker positions.
    """
    if product["id"] == "000137" and form == "powder":
        return {"kind": "Fired frit spread", "shape": "rectangle",
                "rect": [.03, .1, .3, .9], "materialFamily": "neutral",
                "lightnessRange": [80, 100],
                "note": "Actual Powder glass is neutral cream; only the dense left material is sampled. Blue edge reflections are excluded."}
    if product["id"] == "000206" and form == "powder":
        return {"kind": "Fired frit spread", "shape": "rectangle",
                "rect": [.03, .1, .3, .9], "materialFamily": "neutral",
                "lightnessRange": [50, 85],
                "note": "Actual Powder material is a low-chroma warm gray; dense left glass excludes the white background."}
    if product["id"] in DISH_IDS:
        return {"kind": "Unfired frit in a dish", "shape": "circle",
                "rect": [.18, .18, .82, .82], "center": [.5, .5], "radius": .32}
    if product["id"] == "001864" and form == "powder":
        return {"kind": "Cast frit wedge", "shape": "rectangle",
                "rect": [.22, .42, .76, .58], "materialFamily": "neutral",
                "lightnessRange": [20, 85],
                "note": "Powder wedge front is a low-chroma gray-blue; samples stay above the black backdrop and inside the glass face."}
    if product["id"].startswith("0018") and product["id"] != "001838":
        return {"kind": "Cast frit wedge", "shape": "rectangle",
                "rect": [.22, .42, .76, .58]}
    # Existing reviewed neutral intervals identify the material, but the actual
    # colors and positions are remeasured independently from every form's image.
    narrow = product["source"]["materialRule"] == "reviewed-white-region" or product["id"] == "000137"
    return {"kind": "Fired frit spread", "shape": "rectangle",
            "rect": [.03, .1, .3 if narrow else .93, .9]}


def material_pixels(image, product, region):
    # A regular full-resolution source-pixel lattice keeps builds inexpensive.
    # No interpolated resize is sampled: each RGB comes from its original pixel.
    rgb = np.asarray(image)
    step = max(1, max(image.size) // 500)
    ys, xs = np.mgrid[step // 2:image.height:step, step // 2:image.width:step]
    sampled = rgb[ys, xs]
    lab = lab_array(sampled)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    x, y = (xs + .5) / image.width, (ys + .5) / image.height
    left, top, right, bottom = region["rect"]
    eligible = (x >= left) & (x <= right) & (y >= top) & (y <= bottom)
    if region["shape"] == "circle":
        eligible &= (x - region["center"][0]) ** 2 + (y - region["center"][1]) ** 2 <= region["radius"] ** 2
    family = region.get("materialFamily", product["colorFamily"])
    if family == "chromatic":
        eligible &= chroma >= 10
        if product["id"] == "000137":
            # French Vanilla is yellow/cream glass over black. Blue fringe
            # reflections are neither a yellow material sample nor white glass.
            eligible &= lab[..., 2] >= 9
    else:
        low, high = region.get("lightnessRange") or product["source"]["materialThresholds"]["neutralLightnessRange"]
        eligible &= (chroma < 10) & (lab[..., 0] >= low) & (lab[..., 0] <= high)
    # Keep marker points inside eligible material rather than on an isolated
    # compression/edge pixel. The check uses adjacent source-lattice neighbors.
    interior = eligible.copy()
    interior[1:-1, 1:-1] &= (eligible[:-2, 1:-1] & eligible[2:, 1:-1]
                             & eligible[1:-1, :-2] & eligible[1:-1, 2:])
    return sampled, lab, x, y, eligible, interior


def measure(image, product, form, region):
    rgb, lab, x, y, eligible, interior = material_pixels(image, product, region)
    left, top, right, bottom = region["rect"]
    candidates = []
    inspection = []

    def measure_cell(bounds, identifier):
        l, t, r, b = bounds
        box = (x >= l) & (x < r) & (y >= t) & (y < b)
        material = box & eligible
        points = box & interior
        count = int(np.count_nonzero(material))
        if count < 12 or count < .025 * np.count_nonzero(box) or not np.any(points):
            return None
        # Average material only in linear RGB, then locate an actual material
        # pixel close to that full Lab mean. No white gap affects this mean.
        linear_mean = np.asarray(CATALOG.LINEAR_RGB)[rgb[material]].mean(axis=0)
        mean_rgb = [CATALOG.linear_to_channel(float(v)) for v in linear_mean]
        mean_lab = np.asarray(CATALOG.rgb_to_lab(mean_rgb))
        rows, cols = np.nonzero(points)
        distances = ((lab[points] - mean_lab) ** 2).sum(axis=1)
        # Small spatial tie-break chooses a central occurrence of repeated RGB.
        distances += .0001 * ((x[points] - (l + r) / 2) ** 2 + (y[points] - (t + b) / 2) ** 2)
        chosen = int(np.argmin(distances)); row, col = rows[chosen], cols[chosen]
        color = rgb[row, col].tolist()
        return {"id": f"{form}-{identifier}", "rgb": color,
                "hex": "#" + "".join(f"{v:02x}" for v in color),
                "lab": CATALOG.rgb_to_lab(color),
                "x": round(float(x[row, col]), 7), "y": round(float(y[row, col]), 7),
                "materialCoverage": round(count / max(1, np.count_nonzero(box)), 5)}

    for i in range(40):
        l = left + (right - left) * i / 40
        r = left + (right - left) * (i + 1) / 40
        sample = measure_cell([l, top, r, bottom], f"band-{i:02}")
        if sample:
            candidates.append(sample)
    for row in range(6):
        for col in range(12):
            bounds = [left + (right - left) * col / 12, top + (bottom - top) * row / 6,
                      left + (right - left) * (col + 1) / 12, top + (bottom - top) * (row + 1) / 6]
            sample = measure_cell(bounds, f"cell-{row:02}-{col:02}")
            if sample:
                inspection.append(sample)
    candidates.extend(inspection)
    if len(candidates) < 12:
        raise ValueError(f"Too few visible glass samples for {product['id']} {form}: {len(candidates)}")
    # Keep both actual range endpoints, then choose 40 full-color-diverse actual
    # measurements. This is sampling, not a stretching/normalization of the scale.
    selected = [min(candidates, key=lambda v: v["lab"][0]), max(candidates, key=lambda v: v["lab"][0])]
    chosen_ids = {v["id"] for v in selected}
    while len(selected) < min(40, len(candidates)):
        next_sample = max((v for v in candidates if v["id"] not in chosen_ids),
                          key=lambda v: min(sum((a - b) ** 2 for a, b in zip(v["lab"], s["lab"]))
                                            for s in selected))
        selected.append(next_sample); chosen_ids.add(next_sample["id"])
    selected.sort(key=lambda v: (-v["lab"][0], v["id"]))
    return selected, inspection


def build_record(job):
    product, form, handle, url, cache = job
    source = cache / f"{product['id']}-{form}.jpg"
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(CATALOG.fetch(url))
    raw = source.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    region = region_for(product, form)
    measured_cache = source.with_suffix(".samples.json")
    if measured_cache.exists():
        saved = json.loads(measured_cache.read_text())
        if saved.get("algorithm") == 1 and saved["sourceSha256"] == source_hash and saved["region"] == region:
            return product["id"], form, saved
    image, conversion = CATALOG.prepare_image(raw)
    samples, inspection = measure(image, product, form, region)
    for sample in samples + inspection:
        point = (int(sample["x"] * image.width), int(sample["y"] * image.height))
        if list(image.getpixel(point)) != sample["rgb"]:
            raise ValueError(f"Marker/RGB mismatch for {product['id']} {form} {sample['id']}")
    # Spatial inspection does not require duplicated hexadecimal/Lab values;
    # the existing color engine derives them from the measured RGB when needed.
    for sample in samples:
        sample.pop("materialCoverage", None)
    inspection = [{k: sample[k] for k in ("id", "rgb", "x", "y")} for sample in inspection]
    record = {
        "algorithm": 1, "imageUrl": url, "sourceSha256": source_hash,
        "handle": handle, "pixels": list(image.size), "kind": region["kind"],
        "region": region, "colorFamily": region.get("materialFamily", product["colorFamily"]),
        "reference": "catalog.thicknessReference (shared across all frit forms)",
        "profileConversion": conversion["profileConversion"],
        "samples": samples, "inspectionSamples": inspection,
    }
    measured_cache.write_text(json.dumps(record, separators=(",", ":")))
    return product["id"], form, record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/form-photos")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "extension/data/catalog.json").read_text())["products"]
    formats = json.loads((ROOT / "extension/data/product-formats.json").read_text())["products"]
    photos = json.loads((ROOT / "extension/data/cart-photos.json").read_text())["products"]
    jobs = []
    for product in catalog:
        if args.only and product["id"] not in args.only:
            continue
        for form in FORMS:
            handles = {v["handle"] for v in formats[product["id"]][form]["variants"]}
            if len(handles) != 1:
                raise ValueError("Review frit form with multiple photo products")
            handle = handles.pop(); urls = {photos[handle]["images"][0]}
            urls.update(photos[handle].get("variantImages", {}).values())
            if len(urls) != 1:
                raise ValueError("Review frit form with variant-specific photographs")
            jobs.append((product, form, handle, urls.pop(), args.cache))
    products = {}; errors = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(build_record, job) for job in jobs]
        for count, future in enumerate(futures, 1):
            try:
                code, form, record = future.result()
                products.setdefault(code, {})[form] = record
            except Exception as error:
                errors.append(str(error)); print(str(error), flush=True)
            if count % 20 == 0 or count == len(jobs):
                print(f"Measured and checked {count}/{len(jobs)} exact photographs", flush=True)
    if errors:
        raise ValueError("Review photo masks: " + "; ".join(errors))
    result = {"version": 1, "reviewedAt": "2026-10-20", "source": "Bullseye public product photographs",
              "method": "Original sRGB source pixels; reviewed interior masks; material-only linear RGB means; actual representative pixels; exact URL-bound normalized coordinates.",
              "products": products}
    destination = ROOT / ("test-results/form-samples-preview.json" if args.only else "extension/data/form-samples.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Wrote {destination.relative_to(ROOT)} ({destination.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
