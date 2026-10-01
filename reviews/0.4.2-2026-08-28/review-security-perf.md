# Security + Performance Review — Plexus Diagram 0.4.2 (2026-08-28)

Scope: `reviews/0.4.2-2026-08-28/diff.txt`, `src/library.js`, `src/canvas.js` (drop/connect), `src/feature.js` (nest stack). Read-only review, no changes made.

## XSS via library titles / drop payload / crumb titles into DOM

**File:** src/canvas.js:649-687 (crumbs), src/canvas.js:1074-1156 (card titles/nested name), src/library.js:72-83 (list rows)
**Severity:** suggestion
**Type:** security
**What is wrong:** Nothing. Every place that paints untrusted, graph-sourced text (crumb titles from `parseDiagramTitle`, library page titles, nested-board names, card title text) uses `.textContent =`, never `.innerHTML =`, with the string. The only `innerHTML` writes in the diff (`crumbRow.innerHTML = ""`, `list.innerHTML = ""`, `body.innerHTML = ""`, `minimap.innerHTML = ""`, `edgesSvg.innerHTML = ""`) are all clears with a literal empty string, not interpolated content. The one place untrusted content reaches the DOM through a Roam-owned path is `renderStringInto` (`src/canvas.js:1081-1090`), which calls `roamUi().components.renderString`, Roam's own sanitizing renderer, and falls back to `el.textContent = string` (safe) if that API throws or is absent.
**Why it matters:** N/A — confirms the pattern is safe as implemented.
**What needs to change:** Nothing. Keep using `textContent` for any future title/label rendering (crumbs, nested-name input value, library rows) instead of `innerHTML`.

## Unbounded nest stack (`nestStack`)

**File:** src/canvas.js:17, src/feature.js:234-243, src/feature.js:259-264
**Severity:** warning
**Type:** performance
**What is wrong:** `nestStack` is a module-level array that only grows (`openNestedDiagram` pushes the parent) and only shrinks by one when `syncNestStackOnNavigate` sees the hash land exactly back on `nestStack[nestStack.length - 1].uid`. Any navigation path that doesn't retrace that exact uid — following a page link elsewhere in the graph, opening a different diagram, browser back/forward through several stops, or reloading into a deep hash — leaves stale entries on the stack forever (only cleared on extension unload, `src/feature.js:487`). `renderCrumbs()` (`src/canvas.js:649-687`) is called from `render()` on every structural render, and iterates the full stack each time, so cost grows unboundedly with session length/navigation churn, not with actual nesting depth.
**Why it matters:** In a long-lived Roam tab (these routinely stay open for days), a user who wanders through many nested boards without retracing crumbs accumulates an ever-growing array that is walked on every render tick, and a crumb row that keeps showing ever more (stale, wrong) ancestors — a slow perf leak plus a confusing UI.
**What needs to change:** Cap `nestStack` length (e.g. keep the last N, or replace-not-push when a newly opened uid already exists deeper in the stack), and/or clear it whenever navigation lands on a uid not present anywhere in the stack (not just a mismatch with the top entry).

## Unbounded library query

**File:** src/library.js:85-100
**Severity:** warning
**Type:** performance
**What is wrong:** `loadTitles()` runs `roamAlphaAPI.data.q("[:find ?title ?uid :where [?p :node/title ?title] [?p :block/uid ?uid]]")` with no limit, pulling every page title+uid in the graph into memory on every library open, then filters/truncates client-side (`filterLibraryTitles` caps output at 30, `src/library.js:1-14`). `search.addEventListener("input", renderList)` (`src/library.js:102`) then re-filters that same full, unbounded array on every keystroke with no debounce.
**Why it matters:** This is pre-existing behavior, not introduced by this diff, but 0.4.2 makes the drawer easier to reach (now a `document.body` portal, `src/library.js:34-36`, `src/feature.js:283`) so it is likely opened more often. On graphs with tens of thousands of pages this query+filter pattern is the kind of thing that visibly stalls the main thread on open and on every keystroke while searching.
**What needs to change:** Push the empty-query dailies/roam-js/roam-css exclusion and the 30-item cap into the Datalog query itself (or add a `:limit`), and/or debounce `renderList` on input so fast typing doesn't refilter the full list on every character.

## Capture-phase focus/scroll listeners leaking

**File:** src/canvas.js:1046-1072, src/canvas.js:1164, src/canvas.js:1215, src/canvas.js:1793
**Severity:** suggestion
**Type:** performance
**What is wrong:** `attachFocusGuard`/`detachFocusGuard` add/remove a capture-phase `focus` and `scroll` listener on `document`. Tracing every path: `attachFocusGuard()` is called once in `enterEdit` (line 1215); `detachFocusGuard()` is called at the top of `exitEdit` (line 1164, before any `await`, so it also runs synchronously when `exitEdit` is fired-and-forgotten from `dispose()`) and again defensively in `dispose()` (line 1793). The `stealListening` guard makes both attach and detach idempotent. I did not find a path where the listener survives past `exitEdit`/`dispose` — this is clean.
**Why it matters:** N/A. Flagging only the residual cost: a capture-phase `scroll` listener on `document` runs on every scroll event system-wide (any scrollable container) while a card is being edited, not just scrolls near the editor. The handler body is cheap (a few property/class checks) so this is a minor, not urgent, overhead.
**What needs to change:** Nothing required. Optionally scope the scroll listener to the specific scroll containers that can steal focus (e.g. `.rm-article-wrapper`, sidebars) instead of `document`, to cut the fan-out of a capture-phase global listener.

## Metadata writes on every name keystroke (150ms debounce) vs graph load

**File:** src/canvas.js:1126-1141
**Severity:** warning
**Type:** performance
**What is wrong:** The "Name this board…" input debounces `updateBlock(child.uid, next)` at 150ms per pause in typing (same constant style as `PERSIST_DEBOUNCE_MS`, line 29, though not reusing it — it's a literal `150` inline). Unlike the viewport/layout debounce, which coalesces into a single flush guarded by a `*Dirty` flag and only fires the trailing write, this one fires a fresh `updateBlock` call for every 150ms typing pause, with no guard against a still-in-flight write from the previous pause. Typing a multi-word board name at normal speed produces several separate Roam `block.update` transactions instead of one write on blur/commit.
**Why it matters:** Each `updateBlock` is a real Roam Alpha API transact — more write amplification against the graph than needed for a value that only needs to be durable once editing settles. Because there's no in-flight guard, if a write from an earlier pause resolves after a later one (out-of-order network/microtask timing), the block string can end up reverted to a stale intermediate value even though the model (`child.string`/`card._pxdString`) was updated optimistically inside each `.then()`.
**What needs to change:** Only commit on blur/Escape-equivalent (mirroring how card body edits commit through the scratch block), or at minimum track the latest pending write's token and drop `.then()` results that aren't for the most recent value, so a stale write can't clobber a newer one.

## `parseDropPayload` treating random 9-char tokens as uids

**File:** src/canvas.js:208-234
**Severity:** warning
**Type:** security
**What is wrong:** `parseDropPayload` reads `text/plain`, `text/html`, and then *every* type listed in `dataTransfer.types` (line 221-223), concatenates them all into one `blob`, and — if no `[[page]]` or `((block))` pattern is found — falls back to `ROAM_UID_RE`, a bare "9 chars of `[A-Za-z0-9_-]` bounded by non-word characters" match, and treats whatever it finds as a real Roam block uid, immediately materializing it as a `((uid))` block reference on the board (`src/canvas.js:1750-1757`, `onDrop`).
**Why it matters:** This heuristic has no relationship to Roam's actual uid format beyond length/charset, and it's applied to the full concatenation of *all* drag mime types, not just Roam's own drag payload. Dragging rich content from elsewhere (a browser screenshot, a formatted snippet with embedded ids/hashes, base64 data in `text/html`) makes an accidental 9-char alnum/dash/underscore run bounded by punctuation quite likely, especially since base64 alphabets are bounded by exactly the kind of characters (`+`, `/`, `=`, whitespace) this regex treats as a boundary. The result is a card silently gets wired to `((some-coincidental-token))` — a broken reference at best, or, if that token happens to collide with a real block uid elsewhere in the user's own graph, an unintended reference to unrelated content, from data that never claimed to be a Roam identifier.
**What needs to change:** Don't fall back to a bare-regex uid guess for content that didn't originate as a Roam drag (e.g. require the `text/html` chunk to carry a Roam-specific marker/attribute such as `data-uid`, or restrict the type list scanned to `text/plain`/`text/html` and drop the "scan every dataTransfer type" loop), and/or verify the candidate uid actually resolves to an existing block via `roamAlphaAPI.data.pull` before treating it as one, instead of trusting the shape of the string alone.

## Summary table

| Severity | Type | Location | Finding |
|---|---|---|---|
| warning | security | src/canvas.js:208-234 | `parseDropPayload`'s bare 9-char regex fallback, applied across all drag mime types, can misclassify coincidental substrings as Roam block uids and wire a card to an unintended/nonexistent block reference. |
| warning | performance | src/canvas.js:1126-1141 | Nested-board name input fires an `updateBlock` write per 150ms typing pause with no in-flight guard, risking write amplification and out-of-order stale overwrites; should commit on blur instead. |
| warning | performance | src/canvas.js:17, src/feature.js:234-264 | `nestStack` only grows unless navigation retraces the exact top uid; stale entries accumulate for the life of the session and are walked on every render. |
| warning | performance | src/library.js:85-100 | Library drawer query has no limit and re-filters the full unbounded title list on every keystroke; pre-existing, now reached more easily via the `document.body` portal. |
| suggestion | performance | src/canvas.js:1046-1072 | Capture-phase `scroll`/`focus` listeners are correctly attached/detached (no leak found), but scope to specific scroll containers instead of `document` to reduce global capture-phase fan-out. |
| suggestion | security | src/canvas.js (crumbs/titles), src/library.js (list rows) | No XSS found — all untrusted graph text reaches the DOM via `textContent` or Roam's own `renderString`, never raw `innerHTML`. Keep this pattern going forward. |
