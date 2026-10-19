# Version 0.5.0 recovery checkpoint

## Verified status

- The last published source on main is v0.4.0, commit ec892ecabf8d2da585448fb2b96e3abe8536db20.
- The original v5 temporary workspace has not been recovered. Its reported path is not present in the current runtime.
- The previous conversation reported that v5 packaging was underway. That report is not a recovered build, a passing test log, or proof of publication.
- This recovery branch currently contains the verification/publication workflow and this requirements checkpoint. It does not yet contain the reconstructed v5 implementation.
- The initial recovery workflow passed the existing v4 tests and packaging. Those results must not be described as v5 tests.

## Recovered user requirements

1. Exclude tints by default, with an explicit option to include them. Do not remove them from the catalog.
2. Correct thickness labels for different Dark Forest Green samples. Visibly different samples must not both get an unconditional 100% merely because they are opalescent. Keep the thickness guide explicitly photo-based, not a physical calibration. The former chat reported 100% and 77%; independently verify the reconstructed behavior rather than asserting those values in advance.
3. Provide clear Load palettes and Load settings actions, with named settings presets. Always prompt for a name when saving.
4. Put Refresh at the top. Reset settings only, including view controls such as Show full palette. Preserve the image, sampled colors, edited colors, and point positions. Keep Remix separate: Remix creates a new sampled palette.
5. Provide a full cart page with clear saved-cart opening, editing, saving, and duplication. Put Saved Carts and Send to My Cart at the top.
6. Allow copying the user's actual signed-in Bullseye website cart into a local editable cart, only on the user's explicit action. A read/copy must not modify the live cart or complete checkout.
7. Give the cart a color-selection section with names, thickness information, and material filters.
8. Put Show full palette beside color #1.
9. Open full page in a normal new browser tab.
10. Fix wasted space in the full-page layout. Place palette and glass results beside the image where width allows, including near-square images, rather than reserving a full-width empty image area and pushing results below the viewport. Preserve image aspect ratio and point alignment; keep narrow-panel behavior usable.

## Completion gate

- Implement only the recovered requirements and necessary supporting fixes.
- Commit meaningful implementation checkpoints to this branch before final packaging.
- Run existing regressions plus targeted v5 tests, including real browser layout checks.
- Verify ZIP/source correspondence and manifest version 0.5.0.
- Preserve catalog data unless a specific requirement makes a change necessary.
- Publish only after checks pass, without overwriting an independently advanced main branch.
- Report separately: original-file recovery, reconstruction, test results, source publication, and ZIP release.
