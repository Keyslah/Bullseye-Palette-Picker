# Bullseye Palette Picker v0.6.7

## Cart controls

- **Send cart to Bullseye** stays usable after a successful send. Each new deliberate click adds the displayed quantities again; overlapping clicks still share one operation.
- The main page's **Send to my cart** button is removed. **Add to Cart** replaces its **Save cart** action and adds the checked glass to the working cart without asking for a name.
- A **Cart** button at the top right shows total item quantity, including multiple jars of one color. It updates across picker/cart tabs and opens the persistent working cart.
- Working-cart edits are saved automatically. Named cart saving, loading and duplication remain in the cart workspace.
- **Add Colors** sits beside the Cart items heading, directly above the item list. The full color catalog stays in its separate window.
- **Empty Bullseye cart** clears the website cart after confirmation, verifies the empty result, and keeps the local working cart, saved carts, palettes and settings.

## Alternatives and sign-in

Transparent, Opalescent and Tints in Alternatives now filter only that dialog. Changing them does not alter the main page's filters or selected glass. An explicitly chosen alternative remains selected even when its material is outside the main automatic filters. The main page has one Sign in button; Account retains its own name.

## Keep your personal data

The extension keeps its existing identity, storage keys and database names. Updates do not reset preferred settings, image layout, saved palettes, source photos or carts. Background saves survive closing or immediately reloading the picker, and startup waits for the pending save. A failed workspace read prevents defaults from overwriting unread data.

**Settings → Back up my data** exports current settings, named settings, palettes with photos, named carts and the working cart. **Restore my data** validates the file, merges named records and restores its current workspace/settings/cart. Account/session information and website request journals are not included. This supports moving to another extension folder or computer.

## Update from an existing version

1. Close open picker and cart tabs.
2. Extract `Bullseye-Palette-Picker-v0.6.7.zip` into the **same installed extension folder**, replacing its files. If Chrome loads the repository's `extension` subfolder, replace files inside that subfolder.
3. Open `chrome://extensions`, click **Reload** on Bullseye Palette Picker, and confirm **0.6.7**.
4. Reopen the picker and cart. Refresh existing source-image pages before using the right-click command.

Keep the same installation for ordinary updates. Removing it or loading each version from a new folder can create a different storage location. Use a personal-data backup before changing folders or computers. The new backup buttons become available after updating to this version.

## Verification

All **229 JavaScript tests** pass, alongside manifest/catalog/module checks. Native Chromium checks cover the retained workspace and cart builder, desktop/narrow layout, black/purple matching, independent Alternatives, repeated sending/emptying, autosave failure recovery, in-place updates and backup/restore across installations and open tabs. The installable ZIP contains **185 exact-source files**. Shopping tests use disposable storefront fixtures, with no live account or cart changes. The release gate repeats verification and checks the downloaded published ZIP against the tested source.
