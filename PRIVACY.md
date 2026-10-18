# Privacy

Bullseye Palette Picker processes image pixels and compares colors inside your browser. It has no analytics, advertising, remote image-analysis service, or developer-operated server.

## Stored data

The current workspace is automatically saved in `chrome.storage.local`. It includes the reduced source image (at most 1,100 pixels on its longest side), its display name and available source URL, palette colors and point positions, match preferences, chosen jar sizes, and selected glass quantities. A handoff timestamp prevents a previously handled image from overwriting a reopened edited palette.

Named saved palettes use the extension's IndexedDB database. Each includes its name, save time, source image, color points, edited palette, selected jars and quantities, material filters, and image size. Listing saved palettes reads lightweight metadata and small photo thumbnails separately from the stored workspace image. Named palettes stay in this browser profile; they are not uploaded or synchronized to a Bullseye account.

Right-click image handoffs use `chrome.storage.session`. Temporary data can include a reduced image, its source URL, and source tab/window IDs.

The direct cart action keeps a local journal of up to 20 recent cart requests, including a random request ID, variant IDs/quantities, status, timestamp, and confirmation when available. This helps prevent duplicate additions after a lost response or extension restart. It contains no password, customer email, account name, or payment data.

**Remove image** clears the current image and its palette and cancels any pending image handoff. Named palettes are independent copies; delete an individual saved palette from **All palettes** to remove its copy. The local glass selection is separate from the store's cart. Uninstalling the extension removes its local Chrome storage and IndexedDB. The extension does not modify Bullseye's cart when removing local images or palettes.

A development web preview uses its own origin's local storage and IndexedDB.

## Clipboard and page capture

**Paste** reads a clipboard image after you invoke it; keyboard paste can also import an image. **Copy SKU list** writes the selected SKUs and quantities to the clipboard. The direct cart button does not need clipboard access.

**Capture** reads the visible browser view after you invoke the extension. You can select a region or accept the whole view. The accepted image is processed and saved locally like an imported image.

## Account checks and shopping

The picker checks Bullseye sign-in when opened or refreshed and before sending jars. It requests fresh store HTML and recognizes customer-only account indicators from Bullseye's current theme. It uses an existing Bullseye tab when possible. The account check returns a signed-in, signed-out, or unknown status; it does not collect or store the customer's email or avatar text.

**Sign in** opens Bullseye's normal account login page. Credentials and any verification steps are handled by Bullseye and its account provider.

**Send to my cart** runs the requested store action inside a native Bullseye tab, using that website's existing browser session. After confirming sign-in, it reads the existing cart, sends the chosen variant IDs and quantities to the store's cart API, and checks the resulting quantities. It opens the normal cart after confirmed additions. It does not clear existing items or complete checkout.

An uncertain or partial addition is reported to the user instead of automatically retrying the write. Bullseye's own privacy practices apply to its account, cart, and product pages.

## Other network requests

- Selecting a web image requests that image from its existing source host with credentials omitted. The image is not sent to a color-analysis server.
- Opening product details may request current variants, prices, and availability from `shop.bullseyeglass.com`. The bundled catalog supplies a snapshot when the request is unavailable.
- Product and store links navigate to Bullseye normally.

## Chrome permissions

| Permission | Use |
| --- | --- |
| `contextMenus` | Image and visible-page palette commands |
| `sidePanel` | Picker alongside the current webpage |
| `storage` | Current workspace, request journal, and temporary image handoff |
| `activeTab` | Capture the page on which you explicitly invoke the extension |
| `scripting` | Check the store session and add explicitly chosen variants in a Bullseye tab |
| Bullseye shop host | Read public products and customer-status indicators; use the native cart after your click |
| Optional image-host access | Fetch an image from the particular host you select |

Optional host patterns let Chrome request a particular image origin when needed; they do not grant every website at installation. The extension does not request password, cookie, browsing-history, camera, or microphone APIs.
