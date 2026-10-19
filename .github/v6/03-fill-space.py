"""Purpose: remove the portrait gutter and the isolated search/selected-summary row.
Setup: apply once to the checkpointed compact v6 source and its native tests.
Writes: picker layout and search handler, plus diagnostic output in browser tests.
Constraints: preserve actual image aspect ratio and explicit Fit preference; no catalog/cart changes.
"""
from pathlib import Path
import re

def change(path,old,new):
    p=Path(path);s=p.read_text()
    assert old in s,f'Missing anchor in {path}: {old[:90]}'
    p.write_text(s.replace(old,new,1))

change('extension/picker.js',
 "  const limit=state.imageSize==='fit'?fitHeight:state.imageSize==='larger'?fitHeight*1.25:Infinity;",
 "  // Larger portraits use the entire source column rather than leaving a wide gutter.\n  const limit=beside && state.imageSize!=='fit'?Infinity:state.imageSize==='fit'?fitHeight:state.imageSize==='larger'?fitHeight*1.25:Infinity;")
change('extension/picker.js',
 "  $('glass-search').addEventListener('input', (event) => { state.query = event.target.value; renderResults(); });",
 "  $('glass-search').addEventListener('input', (event) => { state.query = event.target.value; if(state.query.trim() && state.view==='palette' && activeTarget())state.view='alternatives'; renderResults(); persist(); });")
p=Path('extension/picker.html');s=p.read_text()
patterns=[r'<div class="view-tabs"[^>]*>.*?</div>',r'<input id="glass-search"[^>]*>',r'<button class="text-button selected-summary"[^>]*>.*?</button>']
moved=[]
for pattern in patterns:
    match=re.search(pattern,s,re.S);assert match,pattern
    moved.append(match.group());s=s[:match.start()]+s[match.end():]
anchor='        <details class="toolbar-menu" id="about-menu">'
assert anchor in s
s=s.replace(anchor,'        '+'\n        '.join(moved)+'\n'+anchor,1)
p.write_text(s)
with Path('extension/picker-v6.css').open('a') as f:
    f.write('''
/* Search and navigation share the same left-flow toolbar, not an isolated row. */
.compact-toolbar .selected-summary{margin-left:0;margin-right:0}
.compact-toolbar .view-tabs{margin:0;border:0;min-height:0}
.compact-toolbar .view-tab{font-size:10px;padding:4px 6px;min-height:27px}
.cart-page #main-toolbar>.view-tabs,.cart-page #glass-search,.cart-page #open-cart{display:none}
''')
change('tests/v6-browser.py',
 "if width>=650:assert source['width']>width*.43",
 "if width>=650:assert source['width']>width*.43, (image_name,width,height,source)")
change('tests/v6-browser.py',
 "                page.wait_for_timeout(250)",
 "                page.evaluate('window.scrollTo(0,0)')\n                page.wait_for_timeout(250)")
change('tests/v6-browser.py',"requests=[]","requests=[]\nfailure=None")
change('tests/v6-browser.py',"except Exception:\n    if context:","except Exception:\n    failure=traceback.format_exc()\n    if context:")
change('tests/v6-browser.py',"report={'passed':checks,","report={'failure':failure,'passed':checks,")
print('Portrait image now fills its column; search and selected summary packed into the toolbar.')
