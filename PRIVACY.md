# Privacy

Bullseye Palette Picker processes image pixels and compares colors inside your browser. It has no analytics, advertising, remote image-analysis service, or developer-operated server.

## Stored data

The current workspace is automatically saved in `chrome.storage.local` under `bullseyeProjectV1`. The workspace includes the reduced source image (at most 1,100 pixels on its longest side), its display name and available source URL, palette colors and point positions, selected purchase format, preferred jar size, exact package choices, quantities, and which suggestions you unchecked or added manually. Material filters, tint inclusion, and image size are also retained. The cart-only page does not overwrite this photo workspace. These selection preferences keep your edits intact when automatic suggestions update. A handoff timestamp prevents a previously handled image from overwriting a reopened edited palette.

The active local working cart is kept automatically under `bullseyeWorkingCartV1`. It includes its name, local identity, exact variant IDs, package choices, quantities, display information, and update time. This lets the Cart quantity badge and cart pages share the same saved state. Updates retain all existing storage identities.

**Save settings** explicitly writes defaults to the separate `bullseyeSettingsV1` key in `chrome.storage.local`: glass format, preferred frit jar size, transparent/opalescent inclusion, starting automatic-color count, image size, tint inclusion, and full-palette view. Named presets also use the separate `bullseyeSettingsPresetsV1` key, storing only a preset ID, name, settings, and update time. It stores no photo or named-cart contents. Loading settings does not rewrite them, and saving defaults does not overwrite named palettes or carts. A Chrome storage failure is reported rather than redirecting extension data into preview storage.

Named saved palettes use the `bullseyeSavedPalettes` IndexedDB database. Each includes its name, save time, source image, color points, edited palette, purchase format, selected variants and quantities, material filters, and image size. Listing saved palettes reads lightweight metadata and small photo thumbnails separately from the stored workspace image.

Named saved carts use the separate `bullseyeSavedCarts` IndexedDB database and its `carts` store. A record includes its local ID, name, creation/update times, color and item counts, and selected product/variant IDs with quantities. Small display snapshots retain the glass name, SKU, purchase form and size, reference-image path, price, and availability. A saved cart does not contain the source photo or image-analysis data. Copies have independent IDs and items, so editing a duplicate does not change its original.

Settings, saved photo palettes, and named carts stay in the current Chrome profile. They are not uploaded or synchronized to a Bullseye account. A cart is added to the website's cart only through **Send cart to Bullseye**.

**Back up my data** downloads a local JSON file containing current and saved settings, photo palettes including their images, saved carts and the working cart. **Restore my data** reads a file you choose, validates it, merges named records, and restores included working values. The backup excludes the account, session and cart-request journal. No backup is uploaded by the extension. A local restore-coordination marker lets open picker tabs pause writes and reload the restored data.

Right-click image handoffs use `chrome.storage.session`. Temporary data can include a reduced image, its source URL, and source tab/window IDs.

The direct cart action keeps a local journal of up to 20 recent cart requests under `bullseyeCartRequestsV1` in `chrome.storage.local`, including a random request ID, variant IDs/quantities, status, timestamp, and confirmation when available. This helps prevent duplicate additions after a lost response or extension restart. It contains no password, customer email, account name, or payment data.

**Remove image** clears the current image and its palette and cancels any pending image handoff. Named palettes and carts are independent copies: delete a palette from **Load palettes** or a cart from **Saved carts** to remove that record. The local glass selection is separate from the store's cart. Uninstalling the extension removes its local Chrome storage and IndexedDB. Removing local images, palettes, or saved carts does not modify Bullseye's cart.

A development web preview uses its own origin's `localStorage` for the workspace and explicitly saved defaults, and its own IndexedDB for palettes and carts. This preview fallback is used only outside the installed extension.

## Clipboard and page capture

**Paste** reads a clipboard image after you invoke it; keyboard paste can also import an image. **Copy SKU list** writes the selected SKUs and quantities to the clipboard. The direct cart button does not need clipboard access.

**Capture** reads the visible browser view after you invoke the extension. You can select a region or accept the whole view. The accepted image is processed and saved locally like an imported image.

## Account checks and shopping

The picker checks Bullseye sign-in when opened or refreshed and before sending selected glass. It requests fresh store HTML and recognizes customer-only account indicators from Bullseye's current theme. It uses an existing Bullseye tab when possible. The account check returns a signed-in, signed-out, or unknown status; it does not collect or store the customer's email or avatar text.

**Sign in** opens Bullseye's normal account login page. Credentials and any verification steps are handled by Bullseye and its account provider.

**Send cart to Bullseye**, invoked from the cart workspace or saved-cart list, runs the requested store action inside a native Bullseye tab using that website's existing browser session. After confirming sign-in, it reads the existing cart, sends the chosen variant IDs and quantities to the store's cart API, and checks the resulting quantities. It opens the normal cart after confirmed additions. Each deliberate send after success adds those quantities again; overlapping clicks are coalesced. Sending retains existing items and does not complete checkout.

**Empty Bullseye cart** is a separate explicit action, confirmed before use. It checks the store session, posts a single cart-clear request in the native store tab and reads the result to verify an empty cart. It keeps the local working cart, saved carts, palettes and settings. A confirmed empty clears unresolved addition guards so a later deliberate send can start again.

Automatic color selection, format changes, Add to Cart, saving settings, and creating, editing, duplicating, or deleting local carts do not submit store additions. Only explicit Send and confirmed Empty actions modify the website cart.

An uncertain or partial addition is reported to the user instead of automatically retrying the write. Bullseye's own privacy practices apply to its account, cart, and product pages.

**Copy my Bullseye cart** runs only when clicked. It uses the same native store tab and sign-in check, then reads the cart with GET requests. Only product names, SKUs, variant IDs, size labels, quantities, and display prices are returned to the local cart editor. The copy does not return cart tokens, customer identity, notes, addresses, payment data, or checkout information. It is kept as the working cart and can also be saved under a name. Copying does not post a cart change or alter website quantities. Unsupported custom-property/subscription items produce an error rather than silently changing their meaning.

## Other network requests

- Selecting a web image requests that image from its existing source host with credentials omitted. The image is not sent to a color-analysis server.
- Opening product details may request current variants, prices, and availability for that purchase format from `shop.bullseyeglass.com`. The bundled product-format index supplies a snapshot when the request is unavailable. Switching formats uses bundled records and does not upload the image or palette.
- Product and store links navigate to Bullseye normally.

## Chrome permissions

| Permission | Use |
| --- | --- |
| `contextMenus` | Image and visible-page palette commands |
| `sidePanel` | Picker alongside the current webpage |
| `storage` | Current workspace, explicitly saved settings, request journal, and temporary image handoff |
| `activeTab` | Capture the page on which you explicitly invoke the extension |
| `scripting` | Check the store session, read a cart copy, add chosen variants, or empty the website cart after the corresponding explicit action |
| Bullseye shop host | Read public products and customer-status indicators; use the native cart after your click |
| Optional image-host access | Fetch an image from the particular host you select |

Optional host patterns let Chrome request a particular image origin when needed; they do not grant every website at installation. The extension does not request password, cookie, browsing-history, camera, or microphone APIs.

Saved carts, saved settings, and the additional purchase formats introduce no new Chrome permissions. Store integration tests use isolated fixtures; they do not operate on a user's personal Bullseye account or complete a live purchase.

## Cart product photographs

Cart thumbnails and enlarged previews request public product photographs from shop.bullseyeglass.com or cdn.shopify.com, with referrer information omitted. These requests carry no photo-palette image or customer information. cart-photos.json records the public image sources. clear-cart.json contains additional clear-glass purchase variants for the cart only; they are not added to automatic photo matching.
