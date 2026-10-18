# Privacy

Bullseye Palette Picker processes image pixels and compares colors inside the user's browser. It has no analytics, advertising, remote image-analysis service, or developer-operated server.

## Stored data

The picker automatically saves one current project in `chrome.storage.local`. This includes:

- A PNG copy of the selected image, reduced to at most 1,100 pixels on its longest side. This image copy remains saved when the picker or browser is closed.
- The image's filename or display name and, when available, its source image or page URL.
- Palette colors, the selected palette color, match-range and view preferences, chosen jar sizes, and the selected glass list with quantities.
- A timestamp used to avoid reopening a previously handled image handoff.

Right-click image handoffs use `chrome.storage.session` separately. This temporary data can include a reduced image, its source URL, and the source tab and window IDs. It is distinct from the image copy saved with the current project.

**Remove image** clears the image, its saved source information, and its palette from the current project. The selected glass list remains. Removing or manually replacing an image also cancels the previous pending browser-image handoff. Replacing an image overwrites the saved image. The extension does not sync project data to an external account. Uninstalling the extension removes its Chrome storage.

When opened as a development preview, the picker uses that preview origin's local storage for the same saved project state.

## Clipboard and page capture

**Paste image** reads an image from the clipboard after the user invokes it; pasting with the keyboard also imports clipboard image data. **Copy SKU list** and **Send to Bullseye cart** write the selected SKUs and quantities to the system clipboard.

Page capture reads the visible browser view after the user invokes the extension. **Capture a region** lets the user select part of that view or accept the whole view. The accepted image is processed and saved locally in the same way as an imported image.

## Network requests

- When a user selects a web image, the extension requests that image from its existing source host with cookies and other request credentials omitted. It does not send the image to a color-analysis server.
- Opening a glass product's details in the installed extension can request current jar variants, prices, and availability from `shop.bullseyeglass.com`. The bundled catalog supplies fallback information when that request is unavailable.
- **Send to Bullseye cart** opens Bullseye's Quick Add page and attempts to fill the user-selected product SKUs and quantities. The user reviews and submits the store's form.
- Product-page links navigate to Bullseye normally, using that website's own privacy practices and browser session.

## Chrome permissions

| Permission | Use |
| --- | --- |
| `contextMenus` | Add the image and visible-page palette commands |
| `sidePanel` | Display the palette picker alongside a webpage |
| `storage` | Save the reduced image, palette, glass selection, and preferences locally; retain temporary right-click handoff data |
| `activeTab` | Capture the page the user explicitly invokes the extension on |
| `scripting` | Prefill the user-selected SKU list on Bullseye's Quick Add page |
| Bullseye shop host | Read products and fill the Quick Add form on the specified store |
| Optional image-host access | Fetch an image from the specific host requested by the user |

Optional host patterns allow Chrome to request a particular image origin as needed. They do not grant access to every site at installation. The extension does not request password, cookie, browsing-history, camera, or microphone APIs.
