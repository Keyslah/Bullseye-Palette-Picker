"""Purpose: exercise the actual save-then-load palette interaction in native Chrome.
Setup: apply once after 05-release-docs.py via the recovery workflow.
Writes: only the browser acceptance test, not app source or user data.
Constraints: keep assertions; reopen Load palettes after successful Save closes it.
"""
from pathlib import Path
file=Path('tests/v5-browser.py')
text=file.read_text()
old="        expect(page.locator('#saved-list')).to_contain_text('V5 browser palette')"
new="        expect(page.locator('#saved-dialog')).not_to_be_visible()\n        page.locator('#open-saved').click()\n"+old
assert old in text
file.write_text(text.replace(old,new,1))
print('Palette acceptance check now reopens Load palettes after the successful save.')
