"""Purpose: select the existing cart test row using its actual name/variant DOM.
Setup: v062 native actual-photo suite; cart rows carry variant IDs, not product IDs.
Writes: one test locator only. The application and all photo assertions are unchanged.
Constraints: keep testing each grade change and its real CDN thumbnail/large preview.
"""
from pathlib import Path
p=Path('tests/v062-browser.py');s=p.read_text()
old='            item=cart.locator(\'#saved-cart-items [data-product-id="001108"]\')'
new="            item=cart.locator('#saved-cart-items .saved-cart-item').filter(has=cart.get_by_role('heading',name='Aquamarine Blue',exact=True))"
assert old in s;s=s.replace(old,new,1);p.write_text(s)
print('Native cart test uses the real cart row structure; no product-code attribute is invented.')
