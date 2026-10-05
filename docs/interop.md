# Works with

Each row is feature-detected. A missing extension hides that row. Nothing here is required to open a board.

| Feature | Plexus Diagram | Roam Compass | Roam Plexus |
|---|---|---|---|
| Drawing card | The ref card | | Thumbnail, regions, and New drawing. Without it, the picture is a one-time snapshot and New drawing is still an ordinary drawing |
| Region card | The ref card | | Crop and Open drawing. Without it, the card is an ordinary block ref |
| Compass boards | `boardsWith`, `cardsOf`, `thumbnail`, `open` | Setting Boards, default on | |
| Open in Compass | Card menu, only when `RoamCompass.open` exists | `apiVersion` 1: `open`, `focus`, `focusBlock`, `isOpen` | |
| Show on board | `boardsWith` returns `{ uid, title, card }`. `open(board, { card })` pulses that card | Node menu. One board opens. Several show a picker | |
| Annotate as drawing | Image-card menu, the ref card, and the connection | | `create` and `open`. `create` cannot place the image, so the drawing is empty and a toast says to drop the image in |

## Globals

| Global | Version | Methods that stay |
|---|---|---|
| `window.PlexusDiagram` | apiVersion 1 | `boardsWith` now includes `card`. Older fields `uid` and `title` stay |
| `window.RoamCompass` | apiVersion 1 | `isAvailable` and `focus` stay. Added: `open`, `focusBlock`, `isOpen`. Events `roam-compass:ready` and `roam-compass:unload` stay |
| `window.RoamPlexus` | apiVersion 7 | Unchanged in this batch. `create` takes a parent, a page, a title, or an order |

Roam Plexus stays 0.33.0. The command palette stays two entries.

