# Plexus Diagram 3.0: module contracts

Companion to `docs/api-plexus-2.0.md`. One section per module: exports, inputs, outputs, and what happens on a bad input. The running package version is `package.json`. This file covers the modules the 3.0 roadmap names, including later memory and PDF neighbours that share those names.

| Roadmap name | File |
|---|---|
| `regions.js` | `src/model/regions.js` |
| `minimap-svg.js` | `src/view/minimap-svg.js` (there is no `src/model/minimap-svg.js`) |
| `halo.js` | `src/model/halo.js`. The popover is `src/view/halo-pop.js` |
| trails | `src/model/trails.js` |
| `strength.js` | `src/model/strength.js`. Paint is `src/view/strength-lens.js` |
| `resurface.js` | `src/model/resurface.js`. The panel is `src/view/resurface-panel.js` |
| `highlighter.js` | `src/model/highlighter.js` |
| `status-tags.js` | `src/model/status-tags.js` |
| `detect.js` | `src/model/detect.js` |
| source chip | `src/model/source-chip.js` |
| timeline | `src/model/timeline.js` and `src/view/timeline.js` |
| landmarks | `src/model/landmarks.js` |
| journal | `src/model/journal.js` |
| tabs | `src/model/tabs.js` |
| touch | `src/model/touch.js` |
| public API | `src/model/public-api.js` (`window.PlexusDiagram`) |
| host additions | methods on `createHost` in `src/host/roam.js`, not their own files |

None of these modules write `:diagram/*` or `BT_attr*`. Open, pan, zoom, and select still write nothing.

## src/model/regions.js

Image regions and saved views share the Roam Plexus macro. `img` and `view` are the kinds this extension supports. The other kinds parse so a shared ref is recognised, and `supported` stays false.

| Export | Contract |
|---|---|
| `CONTAINER_STRING` | `{{[[plexus-regions]]}}` |
| `REGION_COMPONENT` | `plexus-region` |
| `isContainerString(s)` | In: any value. Out: true only when a string trims to `CONTAINER_STRING`. Fail: non-strings are false. |
| `normalizeFrac(f)` | In: `[rx, ry, rw, rh]`, or `{rx, ry, rw, rh}`, or `{x, y, w, h}`. Out: four numbers in 0..1, rounded to 4 decimals, or null. Fail: a short list, a non-finite number, or a width or height of 0 or less is null. Values outside 0..1 are clamped. |
| `normalizeView(v)` | In: a four-number world rect. Out: one decimal place, or null. Fail: not a four-array, a non-finite number, or a width or height of 0 or less is null. Not clamped. |
| `parseRegion(blockString)` | In: a block string. Out: null when the value is not a string, lacks `plexus-region`, or the head does not match. Otherwise `{kind, drawingUid, caption, extra, supported, owner}` plus the kind's fields. Fail: a bad token, a missing field, or an unknown kind returns the object with `supported: false` and `error`. `img` needs `d` and `f`. `view` needs `d` and `v`. `ids` on a view is at most 24. Roam Plexus kinds (`area`, `rect`, `group`, `frame`, `cframe`, `poly`, `imgrect`, `imgpoly`) set `owner` to `roam-plexus` and stay unsupported. A bad `pad` is outside 0..200. |
| `serializeRegion(region)` | In: a region object. Out: `{{[[plexus-region]]: k=… d=…}}` plus a single-spaced caption. Fail: throws `TypeError` (`serializeRegion: …`) for a missing region, an unknown kind, a bad id, a bad rect, too many ids, a bad pad, or a bad extra token. |
| `fracRectOf(region)` | Out: `{rx, ry, rw, rh}` from `region.f`, or null when `f` is not four numbers. |
| `viewRectOf(region)` | Out: `{x, y, w, h}` from `region.v`, or null when `v` is not four numbers. |
| `isStructuralString(s)` | Out: true for the container string, or when `parseRegion` returns an object (including an unsupported region). Fail: other values are false. |
| `regionsOf(owner)` | In: a block with `:block/children` or `children`. Out: parsed children of the `plexus-regions` container, or of a child whose plexus `type` is `regions`. Each child uid is copied onto the region. Fail: no container, or a child that does not parse, is skipped. An empty owner returns `[]`. |

## src/view/minimap-svg.js

A stroke-only map. There is no `src/model/minimap-svg.js`. Dark mode uses the stroke, not a fill.

| Export | Contract |
|---|---|
| `minimapSvg(doc, opts)` | In: `{v, items, size}`. `v` is a four-array or `{x, y, w, h}`. `size` defaults to 96. Out: an SVG of that size. A positive frame sets the viewBox and a frame rect. Items with a positive rect are stroked. `item.hot` adds `pxd-cardchip__hot`. Fail: a missing or non-positive frame still returns the SVG, with no viewBox. A bad item rect is skipped. |
| `previewFont(viewWidth)` | Out: at least 12, `round(viewWidth / 32)`. |
| `viewMapModel(board, v, ids)` | In: a board, a view rect, and an optional id list. Out: `{viewBox, cards}`. A card that meets the view is kept. Non-sections stop at 40. Sections that meet the view stay and do not count toward 40. An id in `ids` has `role: "hi"`. Others are `muted`. Fail: no board, or a rect that misses the view, adds no card. A non-finite `v` becomes a zero frame, so nothing meets it. |
| `drawViewMap(doc, parent, model)` | In: `{viewBox, cards}`. Out: an SVG appended to `parent`, class `pxd-viewmap`, at most 240 by 140 CSS pixels. Sections get `pxd-viewmap__card--section`. Fail: a missing model draws a zero viewBox and no cards. A card without `rect` is skipped. |
| `drawPreview(doc, parent, model)` | In: a connection preview model (`viewBox`, `cards`, `path`, ends, bars). Out: an SVG, class `pxd-relpop__map`, appended to `parent`. Block ends are bars clipped to their card. Fail: a missing `model` throws when `viewBox` is read. |

## src/model/halo.js

Provenance for one card or connection. No writes. The user entity id is not kept.

| Export | Contract |
|---|---|
| `HALO_PULL` | Pull pattern for create time, edit time, the display name, and ref create times. |
| `HALO_PULL_LIGHT` | The same pull without reverse refs. |
| `HALO_REF_CAP` | 200. The newest ref times kept by `haloRefs`. |
| `HALO_REFS_SPAN_QUERY` | Datalog: count, min create time, max create time of refs. |
| `HALO_REFS_TIMES_QUERY` | Datalog: each ref's entity and create time. |
| `haloRefs(q, uid, cap)` | In: `q(query, uid)` returns rows. `cap` defaults to `HALO_REF_CAP`. Out: `{total, times}`. `total` is the count. `times` holds the newest `cap` stamps, then the span's min and max when those are finite. Fail: a missing `q` or uid, or a throw from the span query, returns `{total: 0, times: []}`. A throw from the times query keeps the total and an empty newest list, then still appends a finite min and max. |
| `formatMade(ms)` | Out: `October 6th, 2026` in local time, or `""` when `ms` is not a finite number. |
| `headerText(opts)` | In: `{created, board, section, userName}`. Out: `Made <date> on <board>`, or `Made on <board>` when the date is missing. A blank board is `Untitled board`. A section adds ` › name`. A name adds ` by name`. |
| `company(rows, uid)` | In: rows with `uid` and `created`. Out: up to 6 other uids whose `created` is within 24 hours. The subject is left out. Fail: a missing subject, a non-finite stamp, or a non-array returns `[]`. |
| `buckets(times)` | Out: 12 counts. Every finite time lands in one bucket across the min..max span. A single time, or an empty list, is twelve zeros (a single time increments bucket 0). Non-finite values are dropped. |
| `refsLine(times, total)` | Out: `Referenced N times, first <date>, last <date>`. `N` is `total` when that is a finite number at least as large as the finite times. Otherwise `N` is the finite-time count. One time uses `time`. Fail: no finite time returns `Referenced 0 times`. |
| `readHaloPull(pulled)` | In: one pull result. Out: `{created, edited, userName, refTimes}`. Times are finite numbers or null. `userName` is the trimmed display name, or `""`. Fail: a missing pull yields null times, an empty name, and `[]`. A single ref object is accepted as well as an array. |

## src/view/halo-pop.js

The popover is not `halo.js`. It mounts its own `pxd-root` on `document.body`. No graph writes.

| Export | Contract |
|---|---|
| `openHaloPopover(opts)` | In: `{doc, anchor, model, pageExists, renderString, unmount, onPulse, dustAge}`. `doc` defaults to `globalThis.document`. Out: `{el, close, header, counts}`. `header` is `headerText(model)`. `counts` is `buckets` of the finite ref times. Dates are Roam links only when `pageExists(label)` is true and `renderString` is a function. Otherwise the date is plain text. Company buttons (at most 6) call `onPulse(uid)`. A non-empty `dustAge` sets `data-dust-age` and a line. Fail: a document that cannot `createElement` throws. A `renderString` throw paints the plain date. `close` calls `unmount` per mounted link (a throw is ignored) and removes the popover. Escape closes it and returns focus to the opener. |

## src/model/trails.js

A trail is a block under the board's collapsed Trails child. Stops are `((uid))` children in block order. A stop's note is its first child. Nothing here writes.

| Export | Contract |
|---|---|
| `trailString(name)` | Out: `{{[[plexus-trail]]}} ` plus the name, collapsed to one line. A blank name becomes `Trail`. |
| `parseTrailName(string)` | Out: the text after the macro, trimmed, or `""` when the string is not a trail macro. |
| `parseStopRef(string)` | Out: the uid inside a whole-string `((uid))`, or `""`. |
| `parseTrailBlock(node)` | In: a block node. Out: `{uid, name, stops}` when plexus `type` is `trail` or the string is the macro. Each stop is `{uid, ref, note, noteUid}`. Children that are not a `((uid))` are skipped. Fail: a missing node, or a node that is neither type nor macro, returns null. A missing name becomes `Trail`. |
| `parseTrails(containerNode)` | Out: `parseTrailBlock` hits among the container's children, in block order. Fail: a missing container returns `[]`. Children that are not trails are skipped. |
| `trailStrip(stops, titleOf, limit)` | Out: up to `limit` (default 8) `{uid, title, index}` rows. `titleOf(uid)` supplies the title. A throw, or an empty title, uses `stop.title` or the uid. Fail: a non-array is empty. A non-finite limit is 8. A negative limit is 0. Stops with no ref and no uid are skipped. |
| `trailBadges(trail)` | Out: a Map of card ref to a 1-based stop number. The first stop that names a ref wins. Fail: no stops returns an empty Map. |
| `trailPoints(stops, rects)` | Out: `{uid, x, y}` at the center of each stop that has a rect. Fail: a missing rect, or a rect map without `get`, skips that stop. |
| `renderTrailStrip(doc, parent, stops, handlers)` | In: `{onStop, onWalk}`. Out: `parent`, class `pxd-trail-strip`, with a button per stop and a Walk button. Listeners sit on the strip. Enter or Space on a stop calls `onStop`. Enter or Space on Walk calls `onWalk`. Fail: a missing parent is returned as-is. A non-array `stops` draws only Walk. |

## src/model/strength.js

Strength and dust. No Roam calls and no stored scores. Dust uses a 30-day month and a 365-day year. Six months is 180 days.

| Export | Contract |
|---|---|
| `STRENGTH_WEIGHTS` | `{refs: 0.6, shared: 0.25, recency: 0.15, opens: 0.15}`. The track-opens formula below uses 0.50 and 0.20 for refs and shared. |
| `REFS_CAP` | 12 |
| `SHARED_CAP` | 3 |
| `OPENS_CAP` | 10 |
| `RECENCY_HALF_LIFE_DAYS` | 180 |
| `DUST_PERIODS` | `6m` and `6 months` are 180 days. `1y` and `1 year` are 365 days. `2y` and `2 years` are 730 days. Values are milliseconds. |
| `strengthScore(components, opts)` | In: `{refs, shared, editTime or edit, opens, now}`. `trackOpens` defaults to false. `now` defaults to `components.now` or `Date.now()`. Out: 0..1. Off: `0.60 * refsNorm + 0.25 * sharedNorm + 0.15 * recencyNorm`. On: `0.50 * refsNorm + 0.20 * sharedNorm + 0.15 * recencyNorm + 0.15 * opensNorm`. Norms cap the counts at the constants above. Recency is `exp(-ln2 * ageDays / 180)`. Fail: bad counts are 0. A missing edit time is recency 0. |
| `strokeFor(score)` | Out: `{width, opacity}`. Width is `round(1 + score * 3)` so 0 is 1 and 1 is 4. Opacity is `0.5 + score * 0.5`. Fail: a non-finite or negative score is treated as 0. A score above 1 is treated as 1. |
| `dustLimit(period)` | Out: a positive finite number is returned as the limit in milliseconds. A known `DUST_PERIODS` key (lower-case, trimmed) returns that span. Fail: anything else is null. |
| `dustAge(editTime, createTime, now)` | Out: milliseconds since the newest finite stamp, or null. Fail: no finite stamp, or a non-finite `now`, is null. |
| `dusty(item, period)` | In: `item` with `editTime` or `edit`, `createTime` or `create`, and optional `now`. Out: true when the age is at least `dustLimit(period)`. Fail: an unknown period, or missing times, is false. Missing times are not dusty. |
| `ageLabel(ms)` | Out: `today`, `1 day`, `N days`, `N month(s)`, or `N year(s)`. Fail: a non-finite `ms` is `""`. |
| `explain(components)` | Out: `N refs, N shared boards, edited …` (or `not edited`). One ref and one shared board use the singular. |
| `edgeOpens(store, from, to)` | Out: `store.get(from) + store.get(to)`. Fail: a store without `get` returns 0. |
| `createOpenStore(opts)` | In: `{storage, graph, enabled}`. `storage` defaults to `localStorage`. Out: `{key, enabled, setEnabled, get, bump, dispose}`. `key` is `plexus-diagram:opens:<graph>`. `get` returns a positive finite count or 0. `bump` increments and writes only when enabled. `dispose` is a no-op. Fail: bad JSON reads as `{}`. A `setItem` throw is ignored. This is device storage, not a Roam write. |

## src/view/strength-lens.js

Paints stroke and dust classes. No writes and no listeners. Scores come from `src/model/strength.js`.

| Export | Contract |
|---|---|
| `applyStrength(edgeEls, scores)` | In: edge elements, and scores by uid (`Map`, object, or array by index). A number is the score. An object may carry `score` or `components` (then `strengthScore`). Out: sets `strokeWidth` and `strokeOpacity` from `strokeFor` on the line. Components also set a title, `N refs, … Heuristic.` Fail: a missing element, a missing score, or a non-finite score is skipped. |
| `applyDust(cardEls, ages, period)` | In: card elements, ages by uid, and a dust period. Out: dusty cards get `pxd-item--dust`, `data-dust-age`, and `Untouched for <label>. Heuristic.` Others lose that class, attribute, and tip. Fail: a missing element is skipped. An item `dusty` rejects loses the class. |
| `clearLens(edges, cards)` | In: element lists, or one object `{edges, cards}`. Out: restores stroke styles remembered by the apply calls, and removes dust classes, `data-dust-age`, and tips. Fail: a null entry is skipped. |

## src/model/resurface.js

Daily-page resurface matching. No Roam calls.

| Export | Contract |
|---|---|
| `DEFAULT_INTERVALS` | `[7, 30, 90, 365]` |
| `RESURFACE_CAP` | 6 items per interval |
| `pageTitleToDate(title)` | In: a Roam daily title such as `October 5th, 2026`. Out: local midnight in milliseconds, or null. Fail: a title that is not `Month Dth, YYYY`, an unknown month, or an impossible day (31 February) is null. |
| `parseIntervals(text)` | In: comma-separated days. Out: the positive finite numbers, or a copy of `DEFAULT_INTERVALS` when none remain. Fail: blanks, zero, and negatives are dropped. |
| `intervalLabel(days)` | Out: `1 week ago`, `1 month ago`, `3 months ago`, `1 year ago`, `N years ago` when `days` is a positive multiple of 365, otherwise `N days ago`. |
| `matchResurface(rows, pageDate, intervals, opts)` | In: rows `{uid, time, …}`, a page time (Date or number), intervals, `{slack, cap}`. `slack` defaults to one day. `cap` defaults to `RESURFACE_CAP`. Out: `[{days, label, items}]` for intervals that have a hit within `slack`. Items sort by absolute delta, then uid, and stop at `cap`. Fail: a null, empty or non-finite page time returns `[]`. Non-positive intervals and rows without a uid or a finite time are skipped. An interval with no hits is omitted. |

## src/view/resurface-panel.js

The panel beside a `plexus-resurface` button. Unload removes the panel only. Matching is `src/model/resurface.js`.

| Export | Contract |
|---|---|
| `fillResurface(doc, panel, opts)` | In: `{pageTitle, rows, intervals, onOpen}`. Out: replaces the panel's children with interval tabs and item buttons. The first tab is shown. A click calls `onOpen({boardUid, cardUid})`. Enter or Space activates the focused tab or item. Fail: no tabs paints `Nothing from a week, a month or a year ago.` See `matchResurface` for a title that is not a daily page. |
| `createResurface(opts)` | In: `pageTitle`, `rows`, and `intervals` are called as functions. `onOpen` is passed through. Out: `{scan, dispose}`. `scan` mounts a `pxd-resurface` panel after each `button.rm-xparser-default-plexus-resurface`, once. A mutation inside `.pxd-resurface` does not scan again. An unchanged row signature does not refill. `dispose` removes the panels and the button flag. Fail: a disconnected button is pruned. No button and no panel skips the row read. |

## src/model/highlighter.js

Colour-highlighter tags on a block string. No DOM and no props. A caller that already has a props fill keeps it and does not call `fillFromTags`.

| Export | Contract |
|---|---|
| `highlighterTags(string)` | Out: `{bg, text}`. The first `#bg-name`, `#bg-ch-name`, `#[[bg-name]]`, `#[[bg-ch-name]]`, `[[bg-name]]`, or `[[bg-ch-name]]` sets `bg`. The first `#c:name` or `#[[c:name]]` sets `text`. Fail: a non-string, or a string with neither `#` nor `[[`, returns `{bg: null, text: null}`. Later tags of the same kind are ignored. |
| `fillFromTags(tags, probe)` | In: a tag object or a string (parsed by `highlighterTags`), and `probe(name)`. Out: the first non-empty probe of the bg name, its lower-case form, `--cl-lh-<name>`, or `--cl-dk-<name>`. Otherwise a built-in wash for red, orange, yellow, green, blue, purple, pink, gray, grey, or teal. Fail: no bg name, a probe that is not a function, or an unknown name with an empty probe, returns `""`. |
| `rewriteBgTag(string, name)` | In: a block string and a tag name, or null. Out: null removes the first bg token and one bordering space. A name matching `[A-Za-z0-9_]+` replaces the first bg token with `#[[bg-<name>]]` and drops later bg tokens. A string with none appends that token, with one space when the string is non-empty and does not already end in whitespace. Fail: a non-string is treated as `""`. A bad name returns the string unchanged. |

## src/model/status-tags.js

Read-only. Colours and glyphs match Task Status Tags' defaults. A live API (`apiVersion` 1) replaces the table. Plexus never writes a status tag.

| Export | Contract |
|---|---|
| `statusKey(name)` | Out: a lower-case slug. Non-letters become single hyphens, trimmed. A rename is a different key. Fail: a null name is `""`. |
| `statusApi(win)` | Out: `win.RoamTaskStatusTags` when `apiVersion` is 1 and `statuses` is a function. Otherwise null. |
| `statusPalette(api)` | Out: a Map keyed by lower-case name, in API order. Fail: no API, a throw, or an empty list uses the seven defaults (Active, Waiting, In Review, Holding, Incubating, Alert, Cancelled). A row with no name is skipped. A repeated name keeps the first. An unknown glyph, or `custom`, becomes `diamond`, then a known default name keeps that default's glyph. |
| `paletteEntries(palette)` | Out: the Map values, or a shallow copy of an array. Fail: a missing palette is `[]`. |
| `paletteVars(entry, theme)` | In: `theme` is `dark` or `bp3-dark` for the dark pair. Any other theme uses light. Out: `{"--pxd-status-base", "--pxd-status-text"}`. Fail: a missing side yields empty strings. The OS colour scheme is not read. |
| `taskStatusOf(string, palette)` | Out: the palette's canonical name for a `#[[task-status/…]]` tag, or the status `taskMeta` already found. Fail: no tag, or a name the palette does not know, returns null. |
| `statusLook(name, palette)` | Out: the palette entry, or a neutral diamond for an unknown name (`glyph: "diamond"`, light and dark neutral pairs). Fail: a blank name uses key `unknown` and an empty tag. |

## src/model/detect.js

Feature detection for sibling extensions. Pure reads of a window-like object. Better Tasks and the colour highlighter do not fire ready or unload. The others do.

| Export | Contract |
|---|---|
| `INTEGRATION_EVENTS` | `roam-compass:ready`, `roam-compass:unload`, `roam-plexus:ready`, `roam-plexus:unload`, `roam-task-status-tags:ready`, `roam-task-status-tags:unload` |
| `betterTasks(win)` | Out: `{id: "better-tasks", label: "Better Tasks", state, version}`. Found when `RoamExtensionTools["better-tasks"]` or `win.betterTasks` is an object. Version is the first finite number or non-blank string among the entry, `betterTasks`, `v1`, and `v2`. Fail: a throw while reading, or neither object, is `state: "not installed"` and an empty version. |
| `taskStatusTags(win)` | Out: id `task-status-tags`, label `Task Status Tags`. Found when `RoamTaskStatusTags` is an object. Version text is `apiVersion N` when that field is a finite number or a non-blank string. Fail: anything else is not installed. |
| `roamPlexus(win)` | Out: id `roam-plexus`, label `Roam Plexus`, from `win.RoamPlexus`. Same version rule as Task Status Tags. Fail: a missing or non-object global is not installed. |
| `compass(win)` | Out: id `compass`, label `Compass`. Found when `RoamCompass` is an object or `__ROAM_COMPASS_VERSION` is a finite number or a non-blank string. The flag wins over `apiVersion` text. Fail: neither is not installed. |
| `highlighter(win)` | Out: id `highlighter`, label `Colour highlighter`. Found when `RoamColorHighlighter` or `colorHighlighter` is an object, or the document shows a `--cl-lh-*` / `--cl-dk-*` value, a style id containing `roam-extension-color-highlighter`, or CSS text with `[data-tag^=".bg-"]` or `--cl-lh-`. Version is the global's version only. Fail: a hostile document, a cross-origin sheet, or none of those signals is not installed. The published extension has no JS API. |
| `integrations(win)` | Out: `[betterTasks, taskStatusTags, roamPlexus, compass, highlighter]` for that window. |
| `statusLine(row, switchOn)` | Out: `Label: detected 1.3` or `Label: not installed`. `switchOn` true appends ` · on`. False appends ` · off`. Fail: a missing label uses `Integration`. An omitted `switchOn` leaves the switch off the line. A version is shown only when the state is detected. |

## src/model/source-chip.js

Source chip for a highlight dragged off a reading page. Computed from the page title and an `Author::` child. Nothing is written, and the author is never copied into props.

| Export | Contract |
|---|---|
| `authorBlockUid(children)` | Out: the uid of the first child whose string starts with `Author::`, or `""`. Fail: a non-array, a child with no uid, or no such child is `""`. |
| `chipWithAuthor(chip, authorString)` | Out: a copy of `chip` with `author` and `text` retaken from that string. `text` is `title · author`, or the title when the author is blank. A string that no longer starts with `Author::` drops the author. Fail: a non-object chip returns null. |
| `sourceChipFor(opts)` | In: `{pageTitle, pageUid, pageChildren}`. Out: `{title, author, pageUid, text}` when the title starts with `Articles/` or `Media Captures/`. Author text drops `[[` and `]]`. Fail: any other title, or a blank title, returns null. A non-string page uid becomes `""`. |
| `sourceChipKey(chip)` | Out: `pageUid`, `title`, `author`, and `text` joined by a unit separator. An author rename changes the key. Fail: a non-object returns `""`. |
| `buildSourceChip(doc, chip, opts)` | In: `{onOpen}`. Out: a `button.pxd-chip.pxd-chip--source`. Click and Enter call `onOpen(pageUid)`. `pointerdown` and `mousedown` stop on the chip so Roam does not enter edit. Fail: a missing chip, or a doc that cannot `createElement`, returns null. |

## src/model/timeline.js

Memory lane and the daily-notes spine. No Roam calls. Play is 700 ms per month so two years finish under 20 seconds. The day is the page title, not the block's create time.

| Export | Contract |
|---|---|
| `LANE_STEP_MS` | 700 |
| `timeIndex(items)` | In: items with `uid` and `time`. Out: `{uid, time, kind}` sorted by time, then uid. `kind` defaults to `card`. Fail: a missing uid or a non-finite time is dropped. A non-array is empty. |
| `monthSteps(start, end)` | Out: month starts from `start` through `end`, including both ends. The loop stops at 600 months. Fail: an invalid date, or an end that is not after the start, returns one stamp: the start when it is finite, otherwise `Date.now()`. |
| `playMs(start, end, stepMs)` | Out: `(monthSteps(start, end).length - 1) * stepMs`, at least 0. `stepMs` defaults to `LANE_STEP_MS`. |
| `laneSets(index, t)` | Out: `{future, fresh}`. `future` is uids with `time > t`. `fresh` is uids within 7 days at or before `t`. An older event is in neither. |
| `edgeHidden(edges, itemFuture, t)` | Out: edge uids whose own `time` is after `t`, or whose `from` or `to` is in `itemFuture`. Fail: an edge without a uid is skipped. |
| `previewLayout(items)` | Out: `{layout, writes: 0}`. `layout` maps uid to `{x, y, w, h}`. Fail: an item without a uid or without finite `x` and `y` is skipped. `writes` stays 0. |
| `TIMELINE_DAY_CAP` | 365 daily pages kept after the newest-first sort. |
| `DAILY_TITLE_PATTERN` | The datalog regex source for a Roam daily title. |
| `timelineQuery(uids)` | Out: `{query, args}`. `args` is `[unique uids, DAILY_TITLE_PATTERN]`. The query finds referring blocks on pages whose title matches that pattern. Tuple order is card uid, block uid, page title, page uid, create time. Fail: blank uids are dropped. This function does not run the query. |
| `groupTimeline(rows)` | In: tuples `[cardUid, blockUid, pageTitle, pageUid, time]` or objects with those fields. Out: `[{year, days}]`, newest day first, at most `TIMELINE_DAY_CAP` days. Each day is `{date, title, pageUid, count, cardUids}`. `date` comes from `pageTitleToDate`. Fail: a row with no card uid, or a title that is not a daily page, is skipped. |
| `firstMention(rows)` | Out: a Map of card uid to the earliest daily-page date in the rows. Non-daily titles are skipped. |
| `lastMention(rows)` | Out: the same Map, using the latest daily-page date. |
| `dateSource(item, rows, mode)` | In: `mode` is `attribute`, `date attribute`, `first`, `first mention`, `last`, or `last mention` (case is ignored). Out: a local midnight, or null. Attribute mode reads `item.date`, `item.attributeDate`, a daily title, then `Date::` or `Due::`, then an `YYYY-MM-DD` in the text. It does not use `rows`. First and last modes read the mention maps for `item.uid`. Fail: an unknown mode, or a missing mention, returns null. |

## src/view/timeline.js

The year and day list in the Info panel. One click listener. No writes. Grouping is `groupTimeline` in `src/model/timeline.js`.

| Export | Contract |
|---|---|
| `mountTimeline(parent, opts)` | In: `{doc, rows, onOpenDay, onShowOnBoard}`. `doc` defaults to `globalThis.document`. Out: `{el, update, dispose}`. The element is `div.pxd-timeline`, appended to `parent`. A year button folds its days. A day click calls `onOpenDay(pageUid)`. Show on board calls `onShowOnBoard` with a Set of that day's card uids. `update` re-renders. `dispose` removes the listeners and the element, and a second call does nothing. Fail: a document that cannot `createElement` throws `mountTimeline needs a document`. No days paints `No daily notes mention this board.` A click after dispose does nothing. |

## src/model/landmarks.js

Landmarks and the walk. Pure. Reading order buckets `y` to 200 world pixels, then `x`. This is not the board's exact y-then-x outline order.

| Export | Contract |
|---|---|
| `READ_BUCKET` | 200 |
| `LANDMARK_PX` | `{S: 48, M: 72, L: 96}` |
| `MINIMAP_W` | 180 |
| `MINIMAP_H` | 120 |
| `landmarkUids(board)` | Out: uids whose item has `landmark === true`, in `board.order` or map order. Fail: no `items` returns `[]`. |
| `readingLandmarkOrder(uids, rects)` | Out: a new array sorted by `floor(y / 200)`, then `x`, then `y`, then uid. A missing rect sorts as 0, 0. |
| `nearestNextOrder(uids, rects)` | Out: reading order, then greedy nearest centre. Ties keep the smaller uid. Fail: fewer than two uids returns the reading order. |
| `neighbourhoodRect(rect, screen)` | Out: a rect at least one viewport, centred on the landmark. `screen` is `{w, h}` or `{width, height}` in world pixels. Fail: a missing rect is null. A missing screen uses the landmark's own size. |
| `membersIn(board, rects, focusRect, focusUid)` | Out: a Set of the focus uid plus every item in `board.order` whose centre lies in `focusRect`. Fail: a missing board, rects, or focus rect returns a set of the focus uid only, or an empty set when that uid is missing too. |
| `landmarkClass(item)` | Out: `pxd-item--landmark pxd-landmark--S|M|L`, or `pxd-section--landmark` for a section. Size defaults to `M`. Fail: an item that is not a landmark returns `""`. |
| `minimapScale(rects, size, vp)` | Out: `{s, ox, oy}` for a 180 by 120 map, including a 40-pixel pad and the viewport rect when `vp.zoom` is set. Fail: no finite rect returns null. |
| `landmarkDots(board, rects, vp, size)` | Out: `{uid, glyph, x, y}` in map pixels for each landmark that has a rect. `glyph` is the item glyph or `""`. Fail: a null scale, a missing board, or a missing rect yields no dot for that case. |
| `walkStops(board, rects, opts)` | In: `{mode, screen, trail}`. `mode` defaults to `reading`. Out: `{uid, rect, title, note, members}`. `reading` and `nearest` walk landmarks. `trail` walks `trail.stops` that have a rect, and keeps the stop note. Off-board stops are left out. The rect is the neighbourhood. Fail: a missing board returns `[]`. A landmark with no rect is skipped. |

## src/model/journal.js

Daily-page journal rows. No Roam calls. Titles match Roam (`October 6th, 2026`). The daily page uid is `MM-DD-YYYY`.

| Export | Contract |
|---|---|
| `startOfDay(date)` | Out: local midnight in milliseconds. A number or a parseable value is passed through `Date`. Fail: an invalid date yields `NaN`. |
| `stepDay(date, delta)` | Out: local midnight, `delta` calendar days later (not a fixed 86400000, so a DST change does not skip). `delta` defaults to 1. A non-numeric delta is 0. |
| `dailyTitle(date)` | Out: the Roam daily title for that local day. |
| `dailyUid(date)` | Out: `MM-DD-YYYY` for that local day. |
| `titleToTime(title)` | Out: `pageTitleToDate(title)`. A non-daily title is null. |
| `firstLine(string)` | Out: the text before the first newline. Fail: null becomes `""`. |
| `journalRows(tree)` | In: an array, or an object with `:block/children`, `children`, or `blocks`. Out: top-level rows `{uid, string, text}` in block order. `string` is `((uid))`. `text` is the first line. Fail: a node with no uid is skipped. A missing tree returns `[]`. |

## src/model/tabs.js

Fullscreen board tabs. A uid list on this device, capped. No Roam writes.

| Export | Contract |
|---|---|
| `TAB_CAP` | 9 |
| `tabStorageKey(graph)` | Out: `plexus-diagram:fullscreen-tabs:` plus the graph name. A missing graph leaves the suffix empty. |
| `normalizeTabs(raw)` | Out: `{uid, title}` rows, unique, at most 9. A string entry has an empty title. Fail: a non-array, a blank uid, or a repeat is dropped. |
| `openTab(tabs, entry)` | Out: `{tabs, index}`. An existing uid stays put. A new title replaces a blank or different title. Past the cap, the oldest tab drops. Fail: a missing uid returns the normalized list and index 0, or -1 when the list is empty. |
| `closeTab(tabs, uid)` | Out: `{tabs, index, removed}`. Removing a tab does not delete the board. `index` is the neighbour that slides into the gap, or -1 when the list is empty. Fail: an unknown uid returns `removed: false` and `index: -1`. |
| `tabAt(tabs, index)` | Out: the tab at that index after normalize, or null. Fail: a non-integer or an out-of-range index is null. |
| `isBoardTabEvent(ev, n)` | Out: true for Cmd or Ctrl plus digit `n` (1..9), with no Alt and no Shift. The `code` may be `DigitN` with an empty key, or the key may be the digit. Fail: a missing event, a non-integer, or `n` outside 1..9 is false. Shift+1 and Shift+2 stay the zoom shortcuts. |

## src/model/touch.js

Two-finger camera and long-press. No DOM and no writes. Zoom goes through the same `zoomAt` as a trackpad pinch.

| Export | Contract |
|---|---|
| `LONG_PRESS_MS` | 500 |
| `LONG_PRESS_OPEN_PX` | 8 |
| `LONG_PRESS_CANCEL_PX` | 20 |
| `pointerDistance(a, b)` | Out: the distance between `{x, y}` points. A missing coordinate is 0. |
| `pointerMidpoint(a, b)` | Out: `{x, y}` halfway between the points. A missing coordinate is 0. |
| `fingerPair(points)` | Out: `{a, b, dist, mid}` for the first two points, or null when there are fewer than two. |
| `pinchViewport(vp, gesture)` | In: `{dist0, mid0, dist, mid}`. Out: `{x, y, zoom}`. When both distances are positive and differ, zoom is `zoomAt` around the first midpoint by `dist / dist0`. The midpoint's move is then added as a pan. An unchanged distance is a pan only. Fail: a missing viewport is `{x: 0, y: 0, zoom: 1}`. A missing midpoint stays at the origin. |
| `longPressAt(movement, elapsed)` | Out: `cancel` when movement is at least 20. `open` when `elapsed` is at least 500 and movement is under 8. Otherwise `wait`. The band from 8 to 20 is neither. `elapsed` defaults to 500. Fail: a non-numeric movement is 0. |

## src/model/public-api.js

Frozen `window.PlexusDiagram`. Reads go through the host. `addCard` is the only write, and only after the ref and schema version checks. Thumbnail width is capped.

| Export | Contract |
|---|---|
| `API_VERSION` | 1 |
| `API_EVENTS` | `change`, `mount`, `unmount` |
| `parseAddRef(raw)` | Out: the string when it is one whole `[[Page]]` or one `((uid))`. Fail: null, empty, prose, a second ref, or a page ref that is not the whole string returns null. |
| `boardsFromRefRows(rows, pull)` | In: rows `[boardUid, pageUid, cardUid]`. `pull(boardUid)` may throw. Out: `{uid, title, card?}` for boards whose plexus `v` is 2. A repeated board keeps the first row. `card` is omitted when the child that holds the ref is not a placed card. When the tree does not hold the uid, `card` stays the row's card uid. Fail: a non-array is empty. A pull throw, or a version other than 2, skips that board. A missing title is `Untitled board`. |
| `fitThumbSize(naturalW, naturalH, maxWidth)` | Out: `{width, height}` with width at most `maxWidth`, height in proportion. Never scaled by 2. Fail: a side or a max that is not greater than 0 returns null. |
| `thumbStroke(color)` | Out: the trimmed colour string, or `#5c7080` when the value is not a string, is blank, or is `currentcolor` in any case. |
| `boardBounds(rects)` | Out: the union `{x, y, w, h}` of finite rects. Fail: no rects, or no finite rect, returns `{x: 0, y: 0, w: 160, h: 160}`. |
| `createPublicApi(opts)` | In: `{host, version, addCard, openBoard, thumbnail, tablesFromPdf, capabilities}`. `capabilities` is a frozen string list on the API and in `spec()` (e.g. `tablesFromPdf`, `tablesFromPdf.scan.helper`); `tablesFromPdf(opts)` calls the injected function and rejects `PDF tables are not available` without one. Out: a frozen API. `apiVersion` is 1. `version` is `String(version ?? "")`. `isAvailable` is true when `host.graphName()` returns a non-empty string. A throw is false. `boardsOn(pageUid)` filters `host.listBoards()` to that page. A throw returns `[]`. `boardsWith(targetUid)` runs the ref query and `boardsFromRefRows`. A query throw returns `[]`. `cardsOf(boardUid)` lists items whose type is `card`: `{uid, kind, title, rect, parent}`. No items returns `[]`. A pull that throws is not caught. `regionsOf(ownerUid)` returns `{uid, kind, caption}` from `regionsOf`. A throw returns `[]`. `viewsOf(boardUid)` returns `board.views` or `[]`. `thumbnail(boardUid, opts)` caps `maxWidth` at a positive finite value, otherwise 160, and calls `thumbnail`. No function returns undefined. `open(boardUid, opts)` calls `openBoard`, or returns undefined. `addCard(boardUid, opts)` rejects with `Error("Bad ref")` when `parseAddRef` fails, and `Error("Not a board")` when `v` is not 2. Otherwise it awaits `addCard(boardUid, string, x, y)` with `at` defaulting to 40, 40, emits `change`, and returns `{uid}`. A missing writer throws when called. `addEventListener` ignores an unknown type or a non-function. Listener throws stay inside the listener. `removeEventListener` deletes that callback. `spec` returns `{apiVersion, events, methods}`. `help` returns a one-line description of apiVersion 1. |
| `emitPublicEvent(api, type, detail)` | In: an API from `createPublicApi`, and `change`, `mount`, or `unmount`. Out: calls listeners. Fail: an unknown type, or an unknown API, does nothing. |
| `installPublicApi(api, opts)` | In: `{win, CustomEventCtor}`. `win` defaults to `globalThis.window` or `globalThis`. Out: assigns `win.PlexusDiagram` and fires `plexus-diagram:ready`. Returns true. Fail: a different value already stored there returns false and does not overwrite. A missing `CustomEvent` or a dispatch throw does not block install. |
| `uninstallPublicApi(api, opts)` | Out: deletes `win.PlexusDiagram` only when it is still this object, fires `plexus-diagram:unload`, and returns whether it was ours. Fail: a delete that throws still fires unload and returns false. |

## src/host/pdf-tables.js

`createPdfTables({store, helper, pdfjs, fetchBytes, sha256, ocrSource})` returns `{tablesFromPdf, capabilities}`; `window.PlexusDiagram.tablesFromPdf` is that function. Nothing is fetched or read at creation. No graph writes.

`tablesFromPdf({url, pages?, scan?: "auto" | "off", ocrSource?, signal?})` resolves `{tables, engine, scanned, scanPages, ocrPages, needsOcr, ocr: {source: "helper" | "injected" | null, state}, from: "cache" | "parse" | "ocr" | "cache+ocr", pageCount}`. `pages` is a list of 1-based page numbers. Each table is `{id, page, caption, rows, cols, merged, confidence, source, spec}` and `spec` is the `createTableFromModel` argument from `toGridModelSpec`: `{rows, merges, headerRows (count), columnAlignments | null, widths (px by column) | null, enhance: true}`. Order: the cached parse (also the cached OCR read), else the built-in engine on the PDF bytes (`fetchBytes(url)`, only after the call). Scan pages are read through `opts.ocrSource`, else the creation `ocrSource`, else the helper when its health is `ready`; a source is any object with `ocr({bytes, sha256, pages, signal})` returning pxd-ocr/1 pages. `scan: "off"` never runs OCR. `needsOcr` lists scan pages still unread; `ocr.state` is the helper state when no source is ready. A full-range parse is cached; a partial one is not. Errors carry `code`: `bad-url`, `no-pdfjs`, `no-fetch`, `fetch-failed`.

| Export | Contract |
|---|---|
| `PDF_TABLES_CAPABILITIES` | `tablesFromPdf`, `tablesFromPdf.cache`, `tablesFromPdf.scan.helper`, `tablesFromPdf.scan.source` |
| `tablesOfDoc(doc, wanted)` | In: a pxd-parse/1 document and an optional Set of pages. Out: the table list above. Tables with no cells are dropped. |
| `createPdfTables(deps)` | See above. |

## src/host/roam.js

Additions since the 2.0 contract. These are methods and a field on the object `createHost` returns. They are not `export function` names. The rest of the host stays in `docs/api-plexus-1.0.md`.

| Export | Contract |
|---|---|
| `blockExists(uid)` | In: a block uid. Out: false for a non-string or an empty uid. Otherwise one fresh `[:block/uid]` pull, not the board cache. True when that pull returns a block. False when the pull returns nothing. Fail: a pull that throws returns true, so a failed read is not treated as a missing block. No write. |
| `lastAction` | Field `stats.lastAction`, absent until a `group` closes with at least one write or an adopted create. Then `{label, writes}`. `label` is the string passed to `group`, or the write kinds in that chunk joined with `+`. `writes` is the chunk's write count. A nested `group` call does not close the outer group. Groups still hold at most 45 writes. This field is not itself a write. |
| `cardStats(targets, opts)` | In: `{kind, uid or title}` targets and `{boardUid}`. Out: a Map. Keys are `uid:<uid>` or `page:<title>`. Values are `{refs, boards, open, done}`. A fresh cache hit returns copies and does not pull. Otherwise one `data.pull_many` of `STATS_PULL` for the resolved entity ids. Fail: a throw from `pull_many`, or a result the host cannot use, falls back to four collection-bound Datalog queries (refs, boards, open TODOs, done TODOs). A missing `pull_many` uses `data.pull` once per entity. A throw from that pull uses the same four queries. Neither pull function uses the four queries. An empty target list, or targets that do not resolve, returns the zeroed Map and does not pull. No write. |
