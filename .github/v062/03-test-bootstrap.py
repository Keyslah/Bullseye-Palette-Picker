"""Purpose: avoid racing the initial picker's pending save with test workspace setup.
Setup: native Chromium photo acceptance test; close the empty picker before seeding.
Writes: test harness only. Application source and photo assertions are unchanged.
Constraints: real CDN requests remain real; no placeholder images or relaxed checks.
"""
from pathlib import Path
p=Path('tests/v062-browser.py');s=p.read_text()
old="        seed=page.evaluate('''async()=>{"
new="        page.wait_for_timeout(700)  # Complete the empty workspace's debounced startup save.\n"+old
assert old in s;s=s.replace(old,new,1)
old='          await chrome.storage.local.set({bullseyeProjectV1:record});return record;'
assert old in s;s=s.replace(old,'          return record;',1)
old="        page.reload();expect(page.locator('#image-loaded')).to_be_visible()"
new="""        page.close()
        worker.evaluate('(record)=>chrome.storage.local.set({bullseyeProjectV1:record})',seed)
        page=context.new_page();page.set_default_timeout(30000);page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'?workspace=1');expect(page.locator('#image-loaded')).to_be_visible()"""
assert old in s;s=s.replace(old,new,1);p.write_text(s)
print('Test workspace seeded after initial page closes, preventing its startup save from replacing the fixture.')
