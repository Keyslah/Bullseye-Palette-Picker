"""Purpose: keep the extra selected-count information in the existing details menu.
Setup: apply after the compact-toolbar density patch.
Writes: relocates the same summary button and verifies its popup placement.
Constraints: no new controls, no lost cart action, no change to saved data or layout limits.
"""
from pathlib import Path
import re
file=Path('extension/picker.html')
text=file.read_text()
pattern=r'        <button class="text-button selected-summary" id="open-cart"[^\n]+\n'
match=re.search(pattern,text)
assert match,'Missing selected-glass summary'
summary=match.group().strip()
text=text[:match.start()]+text[match.end():]
anchor='<div class="menu-content"><h2>Bullseye Palette Picker</h2>'
assert anchor in text
text=text.replace(anchor,anchor+summary,1)
file.write_text(text)
file=Path('tests/v6-browser.py')
text=file.read_text()
old="n=>n.closest('.palette-flow')!==null"
assert old in text
file.write_text(text.replace(old,"n=>n.closest('#about-menu .menu-content')!==null",1))
print('Selection count is accessible inside details, without consuming a main-page row.')
