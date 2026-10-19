"""Purpose: remove the leftover selected-count row from the compact v6 toolbar.
Setup: run once after existing compact-v6 patches through the verification workflow.
Writes: moves the existing summary button only; adds a focused layout assertion.
Constraints: same element ID/listeners and all saved palette/cart behavior are retained.
"""
from pathlib import Path
import re
file=Path('extension/picker.html')
text=file.read_text()
pattern=r'        <button class="text-button selected-summary" id="open-cart"[^\n]+\n'
match=re.search(pattern,text)
assert match,'Missing existing selected-glass summary'
summary=match.group()
text=text[:match.start()]+text[match.end():]
anchor='        <div class="alternatives-heading" id="alternatives-heading"'
assert anchor in text
text=text.replace(anchor,summary+anchor,1)
file.write_text(text)

file=Path('tests/v6-browser.py')
text=file.read_text()
anchor="                if width>=650:assert header['height']+flow['height']<155,(header,flow)"
assert anchor in text
text=text.replace(anchor,anchor+"\n                if width>=1440:assert header['height']<44,('Orphan toolbar row',width,header)\n                assert page.locator('#open-cart').evaluate(\"n=>n.closest('.palette-flow')!==null\")",1)
file.write_text(text)
print('Selected-glass summary moved into the palette controls; no sparse count-only row.')
