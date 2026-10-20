#!/usr/bin/env python3
"""Verify every shipped frit sample against its actual public photograph.

Purpose: detect mismatched photo bytes, wrong coordinates, background samples,
         and RGB values that do not occur at their shipped marker location.
Setup: Python and Pillow; optional --cache directory contains original CDN JPEGs.
Writes: downloads missing public images into the cache and writes an audit under
        test-results. No user browser, image, account, or shopping cart is used.
Constraints: images are genuine CDN bytes, never generated/mocked fixtures. Source
             ICC profiles are converted to sRGB exactly as during measurement.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("catalog_builder", Path(__file__).with_name("build-catalog.py"))
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def inspect(job):
    product, form, record, cache = job
    source = cache / f"{product['id']}-{form}.jpg"
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(BUILDER.fetch(record["imageUrl"]))
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == record["sourceSha256"], f"Photo bytes changed for {product['id']} {form}"
    image, _ = BUILDER.prepare_image(raw)
    assert list(image.size) == record["pixels"]
    region = record["region"]
    left, top, right, bottom = region["rect"]
    samples = record["samples"] + record["inspectionSamples"]
    for sample in samples:
        assert left <= sample["x"] <= right and top <= sample["y"] <= bottom
        if region["shape"] == "circle":
            assert (sample["x"] - .5) ** 2 + (sample["y"] - .5) ** 2 <= .32 ** 2 + 1e-7
        pixel = image.getpixel((int(sample["x"] * image.width), int(sample["y"] * image.height)))
        assert list(pixel) == sample["rgb"], f"Pixel mismatch: {product['id']} {form} {sample['id']}"
        lab = BUILDER.rgb_to_lab(list(pixel)); chroma = math.hypot(lab[1], lab[2])
        if record["colorFamily"] == "chromatic":
            assert chroma >= 10
            if product["id"] == "000137":
                assert lab[2] >= 9
        else:
            assert chroma < 10
            low, high = region.get("lightnessRange") or product["source"]["materialThresholds"]["neutralLightnessRange"]
            assert low <= lab[0] <= high
    return {"color": product["id"], "form": form, "kind": record["kind"],
            "url": record["imageUrl"], "sha256": digest, "pixels": list(image.size),
            "sampleCount": len(record["samples"]), "inspectionCount": len(record["inspectionSamples"]),
            "markerRgbMaximumError": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/form-photos")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    catalog = json.loads((ROOT / "extension/data/catalog.json").read_text())["products"]
    index = json.loads((ROOT / "extension/data/form-samples.json").read_text())["products"]
    jobs = [(product, form, record, args.cache) for product in catalog for form, record in index[product["id"]].items()]
    assert len(jobs) == 564
    audit = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for record in pool.map(inspect, jobs):
            audit.append(record)
            if len(audit) % 40 == 0:
                print(f"Verified original pixels for {len(audit)}/564 photographs", flush=True)
    result = {"photoCount": len(audit), "sampleCount": sum(r["sampleCount"] for r in audit),
              "inspectionCount": sum(r["inspectionCount"] for r in audit),
              "markerRgbMaximumError": 0, "photographs": audit}
    out = ROOT / "test-results/form-sampling-audit.json"; out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(f"PASS: {result['photoCount']} actual photos, {result['sampleCount']} swatches, "
          f"{result['inspectionCount']} spatial samples; exact marker RGB verified.", flush=True)


if __name__ == "__main__":
    main()
