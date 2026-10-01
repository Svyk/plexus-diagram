# Plexus Diagram roadmap: 1.3 to 2.0

Source of truth for every build session after 1.2.0. Written 2026-09-30 against `main` at `d3ea43f` (1.2.0). Tick tasks here as they land; this file is the to-do list.

Companion docs: [`spec-plexus-1.0.md`](spec-plexus-1.0.md) (design), [`spec-plexus-1.2.md`](spec-plexus-1.2.md) (1.2 additions and Heptabase gap table), [`api-plexus-1.0.md`](api-plexus-1.0.md) (module contracts), [`plan-heptabase-arrows.md`](plan-heptabase-arrows.md) (connection design), `CHANGELOG.md`, `README.md`.

## 1. Where things stand

| Version | Date | Commit | What it did |
|---|---|---|---|
| 1.0.0 | 2026-09-28 | `2caae00` | Full rewrite: model / host / session / view layers, schema v2 in block props |
| 1.1.0 | 2026-09-29 | `5165304` | Whole-block cards, Roam bullet drops, nested boards with breadcrumbs, collapse-outline |
| 1.2.0 | 2026-09-29 | `d3ea43f` | Heptabase wave 1: map tiles, board thumbnails, section auto-fit, backgrounds, menus, duplicate, clipboard, mind map, journal cards, badges, panel tabs, focus, Quick Look, present, SVG/Markdown export |

**The user's Svy window was still running 1.1.0 on 2026-09-30** (`window.__plexusDiagram.version`). Several bugs in the user's latest screenshots are 1.1 behavior, fixed in 1.2: the blue block selection after Enter, and unclamped text when zoomed out. Re-check every reported bug on the current build before fixing it.

### The user's asks on 2026-09-30, in their words

1. "When I make a card, it should be just a block like a default, just like standard Roam diagram." Today a new card renders with a Roam bullet, and its children render as an outline (`• test` then `• test`). Native Roam diagram nodes show the block text with no bullet and no header. → **NP-1**
2. "Our enhanced diagram is missing that right sidebar, we should be adding a bunch of stuff, not taking features away." Native Roam diagrams have a vertical control rail at the top right, a Properties panel at the top left, a minimap at the bottom right, and a hover toolbar on each node. Enhancing a board hides all of them and replaces only some. → **P1** (native parity)
3. "Use svy graph for testing." The acceptance graph is now Svy, on dedicated test pages only (section 4).
4. Keep porting Heptabase, done the way Roam works. → **P3-P5**

### Native Roam diagram inventory (measured 2026-09-30 over CDP)

Native diagrams are React Flow (`.react-flow`, nodes `.react-flow__node-block`). Everything below must exist on an enhanced board, as the same feature or a better one. Nothing native may disappear.

| Native surface | Contents | Plexus 1.2 today | Task |
|---|---|---|---|
| Inline header buttons | Edit Block, Maximize | Fullscreen button, Edit via menu | NP-3 |
| Control rail, top right, vertical | zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar, Minimize/Maximize | Horizontal top bar: −, %, +, Fit, Minimap, Exit fullscreen. **No Save PNG, no Open outline in sidebar** | NP-3, NP-5, NP-6 |
| Properties panel, top left, collapsible | **Blocks:** Text Size (number stepper, default 14), Text Color, Text Align (default/left/center/right/justify), Fill Color, Border Color, Reset Selected. **Selected Edges:** Edge Direction (Directed/Undirected/Bidirected), Decoration (Solid/Dashed/Animated), Edge Type (Straight/Smooth-step/Curve Bezier), Edge Color, Reset Default. **Default Groups:** Title Text Size (18), Title Text Color, Title Fill Color, Area Fill Color, Border Color, Reset Default. **Diagram:** Background Color, Background Texture (Dots/Lines/Cross), Reset default | Color swatches on cards and sections; edge dir/route/dash in the context menu; board background in a Background menu. **No text size, text color, align, border color, edge color, animated edges, group title styling, or a single panel** | NP-4, NP-8 |
| Color picker | 13 swatches (black, gray, white, red, pink, purple, violet, blue, cyan, green, orange, yellow, brown) + "Darker" and "Lighter" rows + HEX/RGB/HSL entry | Fixed swatch list | NP-4 |
| Node hover toolbar | Color, Expand all (show/hide children), Backlink (references) | Context bar with other actions | NP-2 |
| Minimap | Bottom right | Exists | NP-12 |
| Node content | The block itself, editable in place, no bullet. Nodes can hold PDF highlights and images | Bullet plus child outline | NP-1, NP-9 |

## 2. How to use this file

- Each task is a checkbox with a stable ID. Never renumber, reorder or delete IDs; add new ones at the end of the phase with the next free number.
- When a task lands: `- [x] **ID Title** — done YYYY-MM-DD, `<sha>`: <one line of evidence>`. Evidence is a live check, a test name or a measurement, not "implemented".
- Blocked: `- [!] **ID Title** — blocked: <reason, what was tried, what would unblock it>`. Move on to the next task.
- Cut on purpose: `- [~] **ID Title** — cut: <reason>`.
- Sizes: S under 2 hours, M half a day, L a day or more, XL several days.
- A phase is done when every task in it is `[x]`, `[!]` or `[~]` and the phase gate passes. Record the version and commit in the phase heading.

## 3. Rules for every task

1. **Add, never take away.** An enhanced board keeps every native capability (section 1 inventory) and every 1.0-1.2 feature. Removing a feature needs the user's approval in the conversation.
2. **Roam data is canonical.** Cards, sections, connections and nested boards are blocks. Layout and style live in each block's `:block/props` under `plexus`, merged on write (read, merge, write: an update replaces the whole props map). Relations that mean something are `Name::` attributes and refs. No shadow store, no IndexedDB, no network requests.
3. **Never write `:diagram/*`**, never write Better Tasks `BT_attr*` blocks, never touch a native diagram that was not enhanced. "Restore native diagram" must keep working.
4. **No writes on open, pan, zoom or select.** Viewport is per device in localStorage.
5. **Undo budget.** Roam's undo stack holds 50 entries. Any bulk operation stays at or under 45 writes per user action (`BULK_CARD_CAP`) and is fully undoable with Cmd+Z.
6. **Never stop `mouseup`** in a `renderBlock` editor (Roam's drag-select disarm; this was the 1.1 Enter focus-loss bug). Keyboard listeners stay in the window capture phase. No `setPointerCapture`.
7. **Speed.** Typing in a normal Roam page with the extension loaded: at most +0.1 ms per key against the extension unloaded. Roam charges about 0.055 ms per keystroke for every command-palette entry, so palette entries are a budget (PF-1). No global CSS that restyles Roam outside `.pxd-*` roots. No MutationObserver on `document` subtrees beyond what 1.2 has. Pull watches: one per mounted board.
8. **Encrypted graphs.** Svy is encrypted. Images and files go through `roamAlphaAPI.file.get` / `file.upload`; nothing rendered is persisted.
9. **Zero runtime dependencies.** Plain JS, esbuild bundle, no dynamically loaded scripts (Roam Depot rule).
10. **Theme.** Follow Roam's theme (`bp3-dark` on body or measured background luminance, not `prefers-color-scheme`). In dark mode, borders carry the meaning; avoid tinted fills as the only signal.
11. **Tests.** Every new pure module gets a `test/*.test.js`. Every view change gets a DOM test where the existing suites do (`node --test`, with the same fake-DOM helpers as `test/view-12.test.js` and `test/cards-12.test.js`).

## 4. Standing gate (every phase)

1. `npm run check` green (build, secret scan, syntax, all tests, generated-file verify).
2. Live acceptance over trusted CDP input (`tools/live/plexus-live.mjs input`), in the Svy graph on test pages only:
   - Test pages: `Plexus Diagram/Test Lab` (create it on first run; one fixture board per phase, titled `P<n> fixture`) and the user's board on page `diagram testing` (block `HNP2GD_oQ`). On `diagram testing`, add and remove only items you created; never edit or delete the user's existing cards.
   - Never write any other Svy page. Never write a daily page. Read-only queries elsewhere are fine.
   - Record every block uid you create in `.live/svy-ledger.jsonl` (gitignored). Delete only uids in the ledger.
   - If the Svy window has an installed Plexus (`window.__plexusDiagram` present and `window.__pxdLive` absent), the harness refuses to inject. Then use the Readwisenotes window titled `Readwisenotes - Daily Notes` and note in the phase row that acceptance ran there.
   - Never use the window titled `plx typing bench` (another project's session).
3. Typing bench: 200 keystrokes into a plain block on the Test Lab page with the build injected vs unloaded; delta at most +0.1 ms/key.
4. Unload leaves zero `.pxd-*` nodes, zero added window/document listeners (count with `getEventListeners` over CDP), zero pull watches, and `window.__plexusDiagram` removed.
5. Screenshot evidence for each visual task in `.live/shots/` (gitignored), named by task ID.
6. Release: bump `package.json` version, `CHANGELOG.md` entry, README updated for user-visible features, commit, tag `v<version>`, push `main`, wait for the Pages deploy, then `cmp` the published `https://svyk.github.io/plexus-diagram/extension.js` and `extension.css` against the local build.
7. Write a session learning to `~/openkb-roam-plugin/raw/session-learnings/YYYY-MM-DD-<slug>.md` for any new Roam fact discovered.

## 5. Phases

| Phase | Theme | Version | Status |
|---|---|---|---|
| P0 | Preflight: harness, fixtures, baselines | — | done 2026-09-30. Injected-build checks ran on Readwisenotes (Svy refused: installed 1.2.0, not 1.1.0). PRE-2 and PRE-5 ran on Svy Test Lab. |
| P1 | Native parity: add, never take away | 1.3.0 | done 2026-10-01, `00841d5` |
| P2 | Card editing feels like Roam | 1.4.0 | todo |
| P3 | Navigate and organize (Heptabase wave 2a) | 1.5.0 | todo |
| P4 | Templates, table view, snapshots, flows (Heptabase wave 2b) | 1.6.0 | todo |
| P5 | Roam graph superpowers | 1.7.0 | todo |
| P6 | Performance and reliability | 1.8.0 | todo |
| P7 | Look, feel and accessibility | 1.9.0 | todo |
| P8 | Docs, hardening and 2.0 | 2.0.0 | todo |

Order matters: P1 and P2 are the user's direct requests. Within a phase, do tasks in the listed order unless one is blocked.

---

### P0: Preflight

- [x] **PRE-1 Harness in the repo** (S) — done 2026-09-30 (roadmap commit): `eval "Svy - " 1+1` → 2; `inject "Svy - "` correctly refused (installed 1.1.0 running); `.live/` gitignored; README written. Original task: `tools/live/plexus-live.mjs`, `cdp-drag.mjs`, `cdp-logs.mjs` are copies of the 1.2 harness with two guards (refuses `plx typing bench`; refuses to inject over an installed Plexus). Add `.live/` to `.gitignore`. Add `tools/live/README.md` with every command and step type (`move`, `down`, `up`, `click`, `drag`, `key`, `text`, `wait`, `wheel`). Accept: `node tools/live/plexus-live.mjs eval "Svy - " "1+1"` prints 2.
- [x] **PRE-2 Ledger helpers** (S) — done 2026-09-30: Svy roundtrip created Test Lab `gbXs7Std6`, listed scratch `h7p1upqwc`, cleanup deleted it (`scratchGone: true`) and skipped the page.
- [x] **PRE-3 Fixture builder** (M) — done 2026-09-30: Readwisenotes (Svy inject refused). `session()` enhance then 6 cards, 2 sections, 3 edges. First board `7XhQbTmMo` renders (`.live/shots/PRE-3.png`). Second run `createdPage: false`, new board `XMncUB_km`.
- [x] **PRE-4 Baselines** (S) — done 2026-09-30: numbers in section 8. Typing delta −0.39 ms/key on Readwisenotes (no board mounted). 6-card open 216 ms, 120-card open 146 ms.
- [x] **PRE-5 Re-verify the screenshot bugs on 1.2** (S) — done 2026-09-30, installed 1.2.0 on Svy board `UZFdVYL7X` (inject refused). View mode has no bullet element (header span + child span). Edit mode shows two Roam bullets (root and child), `.live/shots/PRE-5-edit.png`. Enter created child `beta` and left the editor open. At 10% zoom the card stays a tile, no spill (`.live/shots/PRE-5-zoom.png`).

### P1: Native parity — add, never take away (1.3.0, done 2026-10-01, `00841d5`)

- [x] **NP-1 Plain-block cards by default** (L) — done 2026-09-30, `fbbde06`: Readwisenotes SwK9l7wCD shows alpha with child beta, root bullet hidden, child bullet visible (.live/shots/NP-1-edit.png); Show as card round-trips. — A new card (double-click on empty canvas, `N`, the Card tool, paste of plain text) is a plain Roam block that looks and edits like a native diagram node: no bullet, no header, no title row, block text at 14px, editable in place with a single click (a second click places the caret). Children show below as Roam renders them (bullets on children only) and can be hidden with the node toolbar's Expand toggle (NP-2). Page cards, block-ref cards, image cards and board cards keep their current look. Add a per-card `look: "block" | "card"` prop (default `block` for note cards, `card` for page/ref cards) and a context-menu item "Show as card / Show as block". Setting `default-card-look` (block or card). In the editor, hide the root bullet with a class on the card root only (`.pxd-root .pxd-card--block > .pxd-item__body > .pxd-item__editor > .rm-api-render--block > .rm-block > .rm-block-main > .controls { display: none }` scoped under `.pxd-root`, never global). Accept: double-click empty canvas, type `alpha`, Enter, `beta`, Esc → one block `alpha` with child `beta`, no bullet visible on `alpha` in view or edit mode, screenshot matches a native node's look; the toggle round-trips; existing 1.2 boards look unchanged except note cards losing their root bullet. Where: `src/view/cards.js` (render paths for note cards, `EDITOR_STOPPED` stays without `mouseup`), `src/model/schema.js` (new key with validation), `src/session.js` (create defaults), CSS in `src/css/`.
- [x] **NP-2 Node hover toolbar like native** (M) — done 2026-09-30, `6167956`: Readwisenotes hover on note SwK9l7wCD, page kY9phU2mV (9 refs) and ref Or6gEkteS (mentions of nMrpY2aCj); expand toggled open and restored; color picker shows 11 swatches (.live/shots/NP-2-ref.png). — Hovering or selecting a single card shows a small toolbar above it with, in this order: Color (opens the NP-4 picker), Expand/Collapse children (writes Roam `open` on the card block; Fold still writes plexus `collapsed`), References (shows the count of `:block/_refs`; click opens the linked references in Roam's right sidebar via `ui.rightSidebar.addWindow({window:{type:"mentions", "block-uid":uid}})`), then the 1.2 context actions. Blueprint icons (`bp3-icon-*`), tooltips, 28px hit targets. Accept: three icons present and working on note, page and ref cards; toolbar never covers the card's text while editing (hide during edit).
- [x] **NP-3 Control rail, top right** (M) — done 2026-09-30, `f2f9ecd`: Readwisenotes P0 fixture rail zoom 39%→47%→100%, fit 26%, minimap toggled, Saved PNG, outline opened then closed, Maximize/Minimize (.live/shots/NP-3.png). — Vertical rail matching native order and tooltips: Zoom in, Zoom out, Fit view, Toggle minimap, Save PNG (NP-5), Open outline in sidebar (NP-6), Fullscreen/Exit fullscreen. Keep the zoom percentage (click to reset to 100%) and the version badge (move the badge into the rail's overflow). Setting `controls-position`: `rail` (default) or `bar` (1.2 horizontal bar). The rail must not overlap the minimap, the Properties panel or the context bar at any board size down to 360×240. Accept: every rail button works inline and fullscreen; tooltip text equals native.
- [x] **NP-4 Properties panel, top left** (L) — done 2026-10-01, `503bac4`: Readwisenotes card 0306izJoB kept 18px red centered text, fill #48aff0 and a blue border across reinject; edge PChFJXlja stayed animated #f55656; collapse survived reload (.live/shots/NP-4.png). — Collapsible "Properties" panel with native sections and controls (section 1 inventory), applied to the current selection:
  - Blocks: text size (stepper, 10-48, default 14), text color, text align (default/left/center/right/justify), fill color, border color, Reset selected.
  - Selected edges: direction (directed/undirected/bidirected → existing `DIRS` values `one`/`none`/`two`), decoration (solid/dashed/animated), type (straight/smooth-step/curve bezier → `straight`/`elbow`/`curve`), color, Reset.
  - Default groups (sections): title text size (default 18), title text color, title fill color, area fill color, border color, Reset default (board-level defaults stored on the board block props).
  - Diagram: background color, background texture (dots/lines/cross + 1.2's plain and grid), Reset default (merges with the 1.2 Background menu; both stay).
  - Color picker: the native 13 swatches (rgb values in section 1: black, `rgb(167,182,194)`, white, `rgb(245,86,86)`, `rgb(255,102,161)`, `rgb(194,116,194)`, `rgb(173,153,255)`, `rgb(72,175,240)`, `rgb(46,230,214)`, `rgb(61,204,145)`, `rgb(255,179,102)`, `rgb(242,184,36)`, `rgb(201,151,101)`), "Darker" and "Lighter" rows, plus HEX entry with live preview, plus 1.2's named colors so existing boards keep their look. Store as named colors when a swatch is picked, hex otherwise.
  - Multi-select edits every selected item in one Roam undo step where possible, capped at 45 writes.
  - Schema: add `fontSize`, `textColor`, `align`, `fill`, `border` to cards; `color`, `dash: "animated"` (add to `DASHES`) and `color` to edges; `titleSize`, `titleColor`, `titleFill`, `areaFill`, `border` to sections; board defaults under board props `plexus.defaults`. Validate every value in `src/model/schema.js` (unknown keys dropped, hex must match `^#[0-9a-f]{6}$`).
  - Accept: each control changes the selection visibly and persists across reload; Reset removes only the keys it owns; panel collapsed state is per device.
- [x] **NP-5 Save PNG** (M) — done 2026-10-01, `8976c60`: rail and menu saved a 3222×1552 PNG with the image and the label "causes" (.live/shots/NP-5.png); copy wrote image/png and Roam rendered it on hGhTEY2Gx. — Rasterize the 1.2 SVG export to PNG at 2x on a canvas. Images inside the SVG must be inlined as data URLs first (on encrypted graphs, fetch through `roamAlphaAPI.file.get`), otherwise the canvas taints. Three entry points: rail button (whole board), board menu "Export as PNG", selection menu "Copy selection as PNG" (clipboard via `ClipboardItem`). File name `<board title or page title> YYYY-MM-DD.png`. Accept: PNG of the P1 fixture opens in Preview with images and connection labels visible; clipboard PNG pastes into a Roam block (Roam uploads it).
- [x] **NP-6 Open outline in sidebar** (M) — done 2026-10-01, `0ba08ae`: fullscreen rail click opened the outline; editing 0306izJoB to np6 updated the canvas header in one echo, then restored np4. — Rail button and board menu item open the board block in Roam's right sidebar as an outline (`ui.rightSidebar.addWindow({window:{type:"outline", "block-uid": boardUid}})`). Because enhanced boards are collapsed (`open:false`), check what the sidebar shows; if the board mounts there, add a per-mount "Outline / Board" toggle so the sidebar copy can show the plain outline (cards as blocks, Connections child) without un-collapsing the block for everyone. Spike first and record the finding here. Accept: from a fullscreen board, one click shows the outline of the same board in the sidebar, and editing a card's text there updates the board within one pull-watch echo.
- [x] **NP-7 Boards inside Roam's right sidebar** (M) — done 2026-10-01, `92a1ee3`: dragging 0306izJoB in the sidebar echoed to the main board and was restored to 1100,80; h on the main board left the sidebar on select; sidebar zoom stored under :block (.live/shots/NP-7.png). — An enhanced board mounts and works in a sidebar window (block, outline and mentions windows): pan, zoom, select, edit, keyboard shortcuts scoped to the focused board only, fullscreen from the sidebar, viewport stored separately from the main-window copy (key includes the mount kind). Accept: same board open in main and sidebar; moving a card in one moves it in the other after the echo; keys typed in the main board never reach the sidebar board.
- [x] **NP-8 Edge styles from native** (M) — done 2026-10-01, `39a1091`: restyled PChFJXlja through all 27 dir×dash×route combos at weight 4 and restored it to animated #f55656 dir none (.live/shots/NP-8-01-one-solid-straight.png through NP-8-27-two-animated-curve.png). — Add `dash: "animated"` (CSS stroke-dashoffset animation, paused under `prefers-reduced-motion` and the UI-6 setting), edge `color` (named or hex), `weight` 1-4 in the Properties panel, and arrowhead rendering for `none`/`one`/`two` checked against native. Label background follows the board background. Accept: all 3×3×3 direction/decoration/type combinations render in a fixture, screenshot each.
- [x] **NP-9 Native node content renders** (S) — done 2026-10-01, `c4cb6b0`: dragged image 0yad2IoMk, highlight dUh8ZUzLn, pdf i46TauNK1, video VWYWHUwMB, tweet XnLTc7zXs, and youtube CVpn_ZeCt; double-click on the pdf entered edit and dropped the shield (.live/shots/NP-9.png). Cards deleted after. — Cards whose block holds a PDF highlight (`rm-pdf-highlight`), an image, a `{{[[pdf]]}}`, `{{[[video]]}}`, tweet or YouTube embed render as Roam renders them, with an input shield over iframes while not editing so board pan and drag keep working. Accept: fixture with one of each; drag works over each; double-click enters edit.
- [x] **NP-10 Import native styling on Enhance** (M) — done 2026-10-01, `1d04380`: Test Lab SGMJ1c7y0 imported fill #bb5422, border #2193ee, text #000000, edge dir two dash animated #2487c1 (.live/shots/NP-10.png); Restore left :diagram/* and :rf-diagram value-equal and stripped v; fixture deleted. — When enhancing a native diagram, read (never write) `:diagram.node/data` and `:diagram/*` style fields for node fill, border, text size/color/align, edge direction/decoration/type/color, group styling and background texture, and map them to the NP-4 props, so an enhanced board looks like the native one did. Record each mapping in `src/host/migrate.js` with a unit test using a captured native fixture (capture one from the Readwisenotes diagram `2ZkxxgO7I`, read-only). Accept: enhance a styled native diagram on Test Lab; colors and edge styles survive; Restore native diagram shows the original untouched.
- [x] **NP-11 Expand-all per card** (S) — done 2026-10-01, `6167956`: toggled SwK9l7wCD closed then open; child bpkmLHbbn stayed open true; strings and edit times unchanged (.live/shots/NP-11.png). — Same as native "expand-all": shows or hides all descendants of a card. Writes Roam `open` on the card block only (descendants keep their own state). Accept: toggling twice restores the exact prior `open` values.
- [x] **NP-12 Minimap parity** (S) — done 2026-10-01, `83c7dd3`: drag on the vc8Skaj5K minimap moved the viewport from x -254 to -683; board :edit/time stayed 1790862457806 (.live/shots/NP-12.png). — Bottom right, click to jump, drag to pan, section colors and card rectangles drawn, viewport box; hidden by the rail toggle; remembered per device. Accept: drag in the minimap pans with no writes (`:edit/time` unchanged on the board block).
- [x] **NP-13 Native keyboard parity** (S) — done 2026-10-01, `b0d38ff`: meta-click added q5EACJYji to Or6gEkteS; Cmd-A selected 9 mounted items; ArrowRight moved q5EACJYji 680 to 681 and ArrowLeft restored 680. np4 stayed at 1100,80. — Check every React Flow default the native diagram supports (Backspace/Delete removes selection, Shift-drag box select, Cmd/Ctrl-click add to selection, Cmd+A, arrow nudge) and make sure the enhanced board matches or exceeds it. List the result in section 8.
- [x] **NP-14 Edit Block button** (S) — done 2026-10-01, `7cea72b`: click on vc8Skaj5K opened a textarea `{{[[diagram]]:P1 fixture}}`; Esc removed it; :edit/time stayed 1790862457806 (.live/shots/NP-14.png). — Native's inline "Edit Block" pencil opens the raw `{{[[diagram]]}}` block for editing. Add it to the inline header next to Fullscreen. Accept: click opens the board block's text editor; Esc returns to the board.
- [x] **NP-15 Gate** — done 2026-10-01, `9e73bb0`: `npm run check` 649 pass; no-board typing delta −1.03 ms/key; unload left 0 `.pxd-*` nodes; `.live/shots/NP-15-enhanced.png` and `NP-15-native.png`. — standing gate plus: side-by-side screenshots of the same fixture as a native diagram and as an enhanced board, saved to `.live/shots/NP-15-*.png`, with a checklist showing every native control has a Plexus equivalent.

### P2: Card editing feels like Roam (1.4.0)

- [ ] **ED-1 No flash when entering edit** (M) — Switching a card from the static render to `renderBlock` must not change the card's size or move text by more than 1px. Measure the static content box before mounting the editor, set it as min-height for the first frame, then release. Crossfade 80ms max (none under reduced motion). Accept: 20 enter/exit cycles recorded with `Performance` screenshots show no layout jump; a `ResizeObserver` log shows at most one size change per entry.
- [ ] **ED-2 Zero board re-render while typing** (M) — Instrument render counts per item (`window.__plexusDiagram.stats`). While typing in a card, the board must not re-render that card or any other card from its own pull-watch echo. Accept: 100 typed characters → render count delta 0 for every item (the editing card is owned by Roam).
- [ ] **ED-3 Card auto-height while typing** (S) — A card grows with its content while editing and shrinks back to its stored height (or content height if `h` is auto) on exit; the parent section auto-fits live (1.2 auto-fit). Accept: typing 10 lines grows the card and the section; Esc keeps the new height written once.
- [ ] **ED-4 Roam menus inside cards** (M) — `[[`, `((`, `/`, `{{`, `;;` (if present), and the date picker open, are positioned correctly, and are not clipped by the board's overflow or transformed by its zoom, at 50%, 100% and 200%. Accept: pick a page from `[[` at each zoom and the ref lands in the block.
- [ ] **ED-5 Crisp editing at any zoom** (M) — While editing, render the editor at screen scale (counter-scale the editor box) so text is crisp and the caret matches the mouse at 50%-200%. Accept: click into the middle of a word at 50% and 200% puts the caret at that letter.
- [ ] **ED-6 Enter, Tab and Backspace semantics** (M) — Define and test: Enter at end of a card's root block creates a child inside the card (never a new board item); Enter inside a child creates a sibling child; Tab and Shift+Tab indent within the card; Backspace in an empty root block of a new card deletes the card (one undo); Cmd+Enter cycles TODO like Roam. Accept: a matrix test over trusted input on the fixture, written to `test/live-matrix.md` with results.
- [ ] **ED-7 Paste and drop into cards** (S) — Pasting an image into a card editor uploads through Roam and inlines it; pasting multi-line text creates child blocks like Roam. Accept: both on Svy (encrypted upload path).
- [ ] **ED-8 Undo inside the editor** (S) — Cmd+Z while editing goes to Roam's text undo; Cmd+Z outside an editor undoes the last board action. Accept: type, Cmd+Z, Esc, move card, Cmd+Z → each undoes the right thing.
- [ ] **ED-9 Click targets** (S) — Not editing: single click selects, double click edits, link click navigates (Shift opens in sidebar), checkbox click toggles TODO without entering edit, image click opens Roam's image viewer. Accept: each on the fixture.
- [ ] **ED-10 Card title field for page cards** (S) — Rename a page card in place (F2 or double-click the title) renames the Roam page (`data.page.update`), with a confirmation if the page has more than 10 references. Accept: rename and undo.
- [ ] **ED-11 Gate** — standing gate plus the ED-6 matrix.

### P3: Navigate and organize — Heptabase wave 2a (1.5.0)

- [ ] **HB-1 Card info side panel** (L) — Heptabase's right sidebar "Info" for the selected card, inside the board (fullscreen) or as Roam's right sidebar when inline: the card rendered editable by `renderBlock`/`renderPage`, its attributes, linked references (Roam's own `mentions` render), "On boards" (every board that holds the card's block or a ref to it, click to open and zoom), and tags. Opens with `I` or the toolbar. Accept: on the fixture, every section shows correct data and editing there updates the card.
- [ ] **HB-2 Side-by-side cards** (M) — Open several cards in that panel as tabs (Heptabase opens cards side by side). Shift+click a card adds a tab. Panel width resizable and remembered. Accept: three tabs, switch, close, reload keeps none (tabs are session state).
- [ ] **HB-3 Find on board** (M) — Cmd+F while a board has focus: search card text, section titles and connection labels on this board and nested boards (one level), cycle with Enter/Shift+Enter, zoom to each hit, highlight matches. Roam's own Cmd+F is untouched when the board does not have focus. Accept: 3 hits found and cycled on the fixture.
- [ ] **HB-4 Show on board / deep links** (M) — "Copy link to card" gives a Roam block ref to the card plus an optional URL `#/app/<graph>/page/<boardPageUid>?pxd=<cardUid>`; opening it zooms the board to the card. Block context menu item "Show on board" on any block that is a card (or is referenced by a card): opens the containing board, zooms to the card and pulses it. Accept: from a block elsewhere on Test Lab, Show on board lands on the card.
- [ ] **HB-5 Add-panel filters** (M) — Filters in the Add panel: type (page, block, board, daily), tag (`#tag` picker), edited in the last N days, "not on any board" (Heptabase card library orphans). Accept: each filter narrows results on Svy test data; no query over 150 ms (time each).
- [ ] **HB-6 Snap and smart guides** (M) — Optional snap to grid (setting, default off) and alignment guides while dragging (edges and centers of nearby cards within 6 screen px). Alt disables snapping during a drag. Accept: guides show and snap on the fixture; no writes until drop.
- [ ] **HB-7 Align and distribute toolbar** (S) — When 2+ items are selected, the context bar shows align left/center/right/top/middle/bottom and distribute horizontal/vertical (1.2 has these in the menu). One undo step. Accept: each on 3 cards.
- [ ] **HB-8 Section power** (M) — Collapse a section to its title (children hidden, connections reroute to the section edge), section description line (first child text block with `section-note` look), lock section (pins everything inside), and "Present this section". Accept: each round-trips across reload.
- [ ] **HB-9 Zoom keys** (S) — Shift+0 zoom to 100%, Shift+1 fit all, Shift+2 zoom to selection, Cmd+= / Cmd+- zoom, Space+drag pan, H hand tool, V select tool. Show them in the shortcut sheet (UI-8). Accept: each key on the fixture with the board focused, and none of them fire while typing in a card.
- [ ] **HB-10 Lasso and selection tools** (S) — Marquee select exists (drag on empty canvas, Shift adds to the selection); add Alt+drag lasso (free shape), "Select all in section", "Select same color", "Select connected". Accept: each.
- [ ] **HB-11 Board breadcrumbs and history** (S) — Back/forward through boards opened in place (Cmd+[ / Cmd+]), breadcrumb overflow menu for deep nesting, "Open nested board in its own page" item. Accept: 3-level nesting, back and forward restore viewport.
- [ ] **HB-12 Gate** — standing gate.

### P4: Templates, table view, snapshots, flows — Heptabase wave 2b (1.6.0)

- [ ] **TP-1 Board templates as Roam blocks** (L) — Templates live on page `Plexus Diagram/Templates`, each a top-level block holding a template board (sections, cards, connections with props). "New board from template…" clones the subtree (props kept, `((refs))` inside rewritten, uids fresh), capped at 45 writes per insert; templates larger than that insert in chunks with a progress toast and one "Undo template" action that deletes the inserted root. Ship starters: 5-Why, Fishbone (6M), 8D, SWOT, Kanban (To do / Doing / Done sections), Timeline, Process flow (HACCP style: receiving → storage → blending → filling → packing), Meeting notes, Retro (went well / to improve / actions). "Save board as template" copies a board to the templates page. Accept: each starter inserts and is undoable; a user-saved template round-trips.
- [ ] **TP-2 Table view** (L) — Toggle a board between Board and Table. Rows are the board's cards (and nested board cards), columns are the attribute names found on those blocks (`Name::` children) plus Title, Section, Type, Edited. Cells edit the attribute block's text in place (`renderBlock` on the attribute child), sort by column, filter text. Adding a column adds `Name::` children only when a cell is filled. Heptabase tag databases are the model; Roam attributes are the store. Accept: 10-card fixture with 3 attributes; sort, edit, add a value; Board view unchanged.
- [ ] **TP-3 Kanban view** (M) — Group cards by one attribute (pick it) into columns; dragging between columns rewrites that attribute's value on the card block (one write, undoable). Never touch `BT_attr*` (Better Tasks owns them); for TODO status use the block's `{{[[TODO]]}}`/`{{[[DONE]]}}` marker only. Accept: move a card from To do to Done.
- [ ] **TP-4 Snapshots** (M) — "Save snapshot" writes the current layout of every item (`x, y, w, h, color, collapsed, parent uid`) as JSON in props of a block under a collapsed `Snapshots` child of the board, titled with date and time. "Restore snapshot" re-applies it in chunks of 45 writes with one confirmation. Keep the 10 newest; older ones are listed and deletable. Accept: move 5 cards, restore, every position exact.
- [ ] **TP-5 Mind map presets** (S) — Directions right, down, balanced, radial; spacing compact/normal/airy; depth limit 1-4; include block refs as cards or skip; color branches by top-level child. Remember the last preset per device. Accept: each preset on a 20-node outline.
- [ ] **TP-6 Shapes for flows** (M) — Text items gain `shape` (text `fontSize` today is one of `FONT_SIZES` = 16/24/32/48; keep that list for text items, cards get the free 10-48 stepper): rectangle, rounded, ellipse, diamond (decision), parallelogram (input/output), cylinder (storage). Connections attach to the shape outline. Used by the Process flow template. Accept: a 6-shape flow with Yes/No labels exports to SVG and PNG correctly.
- [ ] **TP-7 Sticky notes** (S) — Text item variant `sticky` (yellow default, any color), slight shadow, 200×200 default. Accept: create, color, resize, export.
- [ ] **TP-8 Swimlanes** (M) — Section variant `lane`: full-width horizontal or vertical bands, label on the side, cards dropped in become children. Accept: 3-lane process flow from the HACCP starter.
- [ ] **TP-9 Gate** — standing gate.

### P5: Roam graph superpowers (1.7.0)

- [ ] **RG-1 Query cards** (M) — A block holding `{{[[query]]: …}}` or `{{query}}` renders as a live card through `renderBlock` (Roam keeps it live). A menu item "Add results as cards" places up to 45 result blocks as ref cards around it. Accept: a query for a tag on Test Lab shows results and places them.
- [ ] **RG-2 Linked references drawer** (M) — Page cards get an expandable "N linked references" drawer (Roam's mentions render); drag a reference out onto the board as a ref card. Accept: drag one out; the source block is byte-identical afterwards.
- [ ] **RG-3 Expand neighbors** (M) — Page or block card menu: "Add pages it links to", "Add pages that link here", "Add attribute values". Places up to 24 cards around the source in a ring and draws derived connections (not written). Accept: on a Test Lab page with 5 refs and 3 backlinks.
- [ ] **RG-4 Typed attribute edges** (M) — Show `Name:: [[X]]` relations between cards on the board as labelled derived edges, styled per attribute name (setting maps names to colors and dash). A legend toggles each attribute on or off. "Write to graph" (1.0) stays the only way a drawn connection becomes an attribute. Accept: `Causes:: [[B]]` on card A shows a labelled A→B edge; toggling hides it; no writes.
- [ ] **RG-5 Better Tasks cards** (S) — TODO and DONE checkboxes toggle in place; a card shows a due chip read from `BT_attrDue::` (read-only, never written); overdue gets a red border. Accept: toggle a TODO on Test Lab; the BT child is byte-identical.
- [ ] **RG-6 Outline reading order** (S) — "Sort outline by position" reorders the board's child blocks top-left to bottom-right (sections first, then cards inside each), so the Roam outline reads like the board. One action, chunked to 45 moves, undoable. Accept: outline order matches the visual order.
- [ ] **RG-7 Add to board from anywhere** (S) — Block context menu "Add to board…" with a recent-boards picker (the 1.2 Send to board picker), places the block as a ref card at the board's center. Uses one block-context-menu entry, not a palette entry. Accept: from a Test Lab block.
- [ ] **RG-8 Tag lenses** (S) — Pick a tag; cards whose block or page carries it stay bright and everything else dims (no writes). Combine with focus mode. Accept: on fixture with 2 tags.
- [ ] **RG-9 Namespace sections** (S) — Dropping a namespaced page (`Project/Sub`) offers "Group under Project" which creates or reuses a section titled `Project`. Accept: two namespaced pages end up in one section.
- [ ] **RG-10 Board embeds** (S) — `{{[[embed]]: ((boardUid))}}` and the 1.2 shortcut card both mount correctly (read-write in an embed, the shortcut stays a thumbnail). No double mount when the same board is visible twice; each mount has its own viewport. Accept: the same board embedded twice on Test Lab plus the original, all three live.
- [ ] **RG-11 Gate** — standing gate.

### P6: Performance and reliability (1.8.0)

- [ ] **PF-1 Command budget** (S) — 1.2 registers 6 palette commands (`Enhance this diagram`, `New whiteboard here`, `Restore native diagram`, `Fullscreen this diagram`, `Export board as SVG`, `Copy board as text`) plus slash and block-context entries. Cut the palette to at most 2 entries ("Plexus: Commands…", which opens a list of every action and keeps the focused block, and "Plexus: New whiteboard here"). Measure the typing bench before and after. Accept: delta at most +0.1 ms/key.
- [ ] **PF-2 300-card board** (M) — Fixture with 300 cards, 20 sections, 150 connections (built in chunks via the ledger). Open under 400 ms to first paint, pan and zoom at 60 fps (trace with `Tracing.start` over CDP), LOD switches without a long task over 50 ms. Accept: numbers recorded in section 8.
- [ ] **PF-3 Offscreen virtualization** (M) — Cards outside the viewport plus one screen of margin do not hold a `renderString` or `renderBlock` mount; they render a cheap placeholder until scrolled near. Accept: on the 300-card board, mounted Roam renders at most the visible count plus margin.
- [ ] **PF-4 Leak test** (S) — Open and close the fixture board 50 times, toggle fullscreen 50 times, reload the extension 10 times. Listener counts, `.pxd-*` nodes and pull watches return to baseline. Accept: counts in section 8.
- [ ] **PF-5 Error isolation** (S) — A card whose render throws shows a small "Could not render" chip with the uid and an Open button; the board keeps working; one console error per card, not per frame. Accept: inject a throwing render in a test and live (a block whose string is a broken roam/render).
- [ ] **PF-6 Two-window consistency** (M) — Same board in the main window and sidebar, and in two Roam windows: moves, edits, deletes and connection changes converge after the echo; no duplicate items; no lost cards. Accept: 30 scripted mixed operations across both, then compare item sets.
- [ ] **PF-7 Undo grouping** (M) — Every single user gesture is one Roam undo step where Roam allows it (move of N cards, align, distribute, paste, mind map, template insert chunk). Document any gesture that needs more than one step. Accept: a table in section 8 with gesture → undo steps.
- [ ] **PF-8 Write-queue health** (S) — The status dot shows idle / writing / retrying / failed with a tooltip; a failed write keeps the optimistic state, retries 3 times, then reverts and toasts. Accept: simulate a failing write in a unit test.
- [ ] **PF-9 Bundle size** (S) — Keep `extension.js` under its 1.2 size plus 25% after all P1-P5 work, or explain the growth in section 8.
- [ ] **PF-10 Gate** — standing gate.

### P7: Look, feel and accessibility (1.9.0)

- [ ] **UI-1 Overview-tier title collisions** (S) — Known 1.2 polish item: around 12% zoom a card can cover a section's title pill. Draw section titles above cards in the overview tier, or offset cards. Accept: screenshot at 12% and 8% on the 300-card board.
- [ ] **UI-2 Icon toolbar** (M) — Replace text buttons with Blueprint icons plus tooltips everywhere (context bar, rail, panel tabs), matching Roam's own controls. Accept: screenshot of each surface in light and dark.
- [ ] **UI-3 Tool palette** (M) — Heptabase-style floating tool palette, bottom center: Select (V), Hand (H), Card (N), Text (T), Sticky (S), Shape (R), Section (G), Board (W), Connect (C). Setting to hide it. Accept: each tool creates or acts; the palette never overlaps the minimap.
- [ ] **UI-4 Light and dark themes** (M) — Check every surface in Roam light, Roam dark (`bp3-dark`), and the Blueprint theme the user runs. Colors from CSS variables only; dark mode uses borders for selection and section identity. Accept: screenshots of the fixture in both themes.
- [ ] **UI-5 Empty-board hint** (S) — A new board shows a quiet hint: "Double-click to add a block · drag bullets from the outline · press ? for shortcuts". Disappears after the first item. Accept: visible on a new board only.
- [ ] **UI-6 Motion setting** (S) — Setting `motion`: full / reduced / none; also honor `prefers-reduced-motion`. Covers zoom animation, present transitions, animated edges, pulses. Accept: each value.
- [ ] **UI-7 Keyboard-only use** (M) — Every action reachable by keyboard; visible focus rings; `aria-label` on every control; the board root is a focusable region with `aria-roledescription="whiteboard"`; cards announce title and type. Accept: tab through the rail, panel, a card, its toolbar and the menu without a mouse.
- [ ] **UI-8 Shortcut sheet** (S) — `?` opens a sheet of every shortcut grouped by area, generated from one table in code so it cannot drift. Accept: every key in the sheet works.
- [ ] **UI-9 Changelog popover** (S) — Clicking the version badge shows the bundled CHANGELOG entry for the running version (no network). Accept: shows the current entry.
- [ ] **UI-10 Settings panel order** (S) — Group the Roam Depot settings into Cards, Sections, Connections, Board, Performance, with plain descriptions and a "Reset Plexus settings" button. Accept: every setting applies live (no remount).
- [ ] **UI-11 Gate** — standing gate plus light and dark screenshot set.

### P8: Docs, hardening and 2.0 (2.0.0)

- [ ] **DOC-1 README rewrite** (M) — Start a board, what each surface does (rail, Properties, toolbar, panel, palette), what it means in Roam (blocks, props, attributes), every shortcut, settings, limits (undo 50, bulk 45, mind map 24), install and update. Screenshots in `docs/img/` from `.live/shots/`.
- [ ] **DOC-2 Spec 2.0** (M) — `docs/spec-plexus-2.0.md`: data model with every prop key and its validation, every surface, the native parity table filled in, Heptabase gap table updated, non-goals.
- [ ] **DOC-3 API contracts** (S) — Update `docs/api-plexus-1.0.md` with each new module's contract or start `api-plexus-2.0.md`.
- [ ] **DOC-4 Roam Depot listing** (S) — Description, screenshots, and the Depot PR material ready in `docs/depot/` (do not open a PR; the user decides).
- [ ] **HARD-1 Fuzz the schema** (S) — Property tests over random props (unknown keys, wrong types, huge numbers, NaN) for every item type; the board renders and nothing is written back unless the user edits.
- [ ] **HARD-2 Migration from every past version** (S) — Boards created by 0.4, 0.6, 1.0, 1.1 and 1.2 open on 2.0 with no writes on open. Accept: fixtures for each in tests.
- [ ] **HARD-3 Restore native, full round trip** (S) — Enhance → edit heavily → Restore native diagram → the native diagram renders its original nodes; re-enhance restores the Plexus layout. Accept: live on Test Lab.
- [ ] **REL-1 2.0 release** — standing gate, tag `v2.0.0`, GitHub release notes.

## 6. Later (ideas not scheduled)

Pick from here only when every phase above is done or blocked.

- Card templates (a card with preset children and attributes) from `roam/templates` or SmartBlocks if installed (read only their output, never their config).
- Gallery view of a board (image-first grid).
- Calendar lane: a section that lays out daily-page cards by date.
- Timeline view: cards with a date attribute on a horizontal axis.
- Graph view of a board's derived links (force layout, read-only).
- Card version peek: Roam's block history for a card, if Roam exposes it.
- Comments on cards via Roam's native comments (`add_comment` surface), shown as a count badge.
- Highlight colors inside card text (Roam `^^highlight^^`) as a color filter.
- Connection waypoints (manual bend points) and orthogonal routing around cards.
- Group connections: one arrow from a section to a section.
- Board-level "focus timer" (pomodoro) section for daily planning boards.
- Presenter notes from each section's first child block, and a presenter window.
- Laser pointer and temporary pen during present.
- PDF export through the print dialog, one section per page.
- Import an image of a whiteboard as a background layer, locked.
- Per-board default zoom threshold.
- Live thumbnails of boards on other pages without opening them (needs a watch budget plan).
- Multi-user cursors (needs Roam multiplayer presence; probably never).

## 7. Non-goals

AI agent features inside the board, SuperTag-style typed schemas or class tags, storing anything outside Roam blocks and props, network requests, any write on open, pan, zoom or select, writing `:diagram/*`, writing `BT_attr*`, replacing Roam's native diagram for boards the user did not enhance.

## 8. Measurements and findings

Fill in as phases run. Keep the newest at the top of each list.

- NP-4, 2026-10-01: Named picks store the palette name. Native, darker, lighter, and HEX store lowercase hex. A missing section titleSize still paints 15px. Edge dash and color paint on an edge-only frame. Collapse is localStorage `pxd-props-collapsed`. The 1.2 Background menu stays.
- NP-5, 2026-10-01: file.get returns a File, PNG inlines data URLs only, and the SVG download stays text. The live 3222×1552 PNG shows the image and "causes", and Roam rendered the clipboard PNG on the Test Lab block. The anchor click opened a blob window and did not write Downloads.
- NP-3, 2026-09-30: Maximized native diagram `2ZkxxgO7I` titles, top to bottom: zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar, Minimize. Inline titles are Edit Block and Maximize. `addWindow` type `outline` for board `7XhQbTmMo` came back as `sidebar-block-7XhQbTmMo` (type block).
- NP-2, 2026-09-30: Color opens the NP-4 picker. The inline row stays 11 swatches. Expand writes the card's `:block/open` and hides rendered children; a missing `open` stays open. A block-ref's References button opens mentions of the target uid. Positive wheel deltaX pans the world left.
- Baselines (PRE-4), Readwisenotes, 2026-09-30: typing delta −0.39 ms/key (33.79 injected, 34.18 unloaded, 200 keys, no board mounted). Open 6-card `7XhQbTmMo` 216 ms; 120-card `rw4_lPoOm` 146 ms. Unload of that board: 1472 `.pxd-*` nodes to 0, 1 watch to 0. No-board listeners: window 108 to 106, document stayed 140. Palette commands: 6, plus context `Plexus: Enhance`. Bundle: extension.js 441713, extension.css 61452.
- PRE-5, installed 1.2.0 on Svy `UZFdVYL7X`: view mode has no bullet node. Edit mode shows the root bullet and the child bullet. Enter left the editor open on child `beta`. At 10% the card is a tile with no spill.
- NP-6, 2026-10-01: addWindow type outline for vc8Skaj5K (open false, 12 children) created sidebar-block-vc8Skaj5K and mounted the canvas. The sidebar copy defaults to Outline and does not write :block/open.
- [x] NP-15 checklist, same block `vc8Skaj5K`: Edit Block, Maximize, zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar. Properties covers text size, color, align, fill, border, edge direction, decoration, type, color, section title and area, diagram background. Hover toolbar has Color, Expand, References. Minimap drag pans. Cards are plain blocks and render embeds. Delete, marquee, Cmd-click, Cmd-A, and arrow nudge match native.
- NP-15, 2026-10-01: Restoring the marker shows Roam's empty diagram because this board was created enhanced and has no `:diagram` nodes. Putting `v: 2` back remounted the canvas. np4 stayed at 1100,80. Mounted-board typing median was about +1.5 ms/key. No-board mean was 34.32 injected and 35.35 unloaded.
- NP-14, 2026-10-01: Edit Block on vc8Skaj5K opened a textarea with the raw diagram string. Esc removed it. Board :edit/time stayed 1790862457806.
- NP-13, 2026-10-01: Delete and Backspace delete the selection; Shift+Delete includes section contents. Shift-drag marquee adds to the selection. Cmd/Ctrl-click toggles membership and does not edit. Cmd/Ctrl+A selects every item. Arrows nudge 1px, Shift+arrows 10px. Live on vc8Skaj5K: meta-click added q5EACJYji, Cmd-A selected 9 mounted items, one ArrowRight then ArrowLeft restored q5EACJYji to x 680.
- PF-2 300-card numbers: _pending_
- PF-4 leak counts: _pending_
- PF-7 undo table: _pending_
- PF-9 bundle size: _pending_
