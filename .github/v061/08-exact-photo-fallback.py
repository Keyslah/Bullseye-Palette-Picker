"""Purpose: keep unavailable-size photo previews tied to the requested grade/thickness.
Setup: apply once after cart photo support and its tests.
Writes: only cart-photo resolution, one call site and a focused regression.
Constraints: never substitute another sheet thickness or silently use another grade's listing.
"""
from pathlib import Path
p=Path('extension/lib/cart-photos.js');s=p.read_text();old='  const handle = variant?.handle || product?.handle;';assert old in s
s=s.replace(old,"  const handle = variant?.handle || (variant?.form && variant.form !== product?.form ? null : product?.handle);",1);p.write_text(s)
p=Path('extension/lib/cart-library.js');s=p.read_text();old='cartVariants, cartSizeLabel, cartSizeChoices';assert old in s;s=s.replace(old,'cartVariants, cartSizeLabel, cartSizeKey, cartSizeChoices',1)
old='variant || cartVariants(product,addForm)[0]';assert old in s;s=s.replace(old,'variant || cartVariants(product,addForm).find(option=>cartSizeKey(option)===sizeKey) || {form:addForm,title:requestedSize}',1);p.write_text(s)
p=Path('tests/cart-photos.test.js');s=p.read_text();s+='''\ntest('an unavailable size never borrows another grade listing as though it matched',()=>{\n  const photo=cartPhotoSpec(vanilla,{form:'sheets',title:'Unknown size'},photos);\n  assert.equal(photo.kind,'reference');assert.equal(photo.form,'sheets');\n  assert.match(photo.note,/reference/);\n});\n''';p.write_text(s)
print('Unavailable package previews keep the requested grade and exact variant reference.')
