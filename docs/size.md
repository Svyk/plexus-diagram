# Bundle size

Measured 2026-10-30. The size gate fails when an artifact is at or over its budget. 1 KB = 1024 bytes.

| artifact | bytes | budget |
| --- | ---: | --- |
| extension.js | 2233436 | 921600 (900 KB) |
| extension.css | 240715 | 92160 (90 KB) |

Start code in extension.js: 1740857 bytes. The rest of the file is the pieces below, kept as deflated text and only inflated and evaluated on first use. Roam Depot publishes extension.js and extension.css alone and remote code is ruled out, so pieces cannot leave the file, and extension.js cannot reach its budget.

| piece | code bytes | CSS bytes | stored bytes |
| --- | ---: | ---: | ---: |
| changelog | 130476 | 0 | 64224 |
| parse | 511983 | 17885 | 257932 |
| read | 83299 | 19128 | 45072 |
| ai | 110188 | 13590 | 61296 |
| views | 33350 | 7046 | 19228 |
| io | 11301 | 0 | 6632 |
| tools | 70197 | 17505 | 36744 |

Regenerate with `node scripts/size-report.mjs --write docs/size.md`.

## Top 15 modules by output bytes

| bytes | module |
| ---: | --- |
| 492781 | `<stdin>` |
| 247727 | `src/view/board-view.js` |
| 164903 | `src/view/cards.js` |
| 99178 | `src/host/roam.js` |
| 83392 | `src/session.js` |
| 82613 | `src/feature.js` |
| 42193 | `src/view/chrome.js` |
| 31223 | `src/view/edges.js` |
| 30288 | `src/view/interactions.js` |
| 26821 | `src/settings.js` |
| 26304 | `src/view/tooltip-text.js` |
| 22477 | `src/view/page-chips.js` |
| 20982 | `src/model/board.js` |
| 19168 | `src/model/pdf-pin.js` |
| 18226 | `src/relchips.js` |

