# Batch 3-5 — REG-1

Parser only. No rendering and no writes. TSK-2 stays open, so TSK-3 waits.

Measured on Readwisenotes: kinds area, rect, frame, cframe, poly, imgrect, imgpoly. No img or view yet. Container string is `{{[[plexus-regions]]}}`. Sample area block `UXEkw3lHW`.

Files: `src/model/regions.js`, `classifyString` in schema.js, skip in board.js, badge filter in cards.js, `test/regions-29.test.js`.

img and view are the only supported kinds. Roam Plexus kinds parse as owner roam-plexus, supported false, no error. Area ids are not capped. View ids cap at 24. Any other kind is unknown.

Accept: tests green, those blocks are not cards, the badge ignores the container, the sample area parses, and opening the board writes nothing.
