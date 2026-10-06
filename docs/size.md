# Bundle size

Measured 2026-10-06. The size gate fails when an artifact is at or over its budget. 1 KB = 1024 bytes.

| artifact | bytes | budget |
| --- | ---: | --- |
| extension.js | 1605291 | 921600 (900 KB) |
| extension.css | 203814 | 92160 (90 KB) |

Regenerate with `node scripts/size-report.mjs --write docs/size.md`.

## Top 15 modules by output bytes

| bytes | module |
| ---: | --- |
| 248097 | `src/view/board-view.js` |
| 178768 | `src/view/cards.js` |
| 109617 | `src/feature.js` |
| 86461 | `src/session.js` |
| 83245 | `src/host/roam.js` |
| 56846 | `src/changelog-text.js` |
| 53007 | `src/view/chrome.js` |
| 37452 | `src/view/interactions.js` |
| 36790 | `src/view/read-pane.js` |
| 30953 | `src/view/panel.js` |
| 29649 | `src/view/edges.js` |
| 29168 | `src/model/board.js` |
| 26711 | `src/relchips.js` |
| 20339 | `src/host/migrate.js` |
| 20229 | `src/session-clip.js` |

