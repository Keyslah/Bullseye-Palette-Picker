"""Purpose: render the original four-glass-tile project icon at Chrome's required sizes.
Setup: run python scripts/make-icons.py with Pillow installed from requirements-dev.txt.
Destructive behavior: overwrites only extension/assets/icon-*.png.
Constraints: geometric project artwork; does not use or reproduce Bullseye's company logo.
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'extension' / 'assets'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 504, 504), radius=120, fill='#153F35')
for bounds, color in [((92, 92, 245, 245), '#A8D4AD'), ((267, 92, 420, 245), '#E8B95D'), ((92, 267, 245, 420), '#73B5C3'), ((267, 267, 420, 420), '#DA8C79')]:
    draw.rounded_rectangle(bounds, radius=35, fill=color)
    x, y, _, _ = bounds
    draw.line((x+24, y+55, x+24, y+30, x+58, y+30), fill=(255, 255, 255, 130), width=7)
for size in [16, 32, 48, 128]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f'icon-{size}.png')
print('Rendered 16, 32, 48, and 128 pixel icons.')
