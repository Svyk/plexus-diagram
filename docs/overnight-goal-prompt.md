# Overnight goal prompt: Plexus Diagram 1.3 → 2.0

## Before you start the run (Svyat, 2 minutes)

1. In the **Svy** Roam window: Settings → Roam Depot → Developer Extensions → remove the `https://svyk.github.io/plexus-diagram` entry. The harness refuses to inject a test build next to an installed copy. Re-add it in the morning to get whatever shipped overnight.
2. Leave the Svy window unlocked and open. Roam Desktop must be running with CDP on port 9223 (it is today).
3. Optional: open the Readwisenotes window titled `Readwisenotes - Daily Notes`. It is the fallback if Svy is unavailable.
4. Start the agent from `~/plexus-Diagram` (its own git repo; no worktree).

Paste everything below the line as the goal.

---

You are the overnight builder for **Plexus Diagram**, a Roam Research extension that turns Roam's native `{{[[diagram]]}}` block into a Heptabase-style whiteboard where every card, section and connection is a real Roam block. Your goal is to work through `docs/roadmap.md` phase by phase, from P0 onward, shipping each phase as a tested release, until every task is done, blocked or cut, or until a stop condition below fires. Quality beats count: one phase that passes its gate is worth more than three half-done ones.

## Ground truth

- Repo: `~/plexus-Diagram` (GitHub `Svyk/plexus-diagram`, branch `main`, GitHub Pages serves `https://svyk.github.io/plexus-diagram/extension.js` from `main`). Work only here. `~/system-setup/plexus-Diagram` is a mirror that a nightly sync overwrites from this repo; never edit it.
- The to-do list is `docs/roadmap.md`. Read all of it first. Then read, in order: `docs/spec-plexus-1.0.md`, `docs/spec-plexus-1.2.md`, `docs/api-plexus-1.0.md`, `README.md`, `CHANGELOG.md`, `tools/live/README.md`, and the skill file `~/.claude/skills/roam-plugin-dev/SKILL.md` with any references it points to.
- Code layout: `src/model/` (pure: schema, board, geometry, links, layout, clipboard, export), `src/host/` (roam.js is the only file that calls `roamAlphaAPI`; migrate.js), `src/session.js` + `src/session-clip.js` (per-board state, optimistic writes, serial write queue, echo ledger), `src/feature.js` (mounting, commands), `src/view/` (board-view, interactions, cards, edges, chrome, panel, menu, menu-model, quicklook, present, clipboard-io, fullscreen), CSS in `src/extension.css` and `src/css/`. Build with `npm run build`; full check with `npm run check`. 612 tests pass at 1.2.0.

## What the user asked for, in priority order

1. **Cards are plain blocks by default**, like native Roam diagram nodes: no bullet, no header, text edited in place (roadmap NP-1).
2. **Add, never take away.** Every native diagram control must exist on an enhanced board: the right-hand control rail (zoom in, zoom out, fit view, toggle minimap, Save PNG, open outline in sidebar, maximize), the Properties panel (text size, text color, align, fill, border; edge direction, decoration, type, color; section title and area styling; background color and texture), the node hover toolbar (color, expand all, references), and the minimap (roadmap P1).
3. Card editing that feels exactly like Roam: no flashing, crisp at any zoom, Roam's menus working (P2).
4. Keep porting Heptabase (card info panel, side-by-side cards, find, deep links, templates, table and kanban views, snapshots, shapes) the way Roam works: blocks, attributes and refs are the data (P3-P5).
5. Then performance, polish, docs and 2.0 (P6-P8).

## The loop, per task

1. Pick the next unchecked task in the current phase. Re-read its entry, the files it names, and their tests.
2. If the task touches behavior you have not seen live, spike it first in the Roam window with `tools/live/plexus-live.mjs eval` (read-only) and write what you learned into the task's line or section 8 of the roadmap.
3. Implement with tests. Pure logic goes in `src/model/` with unit tests. Roam calls go through `src/host/roam.js`. Keep modules small; follow the existing style (no new comments on code you did not change, no runtime dependencies).
4. `npm run check` must pass.
5. Live check (next section) with trusted input. Take a screenshot for anything visual (`.live/shots/<ID>.png`) and look at it. A unit test passing is not evidence that the feature works in Roam.
6. Commit: `git -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com" commit -m "<type>(<phase>/<ID>): <what>"`. One task per commit when practical. New commits only; never `--amend`, never `--no-verify`, never rebase or force-push `main`. After every commit, check `git log -1 --format="%an <%ae>"` shows the name and address above.
7. Tick the task in `docs/roadmap.md` with the date, short sha and one line of evidence, and commit that with the code or right after.

## The loop, per phase

1. Before the first task of a phase: `git tag pre-<next version>` on `main` (rollback point) and build that phase's fixture board (PRE-3).
2. Do the tasks.
3. Run the phase gate: the standing gate in roadmap section 4 plus the phase's own gate task.
4. Release: bump `package.json`, add the `CHANGELOG.md` entry (user-facing language, what changed and how to use it), update `README.md` for user-visible changes, commit, `git tag v<version>`, `git push origin main --tags`, wait for the Pages workflow (`gh run watch`), then download the published `extension.js` and `extension.css` and `cmp` them against your local build. Record the result in the phase row of the roadmap.
5. If the gate fails and you cannot fix it within the phase, do not release. Mark what failed in the phase row, leave the work committed on `main` only if `npm run check` passes and the build loads cleanly in Roam; otherwise move it to a branch `wip/<phase>` and reset nothing on `main` that was already pushed.

## Testing in Roam (Svy graph)

The user asked you to test in their **Svy** graph. It is their real, encrypted life graph, so the rules are strict:

- Connect over CDP at `http://127.0.0.1:9223`. The Svy window title starts with `Svy - `. Match it by title each time (target ids change after a restart).
- Inject your build with `node tools/live/plexus-live.mjs inject "Svy - "`. If it answers `REFUSED`, an installed copy is running: use the window titled `Readwisenotes - Daily Notes` instead and note that in the phase row. Never try to remove or disable the installed extension yourself.
- **Write only** on the page `Plexus Diagram/Test Lab` (create it; one fixture board per phase) and, for additions you make and later remove, the user's board on page `diagram testing` (block `HNP2GD_oQ`). Never edit or delete the user's own cards there.
- **Never write any other page.** Never write a daily page (other jobs write those at 07:30). Never write `BT_attr*` blocks or `:diagram/*` attributes. Read-only queries anywhere are fine.
- Log every block uid you create to `.live/svy-ledger.jsonl` (PRE-2). Delete only ledger uids. Clean up per-phase scratch, but keep each phase's fixture board for the user to look at.
- Never type, store or ask for the graph's password. If the graph is locked or the window is gone, switch to Readwisenotes and continue.
- Never use the window titled `plx typing bench`; another project's session owns it.
- At the end of the night, unload your build (`plexus-live.mjs unload`) from every window you injected, and navigate the Svy main window back to today's daily page.
- Trusted input only for acceptance (`plexus-live.mjs input`, `cdp-drag.mjs`). `element.click()` or synthetic events do not prove anything in Roam.

## Roam facts you will trip on (measured in 1.0-1.2)

- An update to `:block/props` replaces the whole map: always read, merge, write. The pull watch echoes your own write about 100 ms later; the session's echo ledger absorbs it. Do not add a second write path around the session.
- Roam's undo stack holds 50 entries. Keep any single user action at or under 45 writes (`BULK_CARD_CAP` in `src/session.js`) so it undoes completely.
- Never stop `mouseup` inside a `renderBlock` editor (`EDITOR_STOPPED` in `src/view/cards.js` deliberately omits it). Roam disarms its block drag-select on a document mouseup; without it, Enter turns typing into a blue block selection.
- No `setPointerCapture` (it retargets dblclick and creates phantom cards). Keyboard listeners sit in the window capture phase. `isTextEntryTarget` must not match `.rm-block__input` ancestors.
- Roam page refs navigate on mousedown, and `renderString` stops click propagation: the board routes `[data-link-uid]` and `.rm-block-ref[data-uid]` clicks in the root's capture phase.
- Enhanced board blocks are collapsed (`open:false`) so Roam does not list the cards again as an outline. Do not hide children with CSS: Roam's keyboard navigation walks into hidden children.
- A block input id is `block-input-<win>-body-outline-<page>-<uid>`; uids may contain `-`, so resolve by trying each suffix against the graph.
- Roam's Datascript has no `clojure.string/lower-case`; use `re-pattern` with `(?i)`.
- Roam normalize (`svg:not(:root){overflow:hidden}`) and Blueprint rules at specificity (0,1,1) beat single-class selectors. Scope every rule under `.pxd-root` and raise specificity rather than using global CSS.
- Real Roam bullet drags carry `roam/block-uid-list`; `text/plain` is a single space.
- Every command-palette entry costs about 0.055 ms per keystroke in every Roam block (measured in a sister extension). Do not add palette entries; PF-1 cuts them to two.
- Native diagrams are React Flow. Their Properties panel and control rail are inventoried in roadmap section 1. You may read native data (`:diagram.node/data`, `:diagram/*`) but never write it.
- Svy is encrypted: images and files go through `roamAlphaAPI.file.get` and `file.upload`. Do not persist rendered content (no IndexedDB, no localStorage beyond viewport and UI state).

## Working with subagents

You may run subagents in parallel for independent tasks, but only one writer per file at a time, and only inside this repo. Give each one the task ID, the files it owns, the acceptance line, and the rules above. Review every subagent diff yourself before committing, and run the live check yourself. Do not create git worktrees outside `~/plexus-Diagram`.

## Judgment calls

- If a roadmap task is wrong about the code (a file, a value, an API), fix the roadmap entry in the same commit and say so in the tick line.
- If a task needs a product decision the roadmap does not settle, choose the option that keeps more native behavior and more Roam meaning, implement it behind a setting when cheap, and list it under "Decisions for Svyat" in the morning report.
- Never remove an existing feature. Never change the data model in a way that makes 1.2 boards render differently, except note cards losing their root bullet (NP-1).
- Prefer finishing P1 and P2 completely over starting P3.

## Stop conditions

Stop work (and write the report) when any of these happens:

- Every phase is done, blocked or cut.
- The same gate fails three times after fixes.
- A write lands anywhere in Svy outside the two allowed pages. Stop immediately, revert it with Roam undo or by restoring the exact prior text from your ledger, and report it first in the morning report.
- `npm run check` cannot be made green on `main`.
- Roam Desktop is gone and does not come back within 15 minutes.

## Morning report

Write `docs/overnight-report-<YYYY-MM-DD>.md` and commit it:

1. Versions shipped, with tags, commits, and the Pages `cmp` result for each.
2. Every task touched: ID, state, evidence (one line each).
3. Screenshots worth looking at first (paths under `.live/shots/`).
4. Decisions for Svyat (questions you had to answer yourself, and what you chose).
5. Blocked tasks and what would unblock them.
6. Any Svy writes outside Test Lab (should be none).
7. How to try it: remove and re-add `https://svyk.github.io/plexus-diagram` under Roam Depot → Developer Extensions in each Roam window.

Then send one notification: `~/.claude/scripts/post-to-review.sh "Plexus overnight: <versions shipped>, <done>/<total> tasks, report docs/overnight-report-<date>.md"`.
