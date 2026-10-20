"""Purpose: keep the requested Grade and Size controls adjacent without an oversized jar menu.
Setup: apply after cart builder/large photo controls.
Writes: size-dependent dropdown styling and its native layout assertion only.
Constraints: sheet choices remain wide enough for dimensions and thickness; narrow panels wrap.
"""
from pathlib import Path
p=Path('extension/lib/cart-library.js');s=p.read_text();old="    $('cart-add-size-label').textContent=addForm==='sheets' ? 'Size / thickness' : 'Size';";assert old in s
s=s.replace(old,old+"\n    sizeControl.closest('.cart-size-option').classList.toggle('sheet-sizes',addForm==='sheets');",1);p.write_text(s)
with Path('extension/picker-v6.css').open('a') as f:f.write('''
.cart-size-option{width:auto}
#cart-add-size{width:105px;flex:none}
.cart-size-option.sheet-sizes #cart-add-size{width:clamp(150px,19vw,270px);flex:1}
@media(max-width:540px){.cart-size-option{width:auto}.cart-size-option.sheet-sizes{width:100%}.cart-size-option.sheet-sizes #cart-add-size{width:auto}}
''')
p=Path('tests/cart-builder-browser.py');s=p.read_text();old="        page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100);no_overflow(page)";assert old in s
s=s.replace(old,old+"\n        if width>=1400:assert abs(page.locator('#cart-add-form').bounding_box()['y']-page.locator('#cart-add-size').bounding_box()['y'])<3",1);p.write_text(s)
print('Compact jar menus stay beside Grade; sheet combinations retain readable labels.')
