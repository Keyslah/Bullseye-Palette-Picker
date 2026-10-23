# Bullseye Palette Picker v0.6.6

## Changes

- Black and near-black neutral targets now choose regular Black (`000100`) when available, including in Transparent-only mode. This fixes cases where reflected color in product photographs made Aventurine Blue win the old near-tie rule.
- **Add Color** opens its own window. The complete color catalog, search, material filters, grade selector, and package or sheet size controls are inside that window. The main cart workspace displays the cart's own items.
- A large **Send to Bullseye Website Cart** button sits at the very top of the cart workspace. It uses the existing send action and keeps its progress, success, and duplicate-send handling.

Per-item grades, sizes, thickness choices, quantities, enlarged product photos, named carts, and existing palette/settings data are retained. Explicitly selected glass stays selected. The send action adds the selected quantities to the existing Bullseye website cart.

## Verification

The release gate runs the JavaScript regressions, manifest/catalog/module checks, native extension workspace and cart checks, layout and photo-matching checks, and exact-source ZIP verification. Native shopping tests use disposable fixtures. The published archive is downloaded and checked against the tested source after release.

## Update

Extract `Bullseye-Palette-Picker-v0.6.6.zip` into the **same installed extension folder**, replacing its files. Open `chrome://extensions`, click **Reload**, and confirm version **0.6.6**. Close and reopen existing picker and cart tabs. Refresh any source pages that were already open before using the image context menu. Keep the same extension installation and folder to retain local saved palettes, carts, and settings.
