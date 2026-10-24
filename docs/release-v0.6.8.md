# Bullseye Palette Picker v0.6.8

## Unavailable glass stays in your work

- Keep unavailable colors checked on the main page, add them to the working cart and save named carts or palettes containing them.
- The main page and cart workspace show **\* unavailable** beside the name. Stock no longer disables a real size, form, quantity or selection checkbox.
- The exact selected form, size, variant and quantity survive stock changes, reload and saving. A size with no catalog listing remains unavailable for selection; no replacement SKU is invented.
- Sending a cart containing unavailable rows lists those rows and leaves the cart intact. Nothing is silently dropped or partially sent.
- Quantity edits stay in place while a duplicate or working-cart save completes, including a value you are still typing.

## New tabs preserve your source page

**Cart** and **Full page** open separate active tabs. Sending or emptying Bullseye's website cart also opens its result in a new tab instead of navigating the existing Bullseye product/source page. Its URL, history and unsaved form input remain intact. Immediate follow-up cart requests use a fully loaded store document while result tabs open.

## Prominence and automatic colors

**Prominence** is a checkbox immediately to the right of **Alternatives**, checked by default. It uses the image's broad color theme when an image is first sampled or when you press **Remix**. Nearby shades count together, allowing textured regions to remain prominent without requiring identical pixels. Remix can choose different shades within that theme.

The obsolete **Show full palette** checkbox and wording are removed. The existing **Matches** tab returns to your palette's glass matches.

Uncheck Prominence for broader accent coverage on the next automatic sample. Toggling it changes the preference only; it does not rebuild the current palette. The choice is retained in your workspace, saved palettes, named settings and personal-data backup.

Automatic sampling skips black and neutral near-black pixels and chooses other colors actually present in the image. Dark chromatic blues, greens and reds remain eligible. Existing saved palettes and manual Black selections remain supported. A wholly black image cannot supply another real color; click or add a color manually in that case.

Manual additions, edited or dragged dots, and explicitly checked extra glass remain yours. Remix preserves manual colors, their source positions and choices. Newly sampled colors receive distinct IDs even when a previous automatic dot was manually edited.

Initial palettes and Remix prioritize distinct glass colors. If the image does not provide enough distinct colors, they can use the same glass at noticeably different photo-based thickness percentages. Repeated shades need both visible color separation and at least 10 percentage points of thickness difference. Sampling keeps using actual colors from the source image and the selected Prominence theme. Images with limited usable variation can produce fewer than the requested number of automatic colors.

## Reorder palette colors

Drag a palette color or its main match-card grip to compare different neighbors. Ordering works top to bottom in the vertical layout and left to right in the horizontal layout. The swatches, matching cards and numbered source dots follow that order.

Reordering keeps the same color values, source points, active color, selected glass, forms, sizes, quantities and checked state. The order survives reopening and is included when saving a named palette. For keyboard control, use **Alt + Arrow keys** on a swatch or **Arrow keys** on a focused card grip; **Alt + Home/End** on a swatch or **Home/End** on a grip moves it first or last.

## Update while keeping your personal data

1. Close picker and cart tabs.
2. Extract `Bullseye-Palette-Picker-v0.6.8.zip` into the **same installed extension folder**, replacing its files. If Chrome loads the repository's `extension` subfolder, replace the files inside that subfolder.
3. Open `chrome://extensions`, click **Reload** on Bullseye Palette Picker and confirm **0.6.8**.
4. Reopen the picker/cart. Refresh existing source-image pages before using their right-click image command.

Your current palette and named palettes are preserved. Press **Remix** on the current image to use the new automatic sampling rules; manually added or edited colors and their choices are kept. Loading the update does not resample a saved palette.

Keep the same installation for updates. **Settings → Back up my data / Restore my data** supports moving to another folder or computer. This release retains the existing storage keys, databases, palettes, preferences and carts.

## Verification

All **259 JavaScript tests** pass. The release gate also runs manifest/catalog/module checks, retained native workspace/layout/matching/cart tests, and focused native tests for unavailable selections, Prominence, manual-color preservation, palette reordering and separate browser tabs. Personal-data update and backup/restore checks remain included. Store mutations use disposable fixtures, with no customer account or live cart changes.

The installable ZIP contains **185 exact-source files**. The release workflow verifies it against the tested source before publication, then downloads the published archive and repeats the same check. Catalog photographs, color samples and thickness calculations are unchanged.
