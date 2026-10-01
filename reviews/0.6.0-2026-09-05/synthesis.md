# Synthesis — 0.6.0 — 2026-09-05

Critical paint/store split (correctness + architecture): settled edges ignored `from`/`to`. Fixed in `1960d04`. Parent tests **147/147**.

Also in that commit: clone metadata edges so inspector persist writes; stamp `direction` on new edges.

Deferred 0.6.1: inspector rollback, `from::` harc prefix, sequential `patchDiagramBlock`, metadata-page queue, inspector CSS prefix.

Reviews: `review-correctness.md`, `review-bugs.md`, `review-architecture.md`.
