# v0.5.0 reconstruction status

The original interrupted temporary workspace was not recovered. The v5 requirements were reconstructed on top of v0.4.0 commit ec892ecabf8d2da585448fb2b96e3abe8536db20.

The implementation is now committed in the recovery/v0.5.0 branch. Each recovery patch is saved before it runs, and the resulting source is checkpointed before tests. Completed implementation includes tint settings, corrected opal photo-strength labels, named settings, separate Refresh/Remix, full-cart-page editing and naming, read-only website-cart copying, and the wide square/portrait image layout.

Publication is gated by `.github/v5/PUBLISH`, the complete test workflow, and a non-forced fast-forward of main. The release record and successful publication run, not this status note, establish whether the ZIP is publicly released. See release-v0.5.0.md for controls, update steps and supported limits.
