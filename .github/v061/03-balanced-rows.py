"""Purpose: keep wrapped landscape cards balanced instead of leaving an isolated final card.
Setup: apply after the targeted v0.6.1 implementation.
Writes: layout calculation and alternatives grid sizing only.
Constraints: no smaller-than-readable columns; no changes to colors or cart behavior.
"""
from pathlib import Path
path=Path('extension/picker.js');text=path.read_text()
old="  const columns=Math.max(1,Math.min(grid.children.length || 1,Math.floor((grid.clientWidth+6)/136)));"
new="  const count=grid.children.length || 1,maximum=Math.max(1,Math.floor((grid.clientWidth+6)/126));\n  const columns=Math.ceil(count/Math.ceil(count/maximum));"
assert old in text
path.write_text(text.replace(old,new,1))
path=Path('extension/picker-v6.css');text=path.read_text()
old='grid-template-columns:repeat(auto-fit,minmax(145px,1fr))'
assert old in text
path.write_text(text.replace(old,'grid-template-columns:repeat(auto-fill,minmax(145px,1fr))',1))
print('Balanced rows and stable search-result card sizes applied.')
