# Implementation plan — 0.5.0 — 2026-08-29

## Summary
Applied on `bf60226`: persist flush + timer cancel on `attachSession`; `stopWatch` when a session has no views; Esc nest-pop only if the overlay owns the pointer; `setActiveTool` after swap; section color via CSS var; connect-to-empty edge rollback.

## Later
Per-mount nest stack. Scratch ownership. Ghost nodes in `applyPull`. Metadata-page queue. Nested-name echo. Armed-connect click-outside.

## Risk
Live click-click and Beam-at-zoom still need a Roam reload (remove-and-re-add both URLs).
