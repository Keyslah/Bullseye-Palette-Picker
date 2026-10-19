"""Purpose: eliminate a second sparse swatch row at intermediate panel widths.
Setup: the compact toolbar and Settings menu are already in the v6 HTML.
Writes: relocate the existing automatic color-count controls; keep their IDs/events.
Constraints: Remix and Add color remain directly visible; no resampling or data changes.
"""
from pathlib import Path
import re
p=Path('extension/picker.html');s=p.read_text()
pattern=r'<label for="palette-count">Auto</label><div class="stepper">.*?</div>'
m=re.search(pattern,s);assert m
control=m.group();s=s[:m.start()]+s[m.end():]
anchor='<button class="button secondary-button" id="save-settings"'
assert anchor in s
s=s.replace(anchor,'<div class="palette-tools auto-count-setting">'+control+'</div>\n          '+anchor,1)
p.write_text(s)
with Path('extension/picker-v6.css').open('a') as css:
    css.write('\n.auto-count-setting{width:100%;gap:8px}.auto-count-setting>label{font-size:12px}.auto-count-setting .stepper input{width:45px}\n')
print('Automatic extraction count moved into Settings; swatches/Remix remain compact.')
