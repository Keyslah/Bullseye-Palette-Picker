# Chrome Web Store listing kit

Everything needed to publish **Bullseye Palette Picker v0.6.8** on the Chrome Web Store. Work through the sections in order in the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole). Text in the boxes is ready to paste.

## 1. Account (one time)

1. Sign in to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own the listing.
2. Accept the developer agreement and pay the one-time registration fee (the dashboard shows the amount).
3. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) for that account. The store requires it to publish.
4. On the **Account** page, set the **Publisher name** (shown as "Offered by"), then add and verify a contact email. Answer the **trader / non-trader** question. It is an EU requirement; a free, non-commercial project is usually non-trader, but that is your declaration to make.

## 2. Package

Upload the published release ZIP unchanged. It has `manifest.json` at its root and was verified byte-for-byte against the v0.6.8 release commit (`2b865d1`) with `scripts/verify-package.py`.

- Download: [Bullseye-Palette-Picker-v0.6.8.zip](https://github.com/Keyslah/Bullseye-Palette-Picker/releases/download/v0.6.8/Bullseye-Palette-Picker-v0.6.8.zip) (20.8 MB)
- SHA-256: `b4266f88f3c758de82a0b38d682f8bcd2013ecb500cd440c1fbd7f2d0c08f93a`

In the dashboard, click **Add new item** and upload the ZIP. The name, summary, version and icons come from `manifest.json` and cannot be edited in the dashboard.

## 3. Store listing tab

**Description**

```text
Turn any photo into a palette of real Bullseye glass.

Right-click an image on any website and choose "Create Bullseye palette." The picker samples the photo's main colors, marks each one with a numbered dot, and matches it to an actual Bullseye glass color, with a reference photograph of that glass beside it.

WHAT IT DOES
• Samples a photo's main colors. Drag a dot to resample, click the image to add a color, or edit any color directly.
• Matches by full color (CIEDE2000), so hue, saturation and lightness all count, across 141 Bullseye colors.
• Shows an approximate thickness guide for each match, such as "Steel Blue at 95% thickness."
• Browse Alternatives for any color, filtered by Transparent, Opalescent and Tints.
• Choose Sheets or Powder, Fine, Medium or Coarse frit, with 2,088 real Bullseye sheet and frit options. Out-of-stock glass stays selectable and is marked "* unavailable."
• Save named palettes (including the photo), named settings and multiple named carts. Back up and restore everything to a file.
• Add your picks to a working cart, then send them to your own Bullseye website cart in one click. You review and check out on Bullseye's site as usual.

HOW TO USE
1. Right-click a photo (or a page, for "Create Bullseye palette from visible page"), or click the toolbar button and import, paste or capture an image.
2. Adjust colors, swap in alternatives, and choose the form, size and quantity for each glass.
3. Click Add to Cart, open Cart, then click "Send cart to Bullseye." Sending requires signing in to your Bullseye account. Nothing is ever checked out automatically.

PRIVACY
Everything runs in your browser. Images, palettes, settings and carts are stored only in your Chrome profile. No analytics, no ads, no developer server. The extension contacts shop.bullseyeglass.com (and its product-photo CDN) to check sign-in, show current product details and photos, and read, add to or empty your Bullseye cart when you ask. When you pick a web image, it downloads just that image from the site hosting it. It never reads or stores your password or payment details.
Privacy policy: https://github.com/Keyslah/Bullseye-Palette-Picker/blob/main/PRIVACY.md

GOOD TO KNOW
• Thickness percentages are a photo-based estimate, not a measurement or firing recipe. Screens and lighting vary.
• Bullseye confirms stock, prices and limits when you send a cart.

Independent project: not affiliated with, endorsed by, or sponsored by Bullseye Glass Co. Product photography © Bullseye Glass Co., used to identify and promote Bullseye products.
Source code (MIT): https://github.com/Keyslah/Bullseye-Palette-Picker
```

| Field | Value |
| --- | --- |
| Category | **Art & Design** (Shopping also fits) |
| Language | English |
| Store icon (if asked) | `extension/assets/icon-128.png` |
| Screenshots (1280×800, upload in order) | `screenshot-1-palette.png`, `screenshot-2-glass-detail.png`, `screenshot-3-alternatives.png`, `screenshot-4-cart.png`, `screenshot-5-saved-palettes.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `promo-marquee-1400x560.png` |
| Official URL | Leave blank (needs a site verified in Google Search Console) |
| Homepage URL | `https://github.com/Keyslah/Bullseye-Palette-Picker` |
| Support URL | `https://github.com/Keyslah/Bullseye-Palette-Picker/issues` |
| Mature content | Off |

The screenshots come from the real v0.6.8 extension, run in a test browser against a simulated Bullseye store (no real account or cart) on an original, generated sample image. The glass shown is exactly what the extension matched, including two colors marked unavailable in the bundled inventory snapshot.

## 4. Privacy tab

**Single purpose**

```text
Bullseye Palette Picker turns a photo the user chooses into a palette of matching Bullseye glass: it samples the image's colors, matches each one to a real Bullseye sheet or frit color, and lets the user add the chosen glass to their own Bullseye website cart.
```

**Permission justifications**

contextMenus
```text
Adds two right-click commands: "Create Bullseye palette" on images and image links, and "Create Bullseye palette from visible page" on pages. They send the chosen image to the picker.
```

sidePanel
```text
The picker opens in Chrome's side panel beside the page the user is browsing, so the source photo and matching glass can be compared while browsing. The toolbar button opens it.
```

storage
```text
Saves the user's work on their own device: the current photo workspace, working cart, saved settings, and a short log of recent cart requests (to prevent duplicate additions) in chrome.storage.local. A right-click image hand-off is held briefly in chrome.storage.session. Nothing is synced or uploaded.
```

activeTab
```text
Used only after the user invokes the extension on a tab: to capture the visible page when they choose Capture or "Create Bullseye palette from visible page", and to find the photo inside a right-clicked image link (for example, Pinterest hover overlays).
```

scripting
```text
Runs the extension's own bundled functions (no remote code) in two cases: (1) after a right-click on an image link, a one-time lookup of the photo inside that link on the current tab, under activeTab; (2) in a shop.bullseyeglass.com tab, to check whether the user is signed in and, when the user clicks the matching button, to read, add to, or empty their Bullseye cart through the store's own cart API.
```

Host permissions
```text
https://shop.bullseyeglass.com/* is required to check Bullseye sign-in, show current product availability and prices, and read, add to, or empty the user's own Bullseye cart when they click the matching button. The optional https://*/* and http://*/* patterns are not granted at install. When the user picks a web image whose host will not serve it otherwise, the extension asks Chrome for access to that one image host (for example https://i.pinimg.com/*) only to download that image for local color analysis. Users can decline and use file import, paste, or capture instead.
```

**Remote code:** No, I am not using remote code.

**Data usage.** Google counts data that is only processed or stored on the user's device as handled data, so it must be disclosed. Suggested answers:

- Check **Website content**: images the user picks from web pages (and their source URLs), the visible-page capture, and the cart contents read from Bullseye when the user clicks "Copy my Bullseye cart".
- Leave the others unchecked. The extension collects no names or emails (the sign-in check only detects whether a customer-only page element exists), no passwords or cookies, no payment data, no messages, no location, no browsing history (only the source URL of an image the user chose), and no click or keystroke monitoring.
- Tick all three certifications: no selling or transferring data outside approved uses, no use unrelated to the single purpose, no creditworthiness or lending use.

These are your certifications. If you are unsure about a category, checking it is the conservative choice.

**Privacy policy URL:** `https://github.com/Keyslah/Bullseye-Palette-Picker/blob/main/PRIVACY.md`

`PRIVACY.md` includes the Limited Use statement the store requires. Merge it into `main` before submitting, so the URL above shows it.

## 5. Distribution tab

| Field | Value |
| --- | --- |
| Payments | Free of charge |
| Visibility | **Public** (listed and searchable) |
| Regions | All regions |

## 6. Test instructions tab (optional, helps review)

```text
No account is needed to test the main features.
1. Right-click any photo on a website and choose "Create Bullseye palette". The picker opens in the side panel with the photo, numbered color dots, and matching Bullseye glass.
2. Drag a dot, click Alternatives, change the form under Settings (Sheets, Powder, Fine, Medium, Coarse), and click Add to Cart. Then open Cart at the top right.
3. "Send cart to Bullseye" adds the items to the user's own cart at shop.bullseyeglass.com and requires a Bullseye customer account. Without one, the extension shows a sign-in prompt instead. Nothing is ever checked out.
```

## 7. Submit

Click **Submit for review**. You can untick automatic publishing in the confirmation dialog and publish yourself within 30 days of approval. Google says most reviews finish within a few days but can take a few weeks; new developer accounts and requests for broad host access can lengthen review, and the optional all-sites image permission may count. Contact developer support if a review is pending for more than three weeks.

## After it is live

- The store version installs as a separate extension from an unpacked copy, with a different extension ID, so saved data does not move over by itself. In the old copy use **Settings → Back up my data**, install from the store, use **Restore my data**, then remove the unpacked copy so the right-click menu has one entry.
- To ship an update: raise `version` in `extension/manifest.json` and `package.json` (each upload must be higher than the last), run `npm run package`, upload the ZIP on the item's **Package** tab, and submit.

## Things to know before submitting

- **Name and trademark.** "Bullseye" is Bullseye Glass Co.'s trademark. Store policy forbids implying that a product is endorsed by another company, so the description and marquee state that the project is independent. If Bullseye Glass Co. ever objects, the usual fix is a name like "Palette Picker for Bullseye Glass", which requires a new package version.
- **Bullseye photos.** Bullseye's [Product Image Library conditions](https://www.bullseyeglass.com/about-our-glass/product-image-library/) say the images "may only be used in promoting Bullseye Glass products and must be specified as Bullseye images". The listing credits them. That page does not mention needing written permission, but asking through their [contact page](https://www.bullseyeglass.com/contact-us/) would remove any doubt.
