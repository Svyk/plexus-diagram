# Works with

Each row is feature-detected. A missing extension hides that row. Nothing here is required to open a board.

| Feature | Plexus Diagram | Roam Compass | Roam Plexus |
|---|---|---|---|
| Drawing card | The ref card | | Thumbnail, regions, and New drawing. Without it, the picture is a one-time snapshot and New drawing is still an ordinary drawing |
| Region card | The ref card | | Crop and Open drawing. Without it, the card is an ordinary block ref |
| Compass boards | `boardsWith`, `cardsOf`, `thumbnail`, `open` | Setting Boards, default on | |
| Open in Compass | Card menu, only when `RoamCompass.open` exists | `apiVersion` 1: `open`, `focus`, `focusBlock`, `isOpen` | |
| Expand with Compass | Card menu on a page or block card, when `RoamCompass.apiVersion` is at least 2 and `neighborhood` exists. Adds the neighbors as cards and labelled arrows | `neighborhood(uid)` returns `{ center, nodes }`. `null` or `missing: true` adds nothing | |
| Show on board | `boardsWith` returns `{ uid, title, card }`. `open(board, { card })` pulses that card | Node menu. One board opens. Several show a picker | |
| Annotate as drawing | Image-card menu, the ref card, and the connection | | `create` and `open`. `create` cannot place the image, so the drawing is empty and a toast says to drop the image in |

## Globals

| Global | Version | Methods that stay |
|---|---|---|
| `window.PlexusDiagram` | apiVersion 1 | `boardsWith` now includes `card`. Added: `listBoards`, `addCards`, `addSection`, `connect`. Older fields `uid` and `title` stay |
| `window.RoamCompass` | apiVersion 2 | `isAvailable` and `focus` stay. apiVersion 1 added `open`, `focusBlock`, `isOpen`. apiVersion 2 adds `neighborhood`. Events `roam-compass:ready` and `roam-compass:unload` stay |
| `window.RoamPlexus` | apiVersion 7 | Unchanged in this batch. `create` takes a parent, a page, a title, or an order |

Roam Plexus stays 0.33.0. The command palette stays two entries.

`addCards` and `addSection` are each one undo step. `connect` of one arrow is one undo step. Several arrows are one undo step when the board groups writes, which the Roam host does, and one step per arrow when it does not. A group past 45 writes splits into consecutive steps. Expand with Compass is one undo step when the board groups writes. Otherwise the cards are one step and each arrow is its own.

