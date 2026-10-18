#!/usr/bin/env python3
"""Check that photographed background cannot become a glass color sample.

Purpose: regression checks for blue, black, gray, and white material sampling,
         including actual material marker coordinates after background removal.
Setup: Python 3.11+ and requirements-dev.txt (Pillow); run from any directory.
Destructive behavior: none. Images are in-memory fixtures; no files are written,
                      no network requests are made, and no carts are accessed.
Constraints: verifies the catalog builder independently of the Chrome runtime.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

from PIL import Image


BUILDER_PATH = Path(__file__).with_name("build-catalog.py")
SPEC = importlib.util.spec_from_file_location("bullseye_catalog_builder", BUILDER_PATH)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class MaterialSamplingTests(unittest.TestCase):
    def check_material(self, material: tuple[int, int, int], background: tuple[int, int, int],
                       family: str, rule: str, lightness_range: list[float] | None = None) -> None:
        size = (400, 400)
        solid = Image.new("RGB", size, material)
        mixed = Image.new("RGB", size, background)
        # The band center lies just inside the background half. A geometrical
        # center marker would therefore be wrong even if the average was right.
        mixed.paste(material, (0, 0, size[0], size[1] // 2))

        for label, image, expected_coverage in (("solid", solid, 1), ("half background", mixed, 0.5)):
            with self.subTest(image=label):
                samples = BUILDER.measure_samples(
                    image, [0.05, 0.1, 0.95, 0.9], 40, 0.025, family, rule, lightness_range,
                )
                self.assertEqual(len(samples), 40)
                for sample in samples:
                    self.assertEqual(tuple(sample["rgb"]), material,
                                     "Background must not dilute the actual material color.")
                    self.assertAlmostEqual(sample["materialCoverage"], expected_coverage)
                    point = (int(sample["x"] * size[0]), int(sample["y"] * size[1]))
                    self.assertEqual(image.getpixel(point), material,
                                     "The marker must point to visible material, not its background.")
                    self.assertEqual(tuple(sample["markerRgb"]), material)

    def test_blue_does_not_turn_white_when_white_background_is_added(self) -> None:
        self.check_material((40, 140, 240), (255, 255, 255), "chromatic", "visible-color")

    def test_black_does_not_turn_gray_when_white_background_is_added(self) -> None:
        self.check_material((5, 5, 5), (255, 255, 255), "neutral", "neutral-material", [0, 20])

    def test_gray_keeps_its_actual_tone_when_white_background_is_added(self) -> None:
        self.check_material((140, 140, 140), (255, 255, 255), "neutral", "neutral-material")

    def test_white_does_not_turn_gray_when_black_background_is_added(self) -> None:
        self.check_material((245, 245, 245), (0, 0, 0), "neutral", "reviewed-white-region", [85, 100])


if __name__ == "__main__":
    unittest.main(verbosity=2)
